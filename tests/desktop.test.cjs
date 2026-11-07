const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findExecutable, copyText, formatNotification, notify } = require('../src/desktop.cjs');

test('executable lookup respects platform PATH delimiter and Windows extensions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node.cmd'), '');
  fs.writeFileSync(path.join(bin, 'copy'), '', { mode: 0o755 });
  assert.equal(findExecutable('node', { Path: `${root};${bin}`, PATHEXT: '.EXE;.CMD' }, 'win32'), path.join(bin, 'node.cmd'));
  assert.equal(findExecutable('copy', { PATH: bin }, 'linux'), path.join(bin, 'copy'));
  assert.equal(findExecutable('missing', { PATH: bin }, 'linux'), null);
  assert.equal(findExecutable('bin', { PATH: root }, 'linux'), null);
});

test('clipboard sends literal response only through stdin with a bounded child', () => {
  const calls = [];
  const text = 'ação 😀 C:\\new\\file `$(touch nope)`';
  assert.equal(copyText(text, { platform: 'darwin', find: name => name, run: (...args) => { calls.push(args); return { status: 0 }; } }), true);
  assert.equal(calls[0][0], 'pbcopy');
  assert.deepEqual(calls[0][1], []);
  assert.equal(calls[0][2].input, text);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].timeout, 1500);
  assert.equal(calls[0][2].killSignal, 'SIGKILL');
});

test('Linux uses Wayland first and falls back to X11 tools after failure', () => {
  const calls = [];
  const run = (command, args) => { calls.push([command, args]); return { status: command === 'xsel' ? 0 : 1 }; };
  assert.equal(copyText('text', { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, find: name => name, run }), true);
  assert.deepEqual(calls, [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]]);
});

test('empty clipboard input and unavailable graphical sessions launch no commands', () => {
  const run = () => { throw new Error('must not run'); };
  assert.equal(copyText('', { platform: 'darwin', run }), false);
  assert.equal(copyText('hello', { platform: 'linux', env: {}, run }), false);
  assert.equal(copyText('hello', { platform: 'win32', run }), false);
});

test('notification body contains only metrics and marks unknown and estimated values', () => {
  const stats = { title: '-title "&" 😀', total_tokens: 1200, input_tokens: 1000, output_tokens: 200, cache_hit_pct: 75, latency_ms: 12345, latency_is_estimate: true, response: 'PRIVATE' };
  assert.deepEqual(formatNotification(stats), { title: '-title "&" 😀', body: 'Total 1.200 | 🔵 In 1.000 | 🟠 Out 200\n🟢 Cache 75,0% | Lat. turno ~12,3s' });
  assert.deepEqual(formatNotification({}), { title: 'Codex', body: 'Total N/D | 🔵 In N/D | 🟠 Out N/D\n🟢 Cache N/D | Lat. turno N/D' });
  assert.equal(formatNotification({ latency_ms: 125000 }).body.endsWith('2m 05s'), true);
});

test('native notifications keep all data in argv and delegate sound to the OS', () => {
  const calls = [];
  const options = { find: name => name, run: (...args) => { calls.push(args); return { status: 0 }; } };
  const title = '-hostile "title"\n😀';
  notify({ title }, { ...options, platform: 'darwin' });
  assert.equal(calls[0][0], 'osascript');
  assert.equal(calls[0][1][0], '-e');
  assert.equal(calls[0][1][1].includes(title), false);
  assert.match(calls[0][1][1], /on run argv/);
  assert.match(calls[0][1][1], /sound name "Glass"/);
  assert.equal(calls[0][1][2], '--');
  assert.equal(calls[0][1][3], title);
  notify({ title }, { ...options, platform: 'linux' });
  assert.equal(calls[1][0], 'notify-send');
  assert.deepEqual(calls[1][1].slice(0, -1), ['--app-name=NotDex', '--hint=string:sound-name:message-new-instant', '--', title]);
  assert.equal(calls.every(call => call[2].shell === false && call[2].timeout === 1500), true);
});

test('desktop command failures are silent', () => {
  const options = { platform: 'darwin', find: name => name, run: () => { throw new Error('unavailable'); } };
  assert.equal(copyText('text', options), false);
  assert.equal(notify({}, options), false);
});
