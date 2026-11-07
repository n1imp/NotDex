const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repo = path.dirname(__dirname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('pinned release has valid checksums for supported runtime assets', () => {
  const version = fs.readFileSync(path.join(repo, 'scripts/node-version.txt'), 'utf8').trim();
  assert.match(version, /^24\.\d+\.\d+$/);
  const lines = fs.readFileSync(path.join(repo, 'scripts/node-shasums.txt'), 'utf8').trim().split(/\r?\n/);
  for (const line of lines) {
    assert.match(line, /^[0-9a-f]{64}  /);
    const asset = line.split(/\s+/)[1];
    assert.ok(asset.startsWith('win-') || asset.startsWith('node-v' + version + '-'));
  }
  assert.equal(new Set(lines.map(line => line.split(/\s+/)[1])).size, lines.length);
  const assets = new Set(lines.map(line => line.split(/\s+/)[1]));
  for (const asset of assets) if (asset.endsWith('.tar.gz')) assert(assets.has(asset.slice(0, -7) + '/bin/node'));
});

function windowsFixture(valid) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notdex bootstrap ' & \u00e7 "));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  fs.copyFileSync(path.join(repo, 'scripts/bootstrap.ps1'), path.join(scripts, 'bootstrap.ps1'));
  fs.writeFileSync(path.join(scripts, 'node-version.txt'), '24.22.2');
  const checksum = valid ? hash('pinned fixture') : '0'.repeat(64);
  fs.writeFileSync(path.join(scripts, 'node-shasums.txt'), checksum + '  win-x64/node.exe\n' + checksum + '  win-arm64/node.exe\n');
  const harness = path.join(root, 'fixture.ps1');
  fs.writeFileSync(harness, `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -ErrorAction Stop
. $env:NOTDEX_BOOTSTRAP_FILE
function Get-Command { param($Name,$ErrorAction) return $null }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$OutFile)
    [IO.File]::AppendAllText($env:NOTDEX_DOWNLOAD_LOG,$Uri + "\n")
    [IO.File]::WriteAllText($OutFile,'pinned fixture')
}
try {
    $NoDownload=$env:NOTDEX_OFFLINE -eq '1'
    $Result=Get-NotDexNode -CodexHome $env:CODEX_HOME -NoDownload:$NoDownload
    [Console]::Out.WriteLine($Result)
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`);
  const env = { ...process.env, NOTDEX_BOOTSTRAP_FILE: path.join(scripts, 'bootstrap.ps1'),
    NOTDEX_CACHE_HOME: path.join(root, 'cache'), CODEX_HOME: path.join(root, 'profile'), NOTDEX_DOWNLOAD_LOG: path.join(root, 'download.log') };
  const invoke = extra => spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, env, invoke };
}

test('Windows private download verifies checksum and cached reuse needs no network', { skip: process.platform !== 'win32' }, () => {
  const { env, invoke } = windowsFixture(true);
  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const binary = first.stdout.trim().split(/\r?\n/).at(-1);
  assert.equal(fs.readFileSync(binary, 'utf8'), 'pinned fixture');
  const second = invoke({ NOTDEX_OFFLINE: '1' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout.trim(), binary);
  assert.equal(fs.readFileSync(env.NOTDEX_DOWNLOAD_LOG, 'utf8').trim().split('\n').length, 1);
});

test('Windows rejects bad checksums and cleans temporary downloads', { skip: process.platform !== 'win32' }, () => {
  const { env, invoke } = windowsFixture(false);
  const result = invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256/);
  assert.deepEqual(fs.readdirSync(path.join(env.NOTDEX_CACHE_HOME, 'runtime')), []);
  assert.equal(fs.existsSync(env.CODEX_HOME), false);
});

function unixFixture(valid) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notdex bootstrap ' & \u00e7 "));
  const scripts = path.join(root, 'scripts');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(scripts); fs.mkdirSync(bin);
  fs.copyFileSync(path.join(repo, 'scripts/bootstrap.sh'), path.join(scripts, 'bootstrap.sh'));
  fs.writeFileSync(path.join(scripts, 'node-version.txt'), '24.22.2\n');
  const flavour = process.platform === 'linux' && /musl/i.test(spawnSync('ldd', ['--version'], { encoding: 'utf8' }).stderr || '') ? '-musl' : '';
  const name = `node-v24.22.2-${process.platform}-${process.arch}${flavour}`;
  const packageRoot = path.join(root, name, 'bin');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'node'), '#!/bin/sh\nprintf "v24.22.2\\n"\n', { mode: 0o755 });
  const archive = path.join(root, 'fixture.tar.gz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', root, name]);
  assert.equal(tar.status, 0);
  fs.writeFileSync(path.join(scripts, 'node-shasums.txt'), (valid ? hash(fs.readFileSync(archive)) : '0'.repeat(64)) + '  ' + name + '.tar.gz\n' + hash(fs.readFileSync(path.join(packageRoot, 'node'))) + '  ' + name + '/bin/node\n');
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf "v20.0.0\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\ncase "$1" in https://nodejs.org/dist/v24.22.2/*) ;; https:*) exit 9 ;; esac\nif [ "$1" = -o ]; then cp "$NOTDEX_ARCHIVE" "$2"; exit; fi\nshift\ndone\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
    NOTDEX_ARCHIVE: archive, NOTDEX_CACHE_HOME: path.join(root, 'cache') };
  const invoke = offline => spawnSync('/bin/sh', ['-c', 'set -eu; . "$1/scripts/bootstrap.sh"; notdex_bootstrap "$1" "$2" "$3"; printf "%s\\n" "$NOTDEX_NODE"',
    'bootstrap', root, path.join(root, 'profile'), String(offline)], { env, encoding: 'utf8' });
  return { root, env, invoke, name, scripts };
}

