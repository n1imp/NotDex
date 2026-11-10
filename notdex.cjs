const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
try {
  const index = process.argv.indexOf('--codex-home');
  const home = index >= 0 ? process.argv[index + 1] : process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const directory = path.join(path.resolve(home), 'notdex');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.app !== 'NotDex' || manifest.format_version !== 2) throw Error('Install NotDex 0.2+ before opening the overlay.');
  require(path.join(directory, 'terminal.cjs')).main();
} catch (error) { console.error('NotDex: ' + error.message); process.exitCode = 1; }
