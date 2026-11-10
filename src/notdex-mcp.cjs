const readline = require('node:readline');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { metadata, publishEvent } = require('./bridge.cjs');

const TOOL = {
  name: 'notdex_event', description: 'Internal Codex lifecycle callback for NotDex clipboard, notifications and local observability.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['event', 'session_id'], properties: {
    event: { type: 'string', enum: ['prompt', 'stop'] }, session_id: { type: 'string' },
    ...Object.fromEntries(['turn_id', 'transcript_path', 'cwd', 'model', 'last_assistant_message'].map(key => [key, { type: ['string', 'null'] }]))
  } },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
};

function valid(data) {
  return data && typeof data === 'object' && ['prompt', 'stop'].includes(data.event) && typeof data.session_id === 'string' && data.session_id.length > 0 && data.session_id.length <= 200 &&
    Object.entries(data).every(([key, value]) => Object.hasOwn(TOOL.inputSchema.properties, key) && (value === null || typeof value === 'string'));
}

function serve({ input = process.stdin, output = process.stdout, enqueue, publish = publishEvent } = {}) {
  let worker;
  const spawnWorker = () => {
    worker = new Worker(path.join(__dirname, 'mission-worker.cjs'), { stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    worker.on('error', () => { worker = null; });
  };
  if (!enqueue) {
    spawnWorker();
    enqueue = data => { if (!worker) spawnWorker(); worker.postMessage(data); };
  }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let pendingDispatches = 0, closeRequested = false, shutdownSent = false;
  const finish = () => {
    if (closeRequested && !pendingDispatches && !shutdownSent) {
      shutdownSent = true;
      try { worker?.postMessage({ event: 'shutdown' }); } catch {}
    }
  };
  const send = (id, result, error, after) => output.write(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...(error ? { error } : { result }) }) + '\n', after);
  lines.on('line', line => {
    let message;
    try { if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw Error('Oversized'); message = JSON.parse(line); }
    catch { send(null, null, { code: -32700, message: 'Invalid JSON message' }); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { send(null, null, { code: -32600, message: 'Invalid request' }); return; }
    if (message.id === undefined) return;
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      send(message.id, { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(requested) ? requested : '2025-11-25',
        serverInfo: { name: 'NotDex', version: '0.2.0' }, capabilities: { tools: {} } });
    } else if (message.method === 'ping') send(message.id, {});
    else if (message.method === 'tools/list') send(message.id, { tools: [TOOL] });
    else if (message.method === 'tools/call' && message.params?.name === TOOL.name && valid(message.params.arguments)) {
      const data = message.params.arguments;
      pendingDispatches++;
      // Flush the ACK before any OS work; the worker thread can block independently.
      send(message.id, { content: [{ type: 'text', text: '{}' }], structuredContent: {} }, null, () => {
        try { Promise.resolve(publish(metadata(data))).catch(() => {}); } catch {}
        if (data.event === 'stop') { try { enqueue(data); } catch {} }
        pendingDispatches--; finish();
      });
    } else send(message.id, null, { code: message.method === 'tools/call' ? -32602 : -32601, message: 'Unsupported method or invalid arguments' });
  });
  const close = () => {
    if (!closeRequested) { closeRequested = true; lines.close(); }
    finish();
  };
  lines.on('close', close); input.on('error', close); output.on('error', close);
  return close;
}

module.exports = { serve, valid };
if (require.main === module) { try { serve(); } catch { process.exitCode = 0; } }
