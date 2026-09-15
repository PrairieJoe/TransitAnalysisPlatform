import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeHourlyProjectDatabase, analyzeProjectDatabase, analyzeStationProjectDatabase, writeProjectDatabase } from '../../src/main/duckdb';

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

  it('persists boarding hours and returns hourly weekday/weekend aggregates', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-hourly-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '07:00:00' },
      { serviceDate: '2024-01-06', boardingCount: 5, boardingTime: '07:30:00' }
    ]);

    const result = await analyzeHourlyProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-06' }, denominator: 'observed' });
    expect(result.metrics[7].weekdayAverage).toBe(10);
    expect(result.metrics[7].weekendAverage).toBe(5);
  });

  it('persists station IDs and returns station demand aggregates', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-station-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-01-01', boardingCount: 100, stationId: 'A', route: 'A' },
      { serviceDate: '2024-01-01', boardingCount: 50, stationId: 'B', route: 'A' },
      { serviceDate: '2024-01-02', boardingCount: 200, stationId: 'A', route: 'A' },
      { serviceDate: '2024-01-02', boardingCount: 10, route: 'A' }
    ]);

    const result = await analyzeStationProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'observed' });
    expect(result.totalBoardings).toBe(350);
    expect(result.metrics).toEqual([
      { stationId: 'A', totalBoardings: 300, dailyAverage: 150, rank: 1 },
      { stationId: 'B', totalBoardings: 50, dailyAverage: 25, rank: 2 }
    ]);
    expect(result.excludedRows).toBe(1);
  });

  it('keeps legacy databases usable and upgrades them for hourly analysis', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-legacy-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    const instance = await DuckDBInstance.create(dbPath, { threads: '4' });
    const connection = await instance.connect();
    await connection.run('CREATE TABLE records (service_date VARCHAR, boarding_count DOUBLE, route VARCHAR, station VARCHAR, region VARCHAR)');
    await connection.run("INSERT INTO records VALUES ('2024-01-01', 10, 'A', NULL, NULL), ('2024-01-01', 5, 'A', NULL, NULL)");
    connection.closeSync();
    instance.closeSync();

    const weekdayResult = await analyzeProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-01', route: 'A' }, denominator: 'observed' });
    expect(weekdayResult.metrics[0].average).toBe(15);
    const hourlyResult = await analyzeHourlyProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-01', route: 'A' }, denominator: 'observed' });
    expect(hourlyResult.excludedRows).toBe(2);
    expect(hourlyResult.warnings.join(' ')).toContain('시간');
    const stationResult = await analyzeStationProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-01', route: 'A' }, denominator: 'observed' });
    expect(stationResult.metrics).toEqual([]);
    expect(stationResult.excludedRows).toBe(2);
  });
});
