const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

async function getSessionMetrics(data) {
  const result = {
    title: '', input_tokens: null, cached_input_tokens: null, output_tokens: null,
    total_tokens: null, cache_hit_pct: null, latency_ms: null, latency_is_estimate: false
  };
  let transcript = data.transcript_path;
  if (data.session_id) {
    try {
      for (const line of fs.readFileSync(path.join(data.codex_root, 'session_index.jsonl'), 'utf8').split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry.id === data.session_id && typeof entry.thread_name === 'string' && entry.thread_name.trim()) {
            result.title = entry.thread_name;
          }
        } catch {}
      }
    } catch {}
    if (!result.title || !transcript) {
      try {
        const file = fs.readdirSync(data.codex_root).filter(name => /^state_\d+\.sqlite$/.test(name))
          .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0];
        if (file) {
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(path.join(data.codex_root, file), { readOnly: true });
          try {
            const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(column => column.name));
            const selection = ['title', 'name', 'rollout_path'].map(column => columns.has(column) ? column : 'NULL AS ' + column).join(',');
            const row = db.prepare('SELECT ' + selection + ' FROM threads WHERE id = ?').get(data.session_id);
            if (row) {
              result.title ||= row.name || row.title || '';
              transcript ||= row.rollout_path;
            }
          } finally { db.close(); }
        }
      } catch {}
    }
  }
  result.title ||= 'Codex';

  let usage = null;
  let start = null;
  let activeTurn = null;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(transcript), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!/"(?:token_count|token_usage_record|task_started|task_complete)"/.test(line)) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const payload = event.payload || {};
      let candidate = null;
      if (event.type === 'token_usage_record' && (!payload.thread_id || payload.thread_id === data.session_id)) {
        candidate = payload.thread_token_usage;
      } else if (event.type === 'event_msg' && payload.type === 'token_count') {
        candidate = payload.info?.total_token_usage;
      }
      if (candidate && (number(candidate.input_tokens) !== null || number(candidate.output_tokens) !== null)) usage = candidate;
      if (event.type !== 'event_msg' || (data.turn_id && payload.turn_id !== data.turn_id)) continue;
      if (payload.type === 'task_started') {
        const timestamp = Date.parse(event.timestamp);
        start = Number.isFinite(timestamp) ? timestamp : number(payload.started_at) === null ? null : payload.started_at * 1000;
        activeTurn = payload.turn_id;
        result.latency_ms = null;
      } else if (payload.type === 'task_complete' && (!activeTurn || !payload.turn_id || payload.turn_id === activeTurn)) {
        const end = Date.parse(event.timestamp);
        result.latency_ms = number(payload.duration_ms);
        if (result.latency_ms === null && start !== null && Number.isFinite(end) && end >= start) result.latency_ms = end - start;
      }
    }
  } catch {}
  for (const field of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens']) result[field] = number(usage?.[field]);
  if (result.total_tokens === null && result.input_tokens !== null && result.output_tokens !== null) {
    result.total_tokens = result.input_tokens + result.output_tokens;
  }
  if (result.input_tokens > 0 && result.cached_input_tokens !== null && result.cached_input_tokens <= result.input_tokens) {
    result.cache_hit_pct = 100 * result.cached_input_tokens / result.input_tokens;
  }
  const observed = Date.parse(data.observed_at);
  if (result.latency_ms === null && start !== null && Number.isFinite(observed) && observed >= start) {
    result.latency_ms = observed - start;
    result.latency_is_estimate = true;
  }
  return result;
}

module.exports = { getSessionMetrics };
if (require.main === module) {
  (async () => {
    const data = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
    const stats = await getSessionMetrics(data);
    process.stdout.write(Buffer.from(JSON.stringify(stats), 'utf8').toString('base64'));
  })().catch(() => { process.exitCode = 0; });
}
