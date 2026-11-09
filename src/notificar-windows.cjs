const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnProcess, spawnSync } = require('node:child_process');
const { extractInput } = require('./notificar-unix.cjs');
const { copyText } = require('./desktop.cjs');

function runHook(raw, { copy = copyText, spawn = spawnProcess, env = process.env } = {}) {
  const observedAt = new Date().toISOString();
  const { text, data } = extractInput(raw);
  try { copy(text, { platform: 'win32', env }); } catch {}
  const metadata = {
    codex_root: path.dirname(__dirname), observed_at: observedAt,
    helper_path: path.join(__dirname, 'notificar-metricas.cjs'), node_path_file: path.join(__dirname, 'node-path.txt')
  };
  for (const field of ['session_id', 'transcript_path', 'turn_id']) metadata[field] = typeof data[field] === 'string' ? data[field] : '';
  try {
    const worker = spawn(process.execPath, [
      '--no-warnings', __filename, '--worker', Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')
    ], { env, detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    worker.on('error', () => {});
    worker.unref();
  } catch {}
}

function runWorker(data, { run = spawnSync, env = process.env } = {}) {
  // Windows PowerShell 5.1 exits before executing scripts when directly detached.
  try {
    run(path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'notificar.ps1'), '-WorkerData', data
    ], { env, stdio: 'ignore', shell: false, windowsHide: true });
  } catch {}
}

function main() {
  try {
    if (process.platform === 'win32') {
      if (process.argv[2] === '--worker') runWorker(process.argv[3]);
      else runHook(fs.readFileSync(0, 'utf8'));
    }
  } catch {}
  process.exit(0);
}

module.exports = { runHook, runWorker, main };
if (require.main === module) main();
