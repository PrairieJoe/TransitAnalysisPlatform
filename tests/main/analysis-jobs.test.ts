import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnalysisJobHandlers } from '../../src/main/analysis-jobs';
import { createJobManager, JobCancelledError } from '../../src/main/job-manager';
import { createProjectStore } from '../../src/main/project-store';
import {
  analyzeHourlyProjectDatabase,
  analyzeODProjectDatabase,
  analyzeProjectDatabase,
  closeAllProjectDatabases,
  closeProjectDatabase,
  writeProjectDatabase
} from '../../src/main/duckdb';
import type { JobProgress } from '../../src/shared/job-types';
import type { AnalysisConfig, ProjectManifest } from '../../src/shared/types';

const roots: string[] = [];

afterEach(async () => {
  await closeAllProjectDatabases();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'analysis-jobs-'));
  roots.push(root);
  const project: ProjectManifest = {
    schemaVersion: 10,
    id: 'sample',
    name: 'sample',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    sourceFiles: ['sample.csv'],
    records: [
      { serviceDate: '2024-01-01', boardingCount: 10, boardingHour: 7, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-02', boardingCount: 20, boardingHour: 8, stationId: 'A', destinationStationId: 'C' }
    ],
    mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' },
    parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 }
  };
  const store = createProjectStore(root, writeProjectDatabase);
  await store.save(project);
  return { root, project, store, dbPath: join(root, project.id, 'records.duckdb') };
}

describe('analysis job handlers', () => {
  it('matches direct DuckDB results and reconstructs a missing project database', async () => {
    const { root, project, store, dbPath } = await fixture();
    const config: AnalysisConfig = {
      filter: { from: '2024-01-01', to: '2024-01-02' },
      denominator: 'observed'
    };
    const expectedWeekday = await analyzeProjectDatabase(dbPath, config);
    const expectedHourly = await analyzeHourlyProjectDatabase(dbPath, config);
    const expectedOD = await analyzeODProjectDatabase(dbPath, config);
    await closeProjectDatabase(dbPath);
    await rm(dbPath);

    const events: JobProgress[] = [];
    const jobs = createJobManager({ emit: (event) => events.push(event) });
    const handlers = createAnalysisJobHandlers({ jobs, projectRoot: root, store });
    const base = { projectId: project.id, projectRevision: project.updatedAt, config };

    expect(await handlers.weekday({ ...base, jobId: 'weekday' })).toEqual(expectedWeekday);
    expect(await handlers.hourly({ ...base, jobId: 'hourly' })).toEqual(expectedHourly);
    expect(await handlers.od({ ...base, jobId: 'od' })).toEqual(expectedOD);
    expect(events.some(({ phase }) => phase === 'open-database')).toBe(true);
    expect(events.some(({ phase }) => phase === 'analyze')).toBe(true);
  });

  it('observes cancellation before analysis begins', async () => {
    const { root, project, store } = await fixture();
    const jobs = createJobManager({ emit: () => {} });
    const handlers = createAnalysisJobHandlers({ jobs, projectRoot: root, store });
    const running = handlers.weekday({
      jobId: 'cancel-analysis',
      projectId: project.id,
      projectRevision: project.updatedAt,
      config: { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'observed' }
    });

    expect(jobs.cancel('cancel-analysis').accepted).toBe(true);
    await expect(running).rejects.toBeInstanceOf(JobCancelledError);
  });
});
