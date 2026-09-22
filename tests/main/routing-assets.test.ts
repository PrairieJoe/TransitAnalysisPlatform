import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRoutingAsset, type RoutingAssetSearchContext } from '../../src/main/routing-assets';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function contextFixture(): Promise<RoutingAssetSearchContext> {
  const root = await mkdtemp(join(tmpdir(), 'tap-routing-assets-'));
  temporaryDirectories.push(root);
  return {
    userDataPath: join(root, 'user-data'),
    appPath: join(root, 'app'),
    downloadsPath: join(root, 'Downloads')
  };
}

describe('routing asset discovery', () => {
  it('discovers a PBF from a bounded download location without a file dialog', async () => {
    const context = await contextFixture();
    const pbfPath = join(context.downloadsPath, 'south-korea-latest.osm.pbf');
    await mkdir(dirname(pbfPath), { recursive: true });
    await writeFile(pbfPath, 'pbf fixture');

    const result = await resolveRoutingAsset(context);

    expect(result.status).toBe('ready');
    expect(result.metadata?.path).toBe(pbfPath);
    expect(result.source).toBe('downloads');
  });

  it('reuses a persisted fingerprint before searching other locations', async () => {
    const context = await contextFixture();
    const pbfPath = join(context.appPath, 'data', 'osm', 'south-korea.osm.pbf');
    await mkdir(dirname(pbfPath), { recursive: true });
    await writeFile(pbfPath, 'persisted fixture');

    const first = await resolveRoutingAsset(context);
    const second = await resolveRoutingAsset({ ...context, appPath: join(context.userDataPath, 'unavailable-app') });
    const persisted = JSON.parse(await readFile(join(context.userDataPath, 'routing-assets.json'), 'utf8')) as { lastKnown?: { sha256: string } };

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(second.source).toBe('persisted');
    expect(persisted.lastKnown?.sha256).toBe(createHash('sha256').update('persisted fixture').digest('hex').toUpperCase());
  });

  it('reports a changed persisted file as stale until an explicit rescan accepts it', async () => {
    const context = await contextFixture();
    const pbfPath = join(context.downloadsPath, 'south-korea-latest.osm.pbf');
    await mkdir(dirname(pbfPath), { recursive: true });
    await writeFile(pbfPath, 'first fixture');
    await resolveRoutingAsset(context);
    await writeFile(pbfPath, 'changed fixture');

    const stale = await resolveRoutingAsset(context);
    const rescanned = await resolveRoutingAsset({ ...context, forceRescan: true });

    expect(stale.status).toBe('stale');
    expect(stale.metadata?.path).toBe(pbfPath);
    expect(rescanned.status).toBe('ready');
    expect(rescanned.metadata?.sha256).toBe(createHash('sha256').update('changed fixture').digest('hex').toUpperCase());
  });

  it('returns actionable Geofabrik guidance when no bounded candidate exists', async () => {
    const context = await contextFixture();

    const result = await resolveRoutingAsset(context);

    expect(result.status).toBe('missing');
    expect(result.geofabrikUrl).toBe('https://download.geofabrik.de/asia/south-korea.html');
    expect(result.expectedFileName).toBe('south-korea-latest.osm.pbf');
    expect(result.recommendedPath).toContain('routing');
    expect(result.message).toContain('Geofabrik');
  });
});
