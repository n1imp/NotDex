const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TranscriptMonitor } = require('../src/monitor.cjs');
const { readAccount } = require('../src/account.cjs');

test('tail handles partial records, append, truncation and session changes without retaining response text', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-monitor-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions/a.jsonl');
  const context = JSON.stringify({ type: 'turn_context', payload: { turn_id: 't', model: 'gpt-6.1-sol' } });
  const record = JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 's', turn_id: 't', response_id: 'r',
    usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
    turn_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 },
    thread_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 }
  } });
  fs.writeFileSync(file, context + '\n' + record.slice(0, 40));
  const monitor = new TranscriptMonitor({ codexRoot: root }); t.after(() => monitor.close());
  assert(monitor.attach({ session_id: 's', turn_id: 't', transcript_path: file }));
  await monitor.tick(); assert.equal(monitor.snapshot().turn.total_tokens, null);
  fs.appendFileSync(file, record.slice(40) + '\n' + JSON.stringify({ type: 'response_item', payload: { text: 'PRIVATE RESPONSE' } }) + '\n');
  await monitor.tick(); assert.equal(monitor.snapshot().turn.total_tokens, 110);
  assert(!JSON.stringify(monitor.snapshot()).includes('PRIVATE RESPONSE'));
  fs.writeFileSync(file, context + '\n'); await monitor.tick(); assert.equal(monitor.snapshot().session.total_tokens, null);
  const other = path.join(root, 'sessions/b.jsonl'); fs.writeFileSync(other, '');
  monitor.attach({ session_id: 'other', transcript_path: other }); await monitor.tick();
  assert.equal(monitor.snapshot().session_id, 'other'); assert.equal(monitor.snapshot().turn.total_tokens, null);
  assert.equal(monitor.attach({ session_id: 'bad', transcript_path: path.join(root, 'auth.json') }), false);
});

test('account client uses read-only methods, accepts actual plan/quota and never returns identity fields', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-account-'));
  const file = path.join(root, 'fake-codex.cjs');
  fs.writeFileSync(file, `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(r.id==null)return;let result;if(r.method==='initialize')result={};else if(r.method==='account/read')result={account:{type:'chatgpt',planType:'plus',email:'PRIVATE_EMAIL'}};else if(r.method==='account/rateLimits/read')result={rateLimits:{planType:'plus',primary:{usedPercent:23,windowDurationMins:300,resetsAt:9999999999}}};else throw Error('Unexpected or paid method');console.log(JSON.stringify({id:r.id,result}));});`);
  const result = await readAccount({ file: process.execPath, args: [file] });
  assert.equal(result.plan, 'plus'); assert.equal(result.quota.primary.used_percent, 23);
  assert(!JSON.stringify(result).includes('PRIVATE_EMAIL'));
});
