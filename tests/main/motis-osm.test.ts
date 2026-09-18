import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GEOFABRIK_SOUTH_KOREA_URL, inspectOsmPbf } from '../../src/main/motis-osm';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('OSM PBF workflow', () => {
  it('exposes the official South Korea Geofabrik page', () => {
    expect(GEOFABRIK_SOUTH_KOREA_URL).toBe('https://download.geofabrik.de/asia/south-korea.html');
  });

  it('returns file metadata and a SHA-256 hash for a selected PBF', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tap-osm-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, 'south-korea.osm.pbf');
    const contents = Buffer.from('synthetic-pbf-fixture');
    await writeFile(filePath, contents);

    const metadata = await inspectOsmPbf(filePath);

    expect(metadata.path).toBe(filePath);
    expect(metadata.fileName).toBe('south-korea.osm.pbf');
    expect(metadata.sizeBytes).toBe(contents.byteLength);
    expect(metadata.sha256).toBe(createHash('sha256').update(contents).digest('hex').toUpperCase());
  });

  it('rejects a selected path that is not a regular file', async () => {
    await expect(inspectOsmPbf(join(tmpdir(), 'tap-osm-file-that-does-not-exist.pbf'))).rejects.toThrow('OSM PBF 파일을 찾을 수 없습니다');
  });
});
