[CmdletBinding()]
param(
    [string]$SourceRoot,
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedMotisVersion = 'v2.11.3'
$ExpectedMotisCommit = 'b228a4519d196d9dd01b5ce80be46e642abc953e'
$ExpectedOsrCommit = 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7'
$PatchId = 'osr-max-ways-per-node-32'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PatchPath = Join-Path $PSScriptRoot 'osr-max-ways-per-node-32.patch'
$VerifierPath = Join-Path $PSScriptRoot 'verify-patched-build.mjs'
$MotisRepository = 'https://github.com/motis-project/motis.git'

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Join-Path $RepoRoot 'deps'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $RepoRoot 'vendor\motis\patched-windows'
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$MotisSource = Join-Path $SourceRoot 'motis-v2.11.3'
$BuildDirectory = Join-Path $MotisSource 'build\patched-windows'
$StageDirectory = "$OutputDirectory.staging-$PID"

function Get-ToolPath([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Required build prerequisite '$Name' was not found on PATH."
    }
    return $command.Source
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory,
        [switch]$AllowFailure
    )

    $displayArguments = ($Arguments | ForEach-Object {
            if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
        }) -join ' '
    Write-Host "+ $FilePath $displayArguments"

    $previousLocation = Get-Location
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        if ($WorkingDirectory) {
            Set-Location -LiteralPath $WorkingDirectory
        }
        $ErrorActionPreference = 'Continue'
        $output = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Set-Location -LiteralPath $previousLocation
    }

    if ($output.Count -gt 0) {
        $output | ForEach-Object { Write-Host $_ }
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed with exit code ${exitCode}: $FilePath $displayArguments"
    }
    return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Invoke-Git([string[]]$Arguments, [switch]$AllowFailure) {
    return Invoke-External -FilePath $GitPath -Arguments $Arguments -AllowFailure:$AllowFailure
}

function Get-GitValue([string]$Repository, [string[]]$Arguments) {
    $allArguments = @('-C', $Repository) + $Arguments
    $result = Invoke-Git $allArguments
    $value = ($result.Output | Select-Object -Last 1).ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Git returned no value for '$($Arguments -join ' ')' in '$Repository'."
    }
    return $value
}

function Assert-CleanGitCheckout([string]$Repository, [string]$Description) {
    if (-not (Test-Path -LiteralPath (Join-Path $Repository '.git'))) {
        throw "$Description is not a Git checkout: $Repository"
    }
    $status = Invoke-Git @('-C', $Repository, 'status', '--porcelain')
    if ($status.Output.Count -gt 0) {
        throw "$Description has uncommitted changes; refusing to overwrite it: $Repository"
    }
}

function Assert-PinnedMotisCheckout {
    Assert-CleanGitCheckout $MotisSource 'MOTIS source checkout'
    $head = Get-GitValue $MotisSource @('rev-parse', 'HEAD')
    if ($head -ne $ExpectedMotisCommit) {
        throw "MOTIS source must be $ExpectedMotisVersion at $ExpectedMotisCommit; found $head."
    }
    $tag = Get-GitValue $MotisSource @('describe', '--tags', '--exact-match', 'HEAD')
    if ($tag -ne $ExpectedMotisVersion) {
        throw "MOTIS source must have exact tag $ExpectedMotisVersion; found $tag."
    }
}

function Assert-PinnedOsrDependency([string]$OsrSource) {
    if (-not (Test-Path -LiteralPath (Join-Path $OsrSource '.git'))) {
        throw "MOTIS/pkg did not create an OSR Git checkout at $OsrSource."
    }
    $head = Get-GitValue $OsrSource @('rev-parse', 'HEAD')
    if ($head -ne $ExpectedOsrCommit) {
        throw "OSR source must be pinned to $ExpectedOsrCommit; found $head."
    }
}

function Test-ExpectedOsrPatch([string]$OsrSource) {
    $reverseCheck = Invoke-Git @('-C', $OsrSource, 'apply', '--reverse', '--check', $PatchPath) -AllowFailure
    if ($reverseCheck.ExitCode -ne 0) {
        return $false
    }

    $statusLines = @(Invoke-Git @('-C', $OsrSource, 'status', '--porcelain').Output | ForEach-Object { $_.ToString().TrimEnd() } | Where-Object { $_ })
    if ($statusLines.Count -ne 1 -or $statusLines[0] -notmatch '^\s*M\s+include/osr/types\.h$') {
        throw "OSR checkout contains changes in addition to the expected $PatchId patch; refusing to overwrite it."
    }
    return $true
}

