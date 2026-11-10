const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { activate, deactivate } = require('../scripts/shell-integration.cjs');

for (const platform of ['linux', 'darwin', 'win32']) test(`${platform}: shell activation is idempotent and removal preserves user edits`, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-shell-'));
  const directory = path.join(home, 'runtime'); fs.mkdirSync(directory);
  let registryValue = 'C:\\existing';
  const registry = { documents: path.join(home, 'Documents'), read: () => registryValue,
    write: (before, after) => { assert.equal(registryValue, before); registryValue = after; } };
  const profile = platform === 'win32' ? path.join(home, 'Documents/WindowsPowerShell/profile.ps1') : path.join(home, '.bashrc');
  fs.mkdirSync(path.dirname(profile), { recursive: true }); fs.writeFileSync(profile, '# original\n');
  const options = { homeDir: home, platform, registry, env: {} };
  activate(directory, options); activate(directory, options);
  const content = fs.readFileSync(profile, 'utf8').replace(/^\ufeff/, '');
  assert(content.startsWith('# original\n')); assert.equal(content.split('# BEGIN NotDex CLI').length, 2);
  if (platform === 'win32') assert(registryValue.startsWith(path.join(directory, 'bin') + ';'));
  fs.appendFileSync(profile, '# added later\n');
  deactivate(directory, options);
  assert.equal(fs.readFileSync(profile, 'utf8').replace(/^\ufeff/, ''), '# original\n# added later\n');
  assert.equal(registryValue, 'C:\\existing');
});

test('Windows preserves a UTF16LE profile byte-for-byte on activation/removal', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-shell-encoding-'));
  const directory = path.join(home, 'runtime'); fs.mkdirSync(directory);
  const profile = path.join(home, 'Documents/WindowsPowerShell/profile.ps1');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  const bytes = Buffer.from('\ufeff$env:KEEP="café"\r\n', 'utf16le'); fs.writeFileSync(profile, bytes);
  let value = 'C:\\upstream;' + path.join(directory, 'bin');
  const registry = { documents: path.join(home, 'Documents'), read: () => value, write: (before, after) => { assert.equal(value, before); value = after; } };
  const options = { platform: 'win32', homeDir: home, registry };
  activate(directory, options);
  assert(value.startsWith(path.join(directory, 'bin') + ';'));
  deactivate(directory, options);
  assert(fs.readFileSync(profile).equals(bytes));
  assert.equal(value, 'C:\\upstream');
});

test('an edited managed block is rejected without changing the shell file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-shell-edit-'));
  const directory = path.join(home, 'runtime'); fs.mkdirSync(directory);
  const options = { homeDir: home, platform: 'linux', env: {} };
  activate(directory, options);
  const file = path.join(home, '.bashrc');
  const edited = fs.readFileSync(file, 'utf8').replace('export PATH=', 'export EDITED_PATH=');
  fs.writeFileSync(file, edited);
  assert.throws(() => deactivate(directory, options), /edited/i);
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
