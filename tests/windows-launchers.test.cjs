const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeHookCommand } = require('../scripts/setup.cjs');

test('Windows hook records an absolute system PowerShell path', () => {
  assert.match(makeHookCommand('win32', 'C:\\Codex Home\\notdex'), /^"[A-Z]:\\.*\\WindowsPowerShell\\v1\.0\\powershell\.exe" -NoProfile/i);
});

test('Windows launchers ignore a planted powershell.exe', { skip: process.platform !== 'win32' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex launcher security '));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const fake = path.join(root, 'powershell.exe');
  const compiler = path.join(root, 'compile.ps1');
  fs.writeFileSync(compiler, `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'public class AuditMarker { public static void Main(string[] args) { System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("NOTDEX_FAKE_MARKER"), "untrusted"); } }' -OutputAssembly $env:NOTDEX_FAKE_EXE -OutputType ConsoleApplication
`);
  const compiled = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', compiler], { env: { ...process.env, NOTDEX_FAKE_EXE: fake }, encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, compiled.stderr);
  const trusted = '[IO.File]::WriteAllText($env:NOTDEX_TRUSTED_MARKER,"trusted"); [Environment]::Exit(0)';
  const runtime = path.join(root, "Runtime ' & spaces");
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, 'notificar.ps1'), trusted);
  for (const name of ['Install', 'Uninstall']) {
    fs.copyFileSync(path.join(__dirname, '..', name + '.cmd'), path.join(root, name + '.cmd'));
    fs.writeFileSync(path.join(root, name.toLowerCase() + '.ps1'), trusted);
  }
  const commands = { hook: makeHookCommand('win32', runtime), install: 'Install.cmd', uninstall: 'Uninstall.cmd' };
  for (const [name, command] of Object.entries(commands)) await t.test(name, () => {
    const marker = path.join(root, name + '.trusted');
    const fakeMarker = path.join(root, name + '.untrusted');
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/c', '"' + command + '"'], {
      cwd: root, input: '\n', encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true, timeout: 15000,
      env: { ...process.env, PATH: root + ';' + process.env.PATH, NOTDEX_TRUSTED_MARKER: marker, NOTDEX_FAKE_MARKER: fakeMarker }
    });
    assert.equal(fs.existsSync(fakeMarker), false, name + ' executed the planted executable');
    assert.equal(result.status, 0, String(result.error || result.stderr));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'trusted');
  });
});
