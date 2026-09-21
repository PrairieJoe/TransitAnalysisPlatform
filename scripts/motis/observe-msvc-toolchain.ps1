[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NativeOutput {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$Arguments = @()
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Required tool '$Command' was not found on PATH."
    }

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        return @(& $Command @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Require-CapturedValue([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "MSVC toolchain observation is missing $Name."
    }
    return $Value.Trim()
}

$compilerOutput = Get-NativeOutput -Command 'cl.exe'
$compilerMatch = [regex]::Match(($compilerOutput -join "`n"), '(?:Version|\uBC84\uC804)\s+([0-9.]+)')
$compilerVersion = Require-CapturedValue 'compiler version' $compilerMatch.Groups[1].Value

$cmakeOutput = Get-NativeOutput -Command 'cmake' -Arguments @('--version')
$cmakeMatch = [regex]::Match(($cmakeOutput -join "`n"), 'cmake version\s+([^\s]+)')
$cmakeVersion = Require-CapturedValue 'CMake version' $cmakeMatch.Groups[1].Value

$ninjaOutput = Get-NativeOutput -Command 'ninja' -Arguments @('--version')
$ninjaVersion = Require-CapturedValue 'Ninja version' ($ninjaOutput | Select-Object -First 1)
$windowsSdkVersion = (Require-CapturedValue 'Windows SDK version' ([string]$env:WindowsSDKVersion)).TrimEnd('\')
$vcToolsVersion = Require-CapturedValue 'Visual C++ tools version' ([string]$env:VCToolsVersion)
$runnerImage = Require-CapturedValue 'runner image' ([string]$env:ImageOS)

# VCToolsVersion is deliberately captured and validated even though the lock's
# compilerVersion field is sourced from cl.exe itself.
$null = $vcToolsVersion

$observation = [ordered]@{
    compilerFamily = 'MSVC'
    compilerVersion = $compilerVersion
    windowsSdkVersion = $windowsSdkVersion
    cmakeVersion = $cmakeVersion
    ninjaVersion = $ninjaVersion
    generator = 'Ninja'
    runnerImage = [string]$env:ImageOS
}

$outputParent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
if (-not [string]::IsNullOrWhiteSpace($outputParent)) {
    New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
}
$observation | ConvertTo-Json | Set-Content -Encoding utf8 $OutputPath
