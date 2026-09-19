import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
      ...metadata,
      name: 'renamed',
      analysisMode: 'od',
      recordCount: 1
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

