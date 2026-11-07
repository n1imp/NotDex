const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function fixture(manager, { answer = 'y\n', disabled = false, desktop = true, wayland = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-linux-deps-'));
  const log = path.join(root, 'packages.log');
  const script = (name, body) => fs.writeFileSync(path.join(root, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  script('uname', 'printf "Linux\\n"');
  script('id', 'printf "1000\\n"');
  script(manager, 'printf "%s\\n" "$*" >> "$NOTDEX_PACKAGES_LOG"');
  script('sudo', 'printf "sudo %s\\n" "$*" >> "$NOTDEX_PACKAGES_LOG"; exec "$@"');
  const result = spawnSync('/bin/sh', ['-c', 'set -eu; . "$1"; notdex_linux_dependencies "$2"', 'deps',
    path.join(__dirname, '../scripts/linux-deps.sh'), String(disabled)], {
    input: answer, encoding: 'utf8', env: { ...process.env, PATH: root, NOTDEX_PACKAGES_LOG: log,
      DISPLAY: desktop && !wayland ? ':fixture' : '', WAYLAND_DISPLAY: desktop && wayland ? 'wayland-fixture' : '' }
  });
  return { result, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

for (const [manager, notify] of [['apt-get', 'libnotify-bin'], ['dnf', 'libnotify'], ['pacman', 'libnotify'], ['zypper', 'libnotify-tools']]) {
  test(`${manager}: package installation runs only after consent`, { skip: process.platform === 'win32' }, () => {
    const { result, log } = fixture(manager);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(log.includes(notify));
    assert.ok(log.includes('xclip'));
    assert.ok(log.includes('sudo'));
  });
}

test('Wayland selects wl-clipboard and declining performs no package actions', { skip: process.platform === 'win32' }, () => {
  const accepted = fixture('apt-get', { wayland: true });
  assert.equal(accepted.result.status, 0, accepted.result.stderr);
  assert.ok(accepted.log.includes('wl-clipboard'));
  const declined = fixture('apt-get', { answer: 'n\n' });
  assert.notEqual(declined.result.status, 0);
  assert.equal(declined.log, '');
});

test('headless and explicit package opt-out never execute sudo', { skip: process.platform === 'win32' }, () => {
  for (const options of [{ desktop: false }, { disabled: true }]) {
    const { result, log } = fixture('apt-get', options);
    assert.notEqual(result.status, 0);
    assert.equal(log, '');
  }
});
