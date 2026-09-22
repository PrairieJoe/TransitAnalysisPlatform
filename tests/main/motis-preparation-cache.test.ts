import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GtfsFileSet } from '../../src/core/synthetic-gtfs/types';
import { buildMotisPreparationFingerprint, createMotisPreparationCache, type MotisBinaryIdentity } from '../../src/main/motis-preparation-cache';
import type { MotisPreparationResult, MotisSidecarOptions } from '../../src/main/motis-sidecar';

const files = {
  'agency.txt': 'agency', 'stops.txt': 'stops', 'routes.txt': 'routes', 'trips.txt': 'trips', 'stop_times.txt': 'stop_times', 'calendar.txt': 'calendar',
  'tap-motis-config.json': '{}', 'tap-provenance.json': '{}', 'tap-validation.json': '{}'
} as GtfsFileSet;

const binary: MotisBinaryIdentity = { sha256: 'BINARY-A', manifestSchemaVersion: 2 };

function options(dataDirectory: string, osmPbfPath: string, port = 18765): MotisSidecarOptions {
  return {
    executablePath: 'C:\\motis\\motis.exe', dataDirectory, osmPbfPath, port, args: ['server'],
    environment: { TBB_NUM_THREADS: '1' }, disableTiles: true, healthPath: '/api/v1/health', startupTimeoutMs: 30000
  };
}

async function seedPbf(name: string, content: string): Promise<string> {
  const path = join(name, 'region.osm.pbf');
  await writeFile(path, content);
  return path;
}

describe('MOTIS preparation cache', () => {
  it('reuses a completed fingerprint while excluding port and storage path from the fingerprint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-cache-'));
    const pbf = await seedPbf(root, 'pbf-a');
    const first = options(join(root, 'motis-data'), pbf, 18765);
    const second = options(join(root, 'motis-data'), pbf, 18766);
    const prepare = vi.fn(async (prepared: MotisSidecarOptions): Promise<MotisPreparationResult> => {
      await mkdir(join(prepared.dataDirectory, 'data'), { recursive: true });
      await writeFile(join(prepared.dataDirectory, 'config.yml'), 'config');
      await writeFile(join(prepared.dataDirectory, 'tap-synthetic-gtfs.zip'), 'zip');
      return { archivePath: join(prepared.dataDirectory, 'tap-synthetic-gtfs.zip'), message: 'prepared' };
    });
    const cache = createMotisPreparationCache({
      prepare,
      binaryIdentity: async () => binary,
      sidecar: { getStatus: () => ({ state: 'stopped' }), stop: vi.fn(async () => undefined) }
    });

    const firstResult = await cache.prepare(first, files);
    const secondResult = await cache.prepare(second, files);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(firstResult.cacheHit).toBe(false);
    expect(secondResult.cacheHit).toBe(true);
    expect(secondResult.fingerprint).toBe(firstResult.fingerprint);
    expect(secondResult.dataDirectory).toBe(firstResult.dataDirectory);
  });

  it('keeps the previous active network after a new import fails and serializes concurrent preparation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-cache-failure-'));
    const pbfA = await seedPbf(root, 'pbf-a');
    const pbfB = join(root, 'region-b.osm.pbf');
    await writeFile(pbfB, 'pbf-b');
    const first = options(join(root, 'motis-data'), pbfA);
    const second = options(join(root, 'motis-data'), pbfB);
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const prepare = vi.fn(async (prepared: MotisSidecarOptions): Promise<MotisPreparationResult> => {
      calls += 1;
      if (calls === 1) {
        releaseFirst?.();
        await mkdir(join(prepared.dataDirectory, 'data'), { recursive: true });
        await writeFile(join(prepared.dataDirectory, 'config.yml'), 'config-a');
        await writeFile(join(prepared.dataDirectory, 'tap-synthetic-gtfs.zip'), 'zip-a');
        return { archivePath: join(prepared.dataDirectory, 'tap-synthetic-gtfs.zip'), message: 'prepared-a' };
      }
      await writeFile(join(prepared.dataDirectory, 'config.yml'), 'partial-b').catch(() => undefined);
      throw new Error('import failed');
    });
    const stop = vi.fn(async () => undefined);
    const cache = createMotisPreparationCache({ prepare, binaryIdentity: async () => binary, sidecar: { getStatus: () => ({ state: 'ready' }), stop } });

    const firstPromise = cache.prepare(first, files);
    await firstStarted;
    const duplicatePromise = cache.prepare(first, files);
    const firstResult = await firstPromise;
    const duplicateResult = await duplicatePromise;
    await expect(cache.prepare(second, files)).rejects.toThrow('import failed');
    const recovered = await cache.prepare(first, files);

    expect(firstResult.fingerprint).toBe(duplicateResult.fingerprint);
    expect(duplicateResult.cacheHit).toBe(true);
    expect(recovered.cacheHit).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalled();
    expect(await readFile(join(firstResult.dataDirectory, 'config.yml'), 'utf8')).toBe('config-a');
  });

  it('changes when preparation inputs change but not when runtime port changes', () => {
    const base = { pbfSha256: 'PBF-A', gtfsSha256: 'GTFS-A', binary, disableTiles: true, preparationSchemaVersion: 1 };
    expect(buildMotisPreparationFingerprint(base)).toBe(buildMotisPreparationFingerprint({ ...base, port: 18766 }));
    expect(buildMotisPreparationFingerprint(base)).not.toBe(buildMotisPreparationFingerprint({ ...base, pbfSha256: 'PBF-B' }));
    expect(buildMotisPreparationFingerprint(base)).not.toBe(buildMotisPreparationFingerprint({ ...base, gtfsSha256: 'GTFS-B' }));
    expect(buildMotisPreparationFingerprint(base)).not.toBe(buildMotisPreparationFingerprint({ ...base, binary: { ...binary, sha256: 'BINARY-B' } }));
  });
});
