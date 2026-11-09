const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hookFile = path.resolve(__dirname, '../src/notificar-windows.cjs');

test('Windows fast hook copies first and detaches only metadata with isolated standard streams', () => {
  const { runHook } = require(hookFile);
  const calls = [];
  runHook('\uFEFF' + JSON.stringify({ last_assistant_message: 'PRIVATE RESPONSE', session_id: 'session', transcript_path: 'C:\\log.jsonl', turn_id: 'turn' }), {
    copy: text => { calls.push('copy'); assert.equal(text, 'PRIVATE RESPONSE'); },
    spawn: (exe, args, options) => {
      calls.push('spawn');
      assert.equal(exe, process.execPath);
      assert(args.includes('--worker'));
      const data = JSON.parse(Buffer.from(args.at(-1), 'base64').toString('utf8'));
      assert.equal(data.session_id, 'session');
      assert.equal(data.codex_root, path.dirname(path.dirname(hookFile)));
      assert(!JSON.stringify(data).includes('PRIVATE RESPONSE'));
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      return { on() {}, unref() { calls.push('unref'); } };
    }
  });
  assert.deepEqual(calls, ['copy', 'spawn', 'unref']);
});

test('Windows background worker runs trusted PowerShell without detaching its console', () => {
  const { runWorker } = require(hookFile);
  let called = false;
  runWorker('e30=', { run(exe, args, options) {
    called = true;
    assert.match(exe, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    assert.deepEqual(args.slice(-2), ['-WorkerData', 'e30=']);
    assert.equal(options.detached, undefined);
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio, 'ignore');
    assert.equal(options.shell, false);
  } });
  assert(called);
  assert.doesNotThrow(() => runWorker('e30=', { run() { throw Error('unavailable'); } }));
});

test('Windows fast hook still starts its worker after clipboard failure and contains spawn failure', () => {
  const { runHook } = require(hookFile);
  let spawned = false;
  assert.doesNotThrow(() => runHook('{"content":"answer"}', {
    copy() { throw Error('clipboard busy'); }, spawn() { spawned = true; throw Error('spawn failed'); }
  }));
  assert.equal(spawned, true);
});

test('Windows fast hook exits without waiting for a slow PowerShell worker or inheriting its pipes', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex slow worker '));
  for (const file of ['notificar-windows.cjs', 'notificar-unix.cjs', 'desktop.cjs']) fs.copyFileSync(path.join(path.dirname(hookFile), file), path.join(root, file));
  const evidence = path.join(root, 'worker-finished');
  fs.writeFileSync(path.join(root, 'notificar.ps1'), 'param([string]$WorkerData)\nStart-Sleep -Seconds 2\n[IO.File]::WriteAllText($env:NOTDEX_WORKER_EVIDENCE,"finished")\n');
  const started = performance.now();
  const result = spawnSync(process.execPath, [path.join(root, 'notificar-windows.cjs')], {
    input: '{}', encoding: 'utf8', timeout: 5000, windowsHide: true, env: { ...process.env, NOTDEX_WORKER_EVIDENCE: evidence }
  });
  assert.equal(result.status, 0, String(result.error || result.stderr));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert(performance.now() - started < 5000);
  assert.equal(fs.existsSync(evidence), false, 'parent waited for the slow worker');
  for (let attempt = 0; attempt < 120 && !fs.existsSync(evidence); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(evidence, 'utf8'), 'finished');
});

test('Windows worker shows Toast before synchronous sound, even if Toast or sound throws', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notdex notification order '));
  const script = path.join(root, 'test.ps1');
  fs.writeFileSync(script, `
$ErrorActionPreference='Stop'
$Tokens=$null; $Errors=$null
$Ast=[Management.Automation.Language.Parser]::ParseFile($env:NOTDEX_WORKER_SOURCE,[ref]$Tokens,[ref]$Errors)
if($Errors.Count){throw 'Worker syntax failed'}
$Function=$Ast.Find({param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Invoke-DesktopNotification'},$true)
if(-not $Function){throw 'No notification orchestrator'}
Invoke-Expression $Function.Extent.Text
function Get-NotificationXml { param($Data) return '<toast/>' }
function Show-NotificationToast { param($Xml) $script:Order+='toast'; if($script:FailToast){throw 'toast unavailable'} }
function Play-NotificationSound { $script:Order+='sound'; throw 'sound unavailable' }
foreach($FailToast in @($false,$true)){
 $script:FailToast=$FailToast; $script:Order=@()
 Invoke-DesktopNotification @{}
 if(($script:Order -join ',') -ne 'toast,sound'){throw 'Sound preceded Toast or prevented its attempt'}
}
`);
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, NOTDEX_WORKER_SOURCE: path.join(path.dirname(hookFile), 'notificar.ps1') }
  });
  assert.equal(result.status, 0, result.stderr);
});
