const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { canBindCommandCenter } = require('../src/navigation.cjs');
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
