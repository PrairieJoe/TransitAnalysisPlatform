param(
  [Parameter(Mandatory = $true)][string]$SourcePbf,
  [Parameter(Mandatory = $true)][string]$ExpandedPbf,
  [Parameter(Mandatory = $true)][string]$OfficialExecutable,
  [Parameter(Mandatory = $true)][string]$Patched32Executable,
  [string]$OutputRoot = 'test-artifacts/motis-junction-expander/import-benchmarks'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sourcePath = (Resolve-Path $SourcePbf).Path
$expandedPath = (Resolve-Path $ExpandedPbf).Path
$officialPath = (Resolve-Path $OfficialExecutable).Path
$patchedPath = (Resolve-Path $Patched32Executable).Path
$outputBase = Join-Path $root $OutputRoot
New-Item -ItemType Directory -Path $outputBase -Force | Out-Null
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$startedAtUtc = [DateTime]::UtcNow.ToString('o')
$runDirectory = Join-Path $outputBase $runId
New-Item -ItemType Directory -Path $runDirectory | Out-Null

function Get-Sha256([string]$path) {
  (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-OsrImport([string]$label, [string]$executable, [string]$pbf) {
  $runDirectoryForImport = Join-Path $runDirectory $label
  New-Item -ItemType Directory -Path $runDirectoryForImport | Out-Null
  $configPath = Join-Path $runDirectoryForImport 'config.yml'
  $dataPath = Join-Path $runDirectoryForImport 'data'
  $logOut = Join-Path $runDirectoryForImport 'stdout.log'
  $logErr = Join-Path $runDirectoryForImport 'stderr.log'
  $pbfForYaml = $pbf.Replace('\', '/')
  @(
    "osm: `"$pbfForYaml`""
    'street_routing: true'
    'server:'
    '  host: 127.0.0.1'
    '  port: 18080'
    '  n_threads: 1'
  ) | Set-Content -LiteralPath $configPath -Encoding utf8

  $args = @('import', '-c', "`"$configPath`"", '-d', "`"$dataPath`"", '--filter', 'osr')
  $process = Start-Process -FilePath $executable -ArgumentList $args -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $peakWorkingSet = 0L
  while (-not $process.HasExited) {
    try {
      $process.Refresh()
      $peakWorkingSet = [Math]::Max($peakWorkingSet, [long]$process.WorkingSet64)
    } catch {
      # The process exited between the status and memory reads.
    }
    Start-Sleep -Milliseconds 250
  }
  $process.WaitForExit()
  $watch.Stop()
  $process.Refresh()
  [pscustomobject]@{
    label = $label
    executable = $executable
    executableSha256 = Get-Sha256 $executable
    pbf = $pbf
    pbfSha256 = Get-Sha256 $pbf
    elapsedMilliseconds = [Math]::Round($watch.Elapsed.TotalMilliseconds)
    exitCode = $process.ExitCode
    peakWorkingSetBytes = $peakWorkingSet
    dataDirectory = $dataPath
    stdoutLog = $logOut
    stderrLog = $logErr
  }
}

$results = @(
  (Invoke-OsrImport 'official-16-expanded' $officialPath $expandedPath)
  (Invoke-OsrImport 'patched-32-original' $patchedPath $sourcePath)
)
$report = [pscustomobject]@{
  schemaVersion = 1
  runId = $runId
  startedAtUtc = $startedAtUtc
  importFilter = 'osr'
  threads = 1
  officialSource = 'https://github.com/motis-project/motis/releases/download/v2.11.3/motis-windows.zip'
  results = $results
}
$reportPath = Join-Path $runDirectory 'report.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
$report | ConvertTo-Json -Depth 6
Write-Output "Report: $reportPath"
