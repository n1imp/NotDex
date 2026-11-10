const test = require('node:test');
const assert = require('node:assert/strict');
const { MetricsAccumulator } = require('../src/observability.cjs');
const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output });
const start = (id, at = '2026-11-10T12:00:00Z') => ({ timestamp: at, type: 'event_msg', payload: { type: 'task_started', turn_id: id } });
const context = (id, model = 'gpt-6.1-sol') => ({ type: 'turn_context', payload: { turn_id: id, model } });
const record = (id, turn, tokens, turnTokens = tokens, threadTokens = turnTokens) => ({ type: 'token_usage_record', payload: {
  thread_id: 'session', response_id: id, turn_id: turn, usage: tokens, turn_token_usage: turnTokens, thread_token_usage: threadTokens
} });

test('canonical session/turn/request totals stay separate; repeated response IDs and late legacy events do not double count', () => {
  const metrics = new MetricsAccumulator({ sessionId: 'session' });
  const events = [start('a'), context('a'), record('r1', 'a', usage(1000, 900, 100)),
    start('b'), context('b'), record('r2', 'b', usage(100, 50, 10), usage(100, 50, 10), usage(1100, 950, 110)),
    record('r3', 'b', usage(200, 100, 20), usage(300, 150, 30), usage(1300, 1050, 130)),
    record('r3', 'b', usage(200, 100, 20), usage(300, 150, 30), usage(1300, 1050, 130)),
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(100, 0, 1) } } }];
  events.forEach(event => metrics.consume(event));
  const result = metrics.snapshot();
  assert.equal(result.session.total_tokens, 1430);
  assert.equal(result.turn.total_tokens, 330);
  assert.equal(result.request.total_tokens, 220);
  assert.equal(result.turn.cache_hit_pct, 50);
  assert.equal(result.session.usd_reference, '0.001905');
  assert.equal(result.turn.usd_reference, '0.000615');
  assert.equal(result.request.usd_reference, '0.000410');
  assert.equal(metrics.snapshot({ turnId: 'a' }).turn.total_tokens, 1100);
});

test('incomplete history, unknown models, unspecified cache-write lifetime and invalid cache counts never invent a dollar amount', () => {
  for (const [model, request, thread] of [
    ['gpt-6.1-sol', usage(100, 0, 10), usage(1000, 0, 100)],
    ['unknown-model', usage(100, 0, 10), usage(100, 0, 10)],
    ['gpt-6.1-sol', { ...usage(100, 0, 10), cache_write_input_tokens: 50 }, usage(100, 0, 10)],
    ['gpt-6.1-sol', usage(100, 101, 10), usage(100, 101, 10)]
  ]) {
    const metrics = new MetricsAccumulator({ sessionId: 'session' });
    metrics.consume(context('a', model));
    metrics.consume(record('r1', 'a', request, thread, thread));
    assert.equal(metrics.snapshot().session.usd_reference, null);
  }
});

test('API Standard reference prices apply long-context rates per request, never to aggregate input; reasoning is not billed twice', () => {
  const metrics = new MetricsAccumulator({ sessionId: 'session' });
  metrics.consume(context('a'));
  const first = { ...usage(200000, 100000, 1000), reasoning_output_tokens: 800 };
  metrics.consume(record('r1', 'a', first));
  const second = usage(300000, 200000, 1000);
  const total = usage(500000, 300000, 2000);
  metrics.consume(record('r2', 'a', second, total, total));
  assert.equal(metrics.snapshot().turn.usd_reference, '0.675000');
});

test('real plan and quota windows are account data, separate from tokens and money, and support zero usage', () => {
  const metrics = new MetricsAccumulator({ sessionId: 'session' });
  metrics.consume({ timestamp: '2026-11-10T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: null,
    rate_limits: { limit_id: 'codex', plan_type: 'plus', primary: { used_percent: 0, window_minutes: 300, resets_at: 123 },
      secondary: { used_percent: 37, window_minutes: 10080, resets_at: 456 } }
  } });
  const result = metrics.snapshot();
  assert.equal(result.plan, 'plus');
  assert.equal(result.quota.primary.used_percent, 0);
  assert.equal(result.quota.secondary.used_percent, 37);
  assert.equal(result.session.usd_reference, null);
  assert.equal(result.turn.plan_share_pct, undefined);
});

test('legacy cumulative deltas require a baseline and are scoped to the requested turn', () => {
  const metrics = new MetricsAccumulator({ sessionId: 'session' });
  const legacy = tokens => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: tokens, last_token_usage: usage(10, 0, 1) } } });
  metrics.consume(legacy(usage(100, 50, 10)));
  metrics.consume(start('a')); metrics.consume(context('a'));
  metrics.consume(legacy(usage(150, 70, 20)));
  metrics.consume({ timestamp: '2026-11-10T12:00:03Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'a', duration_ms: 3000 } });
  metrics.consume(start('b', '2026-11-10T12:01:00Z'));
  metrics.consume(legacy(usage(300, 100, 30)));
  const result = metrics.snapshot({ turnId: 'a' });
  assert.equal(result.turn.total_tokens, 60);
  assert.equal(result.turn.latency_ms, 3000);
  assert.equal(result.turn.usd_reference, null);
  const missing = new MetricsAccumulator(); missing.consume(start('a')); missing.consume(legacy(usage(999, 0, 1)));
  assert.equal(missing.snapshot().turn.total_tokens, null);
});

test('another thread cannot overwrite the selected thread; incomplete duration remains explicitly estimated', () => {
  const metrics = new MetricsAccumulator({ sessionId: 'session' });
  metrics.consume(start('a')); metrics.consume(context('a')); metrics.consume(record('r1', 'a', usage(100, 0, 10)));
  metrics.consume({ type: 'token_usage_record', payload: { thread_id: 'other', thread_token_usage: usage(99999, 0, 1) } });
  const result = metrics.snapshot({ now: '2026-11-10T12:00:02Z' });
  assert.equal(result.turn.latency_ms, 2000);
  assert.equal(result.turn.latency_is_estimate, true);
  assert.equal(result.session.total_tokens, 110);
  assert.equal(result.request.latency_ms, null);
});
