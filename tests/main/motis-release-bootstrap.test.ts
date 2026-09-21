import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { createReleaseCandidate } from '../../scripts/motis/create-release-candidate.mjs';
import { requiredMsvcCrtDlls } from '../../scripts/motis/msvc-runtime.mjs';
import { prepareMotis } from '../../scripts/motis/prepare-patched-windows.mjs';

const pinnedMetadata = {
  motisVersion: 'v2.11.3',
  motisCommit: 'b228a4519d196d9dd01b5ce80be46e642abc953e',
  osrCommit: 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7',
  patchId: 'osr-max-ways-per-node-32',
  baseMaxWaysPerNode: 16,
  maxWaysPerNode: 32,
};

const builderObservation = {
  compilerFamily: 'MSVC',
  compilerVersion: '19.44.35217',
  windowsSdkVersion: '10.0.26100.0',
  cmakeVersion: '3.31.6',
  ninjaVersion: '1.12.1',
  generator: 'Ninja',
  runnerImage: 'win25'
};

async function createDistribution(root: string, binary = Buffer.from('fake motis')) {
  await writeFile(join(root, 'motis.exe'), binary);
  await writeFile(join(root, 'licenses', 'MOTIS-MIT.txt'), 'MIT');
  await writeFile(join(root, 'licenses', 'OSR-MIT.txt'), 'MIT');
  await writeFile(join(root, 'ui', 'index.html'), '<html />');
  await writeFile(join(root, 'tiles-profiles', 'full.lua'), '');
  await Promise.all(requiredMsvcCrtDlls.map((name) => writeFile(join(root, name), `MSVC runtime ${name}`)));
  await writeFile(join(root, 'builder-observation.json'), JSON.stringify(builderObservation));
  const result = await createReleaseCandidate(root);
  const lockPath = `${root}.builder-lock.json`;
  await writeFile(lockPath, JSON.stringify({
    schemaVersion: 2,
    state: 'locked',
    source: {
      motisVersion: pinnedMetadata.motisVersion,
      motisCommit: pinnedMetadata.motisCommit,
      osrCommit: pinnedMetadata.osrCommit
    },
    patch: {
      id: pinnedMetadata.patchId,
      file: 'scripts/motis/osr-max-ways-per-node-32.patch',
      sha256: '4754d17b7d9b04cf928439e91dff29a19266d8f74f7da0de09bf3b253737ec91'
    },
    artifact: { format: 'zip', manifestSchemaVersion: 2 },
    toolchain: builderObservation
  }));
  return { binarySha256: result.manifest.binary.sha256, binarySize: binary.length, lockPath };
}

async function distributionArchiveEntries(source: string) {
  const paths = [
    'motis.exe',
    'motis-manifest.json',
    'builder-observation.json',
    ...requiredMsvcCrtDlls,
    'tiles-profiles/full.lua',
    'ui/index.html',
    'licenses/MOTIS-MIT.txt',
    'licenses/OSR-MIT.txt'
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(source, path))])));
}

async function createArchive(entries: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(tmpdir(), 'tap-motis-archive-'));
  const archivePath = join(root, 'motis.zip');
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  await writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return { root, archivePath };
}

