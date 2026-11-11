const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { canBindCommandCenter } = require('../src/navigation.cjs');

test('native navigation context distinguishes the center, editor, empty composer and active turn', async t => {
  const { Terminal } = require('@xterm/headless');
  const { navigationContext } = require('../src/navigation.cjs');
  const terminal = new Terminal({ cols: 100, rows: 24, allowProposedApi: true }); t.after(() => terminal.dispose());
  const write = data => new Promise(resolve => terminal.write(data, resolve));
  await write('\x1b[H  \x1b[1mAgent command center\x1b[22m  Group: Project\x1b[?25l');
  assert.deepEqual(navigationContext(terminal, false), { kind: 'center', editing: false });
  await write('\x1b[4;1HSearch › abc\x1b[?25h');
  assert.deepEqual(navigationContext(terminal, true), { kind: 'center', editing: true });
  await write('\x1b[2J\x1b[20;1H› Ask Codex to do anything\x1b[24;1H  ← for agents · ? for shortcuts\x1b[20;3H');
  assert.deepEqual(navigationContext(terminal, true), { kind: 'chat', canGoDashboard: true });
  await write('DRAFT'); assert.equal(navigationContext(terminal, true).canGoDashboard, false);
  await write('\x1b[20;1H\x1b[2K› \x1b[23;1Hesc to interrupt\x1b[20;3H');
  assert.equal(navigationContext(terminal, true).canGoDashboard, false);
  await write('\x1b[2J\x1b[H  Agent command center  Group: Project\x1b[?25l');
  assert.deepEqual(navigationContext(terminal, false), { kind: 'unknown' });
});
test('forwarded -C/--cd selects the destination project when checking existing bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-cd-'));
  const home = path.join(root, 'home'), a = path.join(root, 'a'), b = path.join(root, 'b');
  for (const directory of [home, a, path.join(b, '.codex')]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(b, '.codex/config.toml'), '[tui.keymap.global]\ncopy=["f9"]\n');
  assert(canBindCommandCenter(home, a));
  for (const args of [['-C', b], ['--cd', '../b'], ['--cd=../b'], ['-C../b']]) assert.equal(canBindCommandCenter(home, a, args), false);
});
test('F9 uses a native override only when user/profile/project bindings leave it free', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-keymap-'));
  const home = path.join(root, 'home'), cwd = path.join(root, 'project/subdirectory');
  fs.mkdirSync(home); fs.mkdirSync(cwd, { recursive: true });
  assert(canBindCommandCenter(home, cwd));
  assert(!canBindCommandCenter(home, cwd, ['-c', 'tui.keymap.global.copy=["f9"]']));
  fs.writeFileSync(path.join(home, 'config.toml'), '[profiles.custom.tui.keymap.global]\ncopy=["f9 x"]\n');
  assert(!canBindCommandCenter(home, cwd));
  fs.writeFileSync(path.join(home, 'config.toml'), '[tui.keymap.global]\ncopy=["ctrl-y"]\n');
  assert(canBindCommandCenter(home, cwd));
  fs.mkdirSync(path.join(root, 'project/.codex'));
  fs.writeFileSync(path.join(root, 'project/.codex/config.toml'), '[tui.keymap.global]\ncopy=["f9"]\n');
  assert(!canBindCommandCenter(home, cwd));
});
