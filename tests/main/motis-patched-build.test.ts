import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createReleaseCandidate } from '../../scripts/motis/create-release-candidate.mjs';
import { verifyPatchedBuild } from '../../scripts/motis/verify-patched-build.mjs';

const temporaryRoots: string[] = [];

const builderObservation = {
  compilerFamily: 'MSVC',
  compilerVersion: '19.44.35217',
  windowsSdkVersion: '10.0.26100.0',
  cmakeVersion: '3.31.6',
  ninjaVersion: '1.12.1',
  generator: 'Ninja',
  runnerImage: 'win25'
};

async function makeStagedDistribution() {
  const root = await mkdtemp(join(tmpdir(), 'tap-motis-candidate-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'licenses'), { recursive: true });
  await mkdir(join(root, 'tiles-profiles'), { recursive: true });
  await mkdir(join(root, 'ui'), { recursive: true });
  await writeFile(join(root, 'motis.exe'), Buffer.from('custom motis executable'));
  await writeFile(join(root, 'mimalloc.dll'), Buffer.from('mimalloc runtime'));
  await writeFile(join(root, 'vcruntime140.dll'), Buffer.from('MSVC runtime'));
  await writeFile(join(root, 'licenses', 'MOTIS-MIT.txt'), 'MOTIS MIT license');
  await writeFile(join(root, 'licenses', 'OSR-MIT.txt'), 'OSR MIT license');
  await writeFile(join(root, 'tiles-profiles', 'full.lua'), 'return {}');
  await writeFile(join(root, 'ui', 'index.html'), '<html>Custom MOTIS</html>');
  await writeFile(join(root, 'builder-observation.json'), JSON.stringify(builderObservation));
  return root;
}

async function createValidCandidate() {
  const root = await makeStagedDistribution();
  const result = await createReleaseCandidate(root);
  return { root, ...result };
}

async function rewriteManifest(manifestPath: string, update: (manifest: any) => void) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  update(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Custom MOTIS manifest v2', () => {
  it('creates and verifies a complete MSVC distribution inventory', async () => {
    const result = await createValidCandidate();
    const verified = await verifyPatchedBuild(result.manifestPath);

    expect(verified.manifest.schemaVersion).toBe(2);
    expect(verified.manifest.builder.compilerFamily).toBe('MSVC');
    expect(verified.manifest.builder.generator).toBe('Ninja');
    expect(verified.manifest.sourceDiff.changedFiles).toEqual(['include/osr/types.h']);
    expect(verified.manifest.runtimeDlls).toContain('vcruntime140.dll');
    expect(verified.manifest.licenseFiles).toEqual([
      'licenses/MOTIS-MIT.txt',
      'licenses/OSR-MIT.txt'
    ]);
    expect(verified.manifest.validation).toEqual({
      status: 'unvalidated',
      pbfSha256: null,
      supportedMaxWaysPerNode: 32,
      nodesAboveMaxWaysPerNode: 'unsupported'
    });
    expect(verified.manifest.files.map((file: { path: string }) => file.path)).toEqual([
      'builder-observation.json',
      'licenses/MOTIS-MIT.txt',
      'licenses/OSR-MIT.txt',
      'mimalloc.dll',
      'motis.exe',
      'tiles-profiles/full.lua',
      'ui/index.html',
      'vcruntime140.dll'
    ]);
    expect(verified.actualSha256).toBe(verified.manifest.binary.sha256);
  });

  it('rejects file inventory paths that escape the distribution', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.files[0].path = '../builder-observation.json';
    });

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/inside|relative|traversal/i);
  });

  it('rejects duplicate file inventory entries case-insensitively', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.files.push({ ...manifest.files[0], path: 'BUILDER-OBSERVATION.JSON' });
    });

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/duplicate/i);
  });

  it('rejects a manifest that omits a required license', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.licenseFiles = ['licenses/MOTIS-MIT.txt'];
    });

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/OSR-MIT\.txt|license/i);
  });

  it('rejects a manifest that omits the MSVC CRT', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.runtimeDlls = manifest.runtimeDlls.filter((path: string) => path !== 'vcruntime140.dll');
    });

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/vcruntime140\.dll|CRT/i);
  });

  it('rejects a manifest claiming a MinGW build', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.builder.compilerFamily = 'MinGW';
    });

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/MSVC/i);
  });

  it('recalculates hashes for non-binary files', async () => {
    const result = await createValidCandidate();
    await writeFile(join(result.root, 'ui', 'index.html'), '<html>tamper MOTIS</html>');

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/SHA-256 mismatch.*ui\/index\.html/i);
  });

  it('rejects executable and DLL payloads omitted from the inventory', async () => {
    const result = await createValidCandidate();
    await writeFile(join(result.root, 'unlisted.dll'), Buffer.from('not inventoried'));

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/unlisted.*DLL|DLL.*unlisted/i);
  });

  it('rejects distributions missing UI or profile payloads', async () => {
    const missingUi = await createValidCandidate();
    await rm(join(missingUi.root, 'ui'), { recursive: true, force: true });
    await expect(verifyPatchedBuild(missingUi.manifestPath)).rejects.toThrow(/ui\/index\.html|UI/i);

    const missingProfiles = await createValidCandidate();
    await rm(join(missingProfiles.root, 'tiles-profiles'), { recursive: true, force: true });
    await expect(verifyPatchedBuild(missingProfiles.manifestPath)).rejects.toThrow(/tiles-profiles\/full\.lua|profile/i);
  });

  it('creates and verifies the manifest before publishing the staged build', async () => {
    const source = await readFile('scripts/motis/build-patched-windows-msvc.ps1', 'utf8');
    const createCandidate = source.indexOf('create-release-candidate.mjs');
    const verifyCandidate = source.indexOf('verify-patched-build.mjs');
    const publishStage = source.indexOf('Move-Item -LiteralPath $StageDirectory -Destination $OutputDirectory');

    expect(createCandidate).toBeGreaterThanOrEqual(0);
    expect(verifyCandidate).toBeGreaterThan(createCandidate);
    expect(publishStage).toBeGreaterThan(verifyCandidate);
  });
});