describe('MOTIS release bootstrap', () => {
  it('reuses a valid local distribution without making a network request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-local-'));
    const distribution = join(root, 'patched-windows');
    const fixture = await mkdirDistribution(distribution);
    const fetchImpl = vi.fn();

    try {
      const result = await prepareMotis({
        outputDirectory: distribution,
        fetchImpl,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
        lockPath: fixture.lockPath,
      });
      expect(result.source).toBe('local');
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a downloaded archive whose configured SHA-256 does not match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-download-'));
    const source = join(root, 'source');
    const distribution = join(root, 'patched-windows');
    await mkdirDistribution(source);
    const archive = await createArchive(await distributionArchiveEntries(source));

    try {
      await expect(prepareMotis({
        outputDirectory: distribution,
        archivePath: archive.archivePath,
        archiveSha256: '0'.repeat(64),
      })).rejects.toThrow('archive SHA-256');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(archive.root, { recursive: true, force: true });
    }
  });

  it('extracts and verifies a valid local release archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-archive-valid-'));
    const source = join(root, 'source');
    const distribution = join(root, 'patched-windows');
    const fixture = await mkdirDistribution(source);
    const archive = await createArchive(await distributionArchiveEntries(source));

    try {
      const result = await prepareMotis({
        outputDirectory: distribution,
        archivePath: archive.archivePath,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
        lockPath: fixture.lockPath,
      });
      expect(result.source).toBe('archive');
      expect(existsSync(join(distribution, 'motis.exe'))).toBe(true);
      expect(existsSync(join(distribution, 'motis-manifest.json'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(archive.root, { recursive: true, force: true });
    }
  });

  it('downloads a valid release asset through the configured fetch implementation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-fetch-'));
    const source = join(root, 'source');
    const distribution = join(root, 'patched-windows');
    const fixture = await mkdirDistribution(source);
    const archive = await createArchive(await distributionArchiveEntries(source));
    const archiveBytes = await readFile(archive.archivePath);
    const fetchImpl = vi.fn(async () => new Response(archiveBytes, { status: 200 }));

    try {
      const result = await prepareMotis({
        outputDirectory: distribution,
        releaseUrl: 'https://example.test/motis.zip',
        fetchImpl,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
        lockPath: fixture.lockPath,
      });
      expect(result.source).toBe('download');
      expect(fetchImpl).toHaveBeenCalledWith('https://example.test/motis.zip', { redirect: 'follow' });
      expect(existsSync(join(distribution, 'motis.exe'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(archive.root, { recursive: true, force: true });
    }
  });

  it('rejects ZIP entries that escape the extraction directory', async () => {
    const archive = await createArchive({ '../outside.txt': 'must not escape' });
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-traversal-'));
    const distribution = join(root, 'patched-windows');

    try {
      await expect(prepareMotis({ outputDirectory: distribution, archivePath: archive.archivePath })).rejects.toThrow(/out of bound|outside|invalid relative path/i);
      expect(existsSync(join(dirname(distribution), 'outside.txt'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(archive.root, { recursive: true, force: true });
    }
  });

  it('rejects a local distribution using the legacy manifest schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-schema-v1-'));
    const distribution = join(root, 'patched-windows');
    const fixture = await mkdirDistribution(distribution);
    const manifestPath = join(distribution, 'motis-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.schemaVersion = 1;
    await writeFile(manifestPath, JSON.stringify(manifest));

    try {
      await expect(prepareMotis({
        outputDirectory: distribution,
        offline: true,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
        lockPath: fixture.lockPath,
      })).rejects.toThrow(/schema|version|v2/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a valid local distribution when its binary differs from the locked candidate hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-locked-hash-'));
    const distribution = join(root, 'patched-windows');
    const fixture = await mkdirDistribution(distribution);

    try {
      await expect(prepareMotis({
        outputDirectory: distribution,
        offline: true,
        expectedBinarySha256: '0'.repeat(64),
        expectedBinarySizeBytes: fixture.binarySize,
        lockPath: fixture.lockPath,
      })).rejects.toThrow(/SHA-256/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never packages the official 16-way MOTIS distribution as a fallback', async () => {
    const packageScript = await readFile('scripts/package-win.mjs', 'utf8');

    expect(packageScript).not.toContain('TRANSIT_ALLOW_OFFICIAL_MOTIS');
    expect(packageScript).not.toContain("vendor', 'motis', 'windows");
    expect(packageScript).toContain('assertCustomMotisManifest(motisDistribution)');
  });

  it('applies the MinGW oneTBB compatibility patch before the first CMake configure', async () => {
    const buildScript = await readFile('scripts/motis/build-patched-windows.ps1', 'utf8');
    const hydrateDependencies = buildScript.indexOf("@('-l', '-h', '-f')");
    const preConfigurePatch = buildScript.indexOf('Apply-TrackedPatch $tbbCompatibilityPatchPath');
    const firstConfigure = buildScript.indexOf('Invoke-External -FilePath $CMakePath');

    expect(hydrateDependencies).toBeGreaterThanOrEqual(0);
    expect(buildScript).toContain('https://github.com/motis-project/pkg/releases/download/v0.23/pkg.exe');
    expect(buildScript).toContain('f710c2569f062fac8380a564bb00f11a9af579788c4b7ee17220743af203d76b');
    expect(preConfigurePatch).toBeGreaterThan(hydrateDependencies);
    expect(preConfigurePatch).toBeGreaterThanOrEqual(0);
    expect(firstConfigure).toBeGreaterThan(preConfigurePatch);
  });

  it('normalizes patch-target dependencies to the tracked pkg lock before patching', async () => {
    const buildScript = await readFile('scripts/motis/build-patched-windows.ps1', 'utf8');
    const hydrateDependencies = buildScript.indexOf('Hydrate-PkgDependencies');
    const normalizeDependencies = buildScript.indexOf('Normalize-PatchTargetDependencies');
    const compatibilityPatches = buildScript.indexOf('Apply-CompatibilityPatches', normalizeDependencies);
    const trackedPatchState = buildScript.indexOf('function Test-TrackedPatchState');
    const trackedPatchApply = buildScript.indexOf('function Apply-TrackedPatch');

    expect(buildScript).toContain(".pkg.lock");
    expect(buildScript).toContain("'reset', '--hard'");
    expect(buildScript).toContain("'config', 'core.autocrlf', 'false'");
    expect(buildScript).toContain("'checkout', '--'");
    expect(buildScript).toContain("'hash-object'");
    expect(buildScript).toContain("'--ignore-space-change'");
    expect(buildScript.slice(trackedPatchState, trackedPatchApply)).toContain("'--ignore-whitespace'");
    expect(buildScript.slice(trackedPatchApply)).toContain("'--ignore-whitespace'");
    expect(buildScript).toContain("'-p3'");
    expect(buildScript).toContain('patchContext.Repository');
    expect(normalizeDependencies).toBeGreaterThan(hydrateDependencies);
    expect(compatibilityPatches).toBeGreaterThan(normalizeDependencies);
  });

  it('avoids the MinGW windows.foundation header conflict in the Abseil patch', async () => {
    const patch = await readFile('scripts/motis/windows-mingw-abseil.patch', 'utf8');

    expect(patch).toContain('#if defined(__MINGW32__)');
    expect(patch).toContain('WindowsCreateStringReference');
    expect(patch).toContain('ITimeZoneOnCalendar : public IInspectable');
    expect(patch).toContain('RuntimeClass_Windows_Globalization_Calendar');
    expect(patch).toContain('#include <winstring.h>');
    expect(patch).toContain('#include <windows.globalization.h>');
    expect(patch).toContain('#endif');
  });
});

async function mkdirDistribution(root: string) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'licenses'), { recursive: true });
  await mkdir(join(root, 'ui'), { recursive: true });
  await mkdir(join(root, 'tiles-profiles'), { recursive: true });
  return createDistribution(root);
}
