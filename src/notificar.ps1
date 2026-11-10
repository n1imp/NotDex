param([string]$WorkerData)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Get-NotificationXml {
    param($Data)
    $Metadata = @{ title = 'Codex' }
    try {
        $NodePath = ''
        if ($Data.node_path_file -and [IO.File]::Exists($Data.node_path_file)) {
            $NodePath = [IO.File]::ReadAllText($Data.node_path_file).Trim()
        }
        if (-not $NodePath -or -not [IO.File]::Exists($NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
        $InputData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Data | ConvertTo-Json -Compress)))
        $EncodedResult = (& $NodePath --no-warnings $Data.helper_path $InputData 2>$null) -join ''
        if ($LASTEXITCODE -eq 0 -and $EncodedResult) {
            $Metadata = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedResult))) -ErrorAction Stop
        }
    } catch {}
    $Culture = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')
    $Counts = foreach ($Field in @('total_tokens', 'input_tokens', 'output_tokens')) {
        if ($null -ne $Metadata.$Field) { ([double]$Metadata.$Field).ToString('N0', $Culture) } else { 'N/D' }
    }
    $Cache = 'N/D'
    if ($null -ne $Metadata.cache_hit_pct) { $Cache = ([double]$Metadata.cache_hit_pct).ToString('F1', $Culture) + '%' }
    $Latency = 'N/D'
    if ($null -ne $Metadata.latency_ms) {
        $Duration = [TimeSpan]::FromMilliseconds($Metadata.latency_ms)
        $Latency = if ($Duration.TotalSeconds -lt 60) { $Duration.TotalSeconds.ToString('F1', $Culture) + 's' } else { '{0}m {1:00}s' -f [math]::Floor($Duration.TotalMinutes), $Duration.Seconds }
        if ($Metadata.latency_is_estimate) { $Latency = '~' + $Latency }
    }
    $Blue = [char]::ConvertFromUtf32(0x1F535)
    $Orange = [char]::ConvertFromUtf32(0x1F7E0)
    $Green = [char]::ConvertFromUtf32(0x1F7E2)
    $Title = [string]$Metadata.title
    $Title = [Security.SecurityElement]::Escape(($Title -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]', ''))
    $Label = if ($Metadata.scope -eq 'turn') { 'Turno' } else { 'Total' }
    $Counters = [Security.SecurityElement]::Escape("$Label $($Counts[0]) | $Blue In $($Counts[1]) | $Orange Out $($Counts[2])")
    $Cost = ''
    if ($Metadata.scope -eq 'turn') {
        $Dollars = if ($null -ne $Metadata.usd_reference) { ([decimal]$Metadata.usd_reference).ToString('F4', $Culture) } else { 'N/D' }
        $Cost = ' | US$ ref. ' + $Dollars
    }
    $Performance = [Security.SecurityElement]::Escape("$Green Cache $Cache | Lat. turno $Latency$Cost")
    return '<toast duration="short"><visual><binding template="ToastGeneric"><text hint-maxLines="2">' + $Title + '</text><text hint-maxLines="2">' + $Counters + '</text><text>' + $Performance + '</text></binding></visual><audio silent="true"/></toast>'
}


function Show-NotificationToast {
    param([string]$XmlTemplate)
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $AppId = 'Microsoft.Windows.Shell.RunDialog'
    $ToastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $ToastXml.LoadXml($XmlTemplate)
    $Toast = New-Object Windows.UI.Notifications.ToastNotification $ToastXml
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($Toast)
}

function Play-NotificationSound {
    try {
        $SoundPath = [IO.Path]::Combine($env:SystemRoot, 'Media\Windows Notify Calendar.wav')
        $Player = New-Object System.Media.SoundPlayer $SoundPath
        $Player.PlaySync()
    } catch {} finally {
        if ($Player) { $Player.Dispose() }
    }
}

function Invoke-DesktopNotification {
    param($Data)
    $XmlTemplate = Get-NotificationXml $Data
    try { Show-NotificationToast $XmlTemplate } catch {}
    try { Play-NotificationSound } catch {}
}

if ($WorkerData) {
    try {
        $Data = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($WorkerData)))
        Invoke-DesktopNotification $Data
    } catch {}
    [System.Environment]::Exit(0)
}

try {
    $ObservedAt = [DateTimeOffset]::UtcNow.ToString('o')
    # O hook entrega JSON UTF-8 diretamente ao stdin desta instancia.
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    $RawInput = [Console]::In.ReadToEnd().TrimStart([char]0xFEFF)
    $ContentText = ''

    if (-not [string]::IsNullOrWhiteSpace($RawInput)) {
        if ($RawInput -match '^\s*[\{\[]') {
            try {
                $JsonInput = ConvertFrom-Json -InputObject $RawInput -ErrorAction Stop
                # Nunca copie o envelope de metadados nem objetos convertidos em texto.
                if ($RawInput -match '^\s*\{') {
                    foreach ($Field in @('last_assistant_message', 'content', 'output')) {
                        $Candidate = $JsonInput.$Field
                        if ($Candidate -is [string] -and -not [string]::IsNullOrWhiteSpace($Candidate)) {
                            $ContentText = $Candidate
                            break
                        }
                    }
                }
            } catch {}
        } else {
            $ContentText = $RawInput
        }
    }

    # ConvertFrom-Json ja decodifica \n; uma segunda substituicao corrompe caminhos.
    $ContentText = $ContentText.Trim()

    # Uma falha no clipboard nao deve impedir o aviso em segundo plano.
    if (-not [string]::IsNullOrWhiteSpace($ContentText)) {
        try {
            Set-Clipboard -Value $ContentText -ErrorAction Stop
        } catch {}
    }

    # Limite o payload do worker para caber na linha de comando do Windows.
    $WorkerData = @{
        scope = 'turn'
        codex_root = [IO.Directory]::GetParent($PSScriptRoot).FullName
        session_id = if ($JsonInput.session_id -is [string]) { $JsonInput.session_id } else { '' }
        transcript_path = if ($JsonInput.transcript_path -is [string]) { $JsonInput.transcript_path } else { '' }
        turn_id = if ($JsonInput.turn_id -is [string]) { $JsonInput.turn_id } else { '' }
        observed_at = $ObservedAt
        helper_path = [IO.Path]::Combine($PSScriptRoot, 'notificar-metricas.cjs')
        node_path_file = [IO.Path]::Combine($PSScriptRoot, 'node-path.txt')
    } | ConvertTo-Json -Compress
    $EncodedData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($WorkerData))

    # Base64 preserva aspas e Unicode sem passar a resposta pelo parser do shell.
    $PowerShellPath = [IO.Path]::Combine($env:SystemRoot, 'System32\WindowsPowerShell\v1.0\powershell.exe')
    Start-Process -FilePath $PowerShellPath -ArgumentList @('-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-WorkerData', $EncodedData) -WindowStyle Hidden -ErrorAction Stop
} catch {}

[System.Environment]::Exit(0)
