[CmdletBinding()]
param([string]$CodexHome)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\bootstrap.ps1')
$NodePath = Get-NotDexNode -CodexHome $CodexHome -NoDownload
$Arguments = @('--no-warnings',(Join-Path $PSScriptRoot 'uninstall.cjs'))
if ($CodexHome) { $Arguments += @('--codex-home',$CodexHome) }
& $NodePath @Arguments
if ($LASTEXITCODE -ne 0) { throw 'NotDex removal failed; see the error above.' }
