[CmdletBinding()]
param(
    [string]$SourceRoot,
    [string]$LockPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Join-Path $RepoRoot 'deps'
}
if ([string]::IsNullOrWhiteSpace($LockPath)) {
    $LockPath = Join-Path $PSScriptRoot 'motis-builder-lock.json'
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$LockPath = [IO.Path]::GetFullPath($LockPath)
$MotisRepository = 'https://github.com/motis-project/motis.git'
$PkgReleaseUrl = 'https://github.com/motis-project/pkg/releases/download/v0.23/pkg.exe'
$PkgReleaseSha256 = 'f710c2569f062fac8380a564bb00f11a9af579788c4b7ee17220743af203d76b'

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory,
        [switch]$AllowFailure
    )

    $previousLocation = Get-Location
    $previousPreference = $ErrorActionPreference
    try {
        if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
        $ErrorActionPreference = 'Continue'
        $output = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Set-Location -LiteralPath $previousLocation
    }

    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
    }
    return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Invoke-Git([string[]]$Arguments, [switch]$AllowFailure) {
    return Invoke-Native -FilePath 'git' -Arguments $Arguments -AllowFailure:$AllowFailure
}

function Get-GitValue([string]$Repository, [string[]]$Arguments) {
    $result = Invoke-Git (@('-C', $Repository) + $Arguments)
    $value = ($result.Output | Select-Object -Last 1).ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Git returned no value for '$($Arguments -join ' ')' in '$Repository'."
    }
    return $value
}

function Get-PkgLocks([string]$MotisPath) {
    $pkgLockPath = Join-Path $MotisPath '.pkg.lock'
    if (-not (Test-Path -LiteralPath $pkgLockPath -PathType Leaf)) {
        throw "MOTIS/pkg lock file is missing: $pkgLockPath"
    }

    return @(Get-Content -LiteralPath $pkgLockPath | ForEach-Object {
        if ($_ -match '^(\S+)\s+([0-9a-f]{40})$') {
            [pscustomobject]@{ Name = $Matches[1]; Commit = $Matches[2] }
        }
    })
}

function Get-NormalizedSha256([string]$Path) {
    $content = [IO.File]::ReadAllText($Path)
    $normalizedContent = $content.Replace("`r`n", "`n").Replace("`r", "`n")
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($normalizedContent)
        return (-join ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }))
    }
    finally {
        $sha256.Dispose()
    }
}

