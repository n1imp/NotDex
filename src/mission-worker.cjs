const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { runHook } = require(process.platform === 'win32' ? './notificar-windows.cjs' : './notificar-unix.cjs');
const seen = new Set();

parentPort.on('message', data => {
  if (data.event === 'shutdown') { parentPort.close(); return; }
  try {
    const key = data.session_id + ':' + (data.turn_id || '') + ':' + createHash('sha256').update(data.last_assistant_message || '').digest('hex');
    if (seen.has(key)) return;
    seen.add(key); if (seen.size > 64) seen.delete(seen.values().next().value);
    runHook(JSON.stringify(data));
  } catch {}
});
