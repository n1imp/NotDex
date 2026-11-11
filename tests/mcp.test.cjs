const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

test('SessionStart publishes only metadata and never schedules clipboard, sound or toast', async () => {
  const { serve } = require('../src/notdex-mcp.cjs');
  const input = new PassThrough(), output = new PassThrough(); let published;
  output.resume();
  const close = serve({ input, output, enqueue() { assert.fail('start dispatched mission work'); }, publish(data) { published = data; } });
  input.write(JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'notdex_event', arguments: { event: 'start', session_id: 's' } } }) + '\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(published, { event: 'start', session_id: 's' }); close();
});

test('resident protocol replies before enqueueing work and excludes response text from overlay metadata', async () => {
  const { serve } = require('../src/notdex-mcp.cjs');
  const input = new PassThrough(), output = new PassThrough(), order = [], replies = [];
  output.on('data', line => { replies.push(JSON.parse(line)); order.push('reply'); });
  const close = serve({ input, output, enqueue(data) { order.push('work'); assert.equal(data.last_assistant_message, 'PRIVATE'); },
    publish(data) { assert.equal(data.last_assistant_message, undefined); } });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'notdex_event', arguments: {
    event: 'stop', session_id: 'session', turn_id: 'turn', last_assistant_message: 'PRIVATE'
  } } }) + '\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['reply', 'work']);
  assert.deepEqual(JSON.parse(replies[0].result.content[0].text), {});
  assert(!JSON.stringify(replies).includes('PRIVATE'));
  close();
});

test('protocol handles initialize, tools, malformed JSON and invalid parameters without executing work', async () => {
  const { serve } = require('../src/notdex-mcp.cjs');
  const input = new PassThrough(), output = new PassThrough(), replies = [];
  output.on('data', line => replies.push(JSON.parse(line)));
  const close = serve({ input, output, enqueue() { throw Error('must not dispatch'); }, publish() {} });
  input.write('{bad\n');
  input.write(JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  input.write(JSON.stringify({ id: 2, method: 'tools/list' }) + '\n');
  input.write(JSON.stringify({ id: 3, method: 'tools/call', params: { name: 'notdex_event', arguments: { event: 'other', session_id: 's' } } }) + '\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].result.protocolVersion, '2025-06-18');
  assert.equal(replies[2].result.tools.length, 1);
  assert.equal(replies[3].error.code, -32602);
  close();
});

test('actual MCP process answers a second request while its mission thread is blocked', { timeout: 150000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-mcp-'));
  for (const file of ['notdex-mcp.cjs', 'bridge.cjs']) fs.copyFileSync(path.join(__dirname, '../src', file), path.join(root, file));
  const started = path.join(root, 'started'), release = path.join(root, 'release');
  fs.writeFileSync(path.join(root, 'mission-worker.cjs'), `const {parentPort}=require('node:worker_threads'),fs=require('node:fs');parentPort.on('message',data=>{if(data.event==='shutdown'){parentPort.close();return;}fs.writeFileSync(${JSON.stringify(started)},'started');while(!fs.existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);});`);
  const child = spawn(process.execPath, [path.join(root, 'notdex-mcp.cjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const replies = new Map(), pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line); replies.set(reply.id, reply); pending.get(reply.id)?.(reply); });
  const wait = (id, timeout = 5000) => replies.has(id) ? Promise.resolve(replies.get(id)) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('MCP reply missing')), timeout);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
  });
  const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  // Cold process startup is separate from the five-second deadline of a resident hook.
  send(1, 'initialize', { protocolVersion: '2025-06-18' }); await wait(1, 120000);
  send(2, 'tools/call', { name: 'notdex_event', arguments: { event: 'stop', session_id: 's', turn_id: 't', last_assistant_message: 'synthetic' } });
  assert((await wait(2)).result);
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(started) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert(fs.existsSync(started), 'worker did not start');
  send(3, 'ping'); assert((await wait(3)).result);
  assert.equal(fs.existsSync(release), false, 'MCP waited for blocking work');
  fs.writeFileSync(release, 'release');
});

test('overlay client rejects non-loopback destinations and never publishes assistant responses', async () => {
  const { publishEvent } = require('../src/bridge.cjs');
  assert.equal(await publishEvent({ event: 'stop', session_id: 's' }, { env: { NOTDEX_OVERLAY_ENDPOINT: 'https://example.com/event', NOTDEX_OVERLAY_TOKEN: 'x' }, request() { throw Error('external request'); } }), false);
});
