import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAlightingInferenceJob } from '../../src/main/alighting-job';
import { closeAllProjectDatabases, writeProjectDatabase } from '../../src/main/duckdb';
import { createJobManager, JobCancelledError } from '../../src/main/job-manager';
import { createProjectStore } from '../../src/main/project-store';
import type { AlightingInferenceConfig, ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

const roots: string[] = [];
const config: AlightingInferenceConfig = {
  primaryDistanceMeters: 500,
  fallbackDistanceMeters: 1000,
  maxTransferMinutes: 30,
  serviceDayBoundaryHour: 4
};

afterEach(async () => {
  await closeAllProjectDatabases();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'alighting-job-'));
  roots.push(root);
  const routeStopMaster: RouteStopMasterRecord[] = ['A', 'B', 'C'].map((stationId, stationSequence) => ({
    routeId: 'R1',
    routeName: '1번',
    transportMode: 'B',
    stationSequence,
    stationId,
    stationName: stationId,
    latitude: 37,
    longitude: 127 + stationSequence * 0.003
  }));
  const project: ProjectManifest = {
    schemaVersion: 10,
    id: 'sample',
    name: 'sample',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    sourceFiles: ['sample.csv'],
    records: [
      { serviceDate: '2024-01-01', boardingCount: 1, boardingTime: '08:00:00', virtualCardId: 'CARD', route: 'R1', stationId: 'A' },
      { serviceDate: '2024-01-01', boardingCount: 1, boardingTime: '08:15:00', virtualCardId: 'CARD', route: 'R1', stationId: 'B' }
    ],
    mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' },
    parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 },
    routeStopMaster,
    analysisConfig: { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' },
    routeAnalysisConfig: { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed', hour: 'all' }
  };
  const store = createProjectStore(root, writeProjectDatabase);
  await store.save(project);
  return { project, store };
}

describe('alighting inference job', () => {
  it('persists inferred records and summary that can be reopened', async () => {
    const { project, store } = await fixture();
    const jobs = createJobManager({ emit: () => {} });
    const saved = await runAlightingInferenceJob(
      { jobs, store },
      { jobId: 'infer', projectId: project.id, projectRevision: project.updatedAt, config }
    );

    expect(saved.records[0].inferredDestinationStationId).toBe('B');
    expect(saved.alightingSummary?.inferredHigh).toBe(1);
    expect(await store.read(project.id)).toEqual(saved);
  });

  it('does not save when cancellation arrives after inference but before commit', async () => {
    const { project, store } = await fixture();
    const before = await store.read(project.id);
    const jobs = createJobManager({ emit: () => {} });
    const beforeCommit = deferred();
    const release = deferred();
    let yields = 0;
    const running = runAlightingInferenceJob(
      {
        jobs,
        store,
        yieldControl: async () => {
          yields += 1;
          if (yields === 2) {
            beforeCommit.resolve();
            await release.promise;
          }
        }
      },
      { jobId: 'cancel-infer', projectId: project.id, projectRevision: project.updatedAt, config }
    );
    await beforeCommit.promise;
    expect(jobs.cancel('cancel-infer').accepted).toBe(true);
    release.resolve();

    await expect(running).rejects.toBeInstanceOf(JobCancelledError);
    expect(await store.read(project.id)).toEqual(before);
  });

  it('rejects invalid configuration without changing the project', async () => {
    const { project, store } = await fixture();
    const before = await store.read(project.id);
    const jobs = createJobManager({ emit: () => {} });

    await expect(runAlightingInferenceJob(
      { jobs, store },
      { jobId: 'invalid', projectId: project.id, projectRevision: project.updatedAt, config: { ...config, fallbackDistanceMeters: 100 } }
    )).rejects.toThrow('반경');
    expect(await store.read(project.id)).toEqual(before);
  });

  it('does not overwrite a project whose revision changes before commit', async () => {
    const { project, store } = await fixture();
    const jobs = createJobManager({ emit: () => {} });
    let yields = 0;
    const newer = { ...project, name: 'newer', updatedAt: '2026-09-19T01:00:00.000Z' };

    await expect(runAlightingInferenceJob(
      {
        jobs,
        store,
        yieldControl: async () => {
          yields += 1;
          if (yields === 2) await store.save(newer);
        }
      },
      { jobId: 'stale', projectId: project.id, projectRevision: project.updatedAt, config }
    )).rejects.toThrow('변경');

    expect(await store.read(project.id)).toEqual(newer);
  });
});
