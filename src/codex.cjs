const fs = require('node:fs');
const path = require('node:path');
const { findExecutable } = require('./desktop.cjs');

function resolveCodex(selected, env = process.env) {
  const found = selected ? path.resolve(selected) : findExecutable('codex', env);
  if (!found) throw Error('Codex CLI was not found. Install Codex 0.167.0+ and add it to PATH.');
  const file = fs.realpathSync(found);
  if (!fs.statSync(file).isFile()) throw Error('Codex path must point to a file.');
  let script = /\.[cm]?js$/i.test(file) ? file : null;
  if (/\.(cmd|ps1|bat)$/i.test(file)) {
    const candidate = path.join(path.dirname(file), 'node_modules/@openai/codex/bin/codex.js');
    if (fs.existsSync(candidate)) script = candidate;
    else throw Error('Use --codex with the Codex executable or its JavaScript entry; custom shell shims are not executed.');
  }
  if (!script) return { file, args: [] };
  const root = path.dirname(path.dirname(script));
  if (path.basename(script) === 'codex.js' && path.basename(root) === 'codex') {
    const leaf = 'codex-' + process.platform + '-' + process.arch;
    const candidates = [path.join(root, 'node_modules/@openai', leaf), path.join(path.dirname(root), leaf)];
    for (const directory of candidates) {
      const vendor = path.join(directory, 'vendor');
      try {
        for (const triplet of fs.readdirSync(vendor)) {
          const binary = path.join(vendor, triplet, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
          if (fs.statSync(binary).isFile()) return { file: binary, args: [] };
        }
      } catch {}
    }
  }
  return { file: process.execPath, args: [script] };
}

module.exports = { resolveCodex };
