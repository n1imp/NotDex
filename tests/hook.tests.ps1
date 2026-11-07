$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\notificar.ps1'
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-notificar-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($TestRoot)
$Failures = 0

# Exercise the actual script in a child: Exit(0) must not terminate the test runner.
# Replace only the OS side effects; capture the clipboard text and child command.
$Harness = @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$global:Started = [Diagnostics.Stopwatch]::StartNew()
function Set-Clipboard {
    param($Value)
    $elapsed = $global:Started.Elapsed.TotalMilliseconds
    if ($env:CODEX_NOTIFY_TEST_FAILURE -eq 'clipboard') { throw 'Clipboard unavailable' }
    [IO.File]::WriteAllText($env:CODEX_NOTIFY_TEST_CLIPBOARD, $Value)
    [IO.File]::WriteAllText($env:CODEX_NOTIFY_TEST_TIMING, [string]$elapsed)
}
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, $ErrorAction)
    if ($env:CODEX_NOTIFY_TEST_FAILURE -eq 'spawn') { throw 'Process unavailable' }
    [IO.File]::WriteAllText($env:CODEX_NOTIFY_TEST_COMMAND, ($ArgumentList -join ' '))
}
& $env:CODEX_NOTIFY_TEST_SCRIPT
'@

function Invoke-NotificationCase {
    param([string]$InputText, [string]$Failure = '')
    $CaseRoot = Join-Path $TestRoot ([guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($CaseRoot)
    $Info = New-Object Diagnostics.ProcessStartInfo
    $Info.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $Info.Arguments = '-NoProfile -NonInteractive -Sta -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Harness))
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardInput = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    $Info.EnvironmentVariables['CODEX_NOTIFY_TEST_SCRIPT'] = $ScriptPath
    $Info.EnvironmentVariables['CODEX_NOTIFY_TEST_CLIPBOARD'] = Join-Path $CaseRoot 'clipboard.txt'
    $Info.EnvironmentVariables['CODEX_NOTIFY_TEST_COMMAND'] = Join-Path $CaseRoot 'command.txt'
    $Info.EnvironmentVariables['CODEX_NOTIFY_TEST_TIMING'] = Join-Path $CaseRoot 'timing.txt'
    $Info.EnvironmentVariables['CODEX_NOTIFY_TEST_FAILURE'] = $Failure
    $Process = New-Object Diagnostics.Process
    $Process.StartInfo = $Info
    $Clock = [Diagnostics.Stopwatch]::StartNew()
    [void]$Process.Start()
    $Bytes = [Text.Encoding]::UTF8.GetBytes($InputText)
    $Process.StandardInput.BaseStream.Write($Bytes, 0, $Bytes.Length)
    $Process.StandardInput.Close()
    # Functional checks allow cold-start overhead; measure the real hook separately.
    if (-not $Process.WaitForExit(15000)) {
        $Process.Kill()
        throw 'Functional test exceeded 15 seconds'
    }
    $Clock.Stop()
    $Stdout = $Process.StandardOutput.ReadToEnd()
    $Stderr = $Process.StandardError.ReadToEnd()
    if ($Process.ExitCode -ne 0) { throw "Exit code $($Process.ExitCode): $Stderr" }
    if ($Stdout -or $Stderr) { throw "Unexpected hook output: $Stdout $Stderr" }
    $ClipboardPath = Join-Path $CaseRoot 'clipboard.txt'
    $CommandPath = Join-Path $CaseRoot 'command.txt'
    $TimingPath = Join-Path $CaseRoot 'timing.txt'
    [pscustomobject]@{
        Clipboard = if (Test-Path -LiteralPath $ClipboardPath) { [IO.File]::ReadAllText($ClipboardPath) } else { $null }
        Command = if (Test-Path -LiteralPath $CommandPath) { [IO.File]::ReadAllText($CommandPath) } else { $null }
        ClipboardMs = if (Test-Path -LiteralPath $TimingPath) { [double][IO.File]::ReadAllText($TimingPath) } else { $null }
        TotalMs = $Clock.Elapsed.TotalMilliseconds
    }
    $Process.Dispose()
}

$Cases = @(
    @{ Name = 'final answer wins'; Input = '{"last_assistant_message":"Final answer","content":"Other","session_id":"secret"}'; Want = 'Final answer' },
    @{ Name = 'content string'; Input = '{"content":"Useful content","cwd":"C:\\private"}'; Want = 'Useful content' },
    @{ Name = 'output string'; Input = '{"output":"Useful output"}'; Want = 'Useful output' },
    @{ Name = 'plain text'; Input = "  Plain answer`nsecond line  "; Want = "Plain answer`nsecond line" },
    @{ Name = 'metadata never copied'; Input = '{"session_id":"secret","transcript_path":"C:\\private\\log.jsonl"}'; Want = $null },
    @{ Name = 'malformed JSON never copied'; Input = '{"session_id":"secret"'; Want = $null },
    @{ Name = 'objects never stringified'; Input = '{"content":{"session_id":"secret"},"output":42}'; Want = $null },
    @{ Name = 'empty input preserves clipboard'; Input = ''; Want = $null },
    @{ Name = 'JSON newlines decoded once'; Input = '{"last_assistant_message":"Line 1\nLine 2"}'; Want = "Line 1`nLine 2" },
    @{ Name = 'literal backslashes preserved'; Input = '{"last_assistant_message":"C:\\new\\notes"}'; Want = 'C:\new\notes' },
    @{ Name = 'Unicode preserved'; Input = ('{"last_assistant_message":"A' + [char]0x00E7 + [char]0x00E3 + 'o ' + [char]::ConvertFromUtf32(0x1F680) + '"}'); Want = ('A' + [char]0x00E7 + [char]0x00E3 + 'o ' + [char]::ConvertFromUtf32(0x1F680)) },
    @{ Name = 'large response keeps clipboard and bounded worker command'; Input = ('{"last_assistant_message":"' + ('\u0001' * 4096) + '"}'); Want = ([string][char]1) * 4096 }
)

foreach ($Case in $Cases) {
    try {
        $Result = Invoke-NotificationCase $Case.Input
        if ($Result.Clipboard -cne $Case.Want) { throw 'Clipboard differs from expected final text' }
        if ($Result.Command.Length -ge 32000) { throw 'Worker exceeds the Windows command-line limit' }
        Write-Output ('PASS {0} (copy {1:N1} ms; total {2:N0} ms)' -f $Case.Name, $Result.ClipboardMs, $Result.TotalMs)
    } catch { $Failures++; Write-Output "FAIL $($Case.Name): $_" }
}

foreach ($Failure in @('clipboard', 'spawn')) {
    try {
        $Result = Invoke-NotificationCase '{"last_assistant_message":"Final"}' $Failure
        if ($Failure -eq 'clipboard' -and -not $Result.Command) { throw 'Clipboard failure prevented notification' }
        Write-Output "PASS exit 0 on $Failure failure"
    } catch { $Failures++; Write-Output "FAIL $Failure isolation: $_" }
}

try {
    $Text = 'Ajustei ''aspas'' " & < > ` $() ' + [char]0x0001 + [char]::ConvertFromUtf32(0x1F680) + '. Detalhes que nao devem aparecer.'
    $Payload = @{ last_assistant_message = $Text } | ConvertTo-Json -Compress
    $Result = Invoke-NotificationCase $Payload
    if ($Result.Command -notmatch '-EncodedCommand\s+(\S+)') { throw 'Worker does not use EncodedCommand' }
    $Worker = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
    $Tokens = $null
    $ParseErrors = $null
    $Ast = [Management.Automation.Language.Parser]::ParseInput($Worker, [ref]$Tokens, [ref]$ParseErrors)
    if ($ParseErrors.Count) { throw 'Worker has syntax errors' }
    $Formatter = $Ast.Find({ param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Get-NotificationXml' }, $true)
    if (-not $Formatter) { throw 'Worker has no testable notification formatter' }
    Invoke-Expression $Formatter.Extent.Text
    $DataAssignment = $Ast.Find({ param($Node) $Node -is [Management.Automation.Language.AssignmentStatementAst] -and $Node.Left.Extent.Text -eq '$Data' }, $true)
    Invoke-Expression $DataAssignment.Extent.Text
    if ($Data.PSObject.Properties.Name -contains 'text') { throw 'Assistant response is still passed to the notification worker' }
    $Xml = [xml](Get-NotificationXml $Data)
    if ($Xml.OuterXml -match 'Ajustei|Detalhes que nao') { throw 'Toast contains assistant response content' }
    if ($Xml.toast.visual.binding.text[1].InnerText -notmatch 'Total N/D.*In N/D.*Out N/D') { throw 'Missing counters must be shown as unavailable' }
    if ($Xml.toast.audio.silent -ne 'true') { throw 'Toast would play a second sound' }
    Write-Output 'PASS worker payload, syntax, metrics and response privacy'
} catch { $Failures++; Write-Output "FAIL worker safety: $_" }

if (Get-Command Get-NotificationXml -ErrorAction SilentlyContinue) {
    $FixtureRoot = Join-Path $TestRoot 'sessions'
    [void][IO.Directory]::CreateDirectory($FixtureRoot)
    $IndexPath = Join-Path $FixtureRoot 'session_index.jsonl'
    $Records = @(
        '{"id":"mission-123","thread_name":"Old title"}',
        '{"id":"other-mission","thread_name":"Wrong title"}',
        'malformed record',
        '{"id":"mission-123","thread_name":"Session title: ''quotes'' & <Windows>"}'
    )
    [IO.File]::WriteAllLines($IndexPath, $Records)
    $Data = [pscustomobject]@{ codex_root = $FixtureRoot; session_id = 'mission-123'; helper_path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'src\notificar-metricas.cjs') }
    try {
        $Xml = [xml](Get-NotificationXml $Data)
        if ($Xml.toast.visual.binding.text[0].InnerText -cne "Session title: 'quotes' & <Windows>") { throw 'Latest matching session title was not used' }
        Write-Output 'PASS exact session title from index, including XML characters'
    } catch { $Failures++; Write-Output "FAIL session title: $_" }

    try {
        $DbPath = Join-Path $FixtureRoot 'state_5.sqlite'
        $TranscriptPath = Join-Path $FixtureRoot 'rollout.jsonl'
        [IO.File]::WriteAllLines($TranscriptPath, @(
            '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12000,"cached_input_tokens":9000,"output_tokens":1500,"total_tokens":13500}}}}',
            '{"type":"event_msg","payload":{"type":"task_complete","turn_id":"test-turn","duration_ms":12300}}'
        ))
        $Js = @'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec('CREATE TABLE threads (id TEXT, title TEXT, name TEXT, rollout_path TEXT)');
db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('database-session', 'Initial prompt', 'Current session name', process.argv[2]);
db.close();
'@
        & node.exe --no-warnings -e $Js $DbPath $TranscriptPath
        if ($LASTEXITCODE -ne 0) { throw 'Could not create SQLite test fixture' }
        $Before = (Get-FileHash -LiteralPath $DbPath).Hash
        $Data.session_id = 'database-session'
        $Xml = [xml](Get-NotificationXml $Data)
        if ($Xml.toast.visual.binding.text[0].InnerText -cne 'Current session name') { throw 'Database session title was not used' }
        if ($Xml.toast.visual.binding.text[1].InnerText -notmatch 'Total 13\.500.*In 12\.000.*Out 1\.500') { throw 'Session counters are incorrect' }
        if ($Xml.toast.visual.binding.text[2] -notmatch 'Cache 75,0%.*Lat\. turno 12,3s') { throw 'Cache percentage or turn latency is incorrect' }
        if ($Xml.OuterXml -notmatch [char]::ConvertFromUtf32(0x1F7E2)) { throw 'Colored cache indicator is missing' }
        if ((Get-FileHash -LiteralPath $DbPath).Hash -ne $Before) { throw 'Session database was modified' }
        Write-Output 'PASS title, counters, cache rate, latency and colors; database read only'
    } catch { $Failures++; Write-Output "FAIL database session title: $_" }
}

Write-Output "Failures: $Failures; temporary evidence: $TestRoot"
if ($Failures) { exit 1 }
exit 0
