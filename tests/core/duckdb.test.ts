import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeProjectDatabase, writeProjectDatabase } from '../../src/main/duckdb';

const tempFolders: string[] = [];

afterEach(async () => {
  await Promise.all(tempFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('DuckDB project storage', () => {
  it('persists normalized records and returns filtered daily aggregates', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-01-01', boardingCount: 10, route: 'A' },
      { serviceDate: '2024-01-01', boardingCount: 5, route: 'B' },
      { serviceDate: '2024-01-02', boardingCount: 20, route: 'A' }
    ]);
    const result = await analyzeProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-02', route: 'A' }, denominator: 'observed' });
    expect(result.totalBoardings).toBe(30);
    expect(result.metrics[0].average).toBe(10);
    expect(result.metrics[1].average).toBe(20);
  });
});
