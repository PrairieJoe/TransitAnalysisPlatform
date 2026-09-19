import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStore } from '../../src/main/project-store';
import type { ProjectManifest } from '../../src/shared/types';

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

