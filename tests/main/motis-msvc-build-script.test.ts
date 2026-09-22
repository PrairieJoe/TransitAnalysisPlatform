import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const scriptPaths = {
  observe: 'scripts/motis/observe-msvc-toolchain.ps1',
  resolve: 'scripts/motis/resolve-pinned-source.ps1',
  build: 'scripts/motis/build-patched-windows-msvc.ps1'
} as const;
const runtimeScriptPath = 'scripts/motis/msvc-runtime.mjs';

function readScript(path: string) {
  return readFileSync(path, 'utf8');
}

function invokeCMakeVerifier(buildDirectory: string) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:MOTIS_BUILDER_SCRIPT, [ref]$tokens, [ref]$errors)
if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Assert-MsvcCMakeCache'
}, $true)
if (-not $functionAst) { throw 'Assert-MsvcCMakeCache was not found.' }
Invoke-Expression $functionAst.Extent.Text
Assert-MsvcCMakeCache $env:MOTIS_CMAKE_BUILD_DIRECTORY
`
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOTIS_BUILDER_SCRIPT: resolve(scriptPaths.build),
      MOTIS_CMAKE_BUILD_DIRECTORY: buildDirectory
    }
  });
}

describe('MOTIS MSVC builder scripts', () => {
  it('parses every PowerShell entry point', () => {
    for (const path of Object.values(scriptPaths)) {
      const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path}', [ref]$null, [ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`
      ], { encoding: 'utf8' });

      expect(result.status, `${path}\n${result.stderr}`).toBe(0);
    }
  });

  it('captures the complete MSVC toolchain observation before writing it', () => {
    const source = readScript(scriptPaths.observe);

    expect(source).toContain('cl.exe');
    expect(source).toContain("(?:Version|\\uBC84\\uC804)\\s+([0-9.]+)");
    expect(source).toContain("Get-NativeOutput -Command 'cmake' -Arguments @('--version')");
    expect(source).toContain("Get-NativeOutput -Command 'ninja' -Arguments @('--version')");
    expect(source).toContain('WindowsSDKVersion');
    expect(source).toContain('VCToolsVersion');
    expect(source).toMatch(/compilerFamily\s*=\s*'MSVC'/);
    expect(source).toMatch(/generator\s*=\s*'Ninja'/);
    expect(source).toContain('runnerImage = [string]$env:ImageOS');
    expect(source).toMatch(/throw[\s\S]+ConvertTo-Json[\s\S]+Set-Content/);
  });

  it('pins source identities and rejects patch contamination', () => {
    const source = readScript(scriptPaths.resolve);

    expect(source).toContain('motis-builder-lock.json');
    expect(source).toContain('pkg.exe');
    expect(source).toContain('$lock.patch.file');
    expect(source).toContain('$lock.patch.sha256');
    expect(source).toContain('Replace("`r`n", "`n").Replace("`r", "`n")');
    expect(source).toContain('Get-NormalizedSha256 $PatchPath');
    expect(source).toContain('$PatchApplyPath = Join-Path ([IO.Path]::GetTempPath())');
    expect(source).toContain('WriteAllText($PatchApplyPath, $normalizedPatchText, $utf8NoBom)');
    expect(source).toContain('git -C $OsrSource diff --name-only');
    expect(source).toContain("$changedFiles[0] -ne 'include/osr/types.h'");
    expect(source).toContain("status --porcelain=v1 --untracked-files=all");
    expect(source).toContain("' M include/osr/types.h'");
    expect(source).toContain("'read-tree'");
    expect(source).toContain("'hash-object'");
    expect(source).toContain('expected OSR blob');
    expect(source).toContain('git -C $OsrSource diff --check');
    expect(source).toContain("Select-String -SimpleMatch 'way_pos_t{16U}'");
    expect(source).toContain("Select-String -SimpleMatch 'way_pos_t{32U}'");
    expect(source).toContain('status --porcelain');
    expect(source).not.toMatch(/windows-mingw|msys2/i);
  });

  it('normalizes the MOTIS root checkout to LF before hydrating dependencies', () => {
    const source = readScript(scriptPaths.resolve);
    const clone = source.indexOf("Invoke-Git @('clone', '--branch'");
    const motisStatus = source.indexOf('$motisStatus =', clone);
    const rootConfig = source.indexOf("Invoke-Git @('-C', $MotisSource, 'config', 'core.autocrlf', 'false')");
    const rootReset = source.indexOf("Invoke-Git @('-C', $MotisSource, 'reset', '--hard', [string]$lock.source.motisCommit)");
    const dependencyConfig = source.indexOf("Invoke-Git @('-C', $dependencyPath, 'config', 'core.autocrlf', 'false')");
    const dependencyReset = source.indexOf("Invoke-Git @('-C', $dependencyPath, 'reset', '--hard', $dependencyLock.Commit)");

    expect(clone).toBeGreaterThanOrEqual(0);
    expect(motisStatus).toBeGreaterThan(clone);
    expect(rootConfig).toBeGreaterThan(motisStatus);
    expect(rootReset).toBeGreaterThan(rootConfig);
    expect(rootReset).toBeLessThan(source.indexOf('$pkgDefinition =', rootReset));
    expect(dependencyConfig).toBeGreaterThan(rootReset);
    expect(dependencyReset).toBeGreaterThan(dependencyConfig);
  });

  it('mirrors the upstream MSVC Ninja targets without MinGW compatibility patches', () => {
    const source = readScript(scriptPaths.build);

    expect(source).toContain('-GNinja');
    expect(source).toContain('-DNO_BUILDCACHE=ON');
    expect(source).toContain('-DMOTIS_MIMALLOC=ON');
    expect(source).toContain('CMAKE_C_COMPILER=cl.exe');
    expect(source).toContain('CMAKE_CXX_COMPILER=cl.exe');
    expect(source).toContain('CMakeCCompiler.cmake');
    expect(source).toContain('CMakeCXXCompiler.cmake');
    expect(source).toContain('Remove-Item -LiteralPath $cmakeCache');
    expect(source).toContain('Env:CC');
    expect(source).toContain('Env:CXX');
    expect(source).toMatch(/motis motis-test motis-web-ui/);
    expect(source).toContain('motis-test.exe');
    expect(source).toContain('VCToolsRedistDir');
    expect(source).toContain('msvc-runtime.mjs');
    expect(source).toContain('--list-required');
    expect(source).not.toMatch(/\$requiredCrtDlls\s*=\s*@\(\s*'/);
    expect(source).toContain('Required MSVC runtime DLL is missing');
    expect(source).toContain('deps/tiles/profile');
    expect(source).toContain('ui/build');
    expect(source).toMatch(/license/i);
    expect(source).not.toMatch(/mingw|windows-mingw|msys2/i);
  });

  it('enables MSVC C++ exceptions while preserving reproducible compiler flags', () => {
    const source = readScript(scriptPaths.build);

    expect(source).toContain("'-DCMAKE_CXX_FLAGS=/Brepro /EHsc'");
    expect(source).toContain("'-DCMAKE_C_FLAGS=/Brepro'");
    expect(source).toContain("'-DCMAKE_EXE_LINKER_FLAGS=/Brepro'");
  });

  it('exports the complete shared VC143 runtime inventory for PowerShell staging', () => {
    const result = spawnSync(process.execPath, [runtimeScriptPath, '--list-required'], { encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'concrt140.dll',
      'msvcp140.dll',
      'msvcp140_1.dll',
      'msvcp140_2.dll',
      'msvcp140_atomic_wait.dll',
      'msvcp140_codecvt_ids.dll',
      'vccorlib140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
      'vcruntime140_threads.dll'
    ]);
  });

  it('accepts compiler IDs from generated CMake language metadata', () => {
    const buildDirectory = mkdtempSync(join(tmpdir(), 'motis-msvc-cmake-'));
    const metadataDirectory = join(buildDirectory, 'CMakeFiles', '3.31.6');

    try {
      mkdirSync(metadataDirectory, { recursive: true });
      writeFileSync(join(buildDirectory, 'CMakeCache.txt'), '# Generated CMake cache\n');
      writeFileSync(
        join(metadataDirectory, 'CMakeCCompiler.cmake'),
        'set(CMAKE_C_COMPILER "cl.exe")\nset(CMAKE_C_COMPILER_ID "MSVC")\n'
      );
      writeFileSync(
        join(metadataDirectory, 'CMakeCXXCompiler.cmake'),
        'set(CMAKE_CXX_COMPILER "cl.exe")\nset(CMAKE_CXX_COMPILER_ID "MSVC")\n'
      );

      const result = invokeCMakeVerifier(buildDirectory);

      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true });
    }
  });
});
