const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
const tests = fs.readdirSync(path.join(__dirname, 'tests')).filter(name => name.endsWith('.test.cjs')).sort();
run(process.execPath, ['--no-warnings', '--test', '--test-concurrency=1', ...tests.map(name => path.join(__dirname, 'tests', name))]);
if (process.platform === 'win32') {
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const name of ['setup.tests.ps1', 'hook.tests.ps1']) {
    run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tests', name)]);
  }
} else {
  for (const name of ['install.sh', 'uninstall.sh', 'install.command', 'uninstall.command', 'notdex.sh', 'notdex.command', 'scripts/bootstrap.sh', 'scripts/linux-deps.sh']) {
    run('/bin/sh', ['-n', path.join(__dirname, name)]);
  }
}
console.log('NotDex: all applicable tests passed. No live profile or GUI was modified.');
