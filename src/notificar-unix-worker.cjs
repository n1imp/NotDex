const { getSessionMetrics } = require('./notificar-metricas.cjs');
const { notify } = require('./desktop.cjs');

async function runWorker(data, options) {
  try { return notify(await getSessionMetrics({ ...data, scope: 'turn' }), options); } catch { return false; }
}

module.exports = { runWorker };
if (require.main === module) {
  (async () => {
    try { await runWorker(JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))); } catch {}
    process.exit(0);
  })();
}
