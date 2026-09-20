import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore, type ProjectMetadata } from '../../src/main/project-store';
import { createScenarioDefinition } from '../../src/core/scenario-contract';
import type { ProjectManifest, ScenarioOperationPlan } from '../../src/shared/types';

const makeOperation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: 10, vehicleCount: 4, dwellSeconds: 20,
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'baseline-stop-distance-1', speedsKph: { unknown: 15 },
    intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30
  },
  ...overrides
});

const makeScenarioDefinition = () => createScenarioDefinition({
  scenarioId: 'storage-scenario', label: '저장 경계 시나리오',
  routeChanges: [
    { routeId: 'R-A', baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'], beforeOperation: makeOperation(), afterOperation: makeOperation({ headwayMinutes: 15 }) },
    { routeId: 'R-B', baseStopIds: ['B-1', 'B-2'], scenarioStopIds: ['B-1', 'B-2', 'B-3'], beforeOperation: makeOperation({ vehicleCount: 2 }), afterOperation: makeOperation({ vehicleCount: 5 }) }
  ],
  source: { assumptions: [], warnings: [], modelVersions: ['baseline-stop-distance-1'] },
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z'
});

const makeProject = (): ProjectManifest => ({
  id: 'scenario-project', schemaVersion: 10, name: 'scenario-project',
  createdAt: '', updatedAt: '', sourceFiles: [], records: [],
  mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' },
  parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 }
});

it('persists settings across restart without touching original files and resets them on full save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-store-'));
  const writeDatabase = vi.fn(async () => {});
  const project: ProjectManifest = { id: 'sample', schemaVersion: 10, name: 'sample', createdAt: '', updatedAt: '', sourceFiles: [], records: [{ serviceDate: '2024-01-01', boardingCount: 1 }], mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' }, parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 } };
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const file = join(root, project.id, 'project.json');
    const before = await readFile(file, 'utf8');
    const modified = (await stat(file)).mtimeMs;
    const { records: _records, ...metadata } = project;
    await store.saveMetadata({ ...metadata, name: 'renamed', analysisMode: 'od' });
    expect(writeDatabase).toHaveBeenCalledTimes(1);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await stat(file)).mtimeMs).toBe(modified);
    const reopened = await createProjectStore(root, writeDatabase).read(project.id);
    expect(reopened).toEqual({ ...project, name: 'renamed', analysisMode: 'od' });
    const summary = await store.readSummary(project.id);
    expect(summary).toEqual({
      id: project.id,
      schemaVersion: project.schemaVersion,
      name: 'renamed',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sourceFiles: project.sourceFiles,
      analysisMode: 'od',
      recordCount: 1,
      hasRouteMaster: false
    });
    expect(summary).not.toHaveProperty('records');
    await expect(store.readSummary('../outside')).rejects.toThrow();
    await store.save({ ...project, records: [] });
    expect(await store.read(project.id)).toEqual({ ...project, records: [] });
    await expect(store.saveMetadata({ ...metadata, id: '../outside' })).rejects.toThrow();
    await expect(store.saveMetadata({ ...metadata, id: 'missing' })).rejects.toThrow();
    await expect(store.saveMetadata(project)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('reads bounded summaries from a metadata artifact without parsing the full project records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-summary-'));
  const writeDatabase = vi.fn(async () => {});
  const project: ProjectManifest = { id: 'sample', schemaVersion: 10, name: 'sample', createdAt: '', updatedAt: '', sourceFiles: [], records: [{ serviceDate: '2024-01-01', boardingCount: 1 }], mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' }, parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 }, routeServiceConfigs: [{ routeId: 'R1', vehicleCapacity: 10, tripsByHour: { '7': 1 } }] };
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const summary = {
      id: project.id,
      schemaVersion: project.schemaVersion,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sourceFiles: project.sourceFiles,
      recordCount: project.records.length,
      hasRouteMaster: false
    };
    await writeFile(join(root, project.id, 'project-summary.json'), JSON.stringify(summary), 'utf8');
    await writeFile(join(root, project.id, 'project.json'), '{"records":', 'utf8');

    await expect(store.readSummary(project.id)).resolves.toEqual(summary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('reads full project metadata for main-process jobs without loading records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-metadata-'));
  const writeDatabase = vi.fn(async () => {});
  const project: ProjectManifest = { id: 'sample', schemaVersion: 10, name: 'sample', createdAt: '', updatedAt: '', sourceFiles: [], records: [{ serviceDate: '2024-01-01', boardingCount: 1 }], mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' }, parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 }, routeStopMaster: [{ routeId: 'R1', routeName: '1번', transportMode: 'bus', stationSequence: 1, stationId: 'S1', stationName: '정류장', latitude: 34, longitude: 127 }] };
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const { records: _records, ...metadata } = project;
    await store.saveMetadata(metadata);
    await writeFile(join(root, project.id, 'project.json'), '{"records":', 'utf8');

    await expect(store.readMetadata(project.id)).resolves.toEqual(metadata);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('persists optional multi-route scenario definitions through metadata saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-scenario-'));
  const writeDatabase = vi.fn(async () => {});
  const project = makeProject();
  const scenarioDefinition = makeScenarioDefinition();
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const { records: _records, ...metadata } = project;
    await store.saveMetadata({ ...metadata, scenarioDefinitions: [scenarioDefinition] });

    await expect(createProjectStore(root, writeDatabase).read(project.id)).resolves.toEqual({
      ...project,
      scenarioDefinitions: [scenarioDefinition]
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('round-trips multiple scenario definitions with distinct route changes through metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-scenarios-'));
  const writeDatabase = vi.fn(async () => {});
  const project = makeProject();
  const scenarioA = makeScenarioDefinition();
  const scenarioB = { ...makeScenarioDefinition(), scenarioId: 'scenario-b', label: '두 번째 시나리오', routeChanges: [makeScenarioDefinition().routeChanges[1]] };
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const { records: _records, ...metadata } = project;
    await store.saveMetadata({ ...metadata, scenarioDefinitions: [scenarioA, scenarioB] });

    await expect(createProjectStore(root, writeDatabase).read(project.id)).resolves.toEqual({
      ...project,
      scenarioDefinitions: [scenarioA, scenarioB]
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('blocks invalid scenario definitions before any storage write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-scenario-invalid-'));
  const writeDatabase = vi.fn(async () => {});
  const project = makeProject();
  const invalid = { ...makeScenarioDefinition(), routeChanges: [] };
  try {
    const store = createProjectStore(root, writeDatabase);
    await expect(store.save({ ...project, scenarioDefinitions: [invalid] })).rejects.toThrow('routeChanges');
    expect(writeDatabase).not.toHaveBeenCalled();

    await store.save(project);
    const { records: _records, ...metadata } = project;
    await expect(store.saveMetadata({ ...metadata, scenarioDefinitions: [invalid] } as ProjectMetadata)).rejects.toThrow('routeChanges');
    expect(await store.read(project.id)).toEqual(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});

