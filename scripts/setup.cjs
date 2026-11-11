const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { findExecutable } = require('../src/desktop.cjs');
const { prepareMcpConfig, parse: parseToml } = require('./mcp-config.cjs');
const { dependencyFiles, installDependencies, removeOwnedTree } = require('./dependencies.cjs');
const { prepareHooks } = require('./hooks-config.cjs');
const { realEnvironment } = require('../src/cli.cjs');

const runtimeFiles = ['THIRD_PARTY_NOTICES.txt', 'notificar.ps1', 'notificar-metricas.cjs', 'desktop.cjs', 'notificar-unix.cjs', 'notificar-unix-worker.cjs', 'notificar-windows.cjs',
  'observability.cjs', 'prices.cjs', 'notdex-mcp.cjs', 'mission-worker.cjs', 'bridge.cjs', 'terminal.cjs', 'overlay.cjs', 'renderer.cjs', 'navigation.cjs', 'theme.cjs', 'account.cjs', 'monitor.cjs', 'codex.cjs', 'cli.cjs'];
const ownedFiles = [...runtimeFiles, 'node-path.txt', 'codex-target.json'];
const repo = path.dirname(__dirname);

function entry(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function assertPath(file, directory = false) {
  const stat = entry(file);
  if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))) {
    throw new Error('Expected a regular ' + (directory ? 'directory: ' : 'file: ') + file);
  }
  return stat;
}
function readJson(file) {
  if (!assertPath(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object: ' + file);
  return value;
}
function atomicWrite(file, data) {
  assertPath(file);
  const temporary = file + '.' + require('node:crypto').randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (entry(temporary)) fs.unlinkSync(temporary); }
}
function writeJson(file, data) { atomicWrite(file, JSON.stringify(data, null, 2) + '\n'); }
function resolveHome(options) {
  const home = path.resolve(options.codexHome || options.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  // A selected Codex home may be a dotfiles symlink; managed children remain guarded.
  return entry(home) ? fs.realpathSync(home) : home;
}
function manifest(directory) {
  if (!assertPath(directory, true)) return null;
  const file = path.join(directory, 'manifest.json');
  if (!entry(file)) throw new Error('Existing directory does not belong to NotDex: ' + directory);
  const value = readJson(file);
  if (value.app !== 'NotDex' || ![1, 2].includes(value.format_version) ||
    (value.format_version === 1 ? typeof value.hook_command !== 'string' || !value.hook_command : value.hook_server !== 'notdex' || value.hook_tool !== 'notdex_event')) {
    throw new Error('Unrecognized NotDex manifest: ' + file);
  }
  if (value.owned_commands !== undefined && (!Array.isArray(value.owned_commands) || value.owned_commands.some(command => typeof command !== 'string'))) {
    throw new Error('Unrecognized NotDex command ownership: ' + file);
  }
  if (value.owned_mcp_blocks !== undefined && (!Array.isArray(value.owned_mcp_blocks) || value.owned_mcp_blocks.some(block => typeof block !== 'string'))) throw new Error('Unrecognized MCP configuration ownership: ' + file);
  if (value.owned_hook_blocks !== undefined && (!Array.isArray(value.owned_hook_blocks) || value.owned_hook_blocks.some(block => typeof block !== 'string'))) throw new Error('Unrecognized inline hook ownership: ' + file);
  return value;
}
function ownership(previous, command) {
  return [...new Set([command, previous?.hook_command, ...(previous?.owned_commands || [])].filter(Boolean))];
}
function quoteShell(value) { return "'" + value.replace(/'/g, "'\"'\"'") + "'"; }
function systemPowerShell() {
  return path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
}
function makeHookCommand(platform, directory, nodePath = process.execPath) {
  if (platform === 'win32') {
    const entry = Buffer.from(path.join(directory, 'notificar-windows.cjs'), 'utf8').toString('base64');
    const invocation = "require(Buffer.from('" + entry + "','base64').toString('utf8')).main()";
    const cmd = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe');
    // --% preserves CMD quoting when Codex provides a PowerShell session shell.
    const executable = nodePath.replace(/%/g, '"^%"');
    return cmd + ' --% /d /v:off /s /c @"' + executable + '" --no-warnings -e "' + invocation + '"';
  }
  return quoteShell(nodePath) + ' --no-warnings ' + quoteShell(path.join(directory, 'notificar-unix.cjs'));
}
function updateHooks(config, commands, handler, event = 'Stop', ownsMcp = false, matcher) {
  config.hooks ??= {};
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('hooks must be an object');
  if (config.hooks[event] !== undefined && !Array.isArray(config.hooks[event])) throw new Error(event + ' must be an array');
  const groups = [];
  for (const group of config.hooks[event] || []) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) throw new Error('Invalid Stop matcher group');
    const kept = group.hooks.filter(item => !(item && item.statusMessage === 'NotDex' &&
      (commands.includes(item.command) || ownsMcp && item.type === 'mcp_tool' && item.server === 'notdex' && item.tool === 'notdex_event')));
    if (kept.length || kept.length === group.hooks.length) groups.push({ ...group, hooks: kept });
  }
  if (handler) groups.push({ ...(matcher ? { matcher } : {}), hooks: [handler] });
  config.hooks[event] = groups;
  return config;
}
function prerequisites(options) {
  const { platform, env, find, run } = options;
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Supported desktops: Windows, macOS and Linux.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required. Use the installation shortcut to download a private runtime.');
  require('node:sqlite');
  if (platform === 'win32' && !find('powershell.exe')) throw new Error('Windows PowerShell 5.1 is required.');
  if (platform === 'darwin' && (!find('pbcopy') || !find('osascript'))) throw new Error('macOS pbcopy and osascript are required.');
  if (platform === 'linux') {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) throw new Error('A graphical Linux desktop session is required.');
    const clipboard = (env.WAYLAND_DISPLAY && find('wl-copy')) || (env.DISPLAY && (find('xclip') || find('xsel')));
    if (!clipboard || !find('notify-send')) throw new Error('Missing Linux desktop tools. Run install.sh to install a clipboard tool and notify-send with your approval.');
  }
  const codex = find('codex');
  if (!codex) throw new Error('Install Codex CLI 0.167.0+ and add it to PATH first.');
  const result = platform === 'win32' && /\.(cmd|bat)$/i.test(codex)
    ? run(systemPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', '& $env:NOTDEX_CODEX_EXECUTABLE --version; exit $LASTEXITCODE'],
      { env: { ...env, NOTDEX_CODEX_EXECUTABLE: codex }, encoding: 'utf8', timeout: 15000, windowsHide: true })
    : run(codex, ['--version'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const version = result.stdout?.match(/codex-cli (\d+)\.(\d+)\.(\d+)/);
  if (result.status !== 0 || !version || (Number(version[1]) === 0 && Number(version[2]) < 167)) throw new Error('Codex CLI 0.167.0 or later is required.');
}
function defaults(options) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  return { ...options, env, platform, find: options.find || (name => findExecutable(name, env, platform)), run: options.run || spawnSync };
}
function install(input = {}) {
  const options = defaults(input);
  const home = resolveHome(options);
  options.env = realEnvironment(options.env, path.join(home, 'notdex/bin'), options.platform);
  if (!input.find) options.find = name => findExecutable(name, options.env, options.platform);
  prerequisites(options);
  assertPath(home, true);
  const directory = path.join(home, 'notdex');
  const previous = manifest(directory);
  const hooksFile = path.join(home, 'hooks.json');
  const config = readJson(hooksFile);
  const hooksBefore = entry(hooksFile) ? fs.readFileSync(hooksFile, 'utf8') : null;
  const commands = ownership(previous);
  const handlers = {};
  for (const [event, name] of [['SessionStart', 'start'], ['Stop', 'stop'], ['UserPromptSubmit', 'prompt']]) {
    const input = { event: name, session_id: '${session_id}', turn_id: '${turn_id}', transcript_path: '${transcript_path}', cwd: '${cwd}', model: '${model}' };
    if (name === 'stop') input.last_assistant_message = '${last_assistant_message}';
    handlers[event] = [{ hooks: [{ type: 'mcp_tool', server: 'notdex', tool: 'notdex_event', input, timeout: 5, statusMessage: 'NotDex' }] }];
    if (name === 'start') handlers[event][0].matcher = '^(startup|resume|clear|fork)$';
  }
  // An explicit global opt-out must not become a silently nonfunctional installation.
  const toml = path.join(home, 'config.toml');
  const tomlBefore = assertPath(toml) ? fs.readFileSync(toml, 'utf8') : '';
  if (parseToml(tomlBefore).features?.hooks === false) throw new Error('Enable hooks in Codex first. config.toml is preserved.');
  const owns = item => item && item.statusMessage === 'NotDex' && (commands.includes(item.command) || previous?.format_version === 2 && item.type === 'mcp_tool' && item.server === 'notdex' && item.tool === 'notdex_event');
  const hookPlan = prepareHooks(tomlBefore, config, { owns, ownedBlocks: previous?.owned_hook_blocks, handlers });
  if (!hookPlan.inline) for (const event of Object.keys(handlers)) updateHooks(config, commands, handlers[event][0].hooks[0], event, previous?.format_version === 2, handlers[event][0].matcher);
  const mcp = prepareMcpConfig(hookPlan.text, { directory, nodePath: process.execPath, ownedBlocks: previous?.owned_mcp_blocks });
  const modules = path.join(directory, 'node_modules');
  if (assertPath(modules, true) && !previous?.owns_dependencies) throw new Error('Existing dependencies do not belong to NotDex: ' + modules);
  const dependencies = dependencyFiles();
  const bin = path.join(directory, 'bin');
  if (assertPath(bin, true) && !previous?.owns_cli) throw Error('Existing CLI directory is not owned by NotDex.');
  for (const name of ['codex', 'codex.cmd', 'codex.ps1']) assertPath(path.join(bin, name));
  for (const name of [...ownedFiles, 'manifest.json']) assertPath(path.join(directory, name));
  const payloads = runtimeFiles.map(name => [name, fs.readFileSync(path.join(repo, 'src', name))]);
  fs.mkdirSync(directory, { recursive: true });
  // Retain prior ownership so a failed hooks write can be retried or uninstalled safely.
  const next = { app: 'NotDex', format_version: 2, hook_server: 'notdex', hook_tool: 'notdex_event', owned_commands: commands,
    owned_mcp_blocks: [...new Set([mcp.block, ...(previous?.owned_mcp_blocks || [])])],
    owned_hook_blocks: [...new Set([hookPlan.block, ...(previous?.owned_hook_blocks || [])].filter(Boolean))],
    owns_cli: true, owns_dependencies: true, dependency_hash: previous?.dependency_hash };
  writeJson(path.join(directory, 'manifest.json'), next);
  for (const [name, data] of payloads) atomicWrite(path.join(directory, name), data);
  atomicWrite(path.join(directory, 'node-path.txt'), process.execPath);
  writeJson(path.join(directory, 'codex-target.json'), { path: options.find('codex') });
  fs.mkdirSync(bin, { recursive: true });
  const cli = path.join(directory, 'cli.cjs');
  if (options.platform === 'win32') {
    atomicWrite(path.join(bin, 'codex.cmd'), '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"' + process.execPath.replace(/%/g, '%%') + '" --no-warnings "' + cli.replace(/%/g, '%%') + '" %*\r\nexit /b %errorlevel%\r\n');
    atomicWrite(path.join(bin, 'codex.ps1'), "\ufeff& '" + process.execPath.replace(/'/g, "''") + "' --no-warnings '" + cli.replace(/'/g, "''") + "' @args\nexit $LASTEXITCODE\n");
  } else {
    const shim = path.join(bin, 'codex');
    atomicWrite(shim, '#!/bin/sh\nexec ' + quoteShell(process.execPath) + ' --no-warnings ' + quoteShell(cli) + ' "$@"\n');
    fs.chmodSync(shim, 0o700);
  }
  installDependencies(directory, dependencies);
  if ((entry(toml) ? fs.readFileSync(toml, 'utf8') : '') !== tomlBefore) throw new Error('config.toml changed during installation; retry after reviewing it.');
  atomicWrite(toml, mcp.text);
  if ((entry(hooksFile) ? fs.readFileSync(hooksFile, 'utf8') : null) !== hooksBefore) throw Error('hooks.json changed during installation; review and retry.');
  if (hookPlan.inline) {
    if (hooksBefore !== null) {
      fs.writeFileSync(path.join(directory, 'hooks-backup-' + require('node:crypto').randomUUID() + '.json'), hooksBefore, { flag: 'wx', mode: 0o600 });
      fs.unlinkSync(hooksFile);
    }
  } else writeJson(hooksFile, config);
  next.dependency_hash = dependencies.hash;
  writeJson(path.join(directory, 'manifest.json'), next);
  return directory;
}
function uninstall(input = {}) {
  const options = defaults(input);
  const home = resolveHome(options);
  const directory = path.join(home, 'notdex');
  const previous = manifest(directory);
  if (!previous) return false;
  const hooksFile = path.join(home, 'hooks.json');
  const toml = path.join(home, 'config.toml');
  const tomlBefore = assertPath(toml) ? fs.readFileSync(toml, 'utf8') : '';
  const commands = ownership(previous);
  const owns = item => item && item.statusMessage === 'NotDex' && (commands.includes(item.command) || previous.format_version === 2 && item.type === 'mcp_tool' && item.server === 'notdex' && item.tool === 'notdex_event');
  const hookPlan = prepareHooks(tomlBefore, null, { owns, ownedBlocks: previous.owned_hook_blocks, remove: true });
  const mcp = previous.format_version === 2 ? prepareMcpConfig(hookPlan.text, { ownedBlocks: previous.owned_mcp_blocks, remove: true }) : null;
  const hooks = entry(hooksFile) ? readJson(hooksFile) : null;
  if (hooks) for (const event of ['SessionStart', 'Stop', 'UserPromptSubmit']) updateHooks(hooks, ownership(previous), undefined, event, previous.format_version === 2);
  if (previous.owns_dependencies) assertPath(path.join(directory, 'node_modules'), true);
  if (mcp && mcp.text !== tomlBefore) atomicWrite(toml, mcp.text);
  if (hooks) writeJson(hooksFile, hooks);
  if (previous.owns_cli && assertPath(path.join(directory, 'bin'), true)) {
    for (const name of ['codex', 'codex.cmd', 'codex.ps1']) { const file = path.join(directory, 'bin', name); if (assertPath(file)) fs.unlinkSync(file); }
    if (!fs.readdirSync(path.join(directory, 'bin')).length) fs.rmdirSync(path.join(directory, 'bin'));
  }
  // Only fixed owned files may be removed; never recursively delete a profile.
  for (const name of ownedFiles) {
    const file = path.join(directory, name);
    if (assertPath(file)) fs.unlinkSync(file);
  }
  if (previous.owns_dependencies) removeOwnedTree(directory, path.join(directory, 'node_modules'));
  if (fs.readdirSync(directory).every(name => name === 'manifest.json')) {
    fs.unlinkSync(path.join(directory, 'manifest.json'));
    fs.rmdirSync(directory);
  }
  return true;
}
function main(action) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const argument = process.argv[i];
      if (argument === '--codex-home' && process.argv[i + 1]) options.codexHome = process.argv[++i];
      else if (argument === '--no-download') continue;
      else if (argument === '--no-shell-integration') options.noShellIntegration = true;
      else if (argument === '--help') { console.log('NotDex: ' + action + ' [--codex-home PATH]. Desktop integration; review NotDex once in Codex /hooks.'); return; }
      else throw new Error('Unknown or incomplete option: ' + argument);
    }
    if (action === 'install') {
      const directory = install(options);
      if (!options.noShellIntegration) require('./shell-integration.cjs').activate(directory);
      console.log('NotDex installed: ' + directory);
      if (!options.noShellIntegration) console.log('Open a new terminal; interactive codex sessions now include the overlay.');
      console.log('Restart Codex and review/trust NotDex once in /hooks.');
    } else {
      const directory = path.join(resolveHome(defaults(options)), 'notdex');
      if (manifest(directory) && !options.noShellIntegration) require('./shell-integration.cjs').deactivate(directory);
      console.log(uninstall(options) ? 'NotDex removed. Unrelated hooks preserved.' : 'NotDex is not installed.');
    }
  } catch (error) { console.error('NotDex: ' + error.message); process.exitCode = 1; }
}
module.exports = { install, uninstall, makeHookCommand, main };
