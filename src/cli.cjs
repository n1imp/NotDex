const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveCodex, realEnvironment } = require('./codex.cjs');

const COMMANDS = new Set('exec e review login logout mcp plugin app-server remote-control app completion update doctor sandbox debug apply a queue archive delete migrate-rollouts migrate-nfs-db unarchive cloud exec-server features help'.split(' '));
const VALUES = new Set('-c --config --enable --disable --remote --remote-auth-token-env -i --image -m --model --local-provider -p --profile -s --sandbox -C --cd --add-dir -a --ask-for-approval'.split(' '));

function shouldOverlay(args, stdinTTY, stdoutTTY) {
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  if (!stdinTTY || !stdoutTTY || options.some(value => ['-h', '--help', '-V', '--version'].includes(value))) return false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--') return true;
    if (VALUES.has(value)) { index++; continue; }
    if (!value.startsWith('-')) return !COMMANDS.has(value);
  }
  return true;
}

async function launch(args, { directory = __dirname, codex, env = process.env, input = process.stdin, output = process.stdout } = {}) {
  const cleaned = realEnvironment(env, path.join(directory, 'bin'));
  if (!codex) {
    try { codex = resolveCodex(undefined, cleaned); }
    catch {
      const fallback = JSON.parse(fs.readFileSync(path.join(directory, 'codex-target.json'), 'utf8'));
      codex = resolveCodex(fallback.path, cleaned);
    }
  }
  if (shouldOverlay(args, input.isTTY, output.isTTY)) {
    return require('./terminal.cjs').runTerminal({ codex, args, codexHome: env.CODEX_HOME || path.dirname(directory), input, output, env });
  }
  const result = spawnSync(codex.file, [...codex.args, ...args], { env: cleaned, stdio: 'inherit', windowsHide: false });
  if (result.error) throw result.error;
  return result.signal ? 128 + (require('node:os').constants.signals[result.signal] || 1) : result.status ?? 1;
}

module.exports = { shouldOverlay, realEnvironment, launch };
if (require.main === module) launch(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error('NotDex: ' + error.message); process.exitCode = 1; });