function Test-ApprovedOsrDiff([string]$OsrSource) {
    $status = @(git -C $OsrSource status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the OSR source status.' }
    if ($status.Count -ne 1 -or $status[0] -ne ' M include/osr/types.h') {
        return $false
    }

    $changedFiles = @(git -C $OsrSource diff --name-only)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the OSR source diff.' }
    if ($changedFiles.Count -ne 1 -or $changedFiles[0] -ne 'include/osr/types.h') {
        return $false
    }

    git -C $OsrSource diff --check
    if ($LASTEXITCODE -ne 0) { throw 'OSR source diff failed git diff --check.' }

    $expectedIndex = Join-Path ([IO.Path]::GetTempPath()) "motis-osr-expected-$PID.index"
    $previousGitIndex = $env:GIT_INDEX_FILE
    try {
        Remove-Item -LiteralPath $expectedIndex -Force -ErrorAction SilentlyContinue
        $env:GIT_INDEX_FILE = $expectedIndex
        Invoke-Git @('-C', $OsrSource, 'read-tree', 'HEAD') | Out-Null
        Invoke-Git @('-C', $OsrSource, 'apply', '--cached', '--ignore-space-change', '--ignore-whitespace', '--check', $PatchApplyPath) | Out-Null
        Invoke-Git @('-C', $OsrSource, 'apply', '--cached', '--ignore-space-change', '--ignore-whitespace', $PatchApplyPath) | Out-Null
        $expectedBlob = Get-GitValue $OsrSource @('rev-parse', ':include/osr/types.h')
    }
    finally {
        if ($null -eq $previousGitIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
        else { $env:GIT_INDEX_FILE = $previousGitIndex }
        Remove-Item -LiteralPath $expectedIndex -Force -ErrorAction SilentlyContinue
    }

    $actualBlob = Get-GitValue $OsrSource @('hash-object', '--path=include/osr/types.h', '--', 'include/osr/types.h')
    if ($actualBlob -ne $expectedBlob) {
        throw "The resulting OSR blob does not match the expected OSR blob from the locked patch."
    }

    $patchDiff = git -C $OsrSource diff --unified=0 -- include/osr/types.h
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the OSR capacity diff.' }
    return (@($patchDiff | Select-String -SimpleMatch 'way_pos_t{16U}').Count -eq 1 -and
        @($patchDiff | Select-String -SimpleMatch 'way_pos_t{32U}').Count -eq 1)
}

function Assert-ExistingNestedRepositoriesClean([string]$MotisPath) {
    $depsPath = Join-Path $MotisPath 'deps'
    if (-not (Test-Path -LiteralPath $depsPath -PathType Container)) { return }

    foreach ($dependency in Get-ChildItem -LiteralPath $depsPath -Directory) {
        if (-not (Test-Path -LiteralPath (Join-Path $dependency.FullName '.git'))) { continue }
        $status = @(git -C $dependency.FullName status --porcelain)
        if ($LASTEXITCODE -ne 0) { throw "Unable to inspect dependency '$($dependency.Name)'." }
        if ($status.Count -eq 0) { continue }
        if ($dependency.Name -eq 'osr' -and (Test-ApprovedOsrDiff $dependency.FullName)) { continue }
        throw "Nested repository '$($dependency.Name)' has unapproved changes."
    }
}

if (-not (Get-Command 'git' -ErrorAction SilentlyContinue)) {
    throw "Required tool 'git' was not found on PATH."
}
if (-not (Test-Path -LiteralPath $LockPath -PathType Leaf)) {
    throw "Builder lock is missing: $LockPath"
}

$lock = Get-Content -Raw -LiteralPath $LockPath | ConvertFrom-Json
foreach ($value in @($lock.source.motisVersion, $lock.source.motisCommit, $lock.source.osrCommit, $lock.patch.file, $lock.patch.sha256)) {
    if ([string]::IsNullOrWhiteSpace([string]$value)) { throw 'Builder lock contains an empty source or patch identity.' }
}

$PatchPath = [IO.Path]::GetFullPath((Join-Path $RepoRoot ([string]$lock.patch.file)))
$repoPrefix = $RepoRoot.TrimEnd('\') + '\'
if (-not $PatchPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Builder lock patch path must remain inside the repository.'
}
if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) {
    throw "Locked OSR patch is missing: $PatchPath"
}
$actualPatchSha256 = Get-NormalizedSha256 $PatchPath
if ($actualPatchSha256 -ne ([string]$lock.patch.sha256).ToLowerInvariant()) {
    throw "Locked OSR patch SHA-256 mismatch: expected=$($lock.patch.sha256) actual=$actualPatchSha256"
}
$PatchApplyPath = Join-Path ([IO.Path]::GetTempPath()) "motis-osr-patch-$PID.patch"
$patchText = [IO.File]::ReadAllText($PatchPath)
$normalizedPatchText = $patchText.Replace("`r`n", "`n").Replace("`r", "`n")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($PatchApplyPath, $normalizedPatchText, $utf8NoBom)

$MotisSource = Join-Path $SourceRoot "motis-$($lock.source.motisVersion)"
New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
if (-not (Test-Path -LiteralPath $MotisSource)) {
    $clone = Invoke-Git @('clone', '--branch', [string]$lock.source.motisVersion, '--depth', '1', $MotisRepository, $MotisSource)
    $clone | Out-Null
}
if (-not (Test-Path -LiteralPath (Join-Path $MotisSource '.git'))) {
    throw "MOTIS source is not a Git checkout: $MotisSource"
}

$motisHead = Get-GitValue $MotisSource @('rev-parse', 'HEAD')
if ($motisHead -ne $lock.source.motisCommit) {
    throw "MOTIS source must be $($lock.source.motisCommit); found $motisHead."
}
$motisTag = Get-GitValue $MotisSource @('describe', '--tags', '--exact-match', 'HEAD')
if ($motisTag -ne $lock.source.motisVersion) {
    throw "MOTIS source must have exact tag $($lock.source.motisVersion); found $motisTag."
}
$motisStatus = @(git -C $MotisSource status --porcelain)
if ($LASTEXITCODE -ne 0 -or $motisStatus.Count -ne 0) {
    throw 'Pinned MOTIS source contains tracked or untracked changes.'
}

$pkgDefinition = Get-Content -LiteralPath (Join-Path $MotisSource '.pkg')
if (-not ($pkgDefinition | Select-String -SimpleMatch "commit=$($lock.source.osrCommit)")) {
    throw "MOTIS .pkg does not pin OSR to $($lock.source.osrCommit)."
}
Assert-ExistingNestedRepositoriesClean $MotisSource

$pkgDirectory = Join-Path $MotisSource 'build\msvc-release\dl'
$pkgPath = Join-Path $pkgDirectory 'pkg.exe'
New-Item -ItemType Directory -Force -Path $pkgDirectory | Out-Null
if (-not (Test-Path -LiteralPath $pkgPath -PathType Leaf)) {
    Invoke-WebRequest -Uri $PkgReleaseUrl -OutFile $pkgPath
}
$actualPkgSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pkgPath).Hash.ToLowerInvariant()
if ($actualPkgSha256 -ne $PkgReleaseSha256) {
    throw "Pinned MOTIS pkg SHA-256 mismatch: expected=$PkgReleaseSha256 actual=$actualPkgSha256"
}
$pkgArguments = if ($env:GITHUB_ACTIONS) { @('-l', '-h', '-f') } else { @('-l') }
Invoke-Native -FilePath $pkgPath -Arguments $pkgArguments -WorkingDirectory $MotisSource | Out-Null

$pkgLocks = Get-PkgLocks $MotisSource
foreach ($dependencyLock in $pkgLocks) {
    $dependencyPath = Join-Path $MotisSource "deps\$($dependencyLock.Name)"
    if (-not (Test-Path -LiteralPath (Join-Path $dependencyPath '.git'))) {
        throw "MOTIS/pkg did not create dependency '$($dependencyLock.Name)' at $dependencyPath."
    }
    if ($env:GITHUB_ACTIONS) {
        Invoke-Git @('-C', $dependencyPath, 'config', 'core.autocrlf', 'false') | Out-Null
        Invoke-Git @('-C', $dependencyPath, 'reset', '--hard', $dependencyLock.Commit) | Out-Null
    }
    $actualCommit = Get-GitValue $dependencyPath @('rev-parse', 'HEAD')
    if ($actualCommit -ne $dependencyLock.Commit) {
        throw "Dependency '$($dependencyLock.Name)' must be $($dependencyLock.Commit); found $actualCommit."
    }
}

$OsrSource = Join-Path $MotisSource 'deps\osr'
if ((Get-GitValue $OsrSource @('rev-parse', 'HEAD')) -ne $lock.source.osrCommit) {
    throw "OSR source must be $($lock.source.osrCommit)."
}
if (-not (Test-ApprovedOsrDiff $OsrSource)) {
    $applyCheck = Invoke-Git @('-C', $OsrSource, 'apply', '--ignore-space-change', '--ignore-whitespace', '--check', $PatchApplyPath) -AllowFailure
    if ($applyCheck.ExitCode -ne 0) { throw 'The approved OSR capacity patch does not apply cleanly.' }
    Invoke-Git @('-C', $OsrSource, 'apply', '--ignore-space-change', '--ignore-whitespace', $PatchApplyPath) | Out-Null
}

if (-not (Test-ApprovedOsrDiff $OsrSource)) {
    throw 'OSR source does not exactly match the approved capacity patch.'
}

foreach ($dependency in Get-ChildItem -LiteralPath (Join-Path $MotisSource 'deps') -Directory) {
    if ($dependency.Name -eq 'osr' -or -not (Test-Path -LiteralPath (Join-Path $dependency.FullName '.git'))) { continue }
    $nestedStatus = @(git -C $dependency.FullName status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $nestedStatus.Count -ne 0) {
        throw "Nested repository '$($dependency.Name)' must be clean before configuration."
    }
}

Write-Output $MotisSource
