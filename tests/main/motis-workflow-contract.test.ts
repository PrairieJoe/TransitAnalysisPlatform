import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const buildWorkflowPath = '.github/workflows/motis-build.yml';
const retiredReleaseWorkflowPath = '.github/workflows/motis-release.yml';

function readBuildWorkflow() {
  return readFileSync(buildWorkflowPath, 'utf8');
}

describe('MOTIS candidate build workflow', () => {
  it('uses the upstream-compatible MSVC and Ninja build path', () => {
    const workflow = readBuildWorkflow();

    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).toContain('uses: ilammy/msvc-dev-cmd@v1');
    expect(workflow).toMatch(/ninja/i);
    expect(workflow).toContain('.\\scripts\\motis\\build-patched-windows-msvc.ps1');
    expect(workflow).toContain('.\\scripts\\motis\\verify-patched-build.mjs');
    expect(workflow).toContain('--mode candidate');
  });

  it('uploads a retained run-specific candidate with its verification metadata', () => {
    const workflow = readBuildWorkflow();

    expect(workflow).toContain('uses: actions/upload-artifact@v4');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32-${{ github.run_id }}');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32.zip');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32.sha256');
    expect(workflow).toContain('motis-manifest.json');
    expect(workflow).toContain('builder-observation.json');
    expect(workflow).toMatch(/retention-days:\s*(?:[2-9]\d|[1-9]\d{2,})/);
  });

  it('is build-only and has read-only repository permissions', () => {
    const workflow = readBuildWorkflow();

    expect(existsSync(retiredReleaseWorkflowPath)).toBe(false);
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents: read/);
    expect(workflow).not.toMatch(/msys2|mingw|gh\s+release|contents:\s*write/i);
  });
});
