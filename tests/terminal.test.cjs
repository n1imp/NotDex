const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('@lydell/node-pty');
const { Terminal } = require('@xterm/headless');

test('real PTY wrapper renders metrics, moves/switches/hides the overlay, resizes and forwards Codex input', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-terminal-'));
  fs.mkdirSync(path.join(root, 'sessions')); fs.mkdirSync(path.join(root, 'notdex'));
  const transcript = path.join(root, 'sessions/fixture.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'turn_context', payload: { turn_id: 't', model: 'gpt-6.1-sol' } },
    { type: 'token_usage_record', payload: { thread_id: 's', turn_id: 't', response_id: 'r',
      usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
      turn_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
      thread_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const fixture = path.join(root, 'fake-codex.cjs');
  fs.writeFileSync(fixture, `
if(process.argv.includes('app-server')){
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id==null)return;const result=r.method==='account/read'?{account:{type:'chatgpt',planType:'plus',email:'SECRET_EMAIL'}}:r.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:23,windowDurationMins:300},secondary:{usedPercent:37,windowDurationMins:10080}}}:{};console.log(JSON.stringify({id:r.id,result}));});
}else{
 process.stdin.setRawMode(true); process.stdin.resume();
 process.stdout.write('\\x1b[?1049h\\x1b[HCLI_FIXTURE\\x1b[12;1HREADY');
 const body=JSON.stringify({event:'prompt',session_id:'s',turn_id:'t',transcript_path:${JSON.stringify(transcript)},model:'gpt-6.1-sol'});
 const req=require('node:http').request(process.env.NOTDEX_OVERLAY_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+process.env.NOTDEX_OVERLAY_TOKEN,'content-type':'application/json'}},r=>r.resume());req.on('error',()=>{});req.end(body);
 process.stdin.on('data',data=>{if(data.includes('z'))process.stdout.write('\\x1b[13;1HINPUT_Z');if(data.includes('q'))process.exit(0);});
}
`);
  const screen = new Terminal({ cols: 100, rows: 24, allowProposedApi: true });
  const inputAudit = path.join(root, 'synthetic-input.txt'), wrapper = path.join(root, 'wrapper.cjs');
  fs.writeFileSync(wrapper, `process.stdin.on('data',data=>require('node:fs').appendFileSync(${JSON.stringify(inputAudit)},Buffer.from(data).toString('hex')+'\\n'));require(${JSON.stringify(path.resolve(__dirname, '../src/terminal.cjs'))}).main();`);
  const child = pty.spawn(process.execPath, [wrapper, '--codex', fixture, '--codex-home', root], {
    cols: 100, rows: 24, cwd: root, env: { ...process.env, TERM: 'xterm-256color' }
  });
  let exited = false, code;
  const exit = new Promise(resolve => child.onExit(result => { exited = true; code = result.exitCode; resolve(); }));
  let outputTail = '';
  child.onData(data => { outputTail = (outputTail + data).slice(-4000); screen.write(data); });
  t.after(() => { if (!exited || process.platform === 'win32') { try { child.kill(); } catch {} } screen.dispose(); });
  const lines = () => Array.from({ length: screen.rows }, (_, i) => screen.buffer.active.getLine(screen.buffer.active.baseY + i)?.translateToString() || '');
  const wait = async condition => {
    for (let i = 0; i < 300; i++) { if (condition()) return; if (exited) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail('Terminal condition not reached: ' + lines().join('\n') + '\nSynthetic input hex: ' + (fs.existsSync(inputAudit) ? fs.readFileSync(inputAudit, 'utf8') : 'none'));
  };
  await wait(() => lines().some(line => line.includes('Total 110')) && lines().some(line => line.includes('Conta plus')));
  assert(lines()[0].indexOf('NotDex') > 50);
  assert(!lines().join('').includes('SECRET_EMAIL'));
  if (process.env.NOTDEX_TEST_SCREEN) fs.writeFileSync(process.env.NOTDEX_TEST_SCREEN, JSON.stringify({ cols: screen.cols, rows: screen.rows,
    cells: Array.from({ length: screen.rows }, (_, y) => Array.from({ length: screen.cols }, (_, x) => {
      const cell = screen.buffer.active.getLine(screen.buffer.active.baseY + y)?.getCell(x);
      return { text: cell?.getChars() || ' ', fg: cell?.getFgColor(), bg: cell?.getBgColor() };
    })) }));
  child.write('\x1b[24~'); child.write('\x1b[D'.repeat(3) + '\x1b[B'.repeat(2) + '\t');
  await wait(() => lines()[2]?.includes('NotDex / Requisicao'));
  assert.equal(lines()[2].indexOf('NotDex'), 51);
  screen.resize(70, 18); child.resize(70, 18);
  await wait(() => lines()[2]?.includes('NotDex / Requisicao') && lines()[2].indexOf('NotDex') === 24);
  child.write('h');
  await wait(() => !lines().some(line => line.includes('NotDex')) && lines()[0].includes('CLI_FIXTURE'));
  child.write('z'); await wait(() => lines().some(line => line.includes('INPUT_Z')));
  child.write('q'); await exit; assert.equal(code, 0, outputTail);
});
