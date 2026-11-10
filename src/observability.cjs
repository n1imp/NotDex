const { requestPrice, dollarString, SOURCE, CHECKED_AT } = require('./prices.cjs');
const FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens'];
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function normalizeUsage(raw) {
  const result = Object.fromEntries(FIELDS.map(field => [field, number(raw?.[field])]));
  if (result.total_tokens === null && result.input_tokens !== null && result.output_tokens !== null) result.total_tokens = number(result.input_tokens + result.output_tokens);
  result.cache_write_input_tokens = raw && Object.hasOwn(raw, 'cache_write_input_tokens') ? number(raw.cache_write_input_tokens) : 0;
  return result;
}

function hasUsage(raw) { return raw && (number(raw.input_tokens) !== null || number(raw.output_tokens) !== null); }
function difference(current, baseline) {
  if (!baseline) return null;
  const result = {};
  for (const field of FIELDS) {
    const a = number(current?.[field]), b = number(baseline?.[field]);
    result[field] = a !== null && b !== null && a >= b ? a - b : null;
  }
  return result;
}

function normalizeQuota(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const window = value => {
    if (!value) return null;
    const used = value.used_percent ?? value.usedPercent;
    const minutes = value.window_minutes ?? value.windowDurationMins;
    return typeof used === 'number' && Number.isFinite(used) && used >= 0
      ? { used_percent: used, window_minutes: number(minutes), resets_at: number(value.resets_at ?? value.resetsAt) } : null;
  };
  return { limit_id: raw.limit_id ?? raw.limitId ?? 'codex', primary: window(raw.primary), secondary: window(raw.secondary) };
}

class MetricsAccumulator {
  constructor({ sessionId } = {}) {
    this.sessionId = sessionId;
    this.turns = new Map();
    this.requests = new Map();
    this.latestTurnId = null;
    this.canonical = null;
    this.legacy = null;
    this.plan = null;
    this.quota = null;
    this.updatedAt = null;
    this.freshSession = false;
  }

  turn(id) {
    if (!this.turns.has(id)) this.turns.set(id, { id, model: null, start: null, duration: null, baseline: null, legacy: null, canonical: null, request: null });
    return this.turns.get(id);
  }

  consume(event) {
    if (!event || typeof event !== 'object') return;
    const payload = event.payload || {};
    if (payload.thread_id && this.sessionId && payload.thread_id !== this.sessionId) return;
    if (event.type === 'session_meta') this.freshSession = !payload.forked_from_id;
    if (event.type === 'turn_context') {
      const id = payload.turn_id || this.latestTurnId;
      if (id) { this.turn(id).model = typeof payload.model === 'string' ? payload.model : null; this.latestTurnId = id; }
    }
    if (event.type === 'token_usage_record') {
      const id = payload.turn_id || this.latestTurnId;
      const existing = payload.response_id ? this.requests.get(payload.response_id) : null;
      const model = typeof payload.model === 'string' ? payload.model : existing?.model || this.turns.get(id)?.model;
      const signature = JSON.stringify([normalizeUsage(payload.usage), normalizeUsage(payload.turn_token_usage), normalizeUsage(payload.thread_token_usage), model, number(payload.duration_ms)]);
      if (existing?.signature === signature) return;
      if (hasUsage(payload.thread_token_usage)) this.canonical = normalizeUsage(payload.thread_token_usage);
      if (id) {
        if (!existing || !this.latestTurnId) this.latestTurnId = id;
        const turn = this.turn(id);
        if (hasUsage(payload.turn_token_usage)) turn.canonical = normalizeUsage(payload.turn_token_usage);
        if (hasUsage(payload.usage)) {
          const request = { turnId: id, model, signature,
            usage: normalizeUsage(payload.usage), duration: number(payload.duration_ms), id: payload.response_id || null };
          if (!existing || turn.request?.id === request.id) turn.request = request;
          if (request.id) this.requests.set(request.id, request);
        }
      }
    }
    if (event.type === 'event_msg') {
      if (payload.type === 'task_started') {
        const id = payload.turn_id;
        if (!id) return;
        const turn = this.turn(id);
        turn.start = Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : number(payload.started_at) !== null ? payload.started_at * 1000 : null;
        turn.baseline = this.legacy || (this.freshSession ? normalizeUsage({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }) : null);
        this.latestTurnId = id;
      } else if (payload.type === 'task_complete') {
        const id = payload.turn_id || this.latestTurnId;
        if (id) {
          const turn = this.turn(id), end = Date.parse(event.timestamp);
          turn.duration = number(payload.duration_ms);
          if (turn.duration === null && turn.start !== null && Number.isFinite(end) && end >= turn.start) turn.duration = end - turn.start;
          this.latestTurnId = id;
        }
      } else if (payload.type === 'token_count') {
        if (payload.rate_limits && (!payload.rate_limits.limit_id || payload.rate_limits.limit_id === 'codex')) {
          this.quota = normalizeQuota(payload.rate_limits);
          this.plan = typeof payload.rate_limits.plan_type === 'string' ? payload.rate_limits.plan_type : this.plan;
          this.quotaUpdatedAt = event.timestamp || null;
        }
        if (hasUsage(payload.info?.total_token_usage)) {
          this.legacy = normalizeUsage(payload.info.total_token_usage);
          if (this.latestTurnId) {
            const turn = this.turn(this.latestTurnId);
            turn.legacy = difference(this.legacy, turn.baseline);
            if (!turn.canonical && hasUsage(payload.info.last_token_usage)) turn.request = {
              turnId: turn.id, model: turn.model, usage: normalizeUsage(payload.info.last_token_usage), duration: null, id: null
            };
          }
        }
      }
    }
    if (event.timestamp && Number.isFinite(Date.parse(event.timestamp))) this.updatedAt = event.timestamp;
  }

