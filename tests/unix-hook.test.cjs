const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractInput, runHook } = require('../src/notificar-unix.cjs');
const { runWorker } = require('../src/notificar-unix-worker.cjs');

test('hook extracts only nonempty response strings and preserves literal backslashes', () => {
  const text = 'olá 😀 C:\\new\\file\nnext line';
  assert.equal(extractInput(JSON.stringify({ last_assistant_message: text })).text, text);
  assert.equal(extractInput(JSON.stringify({ last_assistant_message: {}, content: 'fallback' })).text, 'fallback');
  assert.equal(extractInput(JSON.stringify({ output: 'last' })).text, 'last');
  assert.equal(extractInput(`  ${text}  `).text, text);
  for (const input of ['', '  ', '{broken', '["metadata"]', '{"session_id":"private"}', '{"content":{"text":"secret"}}']) {
    assert.equal(extractInput(input).text, '', input);
  }
});

test('worker is detached with metadata only, even when clipboard fails', () => {
  let captured;
  let unref = false;
  runHook(JSON.stringify({ last_assistant_message: 'PRIVATE', session_id: 's', transcript_path: '/tmp/log', turn_id: 't', cwd: 'SECRET' }), {
    platform: 'linux', copy: () => { throw new Error('clipboard unavailable'); },
    spawn: (...args) => { captured = args; return { on() {}, unref() { unref = true; } }; }
  });
  assert.equal(captured[0], process.execPath);
  assert.equal(captured[1][1], path.resolve(__dirname, '../src/notificar-unix-worker.cjs'));
  const metadata = JSON.parse(Buffer.from(captured[1][2], 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(metadata).sort(), ['codex_root', 'observed_at', 'session_id', 'transcript_path', 'turn_id']);
  assert.equal(metadata.codex_root, path.resolve(__dirname, '..'));
  assert.equal(metadata.session_id, 's');
  assert.equal(Number.isNaN(Date.parse(metadata.observed_at)), false);
  assert.equal(JSON.stringify(metadata).includes('PRIVATE'), false);
  assert.deepEqual(captured[2], { detached: true, stdio: 'ignore', shell: false });
  assert.equal(unref, true);
});

test('empty input still starts the notification worker and worker spawn failures stay silent', () => {
  let workers = 0;
  runHook('', { platform: 'darwin', copy: text => assert.equal(text, ''), spawn: () => { workers++; throw new Error('spawn failed'); } });
  assert.equal(workers, 1);
});

test('worker uses the shared metrics reader and excludes response text from notifications', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-worker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transcript = path.join(root, 'log.jsonl');
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: 'session', thread_name: 'Session title' }));
  fs.writeFileSync(transcript, [
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, cached_input_tokens: 50 } } } },
    { type: 'response_item', payload: { text: 'PRIVATE' } }
  ].map(event => JSON.stringify(event)).join('\n'));
  let notification;
  await runWorker({ codex_root: root, session_id: 'session', transcript_path: transcript }, {
    platform: 'linux', find: name => name, run: (command, args) => { notification = [command, args]; return { status: 0 }; }
  });
  assert.equal(notification[0], 'notify-send');
  assert.equal(notification[1].at(-2), 'Session title');
  assert.match(notification[1].at(-1), /Total 120/);
  assert.equal(JSON.stringify(notification).includes('PRIVATE'), false);
});

test('Unix hook subprocess copies UTF-8 stdin and detached worker notifies with fake commands', { skip: process.platform === 'win32' ? 'Unix executable fixture requires macOS/Linux; adapters are tested on Windows above.' : false }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, 'notdex');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(installed);
  fs.mkdirSync(bin);
  for (const name of ['desktop.cjs', 'notificar-unix.cjs', 'notificar-unix-worker.cjs', 'notificar-metricas.cjs']) fs.copyFileSync(path.join(__dirname, '../src', name), path.join(installed, name));
  const clipboard = path.join(root, 'clipboard');
  const notification = path.join(root, 'notification');
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); if (['pbcopy','wl-copy'].includes(path.basename(process.argv[1]))) { if (process.env.NOTDEX_HANG) setInterval(()=>{},1000); else fs.writeFileSync(process.env.NOTDEX_CLIP, fs.readFileSync(0)); } else fs.writeFileSync(process.env.NOTDEX_NOTICE, JSON.stringify(process.argv.slice(2)));\n`;
  for (const command of process.platform === 'darwin' ? ['pbcopy', 'osascript'] : ['wl-copy', 'notify-send']) fs.writeFileSync(path.join(bin, command), fake, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: 's', thread_name: '-Session 😀' }));
  const text = 'PRIVATE ação 😀 C:\\new\\file\n`$(oops)`';
  const env = { ...process.env, PATH: bin, WAYLAND_DISPLAY: 'wayland-0', DISPLAY: '', NOTDEX_CLIP: clipboard, NOTDEX_NOTICE: notification };
  const result = spawnSync(process.execPath, [path.join(installed, 'notificar-unix.cjs')], {
    input: JSON.stringify({ last_assistant_message: text, session_id: 's' }), encoding: 'utf8', timeout: 5000,
    env
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(fs.readFileSync(clipboard, 'utf8'), text);
  for (let attempt = 0; attempt < 100 && !fs.existsSync(notification); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  const notice = JSON.parse(fs.readFileSync(notification, 'utf8'));
  assert.equal(notice.at(-2), '-Session 😀');
  assert.match(notice.at(-1), /Total N\/D/);
  assert.equal(JSON.stringify(notice).includes('PRIVATE'), false);
  fs.unlinkSync(notification);
  const started = Date.now();
  const hung = spawnSync(process.execPath, [path.join(installed, 'notificar-unix.cjs')], {
    input: JSON.stringify({ content: 'must not overwrite', session_id: 's' }), timeout: 5000, env: { ...env, NOTDEX_HANG: '1' }
  });
  assert.equal(hung.status, 0);
  assert.ok(Date.now() - started < 4000, 'hung clipboard command must be killed');
  for (let attempt = 0; attempt < 100 && !fs.existsSync(notification); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(JSON.parse(fs.readFileSync(notification, 'utf8')).at(-2), '-Session 😀', 'clipboard timeout must not suppress notification');
  const empty = spawnSync(process.execPath, [path.join(installed, 'notificar-unix.cjs')], { input: '{broken', timeout: 5000, env });
  assert.equal(empty.status, 0);
  assert.equal(fs.readFileSync(clipboard, 'utf8'), text);
});
