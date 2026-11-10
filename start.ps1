[CmdletBinding()]
param([string]$CodexHome)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\bootstrap.ps1')
$NodePath = Get-NotDexNode -CodexHome $CodexHome -NoDownload
$Arguments = @('--no-warnings', (Join-Path $PSScriptRoot 'notdex.cjs'))
if ($CodexHome) { $Arguments += @('--codex-home', $CodexHome) }
& $NodePath @Arguments
exit $LASTEXITCODE
