const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TranscriptMonitor } = require('../src/monitor.cjs');
const { readAccount } = require('../src/account.cjs');

test('session lookup is exact, retries missing paths and clears metrics when switching sessions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-routing-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(root, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
  const file = path.join(root, 'sessions/selected.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 90, cached_input_tokens: 45, output_tokens: 10 } } } }) + '\n');
  const monitor = new TranscriptMonitor({ codexRoot: root });
  t.after(() => { monitor.close(); db.close(); });
  assert(monitor.attach({ event: 'start', session_id: 'selected' }));
  await monitor.tick(); assert.equal(monitor.snapshot().session.total_tokens, null);
  db.prepare('INSERT INTO threads VALUES (?, ?)').run('selected', file);
  await monitor.tick(); assert.equal(monitor.snapshot().session.total_tokens, 100);
  assert(monitor.attach({ event: 'start', session_id: 'unknown' }));
  assert.equal(monitor.snapshot().session_id, 'unknown');
  await monitor.tick(); assert.equal(monitor.snapshot().session.total_tokens, null);
});

test('a stale lifecycle turn does not pin the panel to an earlier turn', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-turn-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions/a.jsonl');
  fs.writeFileSync(file, ['old', 'new'].flatMap((id, n) => [
    { type: 'turn_context', payload: { turn_id: id, model: 'gpt-6.1-sol' } },
    { type: 'token_usage_record', payload: { thread_id: 's', turn_id: id, response_id: id, usage: { input_tokens: 100 * (n + 1), cached_input_tokens: 0, output_tokens: 10 }, turn_token_usage: { input_tokens: 100 * (n + 1), cached_input_tokens: 0, output_tokens: 10 } } }
  ]).map(x => JSON.stringify(x)).join('\n') + '\n');
  const monitor = new TranscriptMonitor({ codexRoot: root }); t.after(() => monitor.close());
  monitor.attach({ event: 'stop', session_id: 's', turn_id: 'old', transcript_path: file });
  await monitor.tick(); assert.equal(monitor.snapshot().turn_id, 'new'); assert.equal(monitor.snapshot().turn.total_tokens, 210);
  monitor.attach({ event: 'prompt', session_id: 's', turn_id: 'next', model: 'gpt-6.1-sol' });
  assert.equal(monitor.snapshot().turn.total_tokens, null);
  monitor.detach();
  monitor.attach({ event: 'prompt', session_id: 's', turn_id: 'next', model: 'gpt-6.1-sol', transcript_path: file });
  await monitor.tick(); assert.equal(monitor.snapshot().turn_id, 'next');
  assert.equal(monitor.snapshot().turn.total_tokens, null);
});

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