function Apply-ExpectedOsrPatch([string]$OsrSource) {
    if (Test-ExpectedOsrPatch $OsrSource) {
        Write-Host "OSR patch already applied: $PatchId"
        return
    }

    $check = Invoke-Git @('-C', $OsrSource, 'apply', '--check', $PatchPath) -AllowFailure
    if ($check.ExitCode -ne 0) {
        throw "The expected OSR patch does not apply cleanly to $ExpectedOsrCommit."
    }
    Invoke-Git @('-C', $OsrSource, 'apply', $PatchPath) | Out-Null
}

function Copy-Directory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Required MOTIS directory does not exist: $Source"
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Get-BuiltMotisBinary {
    $candidates = @(
        (Join-Path $BuildDirectory 'motis.exe'),
        (Join-Path $BuildDirectory 'Release\motis.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    if ($candidates.Count -ne 1) {
        throw "Expected exactly one built Windows MOTIS executable under $BuildDirectory; found $($candidates.Count)."
    }
    return $candidates[0]
}

function Get-BuiltDirectory([string]$Name) {
    $candidates = @(
        (Join-Path $BuildDirectory $Name),
        (Join-Path $BuildDirectory "Release\$Name")
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
    if ($candidates.Count -ne 1) {
        throw "Expected exactly one built MOTIS directory '$Name' under $BuildDirectory; found $($candidates.Count)."
    }
    return $candidates[0]
}

$GitPath = $null
$CMakePath = $null
$NodePath = $null
$PnpmPath = $null

try {
    # Do all prerequisite checks before creating or changing any source/output files.
    $GitPath = Get-ToolPath 'git'
    $CMakePath = Get-ToolPath 'cmake'
    $NodePath = Get-ToolPath 'node'
    $PnpmPath = Get-ToolPath 'pnpm'
    if (-not (Get-Command 'cl.exe' -ErrorAction SilentlyContinue) -and
        -not (Get-Command 'gcc.exe' -ErrorAction SilentlyContinue) -and
        -not (Get-Command 'clang.exe' -ErrorAction SilentlyContinue)) {
        throw "Required Windows C/C++ compiler prerequisite was not found on PATH. Run from a Visual Studio Developer PowerShell or install an x64 compiler toolchain."
    }
    if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) {
        throw "Tracked OSR patch file is missing: $PatchPath"
    }
    if (-not (Test-Path -LiteralPath $VerifierPath -PathType Leaf)) {
        throw "Tracked manifest verifier is missing: $VerifierPath"
    }
    foreach ($licensePath in @(
            (Join-Path $RepoRoot 'docs\licenses\MOTIS-MIT.txt'),
            (Join-Path $RepoRoot 'docs\licenses\OSR-MIT.txt')
        )) {
        if (-not (Test-Path -LiteralPath $licensePath -PathType Leaf)) {
            throw "Tracked license notice is missing: $licensePath"
        }
    }

    New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
    if (-not (Test-Path -LiteralPath $MotisSource)) {
        Invoke-External -FilePath $GitPath -Arguments @('clone', '--branch', $ExpectedMotisVersion, '--depth', '1', $MotisRepository, $MotisSource) | Out-Null
    }
    Assert-PinnedMotisCheckout

    if (-not (Test-Path -LiteralPath (Join-Path $MotisSource '.pkg'))) {
        throw "MOTIS source does not contain its pinned .pkg dependency lock: $MotisSource"
    }
    $osrLock = Get-Content -LiteralPath (Join-Path $MotisSource '.pkg') | Where-Object { $_ -match '^\s*commit=' + [regex]::Escape($ExpectedOsrCommit) + '\s*$' }
    if (-not $osrLock) {
        throw "MOTIS .pkg lock does not pin OSR to $ExpectedOsrCommit."
    }

    $generatorArguments = @()
    if (Get-Command 'ninja.exe' -ErrorAction SilentlyContinue) {
        $generatorArguments = @('-G', 'Ninja')
    }
    elseif (Get-Command 'cl.exe' -ErrorAction SilentlyContinue) {
        $generatorArguments = @('-G', 'Visual Studio 17 2022', '-A', 'x64')
    }
    else {
        $generatorArguments = @('-G', 'MinGW Makefiles')
    }

    New-Item -ItemType Directory -Force -Path $BuildDirectory | Out-Null
    Invoke-External -FilePath $CMakePath -Arguments ($generatorArguments + @('-S', $MotisSource, '-B', $BuildDirectory, '-DMOTIS_MIMALLOC=ON', '-DCMAKE_BUILD_TYPE=Release')) | Out-Null

    $OsrSource = Join-Path $MotisSource 'deps\osr'
    Assert-PinnedOsrDependency $OsrSource
    Apply-ExpectedOsrPatch $OsrSource

    $buildArguments = @('--build', $BuildDirectory, '--target', 'motis', 'motis-web-ui')
    if ($generatorArguments -contains 'Visual Studio 17 2022') {
        $buildArguments += @('--config', 'Release')
    }
    Invoke-External -FilePath $CMakePath -Arguments $buildArguments | Out-Null

    $builtBinary = Get-BuiltMotisBinary
    $builtTilesProfiles = Get-BuiltDirectory 'tiles-profiles'
    $builtUi = Get-BuiltDirectory 'ui'

    if (Test-Path -LiteralPath $StageDirectory) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $StageDirectory | Out-Null
    Copy-Item -LiteralPath $builtBinary -Destination (Join-Path $StageDirectory 'motis.exe') -Force
    Get-ChildItem -LiteralPath (Split-Path $builtBinary -Parent) -File -Filter '*.dll' | Copy-Item -Destination $StageDirectory -Force
    Copy-Directory $builtTilesProfiles (Join-Path $StageDirectory 'tiles-profiles')
    Copy-Directory $builtUi (Join-Path $StageDirectory 'ui')

    $licenseOutput = Join-Path $StageDirectory 'licenses'
    New-Item -ItemType Directory -Force -Path $licenseOutput | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docs\licenses\MOTIS-MIT.txt') -Destination $licenseOutput -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docs\licenses\OSR-MIT.txt') -Destination $licenseOutput -Force

    $binaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $StageDirectory 'motis.exe')).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        schemaVersion = 1
        motisVersion = $ExpectedMotisVersion
        motisCommit = $ExpectedMotisCommit
        osrCommit = $ExpectedOsrCommit
        patchId = $PatchId
        baseMaxWaysPerNode = 16
        maxWaysPerNode = 32
        platform = 'windows-x64'
        binary = [ordered]@{
            path = 'motis.exe'
            sha256 = $binaryHash
        }
        tilesProfiles = 'tiles-profiles'
        licenseFiles = @('licenses/MOTIS-MIT.txt', 'licenses/OSR-MIT.txt')
        runtimeConstraints = [ordered]@{
            tiles = 'disabled for patched MinGW validation'
            tbbNumThreads = 1
        }
        build = [ordered]@{
            cmakeGenerator = ($generatorArguments -join ' ')
            cmakeSource = 'official MOTIS CMake/pkg workflow'
            buildTargets = @('motis', 'motis-web-ui')
        }
    }
    $manifestPath = Join-Path $StageDirectory 'motis-manifest.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))

    Invoke-External -FilePath $NodePath -Arguments @($VerifierPath, $manifestPath) | Out-Null

    $outputParent = Split-Path $OutputDirectory -Parent
    New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
    if (Test-Path -LiteralPath $OutputDirectory) {
        Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
    }
    Move-Item -LiteralPath $StageDirectory -Destination $OutputDirectory
    $StageDirectory = $null

    Invoke-External -FilePath $NodePath -Arguments @($VerifierPath, (Join-Path $OutputDirectory 'motis-manifest.json')) | Out-Null
    Write-Host "Patched MOTIS distribution ready: $OutputDirectory"
}
finally {
    if ($StageDirectory -and (Test-Path -LiteralPath $StageDirectory)) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
}
