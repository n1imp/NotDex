const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { MetricsAccumulator } = require('./observability.cjs');

function getSessionMetadata(data, { includeTitle = true } = {}) {
  const result = { title: '' };
  let transcript = data.transcript_path;
  if (data.session_id) {
    if (includeTitle) try {
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
  result.transcript_path = transcript;
  return result;
}

async function getSessionMetrics(data) {
  const metadata = getSessionMetadata(data);
  const result = {
    title: metadata.title, input_tokens: null, cached_input_tokens: null, output_tokens: null,
    total_tokens: null, cache_hit_pct: null, latency_ms: null, latency_is_estimate: false
  };
  const transcript = metadata.transcript_path;

  const metrics = new MetricsAccumulator({ sessionId: data.session_id });
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(transcript), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!/"(?:token_count|token_usage_record|task_started|task_complete|turn_context|session_meta)"/.test(line)) continue;
      try { metrics.consume(JSON.parse(line)); } catch {}
    }
  } catch {}
  const snapshot = metrics.snapshot({ turnId: data.turn_id || undefined, now: data.observed_at });
  const scope = ['session', 'turn', 'request'].includes(data.scope) ? data.scope : 'session';
  Object.assign(result, snapshot[scope]);
  if (scope === 'session') {
    result.latency_ms = snapshot.turn.latency_ms;
    result.latency_is_estimate = snapshot.turn.latency_is_estimate;
  }
  Object.assign(result, { scopes: { session: snapshot.session, turn: snapshot.turn, request: snapshot.request },
    plan: snapshot.plan, quota: snapshot.quota, pricing_source: snapshot.pricing_source, pricing_date: snapshot.pricing_date });

  return result;
}

module.exports = { getSessionMetrics, getSessionMetadata };
if (require.main === module) {
  (async () => {
    const data = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
    const stats = await getSessionMetrics(data);
    process.stdout.write(Buffer.from(JSON.stringify(stats), 'utf8').toString('base64'));
  })().catch(() => { process.exitCode = 0; });
}
