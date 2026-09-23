import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStationCatalog } from '../../src/core/station-catalog';
import { closeAllProjectDatabases, readStationCatalog, writeProjectDatabase } from '../../src/main/duckdb';
import type { RouteStopMasterRecord, StationMasterRecord } from '../../src/shared/types';

const station: StationMasterRecord = { stationId: 'S1', stationName: '시청', latitude: 37, longitude: 127 };
const stops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'B', stationSequence: 1, stationId: 'S1', stationName: '시청', latitude: 37, longitude: 127 },
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'B', stationSequence: 2, stationId: 'S2', stationName: '시장', latitude: 37.01, longitude: 127.01 }
];

it('writes and reads the canonical station catalog independently from records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'station-catalog-db-'));
  const dbPath = join(root, 'records.duckdb');
  const catalog = buildStationCatalog([station], stops);
  try {
    await writeProjectDatabase(dbPath, [{ serviceDate: '2026-01-01', boardingCount: 1 }], catalog);
    await writeProjectDatabase(dbPath, [{ serviceDate: '2026-01-01', boardingCount: 1 }], catalog);

    await expect(readStationCatalog(dbPath)).resolves.toEqual(catalog);
  } finally {
    await closeAllProjectDatabases();
    await rm(root, { recursive: true, force: true });
  }
});
