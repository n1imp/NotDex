const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const toml = require('smol-toml');
const { install, uninstall } = require('../scripts/setup.cjs');

test('existing inline hooks keep one source, migrate JSON definitions and retain trust and unrelated TOML', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-inline-'));
  const original = '# Keep comments\n[features]\nhooks=true\n[[hooks.SessionStart]]\nmatcher="startup"\n[[hooks.SessionStart.hooks]]\ntype="command"\ncommand="echo inline"\n[hooks.state]\nmarker="preserve"\n';
  const hooks = { description: 'Keep backup metadata', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo json' }] }] } };
  fs.writeFileSync(path.join(home, 'config.toml'), original);
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify(hooks));
  const options = { codexHome: home, env: { ...process.env, DISPLAY: ':fixture' }, find: () => process.execPath, run: () => ({ status: 0, stdout: 'codex-cli 0.167.0' }) };
  install(options); install(options);
  const text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), config = toml.parse(text);
  assert(text.startsWith(original));
  assert.equal(fs.existsSync(path.join(home, 'hooks.json')), false);
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, 'echo inline');
  assert.equal(config.hooks.state.marker, 'preserve');
  assert.equal(config.hooks.Stop.flatMap(group => group.hooks).filter(h => h.server === 'notdex').length, 1);
  assert(config.hooks.Stop.flatMap(group => group.hooks).some(h => h.command === 'echo json'));
  uninstall(options);
  const after = toml.parse(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'));
  assert.equal(after.hooks.Stop[0].hooks[0].command, 'echo json');
  assert.equal(after.hooks.state.marker, 'preserve');
  assert.equal(after.hooks.UserPromptSubmit, undefined);
});

test('edited managed hook ownership fields cannot leave orphan handlers during uninstall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex-inline-edited-'));
  const options = { codexHome: home, env: { ...process.env, DISPLAY: ':fixture' }, find: () => process.execPath, run: () => ({ status: 0, stdout: 'codex-cli 0.167.0' }) };
  fs.writeFileSync(path.join(home, 'config.toml'), '[hooks.state]\n');
  install(options);
  const file = path.join(home, 'config.toml');
  const edited = fs.readFileSync(file, 'utf8').replaceAll('statusMessage = "NotDex"', 'statusMessage = "Edited"');
  fs.writeFileSync(file, edited);
  assert.throws(() => uninstall(options), /edited|ownership/i);
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
  assert(fs.existsSync(path.join(home, 'notdex/notdex-mcp.cjs')));
});
