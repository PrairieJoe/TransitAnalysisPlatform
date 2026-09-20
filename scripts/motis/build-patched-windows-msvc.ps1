[CmdletBinding()]
param(
    [string]$SourceRoot,
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Join-Path $RepoRoot 'deps'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $RepoRoot 'vendor\motis\patched-windows'
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$StageDirectory = "$OutputDirectory.staging-$PID"
$ResolveScript = Join-Path $PSScriptRoot 'resolve-pinned-source.ps1'
$ObserveScript = Join-Path $PSScriptRoot 'observe-msvc-toolchain.ps1'

function Require-Tool([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required MSVC build tool '$Name' was not found on PATH."
    }
}

function Assert-LastExitCode([string]$Description) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Copy-RequiredDirectory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Required MOTIS directory is missing: $Source"
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Assert-MsvcCMakeCache([string]$BuildDirectory) {
    $cmakeCache = Join-Path $BuildDirectory 'CMakeCache.txt'
    if (-not (Test-Path -LiteralPath $cmakeCache -PathType Leaf)) {
        throw "CMake cache is missing after configuration: $cmakeCache"
    }

    $cmakeFiles = Join-Path $BuildDirectory 'CMakeFiles'
    if (-not (Test-Path -LiteralPath $cmakeFiles -PathType Container)) {
        throw "CMake compiler metadata directory is missing after configuration: $cmakeFiles"
    }

    foreach ($compiler in @(
        @{ FileName = 'CMakeCCompiler.cmake'; VariableName = 'CMAKE_C_COMPILER_ID' },
        @{ FileName = 'CMakeCXXCompiler.cmake'; VariableName = 'CMAKE_CXX_COMPILER_ID' }
    )) {
        $metadataFiles = @(
            Get-ChildItem -LiteralPath $cmakeFiles -Directory | ForEach-Object {
                $metadataFile = Join-Path $_.FullName $compiler.FileName
                if (Test-Path -LiteralPath $metadataFile -PathType Leaf) {
                    $metadataFile
                }
            }
        )
        if ($metadataFiles.Count -eq 0) {
            throw "CMake compiler metadata is missing after configuration: $($compiler.FileName)"
        }

        $identityPattern = '^\s*set\s*\(\s*{0}\s+"MSVC"\s*\)\s*$' -f [regex]::Escape($compiler.VariableName)
        if (-not ($metadataFiles | Where-Object {
            Select-String -LiteralPath $_ -Pattern $identityPattern -CaseSensitive -Quiet
        })) {
            throw "CMake did not configure the expected MSVC compiler identity: $($compiler.VariableName)"
        }
    }
}

foreach ($tool in @('cl.exe', 'cmake', 'ninja', 'git')) { Require-Tool $tool }
if ([string]::IsNullOrWhiteSpace([string]$env:VCToolsRedistDir)) {
    throw 'VCToolsRedistDir is required to stage the MSVC runtime.'
}
foreach ($script in @($ResolveScript, $ObserveScript)) {
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "Required builder script is missing: $script" }
}

$hadCc = Test-Path Env:CC
$previousCc = [string]$env:CC
$hadCxx = Test-Path Env:CXX
$previousCxx = [string]$env:CXX

