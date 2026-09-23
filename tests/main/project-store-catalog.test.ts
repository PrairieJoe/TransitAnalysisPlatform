import { expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProjectDatabase, readStationCatalog, closeAllProjectDatabases } from '../../src/main/duckdb';
import { createProjectStore } from '../../src/main/project-store';
import type { ProjectManifest, RouteStopMasterRecord, StationMasterRecord } from '../../src/shared/types';

const stationMaster: StationMasterRecord[] = [{ stationId: 'S1', stationName: '기준 시청', latitude: 37, longitude: 127 }];
const routeStopMaster: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'B', stationSequence: 1, stationId: 'S1', stationName: '노선 시청', latitude: 37, longitude: 127 },
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'B', stationSequence: 2, stationId: 'S2', stationName: '시장', latitude: 37.01, longitude: 127.01 }
];

function legacyProject(id: string): ProjectManifest {
  return {
    schemaVersion: 10, id, name: 'legacy', createdAt: '2026-01-01', updatedAt: '2026-01-01', sourceFiles: [], records: [{ serviceDate: '2026-01-01', boardingCount: 1 }],
    mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' }, parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 },
    stationMaster, routeStopMaster
  };
}

it('migrates a v10 project into v11 catalog storage and preserves legacy snapshots on reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-catalog-migration-'));
  const project = legacyProject('legacy-catalog');
  const projectDir = join(root, project.id);
  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify(project), 'utf8');
    await writeProjectDatabase(join(projectDir, 'records.duckdb'), project.records);
    const store = createProjectStore(root, writeProjectDatabase);

    const reopened = await store.read(project.id);
    expect(reopened.schemaVersion).toBe(11);
    expect(reopened.stationMaster).toEqual(stationMaster);
    expect(reopened.routeStopMaster).toEqual(routeStopMaster);
    expect(reopened.stationCatalog?.stations).toMatchObject([{ stationId: 'S1', stationName: '기준 시청' }, { stationId: 'S2' }]);
    expect(reopened.stationCatalog?.routeMemberships).toEqual(routeStopMaster);
    await expect(readStationCatalog(join(projectDir, 'records.duckdb'))).resolves.toEqual(reopened.stationCatalog);

    await expect(store.read(project.id)).resolves.toEqual(reopened);
  } finally {
    await closeAllProjectDatabases();
    await rm(root, { recursive: true, force: true });
  }
});

it('derives a catalog when a v10 project has only route-stop data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-catalog-route-only-'));
  const project = { ...legacyProject('route-only'), stationMaster: undefined };
  const projectDir = join(root, project.id);
  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify(project), 'utf8');
    await writeProjectDatabase(join(projectDir, 'records.duckdb'), project.records);

    const reopened = await createProjectStore(root, writeProjectDatabase).read(project.id);
    expect(reopened.schemaVersion).toBe(11);
    expect(reopened.stationMaster).toBeUndefined();
    expect(reopened.stationCatalog?.stations.map(({ stationId }) => stationId)).toEqual(['S1', 'S2']);
  } finally {
    await closeAllProjectDatabases();
    await rm(root, { recursive: true, force: true });
  }
});

it('does not replace v10 metadata when catalog migration write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-catalog-failure-'));
  const project = legacyProject('legacy-failure');
  const projectDir = join(root, project.id);
  try {
    await mkdir(projectDir, { recursive: true });
    const originalJson = JSON.stringify(project);
    await writeFile(join(projectDir, 'project.json'), originalJson, 'utf8');
    await writeProjectDatabase(join(projectDir, 'records.duckdb'), project.records);
    const failingStore = createProjectStore(root, async () => { throw new Error('catalog write failed'); });

    await expect(failingStore.read(project.id)).rejects.toThrow('catalog write failed');
    await expect(readFile(join(projectDir, 'project.json'), 'utf8')).resolves.toBe(originalJson);
  } finally {
    await closeAllProjectDatabases();
    await rm(root, { recursive: true, force: true });
  }
});
