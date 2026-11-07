$ErrorActionPreference = 'Stop'
& node.exe --no-warnings (Join-Path $PSScriptRoot 'test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'NotDex tests failed.' }
