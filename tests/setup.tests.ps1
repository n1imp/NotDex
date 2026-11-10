$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('notdex-setup-' + [guid]::NewGuid().ToString('N'))
$FakeBin = Join-Path $TestRoot 'bin'
[void][IO.Directory]::CreateDirectory($FakeBin)
$FakeCodex = Join-Path $FakeBin 'codex.cmd'
[IO.File]::WriteAllText($FakeCodex, "@echo off`r`necho codex-cli 0.167.0`r`n")
$PreviousPath = $env:PATH
$PreviousCodexHome = $env:CODEX_HOME
$env:PATH = $FakeBin + ';' + $env:PATH
$Failures = 0

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Invoke-Setup([string]$Script, [string]$Directory, [string]$Node = $NodePath, [switch]$Fail, [switch]$UseEnvironment) {
    $ScriptFile = Join-Path $RepoRoot $Script
    $Arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$ScriptFile,'-NoShellIntegration')
    if (-not $UseEnvironment) { $Arguments += @('-CodexHome',$Directory) }
    if ($Script -eq 'install.ps1') { $Arguments += @('-NodePath',$Node) }
    $Preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $Output = & $PowerShell @Arguments 2>&1
        $Code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $Preference }
    if ($Fail) { Assert-True ($Code -ne 0) 'Invalid setup unexpectedly succeeded' }
    elseif ($Code -ne 0) { throw ($Output -join "`n") }
}
function Test-Case([string]$Name, [scriptblock]$Body) {
    try { & $Body; Write-Output "PASS $Name" }
    catch { $script:Failures++; Write-Output "FAIL ${Name}: $_" }
}

