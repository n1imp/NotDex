$ErrorActionPreference = 'Stop'

function Get-NotDexNode([string]$NodePath, [string]$CodexHome, [switch]$NoDownload) {
    if ($NodePath) {
        $NodePath = (Get-Item -LiteralPath $NodePath -ErrorAction Stop).FullName
        $Version = (& $NodePath --version) -join ''
        if ($LASTEXITCODE -ne 0 -or $Version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24+ is required at the explicitly selected NodePath.' }
        return $NodePath
    }
    $Candidates = @()
    if (-not $CodexHome) { $CodexHome = $env:CODEX_HOME }
    if (-not $CodexHome) { $CodexHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
    $Installed = Join-Path $CodexHome 'notdex\node-path.txt'
    if ([IO.File]::Exists($Installed)) { $Candidates += [IO.File]::ReadAllText($Installed).Trim() }
    $Existing = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($Existing) { $Candidates += $Existing.Source }
    foreach ($Candidate in $Candidates) {
        if (-not [IO.File]::Exists($Candidate)) { continue }
        $Version = (& $Candidate --version) -join ''
        if ($LASTEXITCODE -eq 0 -and $Version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { return $Candidate }
    }
    $Version = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'node-version.txt')).Trim()
    $Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $Arch = switch ($Architecture) { 'ARM64' {'arm64'} 'AMD64' {'x64'} default { throw 'Automatic Node download supports Windows x64 and ARM64.' } }
    $Asset = 'win-' + $Arch + '/node.exe'
    $Line = [IO.File]::ReadAllLines((Join-Path $PSScriptRoot 'node-shasums.txt')) | Where-Object { $_.EndsWith('  ' + $Asset) }
    if (@($Line).Count -ne 1) { throw 'Pinned Node checksum was not found.' }
    $Expected = ($Line -split '\s+')[0]
    $CacheHome = if ($env:NOTDEX_CACHE_HOME) { $env:NOTDEX_CACHE_HOME } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'NotDex' }
    $Cache = Join-Path $CacheHome 'runtime'
    $Target = Join-Path $Cache ('node-v' + $Version + '-win-' + $Arch + '.exe')
    if ([IO.File]::Exists($Target) -and (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash -ieq $Expected) { return $Target }
    if ($NoDownload) { throw 'Node.js 24+ was not found. Run install.ps1 once or select an existing NodePath.' }
    foreach ($Path in @($CacheHome,$Cache,$Target)) {
        $Item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        if ($Item -and ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'NotDex runtime cache must not be a link or junction.' }
    }
    [void][IO.Directory]::CreateDirectory($Cache)
    $Temporary = Join-Path $Cache ([guid]::NewGuid().ToString('N') + '.download')
    try {
        Write-Host ('NotDex: downloading private Node.js ' + $Version + ' from nodejs.org; global Node is unchanged.')
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v' + $Version + '/' + $Asset) -OutFile $Temporary
        if ((Get-FileHash -LiteralPath $Temporary -Algorithm SHA256).Hash -ine $Expected) { throw 'Node download failed SHA-256 verification.' }
        if ([IO.File]::Exists($Target)) { [IO.File]::Replace($Temporary,$Target,[NullString]::Value) }
        else { [IO.File]::Move($Temporary,$Target) }
        return $Target
    } finally { if ([IO.File]::Exists($Temporary)) { [IO.File]::Delete($Temporary) } }
}
