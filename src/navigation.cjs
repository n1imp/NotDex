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

function navigationContext(terminal, showCursor) {
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: terminal.rows }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) || '');
  const footer = lines.slice(-3).join('\n');
  const composer = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true).trim();
  const chatFooter = footer.includes('← for agents') && footer.includes('for shortcuts');
  const empty = composer === '›' || composer === '› Ask Codex to do anything';
  if (chatFooter && (showCursor && composer?.startsWith('›') || /esc.*interrupt/i.test(footer))) return { kind: 'chat', canGoDashboard: !!showCursor && empty && !/esc.*interrupt/i.test(footer) };
  // shortcut: native Codex 0.167 UI labels; unknown layouts keep their original input behavior.
  const center = lines.findIndex((line, y) => /^\s*(?:Agent|Project) command center\s+Group:/.test(line) && !!buffer.getLine(buffer.viewportY + y)?.getCell(line.search(/\S/))?.isBold());
  if (center >= 0) return { kind: 'center', editing: lines.slice(center + 1, center + 9).some(line => /^\s*(?:Search ›|Rename ›|Task shortcuts)/.test(line)) };
  return chatFooter ? { kind: 'chat', canGoDashboard: false } : { kind: 'unknown' };
}

module.exports = { canBindCommandCenter, navigationContext };
