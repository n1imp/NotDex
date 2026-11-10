const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const START = '# BEGIN NotDex CLI', END = '# END NotDex CLI';
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";

function fileData(file) {
  try {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error('Shell integration requires a regular file: ' + file);
    const bytes = fs.readFileSync(file), utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    if (bytes[0] === 0xfe && bytes[1] === 0xff || utf16 && bytes.length % 2) throw Error('Convert the shell profile to UTF8 or UTF16LE before installation.');
    const text = utf16 ? bytes.subarray(2).toString('utf16le') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, utf16, bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, mode: fs.statSync(file).mode & 0o777 };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function read(file) { return fileData(file)?.text ?? null; }
function write(file, value) {
  const previous = fileData(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  const bytes = previous?.utf16 ? Buffer.from('\ufeff' + value, 'utf16le') : Buffer.from((previous?.bom || file.endsWith('.ps1') ? '\ufeff' : '') + value, 'utf8');
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: previous?.mode || 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function state(directory) {
  const content = read(path.join(directory, 'shell-integration.json'));
  if (content === null) return null;
  const value = JSON.parse(content);
  if (value.app !== 'NotDex' || value.version !== 1 || !Array.isArray(value.files) || typeof value.bin !== 'string' ||
    value.files.some(item => !path.isAbsolute(item.file) || typeof item.block !== 'string' || !item.block.includes(START) || !item.block.includes(END))) throw Error('Unrecognized shell integration ownership.');
  return value;
}
function strip(content, block) {
  if (content === null) return '';
  if (!block) { if (content.includes(START)) throw Error('Unowned NotDex shell block; review the shell file.'); return content; }
  if (content.includes(block)) {
    if (content.indexOf(block) !== content.lastIndexOf(block)) throw Error('Duplicate NotDex shell block.');
    return content.replace(block, '');
  }
  if (content.includes(START)) throw Error('NotDex shell block was edited; file preserved.');
  return content;
}
function windowsRegistry() {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const run = (code, env = {}) => {
    const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + code, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, ...env } });
    if (result.status !== 0) throw Error('Could not update user PATH; shell integration can be retried.');
    return result.stdout.trim();
  };
  return {
    read() {
      const info = JSON.parse(run("@{ value=[Environment]::GetEnvironmentVariable('Path','User'); documents=[Environment]::GetFolderPath('MyDocuments') } | ConvertTo-Json -Compress"));
      this.documents = info.documents; return info.value;
    },
    write(before, after) {
      run("$current=[Environment]::GetEnvironmentVariable('Path','User'); if ([string]$current -cne $env:NOTDEX_PATH_BEFORE) { throw 'PATH changed' }; [Environment]::SetEnvironmentVariable('Path',$env:NOTDEX_PATH_AFTER,'User')",
        { NOTDEX_PATH_BEFORE: before || '', NOTDEX_PATH_AFTER: after || '' });
    }
  };
}

function activate(directory, { homeDir = os.homedir(), platform = process.platform, env = process.env, registry } = {}) {
  const previous = state(directory), bin = path.join(directory, 'bin');
  const windows = platform === 'win32';
  let userPath;
  if (windows) { registry ||= windowsRegistry(); userPath = registry.read(); }
  const ps = "if (($env:Path -split ';')[0] -ne '" + bin.replace(/'/g, "''") + "') { $env:Path = '" + bin.replace(/'/g, "''") + ";' + $env:Path }\n";
  const sh = 'export PATH=' + quote(bin) + ':"$PATH"\n';
  const profiles = windows
    ? ['WindowsPowerShell/profile.ps1', 'PowerShell/profile.ps1'].map(file => [path.join(registry.documents || path.join(homeDir, 'Documents'), file), ps])
    : [[path.join(homeDir, '.profile'), sh], [path.join(homeDir, '.bashrc'), sh],
      ...['.bash_profile', '.bash_login'].filter(file => fs.existsSync(path.join(homeDir, file))).slice(0, 1).map(file => [path.join(homeDir, file), sh]),
      [path.join(env.ZDOTDIR || homeDir, '.zprofile'), sh], [path.join(env.ZDOTDIR || homeDir, '.zshrc'), sh]];
  const files = profiles.map(([file, code]) => {
    const old = previous?.files.find(item => item.file === file), before = read(file);
    const clean = strip(before, old?.block), block = '\n\n' + START + '\n' + code + END + '\n';
    return { file, before, after: clean + block, block, created: old?.created ?? before === null };
  });
  if (previous?.files.some(old => !files.some(item => item.file === old.file))) throw Error('Shell profile locations changed; remove the previous integration first.');
  const next = { app: 'NotDex', version: 1, bin, pathOwned: windows,
    files: files.map(({ file, block, created }) => ({ file, block, created })) };
  write(path.join(directory, 'shell-integration.json'), JSON.stringify(next, null, 2) + '\n');
  for (const item of files) {
    if (read(item.file) !== item.before) throw Error('Shell profile changed during installation; retry after review.');
    write(item.file, item.after);
  }
  if (windows) {
    const others = (userPath || '').split(';').filter(item => item && item.toLowerCase() !== bin.toLowerCase());
    const desired = [bin, ...others].join(';');
    if (desired !== userPath) registry.write(userPath, desired);
  }
  return next;
}

function deactivate(directory, { platform = process.platform, registry } = {}) {
  const previous = state(directory);
  if (!previous) return;
  const files = previous.files.map(item => { const before = read(item.file); return { ...item, before, after: strip(before, item.block) }; });
  for (const item of files) {
    if (read(item.file) !== item.before) throw Error('Shell profile changed during removal.');
    if (item.before === null) continue;
    if (item.created && !item.after) fs.unlinkSync(item.file); else write(item.file, item.after);
  }
  if (platform === 'win32' && previous.pathOwned) {
    registry ||= windowsRegistry(); const before = registry.read();
    const after = (before || '').split(';').filter(item => item.toLowerCase() !== previous.bin.toLowerCase()).join(';');
    if (after !== before) registry.write(before, after);
  }
  fs.unlinkSync(path.join(directory, 'shell-integration.json'));
}

module.exports = { activate, deactivate };
