const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findExecutable(name, env = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  const searchPath = env.PATH ?? (windows ? env.Path : '') ?? '';
  const extensions = windows && !path.extname(name)
    ? (env.PATHEXT || '.EXE;.CMD').split(';').filter(Boolean).map(extension => extension.toLowerCase()) : [''];
  for (const directory of searchPath.split(windows ? ';' : ':').filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.resolve(directory.replace(/^"(.*)"$/, '$1'), name + extension);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, windows ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function execute(name, args, input, { env = process.env, platform = process.platform, find = findExecutable, run = spawnSync } = {}) {
  try {
    const command = path.isAbsolute(name) || (platform === 'win32' && path.win32.isAbsolute(name)) ? name : find(name, env, platform);
    if (!command) return false;
    const result = run(command, args, {
      input, encoding: 'utf8', env, shell: false, timeout: 1500, killSignal: 'SIGKILL', stdio: ['pipe', 'ignore', 'ignore']
    });
    return !result.error && result.status === 0;
  } catch { return false; }
}

function copyText(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const { platform = process.platform, env = process.env } = options;
  if (platform === 'win32') {
    const input = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    return execute(path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32/clip.exe'), [], input, options);
  }
  if (platform === 'darwin') return execute('pbcopy', [], text, options);
  if (platform !== 'linux') return false;
  if (env.WAYLAND_DISPLAY && execute('wl-copy', [], text, options)) return true;
  if (env.DISPLAY) {
    if (execute('xclip', ['-selection', 'clipboard'], text, options)) return true;
    if (execute('xsel', ['--clipboard', '--input'], text, options)) return true;
  }
  return false;
}

function formatNotification(stats) {
  const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const count = value => known(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : 'N/D';
  const cache = known(stats.cache_hit_pct) ? stats.cache_hit_pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : 'N/D';
  let latency = 'N/D';
  if (known(stats.latency_ms)) {
    const seconds = stats.latency_ms / 1000;
    latency = seconds < 60
      ? seconds.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 's'
      : Math.floor(seconds / 60) + 'm ' + String(Math.floor(seconds % 60)).padStart(2, '0') + 's';
    if (stats.latency_is_estimate) latency = '~' + latency;
  }
  return {
    title: typeof stats.title === 'string' && stats.title.trim() ? stats.title : 'Codex',
    body: `Total ${count(stats.total_tokens)} | 🔵 In ${count(stats.input_tokens)} | 🟠 Out ${count(stats.output_tokens)}\n🟢 Cache ${cache} | Lat. turno ${latency}`
  };
}

const APPLESCRIPT = 'on run argv\n display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"\nend run';

function notify(stats, options = {}) {
  const { platform = process.platform } = options;
  const { title, body } = formatNotification(stats);
  if (platform === 'darwin') return execute('osascript', ['-e', APPLESCRIPT, '--', title, body], undefined, options);
  if (platform === 'linux') return execute('notify-send', ['--app-name=NotDex', '--hint=string:sound-name:message-new-instant', '--', title, body], undefined, options);
  return false;
}

module.exports = { findExecutable, copyText, formatNotification, notify };