test('Unix private runtime works in paths with spaces and is reusable offline', { skip: process.platform === 'win32' }, () => {
  const { invoke } = unixFixture(true);
  const first = invoke(false);
  assert.equal(first.status, 0, first.stderr);
  const second = invoke(true);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout.trim(), second.stdout.trim());
});

test('Unix rejects corrupted archives before installing a runtime', { skip: process.platform === 'win32' }, () => {
  const { env, invoke } = unixFixture(false);
  const result = invoke(false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256/);
  assert.deepEqual(fs.readdirSync(path.join(env.NOTDEX_CACHE_HOME, 'runtime')), []);
});

test('Unix repairs an incompatible cached runtime using the pinned release URL', { skip: process.platform === 'win32' }, () => {
  const { env, invoke, name } = unixFixture(true);
  const cache = path.join(env.NOTDEX_CACHE_HOME, 'runtime');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, name), '#!/bin/sh\nprintf "v20.0.0\\n"\n', { mode: 0o755 });
  const result = invoke(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(invoke(true).status, 0);
});

for (const route of ['cache', 'installed-path']) {
  test(`Unix rejects a tampered runtime before execution through ${route}`, { skip: process.platform === 'win32' }, () => {
    const { root, env, invoke, name } = unixFixture(true);
    const cache = path.join(env.NOTDEX_CACHE_HOME, 'runtime');
    fs.mkdirSync(cache, { recursive: true });
    const binary = path.join(cache, name);
    const marker = path.join(root, 'executed');
    fs.writeFileSync(binary, '#!/bin/sh\ntouch "$NOTDEX_ATTACK_MARKER"\nprintf "v24.22.2\\n"\n', { mode: 0o755 });
    env.NOTDEX_ATTACK_MARKER = marker;
    if (route === 'installed-path') {
      fs.mkdirSync(path.join(root, 'profile/notdex'), { recursive: true });
      fs.writeFileSync(path.join(root, 'profile/notdex/node-path.txt'), binary + '\n');
    }
    const result = invoke(true);
    assert.equal(fs.existsSync(marker), false, 'tampered executable ran before validation');
    assert.notEqual(result.status, 0);
  });
}

for (const route of ['base', 'runtime', 'ancestor', 'writable-base', 'target-directory']) {
  test(`Unix rejects an unsafe cache ${route} before executing its runtime`, { skip: process.platform === 'win32' }, () => {
    const { root, env, invoke, name } = unixFixture(true);
    const backing = path.join(root, 'backing');
    fs.mkdirSync(backing);
    if (route === 'base') fs.symlinkSync(backing, env.NOTDEX_CACHE_HOME);
    else if (route === 'runtime') {
      fs.mkdirSync(env.NOTDEX_CACHE_HOME);
      fs.symlinkSync(backing, path.join(env.NOTDEX_CACHE_HOME, 'runtime'));
    } else if (route === 'ancestor') {
      fs.symlinkSync(backing, path.join(root, 'alias'));
      env.NOTDEX_CACHE_HOME = path.join(root, 'alias/cache');
    }
    const cache = path.join(env.NOTDEX_CACHE_HOME, 'runtime');
    fs.mkdirSync(cache, { recursive: true });
    if (route === 'writable-base') fs.chmodSync(env.NOTDEX_CACHE_HOME, 0o777);
    const binary = path.join(cache, name);
    if (route === 'target-directory') fs.mkdirSync(binary);
    else fs.copyFileSync(path.join(root, name, 'bin/node'), binary);
    const result = invoke(true);
    assert.notEqual(result.status, 0, 'unsafe cache was accepted');
    assert.match(result.stderr, /cache.*(link|permission|owner|private|unsafe)/i);
  });
}

test('Unix verifies the extracted binary against its independent pinned hash', { skip: process.platform === 'win32' }, () => {
  const { env, invoke, name, scripts } = unixFixture(true);
  const file = path.join(scripts, 'node-shasums.txt');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^[a-f0-9]{64}(?=  .*\/bin\/node$)/m, '0'.repeat(64)));
  const result = invoke(false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256/);
  assert.equal(fs.existsSync(path.join(env.NOTDEX_CACHE_HOME, 'runtime', name)), false);
});
