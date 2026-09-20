import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const scriptPaths = {
  observe: 'scripts/motis/observe-msvc-toolchain.ps1',
  resolve: 'scripts/motis/resolve-pinned-source.ps1',
  build: 'scripts/motis/build-patched-windows-msvc.ps1'
} as const;

function readScript(path: string) {
  return readFileSync(path, 'utf8');
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
    expect(source).toContain('git -C $OsrSource diff --name-only');
    expect(source).toContain("$changedFiles[0] -ne 'include/osr/types.h'");
    expect(source).toContain('git -C $OsrSource diff --check');
    expect(source).toContain("Select-String -SimpleMatch 'way_pos_t{16U}'");
    expect(source).toContain("Select-String -SimpleMatch 'way_pos_t{32U}'");
    expect(source).toContain('status --porcelain');
    expect(source).not.toMatch(/windows-mingw|msys2/i);
  });

  it('mirrors the upstream MSVC Ninja targets without MinGW compatibility patches', () => {
    const source = readScript(scriptPaths.build);

    expect(source).toContain('-GNinja');
    expect(source).toContain('-DMOTIS_MIMALLOC=ON');
    expect(source).toMatch(/motis motis-test motis-web-ui/);
    expect(source).toContain('motis-test.exe');
    expect(source).toContain('VCToolsRedistDir');
    expect(source).toContain('deps/tiles/profile');
    expect(source).toContain('ui/build');
    expect(source).toMatch(/license/i);
    expect(source).not.toMatch(/mingw|windows-mingw|msys2/i);
  });
});