  price(usage, requests) {
    if (!usage || !requests.length) return null;
    let cost = 0n;
    const totals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
    for (const request of requests) {
      const value = requestPrice(request.model, request.usage);
      if (value === null) return null;
      cost += value;
      for (const field of Object.keys(totals)) totals[field] += request.usage[field];
    }
    if (Object.keys(totals).some(field => totals[field] !== usage[field])) return null;
    return dollarString(cost);
  }

  snapshot({ turnId = this.latestTurnId, now } = {}) {
    const turn = this.turns.get(turnId);
    const requests = [...this.requests.values()];
    const make = (scope, raw, cost, duration = null, estimated = false, model = null) => {
      const usage = normalizeUsage(raw);
      const validCache = usage.input_tokens > 0 && usage.cached_input_tokens !== null && usage.cached_input_tokens <= usage.input_tokens;
      return { ...usage, scope, cache_hit_pct: validCache ? 100 * usage.cached_input_tokens / usage.input_tokens : null,
        latency_ms: duration, latency_is_estimate: estimated, usd_reference: cost, model };
    };
    const sessionUsage = this.canonical || this.legacy;
    const turnUsage = turn?.canonical || turn?.legacy;
    let duration = turn?.duration ?? null, estimated = false;
    const observed = typeof now === 'number' ? now : Date.parse(now);
    if (duration === null && turn?.start !== null && turn?.start !== undefined && Number.isFinite(observed) && observed >= turn.start) {
      duration = observed - turn.start; estimated = true;
    }
    const request = turn?.request;
    return {
      session: make('session', sessionUsage, this.price(sessionUsage, requests)),
      turn: make('turn', turnUsage, this.price(turnUsage, requests.filter(item => item.turnId === turnId)), duration, estimated, turn?.model),
      request: make('request', request?.usage, request ? dollarString(requestPrice(request.model, request.usage)) : null, request?.duration ?? null, false, request?.model),
      turn_id: turnId || null, request_id: request?.id || null, plan: this.plan, quota: this.quota,
      updated_at: this.updatedAt, quota_updated_at: this.quotaUpdatedAt || null, pricing_source: SOURCE, pricing_date: CHECKED_AT
    };
  }
}

module.exports = { MetricsAccumulator, normalizeUsage, normalizeQuota };
