const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const toml = require('smol-toml');
const { install, uninstall } = require('../scripts/setup.cjs');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "notdex-resident ' & "));
  const options = { codexHome: home, env: { ...process.env, DISPLAY: ':fixture' }, find: () => process.execPath,
    run: () => ({ status: 0, stdout: 'codex-cli 0.167.0' }) };
  return { home, options };
}

test('resident installation uses MCP for Stop and prompt, retains unrelated configuration byte-for-byte on removal', () => {
  const { home, options } = fixture();
  const original = '# Keep my comments\r\n[features]\r\nhooks = true\r\n[profiles.mine]\r\nmodel = "other"\r\n';
  fs.writeFileSync(path.join(home, 'config.toml'), original);
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ description: 'keep', hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'echo keep', statusMessage: 'NotDex' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo prompt' }] }]
  } }));
  install(options); install(options);
  const config = toml.parse(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'));
  assert.equal(config.mcp_servers.notdex.command, process.execPath);
  assert(config.mcp_servers.notdex.args.at(-1).endsWith('notdex-mcp.cjs'));
  assert(config.mcp_servers.notdex.env_vars.includes('NOTDEX_OVERLAY_TOKEN'));
  const hooks = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json')));
  for (const event of ['Stop', 'UserPromptSubmit']) {
    const owned = hooks.hooks[event].flatMap(group => group.hooks).filter(handler => handler.type === 'mcp_tool');
    assert.equal(owned.length, 1); assert.equal(owned[0].timeout, 5); assert.equal(owned[0].command, undefined);
  }
  const runtime = path.join(home, 'notdex');
  assert(fs.existsSync(path.join(runtime, 'node_modules/@xterm/headless/package.json')));
  const dependency = path.join(runtime, 'node_modules/@xterm/headless/package.json');
  fs.unlinkSync(dependency);
  install(options);
  assert.equal(JSON.parse(fs.readFileSync(dependency, 'utf8')).version, '6.0.0');
  fs.writeFileSync(path.join(runtime, 'overlay-settings.json'), '{"x":4}');
  uninstall(options);
  assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(runtime, 'overlay-settings.json'), 'utf8'), '{"x":4}');
  assert.equal(fs.existsSync(path.join(runtime, 'node_modules')), false);
  const after = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json')));
  assert.deepEqual(after.hooks.Stop.flatMap(group => group.hooks).map(h => h.command), ['echo keep']);
  assert.deepEqual(after.hooks.UserPromptSubmit.flatMap(group => group.hooks).map(h => h.command), ['echo prompt']);
});

test('conflicting MCP entry and edited managed blocks are rejected before runtime changes', () => {
  const { home, options } = fixture();
  const file = path.join(home, 'config.toml');
  const original = '[mcp_servers.notdex]\ncommand = "user-owned"\n';
  fs.writeFileSync(file, original);
  assert.throws(() => install(options), /MCP|notdex|owned/i);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(home, 'notdex')), false);
  fs.writeFileSync(file, ''); install(options);
  const changed = fs.readFileSync(file, 'utf8').replace('startup_timeout_sec = 30', 'startup_timeout_sec = 45');
  fs.writeFileSync(file, changed);
  const runtime = path.join(home, 'notdex/notdex-mcp.cjs');
  fs.writeFileSync(runtime, 'user marker');
  assert.throws(() => install(options), /MCP|edited|owned/i);
  assert.equal(fs.readFileSync(runtime, 'utf8'), 'user marker');
});