try {
    if (Test-Path -LiteralPath $StageDirectory) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $StageDirectory | Out-Null
    & $ObserveScript -OutputPath (Join-Path $StageDirectory 'builder-observation.json')

    $MotisSource = & $ResolveScript -SourceRoot $SourceRoot
    if ([string]::IsNullOrWhiteSpace([string]$MotisSource)) { throw 'Pinned MOTIS source resolution returned no path.' }
    $BuildDirectory = Join-Path $MotisSource 'build\msvc-release'

    $cmakeCache = Join-Path $BuildDirectory 'CMakeCache.txt'
    $cmakeFiles = Join-Path $BuildDirectory 'CMakeFiles'
    if (Test-Path -LiteralPath $cmakeCache -PathType Leaf) {
        Remove-Item -LiteralPath $cmakeCache -Force
    }
    if (Test-Path -LiteralPath $cmakeFiles -PathType Container) {
        Remove-Item -LiteralPath $cmakeFiles -Recurse -Force
    }
    Remove-Item Env:CC -ErrorAction SilentlyContinue
    Remove-Item Env:CXX -ErrorAction SilentlyContinue
    cmake -GNinja -S $MotisSource -B $BuildDirectory -DCMAKE_BUILD_TYPE=Release -DMOTIS_MIMALLOC=ON -DCMAKE_C_COMPILER=cl.exe -DCMAKE_CXX_COMPILER=cl.exe
    Assert-LastExitCode 'MOTIS CMake configuration'
    Assert-MsvcCMakeCache $BuildDirectory
    cmake --build $BuildDirectory --target motis motis-test motis-web-ui --parallel 4
    Assert-LastExitCode 'MOTIS build'
    & (Join-Path $BuildDirectory 'motis-test.exe')
    Assert-LastExitCode 'MOTIS tests'

    $motisBinary = Join-Path $BuildDirectory 'motis.exe'
    if (-not (Test-Path -LiteralPath $motisBinary -PathType Leaf)) { throw "Built MOTIS executable is missing: $motisBinary" }
    Copy-Item -LiteralPath $motisBinary -Destination (Join-Path $StageDirectory 'motis.exe') -Force

    Get-ChildItem -LiteralPath $BuildDirectory -File -Filter '*.dll' | Copy-Item -Destination $StageDirectory -Force
    $crtDirectory = Join-Path $env:VCToolsRedistDir 'x64\Microsoft.VC143.CRT'
    $crtDlls = @(Get-ChildItem -LiteralPath $crtDirectory -File -Filter '*.dll')
    if ($crtDlls.Count -eq 0) { throw "No MSVC runtime DLLs were found under $crtDirectory." }
    $crtDlls | Copy-Item -Destination $StageDirectory -Force

    Copy-RequiredDirectory (Join-Path $MotisSource 'deps/tiles/profile') (Join-Path $StageDirectory 'tiles-profiles')
    Copy-RequiredDirectory (Join-Path $MotisSource 'ui/build') (Join-Path $StageDirectory 'ui')

    $licenseDirectory = Join-Path $StageDirectory 'licenses'
    New-Item -ItemType Directory -Force -Path $licenseDirectory | Out-Null
    foreach ($licenseName in @('MOTIS-MIT.txt', 'OSR-MIT.txt')) {
        $licensePath = Join-Path $RepoRoot "docs\licenses\$licenseName"
        $trackedLicense = git -C $RepoRoot ls-files --error-unmatch -- "docs/licenses/$licenseName"
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $licensePath -PathType Leaf)) {
            throw "Tracked MIT license text is missing: $licensePath"
        }
        $null = $trackedLicense
        Copy-Item -LiteralPath $licensePath -Destination $licenseDirectory -Force
    }

    $outputParent = Split-Path -Parent $OutputDirectory
    New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
    if (Test-Path -LiteralPath $OutputDirectory) {
        Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
    }
    Move-Item -LiteralPath $StageDirectory -Destination $OutputDirectory
    $StageDirectory = $null
    Write-Host "MSVC MOTIS distribution staged at $OutputDirectory"
}
finally {
    if ($hadCc) { $env:CC = $previousCc } else { Remove-Item Env:CC -ErrorAction SilentlyContinue }
    if ($hadCxx) { $env:CXX = $previousCxx } else { Remove-Item Env:CXX -ErrorAction SilentlyContinue }
    if ($StageDirectory -and (Test-Path -LiteralPath $StageDirectory)) {
        Remove-Item -LiteralPath $StageDirectory -Recurse -Force
    }
}
