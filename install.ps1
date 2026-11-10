[CmdletBinding()]
param([string]$CodexHome, [string]$NodePath, [switch]$NoDownload, [switch]$NoShellIntegration)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS or Linux.' }
if (-not (Get-Command codex.cmd,codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1)) { throw 'Install Codex CLI and add it to PATH first.' }
. (Join-Path $PSScriptRoot 'scripts\bootstrap.ps1')
$NodePath = Get-NotDexNode -NodePath $NodePath -CodexHome $CodexHome -NoDownload:$NoDownload
$Arguments = @('--no-warnings',(Join-Path $PSScriptRoot 'install.cjs'))
if ($CodexHome) { $Arguments += @('--codex-home',$CodexHome) }
if ($NoDownload) { $Arguments += '--no-download' }
if ($NoShellIntegration) { $Arguments += '--no-shell-integration' }
& $NodePath @Arguments
if ($LASTEXITCODE -ne 0) { throw 'NotDex installation failed; see the error above.' }