try {
    Test-Case 'install, reinstall and uninstall preserve unrelated configuration' {
        $Directory = Join-Path $TestRoot ("Perfil ' & " + [char]0x00E7 + ' com espacos\codex')
        [void][IO.Directory]::CreateDirectory($Directory)
        $ConfigPath = Join-Path $Directory 'config.toml'
        $ConfigText = "[features]`r`nhooks = true`r`n[profiles.test]`r`nmodel = 'fixture'`r`n"
        [IO.File]::WriteAllText($ConfigPath,$ConfigText)
        $HooksPath = Join-Path $Directory 'hooks.json'
        $Initial = '{"description":"Keep me","hooks":{"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"echo unrelated","statusMessage":"NotDex"}]}],"SessionStart":[{"hooks":[{"type":"command","command":"echo start"}]}]}}'
        [IO.File]::WriteAllText($HooksPath,$Initial)
        Invoke-Setup 'install.ps1' $Directory
        Invoke-Setup 'install.ps1' $Directory
        $Hooks = [IO.File]::ReadAllText($HooksPath) | ConvertFrom-Json
        $Handlers = @($Hooks.hooks.Stop | ForEach-Object { $_.hooks })
        $Managed = @($Handlers | Where-Object { $_.command -ne 'echo unrelated' })
        Assert-True ($Managed.Count -eq 1) 'Install duplicated its Stop handler'
        Assert-True ($Managed[0].timeout -eq 5) 'Stop timeout is not five seconds'
        Assert-True ($Hooks.description -eq 'Keep me') 'Top-level hook metadata was lost'
        Assert-True ($Hooks.hooks.SessionStart[0].hooks[0].command -eq 'echo start') 'Another event changed'
        Assert-True ([IO.File]::ReadAllText($ConfigPath).StartsWith($ConfigText)) 'Unrelated TOML content changed'
        $InstallRoot = Join-Path $Directory 'notdex'
        Assert-True ([IO.File]::ReadAllText((Join-Path $InstallRoot 'node-path.txt')).Trim() -ceq $NodePath) 'Node path was not recorded'
        Assert-True ($Managed[0].type -eq 'mcp_tool' -and $Managed[0].server -eq 'notdex') 'Installed handler is not resident MCP'

        # Run the installed launcher, replacing only clipboard and GUI side effects.
        $Preload = Join-Path $TestRoot 'mock-desktop.cjs'
        [IO.File]::WriteAllText($Preload, @'
const cp = require('node:child_process');
const fs = require('node:fs');
cp.spawnSync = (exe, args, options) => {
  if (!exe.endsWith('clip.exe')) throw Error('Unexpected clipboard executable');
  fs.writeFileSync(process.env.NOTDEX_TEST_CLIP, options.input.subarray(2).toString('utf16le'));
  return { status: 0 };
};
cp.spawn = (exe, args) => {
  fs.writeFileSync(process.env.NOTDEX_TEST_WORKER, Buffer.from(args.at(-1), 'base64').toString('utf8'));
  return { on() {}, unref() {} };
};
'@
        )
        $Info=New-Object Diagnostics.ProcessStartInfo
        $Info.FileName=$NodePath
        $Info.Arguments='--no-warnings "' + (Join-Path $InstallRoot 'notdex-mcp.cjs') + '"'
        $Info.EnvironmentVariables['NODE_OPTIONS'] = '--require ' + (ConvertTo-Json -InputObject $Preload -Compress)
        $Info.EnvironmentVariables['NOTDEX_TEST_CLIP'] = Join-Path $TestRoot 'installed-clip.txt'
        $Info.EnvironmentVariables['NOTDEX_TEST_WORKER'] = Join-Path $TestRoot 'installed-worker.json'
        $Info.EnvironmentVariables['NOTDEX_OVERLAY_ENDPOINT'] = ''
        $Info.EnvironmentVariables['NOTDEX_OVERLAY_TOKEN'] = ''
        $Info.UseShellExecute=$false; $Info.CreateNoWindow=$true
        $Info.RedirectStandardInput=$true; $Info.RedirectStandardOutput=$true; $Info.RedirectStandardError=$true
        $Info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
        $Process=New-Object Diagnostics.Process
        $Process.StartInfo=$Info
        [void]$Process.Start()
        $Messages = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' + "`n" + '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notdex_event","arguments":{"event":"stop","session_id":"fixture","last_assistant_message":"Portable answer"}}}' + "`n"
        $Bytes=[Text.Encoding]::UTF8.GetBytes($Messages)
        $Process.StandardInput.BaseStream.Write($Bytes,0,$Bytes.Length)
        $Process.StandardInput.Close()
        Assert-True ($Process.WaitForExit(15000)) 'Installed launcher timed out'
        $Lines=$Process.StandardOutput.ReadToEnd() -split '\r?\n'
        Assert-True ($Process.ExitCode -eq 0) 'Installed hook did not exit zero'
        Assert-True ([IO.File]::ReadAllText((Join-Path $TestRoot 'installed-clip.txt')) -ceq 'Portable answer') 'Installed worker did not copy final text'
        Assert-True (($Lines -join '') -notmatch 'Portable answer') 'Assistant response leaked into MCP output'
        $Data=[IO.File]::ReadAllText((Join-Path $TestRoot 'installed-worker.json')) | ConvertFrom-Json
        Assert-True ($Data.codex_root -ceq $Directory) 'Runtime used the source repository as CODEX_HOME'
        Assert-True ([IO.File]::Exists($Data.helper_path)) 'Installed metrics helper was not found'
        Assert-True ([IO.File]::Exists($Data.node_path_file)) 'Installed Node configuration was not found'
        $Process.Dispose()

        # The managed handler can share a group with another tool after a user edits JSON.
        $Hooks.hooks.Stop[-1].hooks=@($Hooks.hooks.Stop[-1].hooks) + [pscustomobject]@{type='command';command='echo keep-in-group'}
        [IO.File]::WriteAllText($HooksPath,($Hooks | ConvertTo-Json -Depth 30))
        Invoke-Setup 'uninstall.ps1' $Directory
        Invoke-Setup 'uninstall.ps1' $Directory
        $After=[IO.File]::ReadAllText($HooksPath) | ConvertFrom-Json
        $Commands=@($After.hooks.Stop | ForEach-Object { $_.hooks } | ForEach-Object { $_.command })
        Assert-True ($Commands.Count -eq 2 -and $Commands -contains 'echo unrelated' -and $Commands -contains 'echo keep-in-group') 'Uninstall removed unrelated hooks'
        Assert-True (-not [IO.Directory]::Exists($InstallRoot)) 'Uninstall left managed files behind'
        Assert-True ([IO.File]::ReadAllText($ConfigPath) -ceq $ConfigText) 'Uninstall modified config.toml'
    }

    Test-Case 'CODEX_HOME is honored when no parameter is supplied' {
        $Directory=Join-Path $TestRoot 'environment-home'
        $env:CODEX_HOME=$Directory
        Invoke-Setup 'install.ps1' $Directory -UseEnvironment
        Assert-True ([IO.File]::Exists((Join-Path $Directory 'hooks.json'))) 'CODEX_HOME was ignored'
        Invoke-Setup 'uninstall.ps1' $Directory -UseEnvironment
    }
    Test-Case 'invalid hooks JSON is unchanged and no runtime is created' {
        $Directory=Join-Path $TestRoot 'invalid-json'
        [void][IO.Directory]::CreateDirectory($Directory)
        $HooksPath=Join-Path $Directory 'hooks.json'
        [IO.File]::WriteAllText($HooksPath,'{broken json')
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True ([IO.File]::ReadAllText($HooksPath) -ceq '{broken json') 'Invalid configuration was overwritten'
        Assert-True (-not [IO.Directory]::Exists((Join-Path $Directory 'notdex'))) 'Runtime created before validation'
    }
    Test-Case 'an unmanaged installation directory is never overwritten' {
        $Directory=Join-Path $TestRoot 'unmanaged'
        $InstallRoot=Join-Path $Directory 'notdex'
        [void][IO.Directory]::CreateDirectory($InstallRoot)
        $PrivateFile=Join-Path $InstallRoot 'keep.txt'
        [IO.File]::WriteAllText($PrivateFile,'keep')
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True ([IO.File]::ReadAllText($PrivateFile) -ceq 'keep') 'Unmanaged files were changed'
    }
    Test-Case 'old Node is rejected before creating the profile' {
        $OldNode=Join-Path $FakeBin 'old-node.cmd'
        [IO.File]::WriteAllText($OldNode,"@echo off`r`necho v20.0.0`r`n")
        $Directory=Join-Path $TestRoot 'old-node'
        Invoke-Setup 'install.ps1' $Directory -Node $OldNode -Fail
        Assert-True (-not [IO.Directory]::Exists($Directory)) 'Old Node changed the profile'
    }
    Test-Case 'missing Node is rejected without changing the profile' {
        $Directory=Join-Path $TestRoot 'missing-node'
        Invoke-Setup 'install.ps1' $Directory -Node (Join-Path $FakeBin 'missing.exe') -Fail
        Assert-True (-not [IO.Directory]::Exists($Directory)) 'Missing Node changed the profile'
    }
    Test-Case 'explicitly disabled hooks are preserved and rejected' {
        $Directory=Join-Path $TestRoot 'disabled-hooks'
        [void][IO.Directory]::CreateDirectory($Directory)
        $Config=Join-Path $Directory 'config.toml'
        $Text="[features]`r`nhooks = false`r`n"
        [IO.File]::WriteAllText($Config,$Text)
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True ([IO.File]::ReadAllText($Config) -ceq $Text) 'Installer changed the global opt-out'
        Assert-True (-not [IO.Directory]::Exists((Join-Path $Directory 'notdex'))) 'Disabled hooks created a runtime'
    }
    Test-Case 'old Codex is rejected before creating the profile' {
        [IO.File]::WriteAllText($FakeCodex,"@echo off`r`necho codex-cli 0.100.0`r`n")
        $Directory=Join-Path $TestRoot 'old-codex'
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True (-not [IO.Directory]::Exists($Directory)) 'Old Codex changed the profile'
        [IO.File]::WriteAllText($FakeCodex,"@echo off`r`necho codex-cli 0.167.0`r`n")
    }
    Test-Case 'reinstall does not overwrite unrelated hard-linked files' {
        $Directory=Join-Path $TestRoot 'hard-links'
        Invoke-Setup 'install.ps1' $Directory
        $InstallRoot=Join-Path $Directory 'notdex'
        foreach($Name in @('notificar-metricas.cjs','node-path.txt')) {
            $External=Join-Path $TestRoot ('external-' + $Name)
            $Managed=Join-Path $InstallRoot $Name
            [IO.File]::WriteAllText($External,'unrelated sentinel')
            [IO.File]::Delete($Managed)
            [void](New-Item -ItemType HardLink -Path $Managed -Target $External)
        }
        Invoke-Setup 'install.ps1' $Directory
        foreach($Name in @('notificar-metricas.cjs','node-path.txt')) {
            Assert-True ([IO.File]::ReadAllText((Join-Path $TestRoot ('external-' + $Name))) -ceq 'unrelated sentinel') 'Reinstall overwrote an external hard-linked file'
        }
        Invoke-Setup 'uninstall.ps1' $Directory
    }
    Test-Case 'a directory named hooks.json is rejected before writing runtime' {
        $Directory=Join-Path $TestRoot 'directory-config'
        [void][IO.Directory]::CreateDirectory((Join-Path $Directory 'hooks.json'))
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True (-not [IO.Directory]::Exists((Join-Path $Directory 'notdex'))) 'Invalid config path created a runtime'
    }
    Test-Case 'managed directory destinations are rejected before updating files' {
        $Directory=Join-Path $TestRoot 'directory-runtime-file'
        Invoke-Setup 'install.ps1' $Directory
        $InstallRoot=Join-Path $Directory 'notdex'
        $Main=Join-Path $InstallRoot 'notificar.ps1'
        [IO.File]::WriteAllText($Main,'unchanged old runtime')
        $NodeConfig=Join-Path $InstallRoot 'node-path.txt'
        [IO.File]::Delete($NodeConfig)
        [void][IO.Directory]::CreateDirectory($NodeConfig)
        Invoke-Setup 'install.ps1' $Directory -Fail
        Assert-True ([IO.File]::ReadAllText($Main) -ceq 'unchanged old runtime') 'Invalid destination changed another runtime file'
    }
} finally {
    $env:PATH=$PreviousPath
    $env:CODEX_HOME=$PreviousCodexHome
}
Write-Output "Failures: $Failures"
if($Failures){exit 1}
