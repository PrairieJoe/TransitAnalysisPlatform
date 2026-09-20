import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { prepareMotis } from '../../scripts/motis/prepare-patched-windows.mjs';

const pinnedMetadata = {
  motisVersion: 'v2.11.3',
  motisCommit: 'b228a4519d196d9dd01b5ce80be46e642abc953e',
  osrCommit: 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7',
  patchId: 'osr-max-ways-per-node-32',
  baseMaxWaysPerNode: 16,
  maxWaysPerNode: 32,
};

async function createDistribution(root: string, binary = Buffer.from('fake motis')) {
  const binarySha256 = createHash('sha256').update(binary).digest('hex');
  await writeFile(join(root, 'motis.exe'), binary);
  await writeFile(join(root, 'motis-manifest.json'), JSON.stringify({
    ...pinnedMetadata,
    platform: 'windows-x64',
    binary: { path: 'motis.exe', sha256: binarySha256, sizeBytes: binary.length },
    tilesProfiles: 'tiles-profiles',
    ui: 'ui',
    licenses: ['licenses/MOTIS-MIT.txt'],
    runtimeDlls: [],
  }));
  await writeFile(join(root, 'licenses', 'MOTIS-MIT.txt'), 'MIT');
  await writeFile(join(root, 'ui', 'index.html'), '<html />');
  await writeFile(join(root, 'tiles-profiles', 'full.lua'), '');
  return { binarySha256, binarySize: binary.length };
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
    const archive = await createArchive({
      'motis.exe': await readFile(join(source, 'motis.exe')),
      'motis-manifest.json': await readFile(join(source, 'motis-manifest.json')),
      'tiles-profiles/full.lua': '',
      'ui/index.html': '<html />',
      'licenses/MOTIS-MIT.txt': 'MIT',
    });

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
    const archive = await createArchive({
      'motis.exe': await readFile(join(source, 'motis.exe')),
      'motis-manifest.json': await readFile(join(source, 'motis-manifest.json')),
      'tiles-profiles/full.lua': '',
      'ui/index.html': '<html />',
      'licenses/MOTIS-MIT.txt': 'MIT',
    });

    try {
      const result = await prepareMotis({
        outputDirectory: distribution,
        archivePath: archive.archivePath,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
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
    const archive = await createArchive({
      'motis.exe': await readFile(join(source, 'motis.exe')),
      'motis-manifest.json': await readFile(join(source, 'motis-manifest.json')),
      'tiles-profiles/full.lua': '',
      'ui/index.html': '<html />',
      'licenses/MOTIS-MIT.txt': 'MIT',
    });
    const archiveBytes = await readFile(archive.archivePath);
    const fetchImpl = vi.fn(async () => new Response(archiveBytes, { status: 200 }));

    try {
      const result = await prepareMotis({
        outputDirectory: distribution,
        releaseUrl: 'https://example.test/motis.zip',
        fetchImpl,
        expectedBinarySha256: fixture.binarySha256,
        expectedBinarySizeBytes: fixture.binarySize,
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

  it('keeps release publication manual and requires the build verifier', async () => {
    const workflow = await readFile('.github/workflows/motis-release.yml', 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('publish_release:');
    expect(workflow).toContain('build-patched-windows.ps1');
    expect(workflow).toContain('verify-patched-build.mjs');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('actions/download-artifact@v4');
    expect(workflow).toContain('needs: build');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('gh release upload');
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

    expect(buildScript).toContain(".pkg.lock");
    expect(buildScript).toContain("'reset', '--hard'");
    expect(buildScript).toContain("'-p2'");
    expect(buildScript).toContain('patchContext.Repository');
    expect(normalizeDependencies).toBeGreaterThan(hydrateDependencies);
    expect(compatibilityPatches).toBeGreaterThan(normalizeDependencies);
  });
});

async function mkdirDistribution(root: string) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'licenses'), { recursive: true });
  await mkdir(join(root, 'ui'), { recursive: true });
  await mkdir(join(root, 'tiles-profiles'), { recursive: true });
  return createDistribution(root);
}
