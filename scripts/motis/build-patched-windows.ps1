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
$PkgReleaseUrl = 'https://github.com/motis-project/pkg/releases/download/v0.23/pkg.exe'
$PkgReleaseSha256 = 'f710c2569f062fac8380a564bb00f11a9af579788c4b7ee17220743af203d76b'
$CompatibilityPatchSpecs = @(
    [pscustomobject]@{ Name = 'windows-build-compat'; File = 'windows-build-compat.patch'; Includes = @('CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-tbb'; File = 'windows-mingw-tbb.patch'; Includes = @('deps/oneTBB/cmake/compilers/GNU.cmake') },
    [pscustomobject]@{ Name = 'windows-mingw-tg'; File = 'windows-mingw-tg.patch'; Includes = @('deps/tg/CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-tg-atomic'; File = 'windows-mingw-tg-atomic.patch'; Includes = @('deps/tg/tg.c') },
    [pscustomobject]@{ Name = 'windows-mingw-abseil'; File = 'windows-mingw-abseil.patch'; Includes = @('deps/abseil-cpp/absl/time/internal/cctz/src/time_zone_lookup.cc') },
    [pscustomobject]@{ Name = 'windows-mingw-boost-stacktrace'; File = 'windows-mingw-boost-stacktrace.patch'; Includes = @('deps/boost/libs/stacktrace/CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-boost-thread'; File = 'windows-mingw-boost-thread.patch'; Includes = @('deps/boost/libs/thread/CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-net'; File = 'windows-mingw-net.patch'; Includes = @('deps/net/CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-nigiri'; File = 'windows-mingw-nigiri.patch'; Includes = @('deps/nigiri/CMakeLists.txt') },
    [pscustomobject]@{ Name = 'windows-mingw-nigiri-time'; File = 'windows-mingw-nigiri-time.patch'; Includes = @('deps/nigiri/include/nigiri/logging.h') },
    [pscustomobject]@{ Name = 'windows-mingw-resource-time'; File = 'windows-mingw-resource-time.patch'; Includes = @('deps/res/create_resource.cmake', 'deps/conf/src/date_time.cc') },
    [pscustomobject]@{ Name = 'windows-mingw-tiles'; File = 'windows-mingw-tiles.patch'; Includes = @('deps/tiles/include/tiles/util.h') },
    [pscustomobject]@{ Name = 'windows-mingw-utl'; File = 'windows-mingw-utl.patch'; Includes = @('deps/utl/include/utl/logging.h') },
    [pscustomobject]@{ Name = 'windows-mingw-utl-thread'; File = 'windows-mingw-utl-thread.patch'; Includes = @('deps/utl/include/utl/set_thread_name.h') },
    [pscustomobject]@{ Name = 'windows-mingw-utl-verify'; File = 'windows-mingw-utl-verify.patch'; Includes = @('deps/utl/include/utl/verify.h') }
)
$CompatibilityPatchPaths = @{}

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
    if (-not (Test-Path -LiteralPath (Join-Path $MotisSource '.git'))) {
        throw "MOTIS source checkout is not a Git repository: $MotisSource"
    }
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

    $statusResult = Invoke-Git @('-C', $OsrSource, 'status', '--porcelain')
    $statusLines = @($statusResult.Output | ForEach-Object { $_.ToString().TrimEnd() } | Where-Object { $_ })
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

function Test-TrackedPatchState([string]$PatchFile, [string]$IncludePath) {
    $commonArguments = @('-C', $MotisSource, 'apply', '--recount', "--include=$IncludePath")
    $reverseCheck = Invoke-Git ($commonArguments + @('--reverse', '--check', $PatchFile)) -AllowFailure
    if ($reverseCheck.ExitCode -eq 0) {
        return 'Applied'
    }

    $forwardCheck = Invoke-Git ($commonArguments + @('--check', $PatchFile)) -AllowFailure
    if ($forwardCheck.ExitCode -eq 0) {
        return 'Pending'
    }

    throw "Tracked MOTIS compatibility patch does not match the pinned source: $PatchFile ($IncludePath)"
}

function Apply-TrackedPatch([string]$PatchFile, [string]$IncludePath) {
    $state = Test-TrackedPatchState $PatchFile $IncludePath
    if ($state -eq 'Applied') {
        return
    }

    Invoke-Git @('-C', $MotisSource, 'apply', '--recount', "--include=$IncludePath", $PatchFile) | Out-Null
}

function Apply-CompatibilityPatches {
    foreach ($spec in $CompatibilityPatchSpecs) {
        $patchFile = Join-Path $PSScriptRoot $spec.File
        if (-not (Test-Path -LiteralPath $patchFile -PathType Leaf)) {
            throw "Tracked MOTIS compatibility patch is missing: $patchFile"
        }
        $CompatibilityPatchPaths[$spec.Name] = $patchFile
        foreach ($includePath in $spec.Includes) {
            Apply-TrackedPatch $patchFile $includePath
        }
    }
}

function Hydrate-PkgDependencies {
    $pkgDirectory = Join-Path $BuildDirectory 'dl'
    $pkgPath = Join-Path $pkgDirectory 'pkg.exe'
    New-Item -ItemType Directory -Force -Path $pkgDirectory | Out-Null
    if (-not (Test-Path -LiteralPath $pkgPath -PathType Leaf)) {
        Write-Host "Downloading MOTIS pkg tool: $PkgReleaseUrl"
        Invoke-WebRequest -Uri $PkgReleaseUrl -OutFile $pkgPath
    }

    $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pkgPath).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $PkgReleaseSha256) {
        throw "Pinned MOTIS pkg tool SHA-256 mismatch: expected=$PkgReleaseSha256 actual=$actualSha256"
    }

    if ($env:GITHUB_ACTIONS) {
        $pkgArguments = @('-l', '-h', '-f')
    }
    else {
        $pkgArguments = @('-l')
    }
    Invoke-External -FilePath $pkgPath -Arguments $pkgArguments -WorkingDirectory $MotisSource | Out-Null
}

function Get-PkgLockCommit([string]$DependencyName) {
    $lockPath = Join-Path $MotisSource '.pkg.lock'
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        throw "MOTIS/pkg lock file is missing: $lockPath"
    }

    $escapedName = [regex]::Escape($DependencyName)
    $lockLine = Get-Content -LiteralPath $lockPath |
        Where-Object { $_ -match "^$escapedName\s+([0-9a-f]{40})$" } |
        Select-Object -First 1
    if (-not $lockLine) {
        throw "MOTIS/pkg lock file does not contain dependency '$DependencyName': $lockPath"
    }
    return ([regex]::Match($lockLine, '([0-9a-f]{40})$')).Groups[1].Value
}

function Normalize-PatchTargetDependencies {
    foreach ($dependencyName in @(
            'osr',
            'oneTBB',
            'tg',
            'abseil-cpp',
            'boost',
            'net',
            'nigiri',
            'res',
            'conf',
            'tiles',
            'utl'
        )) {
        $dependencyPath = Join-Path $MotisSource "deps\$dependencyName"
        if (-not (Test-Path -LiteralPath (Join-Path $dependencyPath '.git'))) {
            throw "MOTIS/pkg did not create dependency '$dependencyName' at $dependencyPath"
        }

        $expectedCommit = Get-PkgLockCommit $dependencyName
        $actualCommit = Get-GitValue $dependencyPath @('rev-parse', 'HEAD')
        if ($env:GITHUB_ACTIONS) {
            # pkg normally performs this checkout itself. Repeat it explicitly
            # for the patch targets so a clean Windows runner cannot retain a
            # different branch head or worktree state from dependency hydration.
            Invoke-Git @('-C', $dependencyPath, 'reset', '--hard', $expectedCommit) | Out-Null
            $actualCommit = Get-GitValue $dependencyPath @('rev-parse', 'HEAD')
        }
        if ($actualCommit -ne $expectedCommit) {
            throw "Dependency '$dependencyName' must be pinned to $expectedCommit; found $actualCommit."
        }
        Write-Host "Pinned patch dependency: $dependencyName $actualCommit"
    }
}

function Copy-Directory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Required MOTIS directory does not exist: $Source"
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Get-BuiltMotisBinary {
    $candidates = @(
        (Join-Path $BuildDirectory 'motis.exe'),
        (Join-Path $BuildDirectory 'Release\motis.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { $_ }
    $candidates = @($candidates)
    if ($candidates.Count -ne 1) {
        throw "Expected exactly one built Windows MOTIS executable under $BuildDirectory; found $($candidates.Count)."
    }
    return $candidates[0]
}

function Get-BuiltDirectory([string]$Name) {
    $candidates = @(
        (Join-Path $BuildDirectory $Name),
        (Join-Path $BuildDirectory "Release\$Name")
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | ForEach-Object { $_ }
    $candidates = @($candidates)
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

    $usingMinGw = $generatorArguments -contains 'MinGW Makefiles'
    $cmakeOptions = @(
        '-DMOTIS_MIMALLOC=ON',
        '-DBOOST_STACKTRACE_ENABLE_WINDBG=OFF',
        '-DCURL_STATIC_CRT=OFF',
        '-DCMAKE_BUILD_TYPE=Release'
    )
    if ($usingMinGw) {
        $cmakeOptions += '-DCMAKE_CXX_FLAGS=-DBOOST_USE_WINAPI_VERSION=0x0A00 -D_WIN32_WINNT=0x0601 -Wno-error=sfinae-incomplete -Wno-error=array-bounds'
    }

    # The root CMake patch must be present before the first configure because
    # that configure downloads MOTIS/pkg dependencies on a clean cache.
    $rootCompatibilityPatch = $CompatibilityPatchSpecs | Where-Object { $_.Name -eq 'windows-build-compat' }
    $rootCompatibilityPatchPath = Join-Path $PSScriptRoot $rootCompatibilityPatch.File
    Apply-TrackedPatch $rootCompatibilityPatchPath 'CMakeLists.txt'

    New-Item -ItemType Directory -Force -Path $BuildDirectory | Out-Null
    $previousHome = $env:HOME
    $homeWasSet = $null -ne $env:HOME
    if ($usingMinGw) {
        $env:HOME = '/tmp'
    }

    try {
        # Hydrate .pkg dependencies before applying patches. oneTBB is not
        # present in a clean checkout until pkg has populated the dependency tree.
        Hydrate-PkgDependencies
        Normalize-PatchTargetDependencies
        $OsrSource = Join-Path $MotisSource 'deps\osr'
        Assert-PinnedOsrDependency $OsrSource
        Apply-ExpectedOsrPatch $OsrSource

        # oneTBB is configured during CMake, so its Windows compiler probe must
        # be patched after hydration but before the first configure.
        $tbbCompatibilityPatch = $CompatibilityPatchSpecs | Where-Object { $_.Name -eq 'windows-mingw-tbb' }
        $tbbCompatibilityPatchPath = Join-Path $PSScriptRoot $tbbCompatibilityPatch.File
        Apply-TrackedPatch $tbbCompatibilityPatchPath $tbbCompatibilityPatch.Includes[0]
        Apply-CompatibilityPatches

        # Configure only after pkg hydration and all compatibility patches so
        # the clean-runner path sees the patched dependency sources immediately.
        Invoke-External -FilePath $CMakePath -Arguments ($generatorArguments + @('-S', $MotisSource, '-B', $BuildDirectory) + $cmakeOptions) | Out-Null

        Invoke-External -FilePath $PnpmPath -Arguments @('--filter', '@motis-project/motis-client', 'build') -WorkingDirectory (Join-Path $MotisSource 'ui') | Out-Null
        Invoke-External -FilePath $PnpmPath -Arguments @('run', 'build') -WorkingDirectory (Join-Path $MotisSource 'ui') | Out-Null

        $buildArguments = @('--build', $BuildDirectory, '--target', 'motis', 'motis-web-ui', '--parallel', '4')
        if ($generatorArguments -contains 'Visual Studio 17 2022') {
            $buildArguments += @('--config', 'Release')
        }
        Invoke-External -FilePath $CMakePath -Arguments $buildArguments | Out-Null
    }
    finally {
        if ($homeWasSet) {
            $env:HOME = $previousHome
        }
        else {
            Remove-Item Env:HOME -ErrorAction SilentlyContinue
        }
    }

    $builtBinary = Get-BuiltMotisBinary
    $builtTilesProfiles = Join-Path $MotisSource 'deps\tiles\profile'
    $builtUi = Join-Path $MotisSource 'ui\build'

    if (Test-Path -LiteralPath $StageDirectory) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $StageDirectory | Out-Null
    Copy-Item -LiteralPath $builtBinary -Destination (Join-Path $StageDirectory 'motis.exe') -Force
    Get-ChildItem -LiteralPath (Split-Path $builtBinary -Parent) -File -Filter '*.dll' | Copy-Item -Destination $StageDirectory -Force
    if ($usingMinGw) {
        $gccCommand = Get-Command 'gcc.exe' -ErrorAction Stop
        $mingwBinDirectory = Split-Path $gccCommand.Source -Parent
        foreach ($runtimeName in @('libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll')) {
            $runtimePath = Join-Path $mingwBinDirectory $runtimeName
            if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
                throw "Required MinGW runtime DLL is missing: $runtimePath"
            }
            Copy-Item -LiteralPath $runtimePath -Destination $StageDirectory -Force
        }
    }
    Copy-Directory $builtTilesProfiles (Join-Path $StageDirectory 'tiles-profiles')
    Copy-Directory $builtUi (Join-Path $StageDirectory 'ui')

    $licenseOutput = Join-Path $StageDirectory 'licenses'
    New-Item -ItemType Directory -Force -Path $licenseOutput | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docs\licenses\MOTIS-MIT.txt') -Destination $licenseOutput -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'docs\licenses\OSR-MIT.txt') -Destination $licenseOutput -Force

    $binaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $StageDirectory 'motis.exe')).Hash.ToLowerInvariant()
    $runtimeDlls = @(Get-ChildItem -LiteralPath $StageDirectory -File -Filter '*.dll' | Sort-Object Name | ForEach-Object { $_.Name })
    if ($runtimeDlls -notcontains 'mimalloc.dll' -or $runtimeDlls -notcontains 'mimalloc-redirect.dll') {
        throw 'The patched Windows distribution must contain mimalloc.dll and mimalloc-redirect.dll.'
    }
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
            sizeBytes = (Get-Item -LiteralPath (Join-Path $StageDirectory 'motis.exe')).Length
        }
        tilesProfiles = 'tiles-profiles'
        ui = 'ui'
        runtimeDlls = $runtimeDlls
        licenseFiles = @('licenses/MOTIS-MIT.txt', 'licenses/OSR-MIT.txt')
        runtimeConstraints = [ordered]@{
            tiles = 'disabled for patched MinGW validation'
            tbbNumThreads = 1
        }
        build = [ordered]@{
            cmakeGenerator = ($generatorArguments -join ' ')
            cmakeSource = 'official MOTIS CMake/pkg workflow'
            buildTargets = @('motis', 'motis-web-ui')
            compilerFlags = @(
                '-DBOOST_USE_WINAPI_VERSION=0x0A00',
                '-D_WIN32_WINNT=0x0601',
                '-Wno-error=sfinae-incomplete',
                '-Wno-error=array-bounds'
            )
            cmakeOptions = @(
                '-DMOTIS_MIMALLOC=ON',
                '-DBOOST_STACKTRACE_ENABLE_WINDBG=OFF',
                '-DCURL_STATIC_CRT=OFF'
            )
            compatibilityPatches = @($CompatibilityPatchSpecs | ForEach-Object { $_.Name })
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
