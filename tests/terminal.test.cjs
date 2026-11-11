const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('@lydell/node-pty');
const { Terminal } = require('@xterm/headless');
const { install } = require('../scripts/setup.cjs');
const { realEnvironment } = require('../src/codex.cjs');

test('real PTY wrapper renders metrics, moves/switches/hides the overlay, resizes and forwards Codex input', { timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-terminal-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const transcript = path.join(root, 'sessions/fixture.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'turn_context', payload: { turn_id: 't', model: 'gpt-6.1-sol' } },
    { type: 'token_usage_record', payload: { thread_id: 's', turn_id: 't', response_id: 'r',
      usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
      turn_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 },
      thread_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const second = path.join(root, 'sessions/second.jsonl');
  fs.writeFileSync(second, fs.readFileSync(transcript, 'utf8').replaceAll('"s"', '"second"').replaceAll(':100', ':200').replaceAll(':10}', ':20}'));
  const fixture = path.join(root, 'fake-codex.cjs');
  fs.writeFileSync(fixture, `
if(process.argv.includes('app-server')){
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id==null)return;const result=r.method==='account/read'?{account:{type:'chatgpt',planType:'plus',email:'SECRET_EMAIL'}}:r.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:23,windowDurationMins:300},secondary:{usedPercent:37,windowDurationMins:10080}}}:{};console.log(JSON.stringify({id:r.id,result}));});
}else{
 process.stdin.setRawMode(true); process.stdin.resume();
 if(!process.argv.includes('tui.keymap.global.open_agents=["f9"]'))throw Error('Missing native command-center binding');
 for(const key of ['NOTDEX_OVERLAY_ENDPOINT','NOTDEX_OVERLAY_TOKEN'])if(!process.argv.includes('mcp_servers.notdex.env.'+key+'='+JSON.stringify(process.env[key])))throw Error('Missing per-window routing');
 process.stdout.write('\\x1b[?1049h\\x1b[HCLI_FIXTURE\\x1b[6;1H\\x1b[48;2;41;41;41m\\x1b[2K\\x1b[1;2m› \\x1b[22mUSER_COLOR_FIXTURE\\x1b[0m\\x1b[12;1HREADY\\x1b[24;1H← for agents · ? for shortcuts\\x1b[20;1H› \\x1b]10;?\\x07\\x1b]11;?\\x07');
 const body=JSON.stringify({event:'prompt',session_id:'s',turn_id:'t',transcript_path:${JSON.stringify(transcript)},model:'gpt-6.1-sol'});
 const req=require('node:http').request(process.env.NOTDEX_OVERLAY_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+process.env.NOTDEX_OVERLAY_TOKEN,'content-type':'application/json'}},r=>r.resume());req.on('error',()=>{});req.end(body);
 let center=false;
 process.stdout.on('resize',()=>{if(!center){const rows=process.stdout.rows||24;process.stdout.write('\\x1b[H\\x1b[2JCLI_FIXTURE\\x1b['+rows+';1H← for agents · ? for shortcuts\\x1b['+(rows-4)+';1H› ');}});
 process.stdin.on('data',data=>{
  if(data.includes('rgb:')){process.stdout.write('\\x1b[14;1HTHEME_ACK\\x1b[20;3H');return;}
  if(data.includes('\\x1b[20~')){center=true;process.stdout.write('\\x1b[H\\x1b[2J\\x1b[1mAgent command center\\x1b[22m  Group: Project');}
  if(center&&(data.includes('\\r')||data.includes('\\x1b[C'))){center=false;process.stdout.write('\\x1b[H\\x1b[2JCLI_FIXTURE\\x1b[24;1H← for agents · ? for shortcuts\\x1b[20;1H› ');
   const r=require('node:http').request(process.env.NOTDEX_OVERLAY_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+process.env.NOTDEX_OVERLAY_TOKEN}},r=>r.resume());r.on('error',()=>{});r.end(JSON.stringify({event:'start',session_id:'second',transcript_path:${JSON.stringify(second)}}));
  }
  if(data.includes('z'))process.stdout.write('\\x1b[13;1HINPUT_Z\\x1b['+((process.stdout.rows||24)-4)+';3H');if(data.includes('q')||data.includes('\\x03'))process.exit(0);
  if(data.includes('b')){const r=require('node:http').request(process.env.NOTDEX_OVERLAY_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+process.env.NOTDEX_OVERLAY_TOKEN}},r=>{r.resume();process.stdout.write('\\x1b[15;1HLATE_STOP_ACK');});r.on('error',()=>{});r.end(JSON.stringify({event:'stop',session_id:'s',turn_id:'t',transcript_path:${JSON.stringify(transcript)}}));}
 });
}
`);
  const screen = new Terminal({ cols: 100, rows: 24, allowProposedApi: true });
  install({ codexHome: root, env: { ...process.env, DISPLAY: ':fixture' }, find: () => fixture, run: () => ({ status: 0, stdout: 'codex-cli 0.167.0' }) });
  const windows = process.platform === 'win32';
  const shell = windows ? path.join(process.env.SystemRoot, 'System32/cmd.exe') : '/bin/sh';
  const terminalEnv = { ...realEnvironment(process.env, path.join(root, 'notdex/bin')), PATH: path.join(root, 'notdex/bin'), TERM: 'xterm-256color', COLORTERM: 'truecolor', CODEX_HOME: root };
  delete terminalEnv.NO_COLOR; delete terminalEnv.FORCE_COLOR;
  const child = pty.spawn(shell, windows ? ['/d', '/c', 'codex'] : ['-c', 'exec codex'], {
    cols: 100, rows: 24, cwd: root, env: terminalEnv
  });
  let exited = false, code;
  const exit = new Promise(resolve => child.onExit(result => { exited = true; code = result.exitCode; resolve(); }));
  let outputTail = '';
  for (const slot of [10, 11]) screen.parser.registerOscHandler(slot, data => {
    if (data !== '?') return false;
    const report = '\x1b]' + slot + ';rgb:' + (slot === 10 ? 'ffff/ffff/ffff' : '0000/0000/0000') + '\x1b\\';
    child.write(report); return true;
  });
  child.onData(data => { outputTail = (outputTail + data).slice(-4000); screen.write(data); });
  t.after(() => { if (!exited || process.platform === 'win32') { try { child.kill(); } catch {} } screen.dispose(); });
  const lines = () => Array.from({ length: screen.rows }, (_, i) => screen.buffer.active.getLine(screen.buffer.active.baseY + i)?.translateToString() || '');
  const wait = async (condition, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (condition()) return; if (exited) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail('Terminal condition not reached: ' + lines().join('\n') + '\nOutput tail: ' + outputTail);
  };
  await wait(() => lines().some(line => line.includes('Total 110')) && lines().some(line => line.includes('Conta plus')), 120000);
  assert(lines()[0].indexOf('NotDex') > 50);
  assert(!lines().join('').includes('SECRET_EMAIL'));
  // Windows Node TTY drops OSC input records; verify the no-color-report fallback there.
  if (!windows) await wait(() => lines().some(line => line.includes('THEME_ACK')));
  if (!windows) await wait(() => screen.buffer.active.getLine(5).getCell(2).getFgColor() === 0x00ffff);
  else await wait(() => screen.buffer.active.getLine(5).getCell(2).isBold());
  assert(screen.buffer.active.getLine(5).getCell(2).isBgDefault());
  child.write('\x1b[24~\x1b[20~');
  await wait(() => lines()[0].includes('Agent command center') && !lines().some(line => line.includes('NotDex')));
  child.write('\x1b[C'); await new Promise(resolve => setTimeout(resolve, 150));
  assert(lines()[0].includes('Agent command center'));
  child.write('\x1b'); await new Promise(resolve => setTimeout(resolve, 150));
  assert(lines()[0].includes('Agent command center')); assert(!lines().some(line => line.includes('NotDex')));
  child.write('\r');
  await wait(() => lines().some(line => line.includes('Sessao second')) && lines().some(line => line.includes('Total 220')));
  assert(!lines().some(line => line.includes('Total 110')));
  child.write('b'); await wait(() => lines().some(line => line.includes('LATE_STOP_ACK')));
  await new Promise(resolve => setTimeout(resolve, 600));
  assert(lines().some(line => line.includes('Sessao second')));
  assert(lines().some(line => line.includes('Total 220')));
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
  child.write('\x1b'); await wait(() => lines()[0].includes('Agent command center'));
  child.write('\x03'); await exit; assert.equal(code, 0, outputTail);
});
