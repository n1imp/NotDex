const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const repo = path.dirname(__dirname);
let cached;

function available(root = repo) {
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies;
  try {
    return Object.entries(expected).every(([name, version]) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version === version);
  } catch { return false; }
}

function ensureDependencies({ noDownload = false } = {}) {
  if (available()) return;
  if (noDownload) throw Error('Offline overlay dependencies are missing. Use the complete published ZIP.');
  const candidates = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  try {
    const found = require('../src/desktop.cjs').findExecutable('npm');
    if (found) {
      const real = fs.realpathSync(found);
      if (real.endsWith('.js')) candidates.push(real);
      candidates.push(path.join(path.dirname(found), 'node_modules/npm/bin/npm-cli.js'));
    }
  } catch {}
  const npm = candidates.find(file => fs.existsSync(file));
  if (!npm) throw Error('Use the published ZIP with bundled dependencies, or install from a clone using Node.js 24+ with npm.');
  const result = spawnSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: repo, stdio: 'inherit', windowsHide: true, timeout: 180000 });
  if (result.status !== 0 || !available()) throw Error('Could not prepare pinned overlay dependencies; profile unchanged.');
}

function dependencyFiles() {
  const lockBytes = fs.readFileSync(path.join(repo, 'package-lock.json'));
  const hash = createHash('sha256').update(lockBytes).digest('hex');
  if (cached?.hash === hash) return cached;
  if (!available()) throw Error('Run the installer to prepare pinned dependencies first.');
  const root = path.join(repo, 'node_modules');
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Dependency directory must not be a link.');
  const lock = JSON.parse(lockBytes), files = [];
  const walk = (directory, relative) => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), rel = path.join(relative, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Dependency links are not supported: ' + rel);
      if (stat.isDirectory()) walk(file, rel);
      else if (stat.isFile()) files.push({ name: rel, bytes: fs.readFileSync(file), mode: stat.mode & 0o755 });
      else throw Error('Unsupported dependency entry: ' + rel);
    }
  };
  for (const [key, info] of Object.entries(lock.packages)) {
    if (!key) continue;
    if (!key.startsWith('node_modules/') || key.split('/').includes('..') || info.link || !info.integrity) throw Error('Unsupported dependency lock entry.');
    if (info.os && !info.os.includes(process.platform) || info.cpu && !info.cpu.includes(process.arch)) continue;
    const relative = key.slice('node_modules/'.length), directory = path.join(root, relative);
    if (fs.lstatSync(directory).isSymbolicLink() || JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== info.version) throw Error('Dependency version or ownership mismatch.');
    walk(directory, relative);
  }
  cached = { hash, files };
  return cached;
}

function removeOwnedTree(directory, target) {
  const parent = path.resolve(directory), resolved = path.resolve(target);
  if (path.dirname(resolved) !== parent || !/^(node_modules|\.modules\.[a-f0-9-]+\.(tmp|old))$/.test(path.basename(resolved))) throw Error('Unsafe managed dependency path.');
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isDirectory()) throw Error('Expected an owned dependency directory.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function installDependencies(directory, payload) {
  const id = require('node:crypto').randomUUID(), stage = path.join(directory, '.modules.' + id + '.tmp');
  const target = path.join(directory, 'node_modules'), old = path.join(directory, '.modules.' + id + '.old');
  fs.mkdirSync(stage, { mode: 0o700 });
  try {
    for (const file of payload.files) {
      const destination = path.join(stage, file.name);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, file.bytes, { flag: 'wx', mode: file.mode });
    }
    if (fs.existsSync(target)) fs.renameSync(target, old);
    try { fs.renameSync(stage, target); }
    catch (error) { if (fs.existsSync(old)) fs.renameSync(old, target); throw error; }
    removeOwnedTree(directory, old);
  } finally { removeOwnedTree(directory, stage); }
}

module.exports = { ensureDependencies, dependencyFiles, installDependencies, removeOwnedTree };
