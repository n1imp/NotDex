const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnProcess } = require('node:child_process');
const { copyText } = require('./desktop.cjs');

function extractInput(raw) {
  let text = '';
  let data = {};
  if (/^\s*[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
        data = parsed;
        for (const field of ['last_assistant_message', 'content', 'output']) {
          if (typeof data[field] === 'string' && data[field].trim()) { text = data[field]; break; }
        }
      }
    } catch {}
  } else { text = raw; }
  return { text: text.trim(), data };
}

function runHook(raw, { platform = process.platform, env = process.env, copy = copyText, spawn = spawnProcess } = {}) {
  if (platform !== 'darwin' && platform !== 'linux') return;
  const observedAt = new Date().toISOString();
  const { text, data } = extractInput(raw);
  try { copy(text, { platform, env }); } catch {}
  const metadata = { codex_root: path.dirname(__dirname), observed_at: observedAt };
  for (const field of ['session_id', 'transcript_path', 'turn_id']) metadata[field] = typeof data[field] === 'string' ? data[field] : '';
  try {
    const worker = spawn(process.execPath, ['--no-warnings', path.join(__dirname, 'notificar-unix-worker.cjs'), Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')], {
      detached: true, stdio: 'ignore', shell: false
    });
    worker.on('error', () => {});
    worker.unref();
  } catch {}
}

module.exports = { extractInput, runHook };
if (require.main === module) {
  try { runHook(fs.readFileSync(0, 'utf8')); } catch {}
  process.exit(0);
}
