const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('smol-toml');

// Conservatively preserve an explicit F9 binding in any profile or project layer.
function usesF9(value) {
  if (typeof value === 'string') return value.toLowerCase().split(/\s+/).includes('f9');
  return value && typeof value === 'object' && Object.values(value).some(usesF9);
}

function canBindCommandCenter(codexHome, cwd, args = []) {
  const originalCwd = cwd;
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const arg = args[i];
    if (['-c', '--config'].includes(arg)) { i++; continue; }
    let directory;
    if (arg === '-C' || arg === '--cd') directory = args[++i];
    else if (arg.startsWith('--cd=')) directory = arg.slice(5);
    else if (arg.startsWith('-C') && arg.length > 2) directory = arg.slice(2);
    if (directory !== undefined) cwd = path.resolve(originalCwd, directory);
  }
  if (args.some((arg, i) => ['-c', '--config'].includes(args[i - 1]) && /\bf9\b/i.test(arg))) return false;
  if (args.some(arg => /^(?:--config=|-c.).*\bf9\b/i.test(arg))) return false;
  const files = new Set([path.join(codexHome, 'config.toml')]);
  for (let directory = path.resolve(cwd), n = 0; n < 64; n++) {
    files.add(path.join(directory, '.codex/config.toml'));
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  for (const file of files) {
    try {
      const config = parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (usesF9(config.tui?.keymap) || Object.values(config.profiles || {}).some(profile => usesF9(profile.tui?.keymap))) return false;
    } catch (error) { if (error.code !== 'ENOENT') return false; }
  }
  return true;
}

module.exports = { canBindCommandCenter };
