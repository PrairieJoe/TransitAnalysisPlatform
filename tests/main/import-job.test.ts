import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImportJobHandlers } from '../../src/main/import-job';
import { closeAllProjectDatabases, writeProjectDatabase } from '../../src/main/duckdb';
import { createJobManager, JobCancelledError } from '../../src/main/job-manager';
import { createProjectStore } from '../../src/main/project-store';
import type { ColumnMapping } from '../../src/shared/types';

const roots: string[] = [];
const mapping: ColumnMapping = {
  dateColumn: '날짜',
  timeColumn: '시간',
  boardingCountColumn: '승차',
  virtualCardIdColumn: '가상카드',
  routeColumn: '노선',
  stationIdColumn: '승차ID',
  destinationStationIdColumn: '하차ID',
  transactionIdColumn: '거래ID',
  transferCountColumn: '환승',
  rowSemantics: 'count-column'
};
const csv = [
  '날짜,시간,승차,가상카드,노선,승차ID,하차ID,거래ID,환승',
  '2024-01-01,08:00:00,3,VC-1,R1,A,B,T-1,0'
].join('\n');

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
  const root = await mkdtemp(join(tmpdir(), 'import-job-'));
  roots.push(root);
  const first = join(root, 'first.csv');
  const second = join(root, 'second.csv');
  await writeFile(first, csv, 'utf8');
  await writeFile(second, csv, 'utf8');
  const store = createProjectStore(join(root, 'projects'), writeProjectDatabase);
  const jobs = createJobManager({ emit: () => {} });
  return { root, first, second, store, jobs };
}

function prepareRequest(first: string, second: string) {
  return {
    jobId: 'prepare',
    files: [
      { path: first, name: 'first.csv', options: { encoding: 'utf-8' as const, delimiter: ',' as const, headerRow: 0 } },
      { path: second, name: 'second.csv', options: { encoding: 'utf-8' as const, delimiter: ',' as const, headerRow: 0 } }
    ],
    mapping,
    analysisConfig: { filter: { from: '', to: '' }, denominator: 'observed' as const }
  };
}

function manifestMetadata(id: string) {
  return {
    schemaVersion: 10 as const,
    id,
    name: id,
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z'
  };
}

describe('import preparation and staging', () => {
  it('returns bounded metadata and commits a token only once', async () => {
    const { first, second, store, jobs } = await fixture();
    const handlers = createImportJobHandlers({ jobs, store });
    const prepared = await handlers.prepare(prepareRequest(first, second));

    expect(prepared).toMatchObject({
      sourceFiles: ['first.csv', 'second.csv'],
      recordCount: 2,
      duplicateCount: 1,
      excludedRows: 0,
      from: '2024-01-01',
      to: '2024-01-01'
    });
    expect(prepared).not.toHaveProperty('records');

    const committed = await handlers.commit({
      jobId: 'commit',
      stagingToken: prepared.stagingToken,
      keepDuplicates: false,
      manifestMetadata: manifestMetadata('without-duplicates')
    });
    expect(committed.records).toHaveLength(1);
    expect(committed.lastResult?.totalBoardings).toBe(3);
    expect(await store.read(committed.id)).toEqual(committed);
    await expect(handlers.commit({
      jobId: 'reuse',
      stagingToken: prepared.stagingToken,
      keepDuplicates: true,
      manifestMetadata: manifestMetadata('reuse')
    })).rejects.toThrow('토큰');
  });

  it('can keep duplicates when the user explicitly chooses to', async () => {
    const { first, second, store, jobs } = await fixture();
    const handlers = createImportJobHandlers({ jobs, store });
    const prepared = await handlers.prepare(prepareRequest(first, second));
    const committed = await handlers.commit({
      jobId: 'commit-all',
      stagingToken: prepared.stagingToken,
      keepDuplicates: true,
      manifestMetadata: manifestMetadata('with-duplicates')
    });

    expect(committed.records).toHaveLength(2);
    expect(committed.lastResult?.totalBoardings).toBe(6);
  });

  it('cancels between files without creating a staging result', async () => {
    const { first, second, store, jobs } = await fixture();
    const secondRead = deferred();
    const release = deferred();
    let reads = 0;
    const handlers = createImportJobHandlers({
      jobs,
      store,
      readBytes: async (path) => {
        reads += 1;
        if (reads === 2) {
          secondRead.resolve();
          await release.promise;
        }
        return readFile(path);
      }
    });
    const running = handlers.prepare(prepareRequest(first, second));
    await secondRead.promise;
    expect(jobs.cancel('prepare').accepted).toBe(true);
    release.resolve();

    await expect(running).rejects.toBeInstanceOf(JobCancelledError);
  });
});
