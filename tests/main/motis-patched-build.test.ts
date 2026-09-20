import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createReleaseCandidate } from '../../scripts/motis/create-release-candidate.mjs';
import { requiredMsvcCrtDlls } from '../../scripts/motis/msvc-runtime.mjs';
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

async function makeStagedDistribution(observation = builderObservation) {
  const root = await mkdtemp(join(tmpdir(), 'tap-motis-candidate-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'licenses'), { recursive: true });
  await mkdir(join(root, 'tiles-profiles'), { recursive: true });
  await mkdir(join(root, 'ui'), { recursive: true });
  await writeFile(join(root, 'motis.exe'), Buffer.from('custom motis executable'));
  await writeFile(join(root, 'mimalloc.dll'), Buffer.from('mimalloc runtime'));
  await Promise.all(requiredMsvcCrtDlls.map((name) => writeFile(join(root, name), Buffer.from(`MSVC runtime ${name}`))));
  await writeFile(join(root, 'licenses', 'MOTIS-MIT.txt'), 'MOTIS MIT license');
  await writeFile(join(root, 'licenses', 'OSR-MIT.txt'), 'OSR MIT license');
  await writeFile(join(root, 'tiles-profiles', 'full.lua'), 'return {}');
  await writeFile(join(root, 'ui', 'index.html'), '<html>Custom MOTIS</html>');
  await writeFile(join(root, 'builder-observation.json'), JSON.stringify(observation));
  return root;
}

async function writeLockedBuilderLock(release?: {
  buildRunId: string;
  archiveSha256: string;
  binarySha256: string;
  pbfSha256: string;
  scenarioReportSha256: string;
}) {
  const root = await mkdtemp(join(tmpdir(), 'tap-motis-lock-'));
  temporaryRoots.push(root);
  const lockPath = join(root, 'motis-builder-lock.json');
  await writeFile(lockPath, JSON.stringify({
    schemaVersion: 1,
    state: 'locked',
    source: {
      motisVersion: 'v2.11.3',
      motisCommit: 'b228a4519d196d9dd01b5ce80be46e642abc953e',
      osrCommit: 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7'
    },
    patch: {
      id: 'osr-max-ways-per-node-32',
      file: 'scripts/motis/osr-max-ways-per-node-32.patch',
      sha256: '4754d17b7d9b04cf928439e91dff29a19266d8f74f7da0de09bf3b253737ec91'
    },
    artifact: { format: 'zip', manifestSchemaVersion: 2 },
    toolchain: builderObservation,
    ...(release ? { release } : {})
  }));
  return lockPath;
}

async function createValidCandidate() {
  const root = await makeStagedDistribution();
  const result = await createReleaseCandidate(root);
  const lockPath = await writeLockedBuilderLock();
  return { root, lockPath, ...result };
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
    const verified = await verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath });

    expect(verified.manifest.schemaVersion).toBe(2);
    expect(verified.manifest.builder.compilerFamily).toBe('MSVC');
    expect(verified.manifest.builder.generator).toBe('Ninja');
    expect(verified.manifest.sourceDiff.changedFiles).toEqual(['include/osr/types.h']);
    expect(verified.manifest.runtimeDlls).toContain('vcruntime140_threads.dll');
    expect(verified.manifest.runtimeDlls).toEqual([...requiredMsvcCrtDlls, 'mimalloc.dll'].sort());
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
      'concrt140.dll',
      'licenses/MOTIS-MIT.txt',
      'licenses/OSR-MIT.txt',
      'mimalloc.dll',
      'motis.exe',
      'msvcp140.dll',
      'msvcp140_1.dll',
      'msvcp140_2.dll',
      'msvcp140_atomic_wait.dll',
      'msvcp140_codecvt_ids.dll',
      'tiles-profiles/full.lua',
      'ui/index.html',
      'vccorlib140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
      'vcruntime140_threads.dll'
    ]);
    expect(verified.actualSha256).toBe(verified.manifest.binary.sha256);
  });

  it('rejects a locked candidate whose binary differs from the approved release', async () => {
    const result = await createValidCandidate();
    const lockPath = await writeLockedBuilderLock({
      buildRunId: 'run-1',
      archiveSha256: 'a'.repeat(64),
      binarySha256: 'f'.repeat(64),
      pbfSha256: 'c'.repeat(64),
      scenarioReportSha256: 'd'.repeat(64)
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath })).rejects.toThrow(/release binary SHA-256/i);
  });

  it('rejects file inventory paths that escape the distribution', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.files[0].path = '../builder-observation.json';
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/inside|relative|traversal/i);
  });

  it('rejects duplicate file inventory entries case-insensitively', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.files.push({ ...manifest.files[0], path: 'BUILDER-OBSERVATION.JSON' });
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/duplicate/i);
  });

  it('rejects a manifest that omits a required license', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.licenseFiles = ['licenses/MOTIS-MIT.txt'];
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/OSR-MIT\.txt|license/i);
  });

  it('rejects a manifest that omits the MSVC CRT', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.runtimeDlls = manifest.runtimeDlls.filter((path: string) => path !== 'vcruntime140.dll');
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/vcruntime140\.dll|CRT/i);
  });

  it('rejects a self-consistent distribution missing one required MSVC CRT DLL', async () => {
    const result = await createValidCandidate();
    await rm(join(result.root, 'msvcp140_2.dll'));
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.runtimeDlls = manifest.runtimeDlls.filter((path: string) => path !== 'msvcp140_2.dll');
      manifest.files = manifest.files.filter((file: { path: string }) => file.path !== 'msvcp140_2.dll');
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/msvcp140_2\.dll|CRT/i);
  });

  it('rejects a self-consistent distribution missing vcruntime140_threads.dll', async () => {
    const result = await createValidCandidate();
    await rm(join(result.root, 'vcruntime140_threads.dll'));
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.runtimeDlls = manifest.runtimeDlls.filter((path: string) => path !== 'vcruntime140_threads.dll');
      manifest.files = manifest.files.filter((file: { path: string }) => file.path !== 'vcruntime140_threads.dll');
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/vcruntime140_threads\.dll|CRT/i);
  });

  it('rejects builder metadata while the repository lock is still a probe', async () => {
    const root = await makeStagedDistribution({ ...builderObservation, runnerImage: 'bogus-runner' });
    const result = await createReleaseCandidate(root);

    await expect(verifyPatchedBuild(result.manifestPath)).rejects.toThrow(/locked/i);
  });

  it('explicitly verifies a build candidate against the observed probe metadata', async () => {
    const root = await makeStagedDistribution();
    const result = await createReleaseCandidate(root);

    await expect(verifyPatchedBuild(result.manifestPath, { mode: 'candidate' })).resolves.toMatchObject({
      manifest: { builder: builderObservation }
    });
  });

  it('fails closed for an unknown verification mode', async () => {
    const result = await createValidCandidate();

    await expect(verifyPatchedBuild(result.manifestPath, {
      lockPath: result.lockPath,
      mode: 'unlocked' as never
    })).rejects.toThrow(/verification mode/i);
  });

  it.each([
    ['compilerVersion', 'bogus-compiler', /compilerVersion|compiler/i],
    ['windowsSdkVersion', 'bogus-sdk', /Windows SDK/i],
    ['cmakeVersion', 'bogus-cmake', /CMake/i],
    ['ninjaVersion', 'bogus-ninja', /Ninja/i],
    ['runnerImage', 'bogus-runner', /runner image/i]
  ] as const)('rejects locked %s drift', async (field, value, expectedError) => {
    const root = await makeStagedDistribution({ ...builderObservation, [field]: value });
    const result = await createReleaseCandidate(root);
    const lockPath = await writeLockedBuilderLock();

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath })).rejects.toThrow(expectedError);
  });

  it('rejects a manifest claiming a MinGW build', async () => {
    const result = await createValidCandidate();
    await rewriteManifest(result.manifestPath, (manifest) => {
      manifest.builder.compilerFamily = 'MinGW';
    });

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/MSVC/i);
  });

  it('recalculates hashes for non-binary files', async () => {
    const result = await createValidCandidate();
    await writeFile(join(result.root, 'ui', 'index.html'), '<html>tamper MOTIS</html>');

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/SHA-256 mismatch.*ui\/index\.html/i);
  });

  it('rejects executable and DLL payloads omitted from the inventory', async () => {
    const result = await createValidCandidate();
    await writeFile(join(result.root, 'unlisted.dll'), Buffer.from('not inventoried'));

    await expect(verifyPatchedBuild(result.manifestPath, { lockPath: result.lockPath })).rejects.toThrow(/unlisted.*DLL|DLL.*unlisted/i);
  });

  it('rejects distributions missing UI or profile payloads', async () => {
    const missingUi = await createValidCandidate();
    await rm(join(missingUi.root, 'ui'), { recursive: true, force: true });
    await expect(verifyPatchedBuild(missingUi.manifestPath, { lockPath: missingUi.lockPath })).rejects.toThrow(/ui\/index\.html|UI/i);

    const missingProfiles = await createValidCandidate();
    await rm(join(missingProfiles.root, 'tiles-profiles'), { recursive: true, force: true });
    await expect(verifyPatchedBuild(missingProfiles.manifestPath, { lockPath: missingProfiles.lockPath })).rejects.toThrow(/tiles-profiles\/full\.lua|profile/i);
  });

  it('creates and verifies the manifest before publishing the staged build', async () => {
    const source = await readFile('scripts/motis/build-patched-windows-msvc.ps1', 'utf8');
    const createCandidate = source.indexOf('create-release-candidate.mjs');
    const verifyCandidate = source.indexOf('verify-patched-build.mjs');
    const publishStage = source.indexOf('Move-Item -LiteralPath $StageDirectory -Destination $OutputDirectory');

    expect(createCandidate).toBeGreaterThanOrEqual(0);
    expect(verifyCandidate).toBeGreaterThan(createCandidate);
    expect(publishStage).toBeGreaterThan(verifyCandidate);
    expect(source).toMatch(/\$VerifyCandidateScript[\s\S]*'--mode'[\s\S]*'candidate'/);
  });
});
