import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const buildWorkflowPath = '.github/workflows/motis-build.yml';
const publishWorkflowPath = '.github/workflows/motis-publish.yml';
const validationWorkflowPath = '.github/workflows/release-validation.yml';
const stableWorkflowPath = '.github/workflows/release.yml';
const retiredReleaseWorkflowPath = '.github/workflows/motis-release.yml';

function readBuildWorkflow() {
  return readFileSync(buildWorkflowPath, 'utf8');
}

function readPublishWorkflow() {
  return readFileSync(publishWorkflowPath, 'utf8');
}

function readValidationWorkflow() {
  return readFileSync(validationWorkflowPath, 'utf8');
}

function readStableWorkflow() {
  return readFileSync(stableWorkflowPath, 'utf8');
}

describe('MOTIS candidate build workflow', () => {
  it('uses the upstream-compatible MSVC and Ninja build path', () => {
    const workflow = readBuildWorkflow();

    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).toContain('uses: ilammy/msvc-dev-cmd@0b201ec74fa43914dc39ae48a89fd1d8cb592756');
    expect(workflow).toMatch(/ninja/i);
    expect(workflow).toContain('.\\scripts\\motis\\build-patched-windows-msvc.ps1');
    expect(workflow).toContain('.\\scripts\\motis\\verify-patched-build.mjs');
    expect(workflow).toContain('--mode candidate');
  });

  it('uploads a retained run-specific candidate with its verification metadata', () => {
    const workflow = readBuildWorkflow();

    expect(workflow).toContain('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32-${{ github.run_id }}');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32.zip');
    expect(workflow).toContain('motis-windows-x64-v2.11.3-osr32.sha256');
    expect(workflow).toContain('motis-manifest.json');
    expect(workflow).toContain('builder-observation.json');
    expect(workflow).toContain('actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be');
    expect(workflow).toMatch(/attestations:\s*write/);
    expect(workflow).toMatch(/id-token:\s*write/);
    expect(workflow).toMatch(/retention-days:\s*(?:[2-9]\d|[1-9]\d{2,})/);
  });

  it('is build-only and has read-only repository permissions', () => {
    const workflow = readBuildWorkflow();

    expect(existsSync(retiredReleaseWorkflowPath)).toBe(false);
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents: read/);
    expect(workflow).not.toMatch(/msys2|mingw|gh\s+release|contents:\s*write/i);
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}\b)[^\s]+/i);
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

    expect(workflow).toContain('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
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
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}\b)[^\s]+/i);
  });
});

describe('final candidate validation workflow', () => {
  it('checks out an exact commit and records the four required product gates', () => {
    const workflow = readValidationWorkflow();

    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).toMatch(/ref:\s*\$\{\{ inputs\.app_candidate_sha \}\}/);
    expect(workflow).toContain('git rev-parse HEAD');
    expect(workflow).toContain('TRANSIT_MOTIS_DIST_DIR overrides are forbidden');
    expect(workflow).toContain('npm run package:win');
    expect(workflow).toContain('npm run test:packaged-smoke');
    expect(workflow).toContain('npm run test:motis-scenario');
    expect(workflow).toContain('npm run motis:validate-release-candidate');
    expect(workflow).toContain('verify-custom-motis-artifact.mjs');
    expect(workflow).toContain('npm run release:collect-product');
    expect(workflow).toContain('0.7.1-final-readiness.json');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}\b)[^\s]+/i);
  });
});

describe('stable promotion workflow', () => {
  it('runs readiness verification before creating the stable tag or Release', () => {
    const workflow = readStableWorkflow();

    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toContain('environment: stable-release');
    expect(workflow).toContain('npm run release:verify -- --mode stable');
    expect(workflow.indexOf('release:verify')).toBeLessThan(workflow.indexOf('git tag -a'));
    expect(workflow).toContain('git tag -a "$RELEASE_TAG" "$TARGET_SHA"');
    expect(workflow).toContain('git push --atomic origin');
    expect(workflow).toContain('gh release create "$RELEASE_TAG" --verify-tag');
    expect(workflow).toMatch(/already exists; refusing to retarget/i);
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}\b)[^\s]+/i);
  });
});
