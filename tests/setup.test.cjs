const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { install, uninstall, makeHookCommand } = require('../scripts/setup.cjs');

function profile(platform = process.platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notdex setup ' & \u00e7 "));
  const home = path.join(root, 'codex');
  const env = { ...process.env, DISPLAY: ':fixture' };
  const options = { codexHome: home, platform, env, find: () => process.execPath,
    run: () => ({ status: 0, stdout: 'codex-cli 0.167.0\n' }) };
  return { root, home, options };
}

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: install and uninstall preserve hooks, config and user files`, () => {
    const { home, options } = profile(platform);
    fs.mkdirSync(home);
    const config = '[features]\nhooks = true\n';
    fs.writeFileSync(path.join(home, 'config.toml'), config);
    fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ description: 'keep',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep', statusMessage: 'NotDex' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }] } }));
    install(options);
    install(options);
    let hooks = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json')));
    const handlers = hooks.hooks.Stop.flatMap(group => group.hooks);
    assert.equal(handlers.length, 2);
    assert.equal(handlers.find(handler => handler.command !== 'echo keep').timeout, 5);
    assert.equal(hooks.description, 'keep');
    assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, 'echo start');
    assert.equal(hooks.hooks.SessionStart.at(-1).matcher, '^(startup|resume|clear|fork)$');
    assert(fs.readFileSync(path.join(home, 'config.toml'), 'utf8').startsWith(config));
    fs.writeFileSync(path.join(home, 'notdex', 'user-file.txt'), 'keep user file');
    uninstall(options);
    uninstall(options);
    hooks = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json')));
    assert.deepEqual(hooks.hooks.Stop.flatMap(group => group.hooks).map(handler => handler.command), ['echo keep']);
    assert.equal(fs.readFileSync(path.join(home, 'notdex', 'user-file.txt'), 'utf8'), 'keep user file');
  });
}

test('CODEX_HOME and legacy manifests are respected during migration', () => {
  const { home, options } = profile();
  fs.mkdirSync(path.join(home, 'notdex'), { recursive: true });
  fs.writeFileSync(path.join(home, 'notdex', 'manifest.json'), JSON.stringify({ app: 'NotDex', format_version: 1, hook_command: 'legacy-hook' }));
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'legacy-hook', statusMessage: 'NotDex' }, { type: 'command', command: 'keep' }
  ] }] } }));
  delete options.codexHome;
  options.env.CODEX_HOME = home;
  install(options);
  const commands = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'))).hooks.Stop.flatMap(group => group.hooks).map(handler => handler.command);
  assert.equal(commands.length, 2);
  assert.equal(commands.includes('legacy-hook'), false);
  assert.equal(commands.includes('keep'), true);
});

test('malformed JSON and directory destinations cause no runtime writes', () => {
  for (const directory of [false, true]) {
    const { home, options } = profile();
    fs.mkdirSync(home);
    const config = path.join(home, 'hooks.json');
    if (directory) fs.mkdirSync(config);
    else fs.writeFileSync(config, '{bad json');
    assert.throws(() => install(options));
    assert.equal(fs.existsSync(path.join(home, 'notdex')), false);
    if (!directory) assert.equal(fs.readFileSync(config, 'utf8'), '{bad json');
  }
});

test('malformed matcher schema is rejected without changing files', () => {
  const { home, options } = profile();
  fs.mkdirSync(home);
  const config = JSON.stringify({ hooks: { Stop: [{ hooks: 'not an array' }] } });
  fs.writeFileSync(path.join(home, 'hooks.json'), config);
  assert.throws(() => install(options));
  assert.equal(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'), config);
  assert.equal(fs.existsSync(path.join(home, 'notdex')), false);
});

test('hard-linked runtime files are replaced without overwriting their other names', () => {
  const { root, home, options } = profile();
  install(options);
  const target = path.join(home, 'notdex', 'notificar-metricas.cjs');
  const external = path.join(root, 'external');
  fs.writeFileSync(external, 'sentinel');
  fs.unlinkSync(target);
  fs.linkSync(external, target);
  install(options);
  assert.equal(fs.readFileSync(external, 'utf8'), 'sentinel');
});

test('an explicitly selected symlinked Codex home is supported without deleting the link', () => {
  const { root, options } = profile();
  const target = path.join(root, 'real home');
  const alias = path.join(root, 'home alias');
  fs.mkdirSync(target);
  fs.symlinkSync(target, alias, 'junction');
  options.codexHome = alias;
  install(options);
  assert.equal(fs.existsSync(path.join(target, 'notdex', 'manifest.json')), true);
  uninstall(options);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.equal(fs.existsSync(target), true);
});

test('disabled hooks, old Codex and missing Linux desktop tools fail before creating a profile', () => {
  const old = profile();
  old.options.run = () => ({ status: 0, stdout: 'codex-cli 0.100.0' });
  assert.throws(() => install(old.options));
  assert.equal(fs.existsSync(old.home), false);
  const linux = profile('linux');
  linux.options.find = name => name === 'codex' ? process.execPath : null;
  assert.throws(() => install(linux.options), /desktop|clipboard|notify-send/i);
  assert.equal(fs.existsSync(linux.home), false);
  const disabled = profile();
  fs.mkdirSync(disabled.home);
  fs.writeFileSync(path.join(disabled.home, 'config.toml'), '[features]\nhooks = false\n');
  assert.throws(() => install(disabled.options), /hooks/i);
  assert.equal(fs.existsSync(path.join(disabled.home, 'notdex')), false);
});

test('Unix hook shell quoting preserves apostrophes, spaces and metacharacters', () => {
  const command = makeHookCommand('darwin', "/home/a' & $x/notdex", "/apps/my' node");
  assert.match(command, /notificar-unix\.cjs/);
  assert.equal(command.includes('powershell'), false);
  assert.match(command, /'"'"'/);
});

for (const recovery of ['retry', 'uninstall']) {
  test(`failed migration retains prior hook ownership for ${recovery}`, () => {
    const { home, options } = profile();
    fs.mkdirSync(path.join(home, 'notdex'), { recursive: true });
    fs.writeFileSync(path.join(home, 'notdex', 'manifest.json'), JSON.stringify({ app: 'NotDex', format_version: 1, hook_command: 'legacy-hook' }));
    const hooksFile = path.join(home, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({ hooks: { Stop: [{ hooks: [
      { type: 'command', command: 'legacy-hook', statusMessage: 'NotDex' }, { type: 'command', command: 'keep' }
    ] }] } }));
    const canonicalHooksFile = fs.realpathSync(hooksFile);
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (target === canonicalHooksFile) throw Object.assign(new Error('fixture write failure'), { code: 'EACCES' });
      return rename(source, target);
    };
    try { assert.throws(() => install(options), /fixture write failure/); }
    finally { fs.renameSync = rename; }
    if (recovery === 'retry') {
      install(options);
      const owned = JSON.parse(fs.readFileSync(hooksFile)).hooks.Stop.flatMap(group => group.hooks).filter(handler => handler.statusMessage === 'NotDex');
      assert.equal(owned.length, 1);
      assert.notEqual(owned[0].command, 'legacy-hook');
    }
    uninstall(options);
    const commands = JSON.parse(fs.readFileSync(hooksFile)).hooks.Stop.flatMap(group => group.hooks).map(handler => handler.command);
    assert.deepEqual(commands, ['keep']);
  });
}

test('native Unix CLI installation and registered hook work with desktop command fixtures', { skip: process.platform === 'win32' }, async () => {
  const { root, home } = profile();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['pbcopy', 'wl-copy', 'xclip', 'xsel', 'notify-send', 'osascript', 'codex']) {
    const body = name === 'codex' ? 'printf "codex-cli 0.167.0\\n"' :
      ['pbcopy', 'wl-copy', 'xclip', 'xsel'].includes(name) ? 'cat > "$NOTDEX_CLIP_FIXTURE"' : 'printf "%s\\n" "$@" > "$NOTDEX_NOTIFY_FIXTURE"';
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  }
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DISPLAY: ':fixture',
    NOTDEX_CLIP_FIXTURE: path.join(root, 'clip'), NOTDEX_NOTIFY_FIXTURE: path.join(root, 'notify') };
  const repo = path.dirname(__dirname);
  const result = spawnSync('/bin/sh', [path.join(repo, 'install.sh'), '--no-download', '--no-system-packages', '--no-shell-integration', '--codex-home', home], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const input = [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { id: 2, method: 'tools/call', params: { name: 'notdex_event', arguments: { event: 'stop', session_id: 'fixture', last_assistant_message: 'PRIVATE ANSWER' } } }]
    .map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n';
  const hook = spawnSync(process.execPath, ['--no-warnings', path.join(home, 'notdex/notdex-mcp.cjs')], {
    env: { ...env, NOTDEX_OVERLAY_ENDPOINT: '', NOTDEX_OVERLAY_TOKEN: '' }, input, encoding: 'utf8', timeout: 15000
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(fs.readFileSync(env.NOTDEX_CLIP_FIXTURE, 'utf8'), 'PRIVATE ANSWER');
  for (let i = 0; i < 60 && !fs.existsSync(env.NOTDEX_NOTIFY_FIXTURE); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(env.NOTDEX_NOTIFY_FIXTURE), true);
  assert.equal(fs.readFileSync(env.NOTDEX_NOTIFY_FIXTURE, 'utf8').includes('PRIVATE ANSWER'), false);
  const removed = spawnSync('/bin/sh', [path.join(repo, 'uninstall.sh'), '--no-shell-integration', '--codex-home', home], { env, encoding: 'utf8' });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(home, 'notdex')), false);
});
