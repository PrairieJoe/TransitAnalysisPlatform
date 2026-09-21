import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const buildWorkflowPath = '.github/workflows/motis-build.yml';
const publishWorkflowPath = '.github/workflows/motis-publish.yml';
const retiredReleaseWorkflowPath = '.github/workflows/motis-release.yml';

function readBuildWorkflow() {
  return readFileSync(buildWorkflowPath, 'utf8');
}

function readPublishWorkflow() {
  return readFileSync(publishWorkflowPath, 'utf8');
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

describe('MOTIS validated publish workflow', () => {
  it('requires an explicit build run and an existing component tag', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/build_run_id:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/component_tag:[\s\S]*default:\s*motis-v2\.11\.3-osr32\.1/);
    expect(workflow).toContain('--verify-tag');
    expect(workflow).toMatch(/canonical Custom MOTIS component tag/i);
    expect(workflow).toMatch(/actions:\s*read/);
    expect(workflow).toMatch(/contents:\s*write/);
  });

  it('downloads a cross-run candidate and verifies hashes before release mutation', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toContain('actions/download-artifact@v4');
    expect(workflow).toMatch(/run-id:\s*\$\{\{\s*inputs\.build_run_id\s*\}\}/);
    expect(workflow).toContain('ARCHIVE_NAME: motis-windows-x64-v2.11.3-osr32.zip');
    expect(workflow).toContain('CHECKSUM_NAME: motis-windows-x64-v2.11.3-osr32.sha256');
    expect(workflow).toContain('(cd candidate-artifact && sha256sum -c "${CHECKSUM_NAME}")');
    expect(workflow).toContain('verifyReleaseAttestation');
    expect(workflow).not.toContain('${ARTIFACT_NAME}.zip');
    expect(workflow).toContain('github-token: ${{ secrets.GITHUB_TOKEN }}');
    expect(workflow).toContain('motis:verify-builder-lock');
    expect(workflow).toContain('motis-validation');
    expect(workflow).toContain('sha256sum');
    expect(workflow.indexOf('verify-patched-build.mjs')).toBeLessThan(workflow.indexOf('gh release'));
  });

  it('does not rebuild or use the official or MinGW path', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).not.toMatch(/cmake|ninja|msys2|mingw|build-patched-windows/i);
    expect(workflow).not.toContain('vendor/motis/windows');
  });
});
