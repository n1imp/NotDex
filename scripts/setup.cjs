const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { findExecutable } = require('../src/desktop.cjs');

const runtimeFiles = ['notificar.ps1', 'notificar-metricas.cjs', 'desktop.cjs', 'notificar-unix.cjs', 'notificar-unix-worker.cjs', 'notificar-windows.cjs'];
const ownedFiles = [...runtimeFiles, 'node-path.txt'];
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
  if (value.app !== 'NotDex' || value.format_version !== 1 || typeof value.hook_command !== 'string' || !value.hook_command) {
    throw new Error('Unrecognized NotDex manifest: ' + file);
  }
  if (value.owned_commands !== undefined && (!Array.isArray(value.owned_commands) || value.owned_commands.some(command => typeof command !== 'string'))) {
    throw new Error('Unrecognized NotDex command ownership: ' + file);
  }
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
function updateHooks(config, commands, handler) {
  config.hooks ??= {};
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('hooks must be an object');
  if (config.hooks.Stop !== undefined && !Array.isArray(config.hooks.Stop)) throw new Error('Stop must be an array');
  const groups = [];
  for (const group of config.hooks.Stop || []) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) throw new Error('Invalid Stop matcher group');
    const kept = group.hooks.filter(item => !(item && item.statusMessage === 'NotDex' && commands.includes(item.command)));
    if (kept.length || kept.length === group.hooks.length) groups.push({ ...group, hooks: kept });
  }
  if (handler) groups.push({ hooks: [handler] });
  config.hooks.Stop = groups;
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
  if (!codex) throw new Error('Install Codex CLI 0.166.0+ and add it to PATH first.');
  const result = platform === 'win32' && /\.(cmd|bat)$/i.test(codex)
    ? run(systemPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', '& $env:NOTDEX_CODEX_EXECUTABLE --version; exit $LASTEXITCODE'],
      { env: { ...env, NOTDEX_CODEX_EXECUTABLE: codex }, encoding: 'utf8', timeout: 15000, windowsHide: true })
    : run(codex, ['--version'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const version = result.stdout?.match(/codex-cli (\d+)\.(\d+)\.(\d+)/);
  if (result.status !== 0 || !version || (Number(version[1]) === 0 && Number(version[2]) < 166)) throw new Error('Codex CLI 0.166.0 or later is required.');
}
function defaults(options) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  return { ...options, env, platform, find: options.find || (name => findExecutable(name, env, platform)), run: options.run || spawnSync };
}
function install(input = {}) {
  const options = defaults(input);
  prerequisites(options);
  const home = resolveHome(options);
  assertPath(home, true);
  const directory = path.join(home, 'notdex');
  const previous = manifest(directory);
  const hooksFile = path.join(home, 'hooks.json');
  const config = readJson(hooksFile);
  const command = makeHookCommand(options.platform, directory);
  const commands = ownership(previous, command);
  updateHooks(config, commands, { type: 'command', command, timeout: 5, statusMessage: 'NotDex' });
  // An explicit global opt-out must not become a silently nonfunctional installation.
  const toml = path.join(home, 'config.toml');
  if (fs.existsSync(toml)) {
    let features = false;
    for (const line of fs.readFileSync(toml, 'utf8').split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) features = /^\s*\[features\]\s*(?:#.*)?$/.test(line);
      if (features && /^\s*hooks\s*=\s*false\s*(?:#.*)?$/.test(line)) throw new Error('Enable hooks in Codex first. config.toml is preserved.');
    }
  }
  for (const name of [...ownedFiles, 'manifest.json']) assertPath(path.join(directory, name));
  const payloads = runtimeFiles.map(name => [name, fs.readFileSync(path.join(repo, 'src', name))]);
  fs.mkdirSync(directory, { recursive: true });
  // Retain prior ownership so a failed hooks write can be retried or uninstalled safely.
  writeJson(path.join(directory, 'manifest.json'), { app: 'NotDex', format_version: 1, hook_command: command, owned_commands: commands });
  for (const [name, data] of payloads) atomicWrite(path.join(directory, name), data);
  atomicWrite(path.join(directory, 'node-path.txt'), process.execPath);
  writeJson(hooksFile, config);
  return directory;
}
function uninstall(input = {}) {
  const options = defaults(input);
  const home = resolveHome(options);
  const directory = path.join(home, 'notdex');
  const previous = manifest(directory);
  if (!previous) return false;
  const hooksFile = path.join(home, 'hooks.json');
  if (entry(hooksFile)) writeJson(hooksFile, updateHooks(readJson(hooksFile), ownership(previous)));
  // Only fixed owned files may be removed; never recursively delete a profile.
  for (const name of ownedFiles) {
    const file = path.join(directory, name);
    if (assertPath(file)) fs.unlinkSync(file);
  }
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
      else if (argument === '--help') { console.log('NotDex: ' + action + ' [--codex-home PATH]. Desktop integration; review NotDex once in Codex /hooks.'); return; }
      else throw new Error('Unknown or incomplete option: ' + argument);
    }
    if (action === 'install') {
      console.log('NotDex installed: ' + install(options));
      console.log('Restart Codex and review/trust NotDex once in /hooks.');
    } else console.log(uninstall(options) ? 'NotDex removed. Unrelated hooks preserved.' : 'NotDex is not installed.');
  } catch (error) { console.error('NotDex: ' + error.message); process.exitCode = 1; }
}
module.exports = { install, uninstall, makeHookCommand, main };
