const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { getSessionMetrics } = require('../src/notificar-metricas.cjs');

function fixture(events, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toast-metrics-'));
  const transcript = path.join(root, 'rollout.jsonl');
  fs.writeFileSync(transcript, events.map(event => typeof event === 'string' ? event : JSON.stringify(event)).join('\n'));
  return { codex_root: root, session_id: 'session-1', transcript_path: transcript, ...extra };
}

test('legacy counters use session totals without counting cache or reasoning twice', async () => {
  const stats = await getSessionMetrics(fixture([
    { type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 1000, cached_input_tokens: 750, output_tokens: 200, reasoning_output_tokens: 100, total_tokens: 1200 },
      last_token_usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }
    } } },
    { type: 'event_msg', payload: { type: 'token_count', info: null } },
    '{partial final record'
  ]));
  assert.equal(stats.input_tokens, 1000);
  assert.equal(stats.output_tokens, 200);
  assert.equal(stats.total_tokens, 1200);
  assert.equal(stats.cache_hit_pct, 75);
});

test('current records use thread totals and ignore another thread and response text', async () => {
  const stats = await getSessionMetrics(fixture([
    { type: 'token_usage_record', payload: { thread_id: 'session-1',
      usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
      turn_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      thread_token_usage: { input_tokens: 4000, cached_input_tokens: 3000, output_tokens: 500, total_tokens: 4500 }
    } },
    { type: 'token_usage_record', payload: { thread_id: 'other-session', thread_token_usage: { input_tokens: 99999 } } },
    { type: 'response_item', payload: { type: 'message', content: 'PRIVATE_RESPONSE_NOT_FOR_TOAST' } }
  ]));
  assert.equal(stats.total_tokens, 4500);
  assert.equal(stats.cache_hit_pct, 75);
  assert.equal(JSON.stringify(stats).includes('PRIVATE_RESPONSE_NOT_FOR_TOAST'), false);
});

test('latency uses the completed target turn duration', async () => {
  const stats = await getSessionMetrics(fixture([
    { timestamp: '2026-11-05T12:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-11-05T12:01:00Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', duration_ms: 12345 } },
    { timestamp: '2026-11-05T12:02:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } },
    { timestamp: '2026-11-05T12:03:00Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-2', duration_ms: 60000 } }
  ], { turn_id: 'turn-1', observed_at: '2026-11-05T12:05:00Z' }));
  assert.equal(stats.latency_ms, 12345);
  assert.equal(stats.latency_is_estimate, false);
});

test('unfinished log uses hook arrival as an approximate end', async () => {
  const stats = await getSessionMetrics(fixture([
    { timestamp: '2026-11-05T12:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }
  ], { turn_id: 'turn-1', observed_at: '2026-11-05T12:00:45Z' }));
  assert.equal(stats.latency_ms, 45000);
  assert.equal(stats.latency_is_estimate, true);
});

test('missing data stays unknown and zero input does not cause division by zero', async () => {
  const missing = await getSessionMetrics(fixture([]));
  assert.equal(missing.total_tokens, null);
  assert.equal(missing.cache_hit_pct, null);
  assert.equal(missing.latency_ms, null);
  const zero = await getSessionMetrics(fixture([
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0
    } } } }
  ]));
  assert.equal(zero.total_tokens, 0);
  assert.equal(zero.cache_hit_pct, null);
});

test('latest valid index title matches the exact session', async () => {
  const data = fixture([]);
  fs.writeFileSync(path.join(data.codex_root, 'session_index.jsonl'), [
    JSON.stringify({ id: 'session-1', thread_name: 'Old title' }),
    JSON.stringify({ id: 'other-session', thread_name: 'Wrong title' }),
    '{invalid record',
    JSON.stringify({ id: 'session-1', thread_name: 'Sess\u00e3o & <Windows>' })
  ].join('\n'));
  assert.equal((await getSessionMetrics(data)).title, 'Sess\u00e3o & <Windows>');
});

test('database fallback resolves title and transcript without modifying the database', async () => {
  const data = fixture([
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
      input_tokens: 2000, cached_input_tokens: 1000, output_tokens: 400, total_tokens: 2400
    } } } }
  ]);
  const database = path.join(data.codex_root, 'state_5.sqlite');
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, name TEXT, rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('session-1', 'Original title', 'Renamed session', data.transcript_path);
  db.close();
  delete data.transcript_path;
  const hash = () => createHash('sha256').update(fs.readFileSync(database)).digest('hex');
  const before = hash();
  const stats = await getSessionMetrics(data);
  assert.equal(stats.title, 'Renamed session');
  assert.equal(stats.total_tokens, 2400);
  assert.equal(stats.cache_hit_pct, 50);
  assert.equal(hash(), before);
});

test('database metadata works when the optional name column is absent', async () => {
  const data = fixture([]);
  const db = new DatabaseSync(path.join(data.codex_root, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run('session-1', 'Legacy session title', data.transcript_path);
  db.close();
  delete data.transcript_path;
  assert.equal((await getSessionMetrics(data)).title, 'Legacy session title');
});
