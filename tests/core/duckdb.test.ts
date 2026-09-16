import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeHourlyProjectDatabase, analyzeODProjectDatabase, analyzeProjectDatabase, analyzeRouteProjectDatabase, analyzeStationProjectDatabase, readTripChainRecords, writeProjectDatabase } from '../../src/main/duckdb';

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
      { serviceDate: '2024-01-01', boardingCount: 10, route: 'A', virtualCardId: 'VC-1', transactionId: '0', transferCount: 2 },
      { serviceDate: '2024-01-01', boardingCount: 5, route: 'B' },
      { serviceDate: '2024-01-02', boardingCount: 20, route: 'A' },
      { serviceDate: '2024-01-03', boardingCount: 10, route: 'A', virtualCardId: 'VC-2', transactionId: '0', transferCount: 2 }
    ]);
    const result = await analyzeProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-02', route: 'A' }, denominator: 'observed' });
    expect(result.totalBoardings).toBe(30);
    expect(result.metrics[0].average).toBe(10);
    expect(result.metrics[1].average).toBe(20);

    const tripChainRecords = await readTripChainRecords(dbPath);
    expect(tripChainRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceDate: '2024-01-01', route: 'A', virtualCardId: 'VC-1', transactionId: '0', transferCount: 2 }),
      expect.objectContaining({ serviceDate: '2024-01-03', route: 'A', virtualCardId: 'VC-2', transactionId: '0', transferCount: 2 })
    ]));
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

  it('persists OD endpoints and returns all ranked flows', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-od-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-01-01', boardingCount: 100, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-01', boardingCount: 40, stationId: 'B', destinationStationId: 'A' },
      { serviceDate: '2024-01-02', boardingCount: 50, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-02', boardingCount: 5, stationId: 'A' }
    ]);

    const result = await analyzeODProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'observed' });
    expect(result.metrics).toEqual([
      { originStationId: 'A', destinationStationId: 'B', totalBoardings: 150, dailyAverage: 75, rank: 1 },
      { originStationId: 'B', destinationStationId: 'A', totalBoardings: 40, dailyAverage: 20, rank: 2 }
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
    const odResult = await analyzeODProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-01', route: 'A' }, denominator: 'observed' });
    expect(odResult.metrics).toEqual([]);
    expect(odResult.excludedRows).toBe(2);
  });

  it('pre-aggregates route OD/hour rows and builds directional onboard profiles', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-route-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', vehicleId: 'V1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-16', boardingCount: 5, route: 'R1', vehicleId: 'V2', stationId: 'C', destinationStationId: 'A', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 99, route: 'R1', vehicleId: 'V1', stationId: 'A', destinationStationId: 'B', boardingHour: 8 }
    ]);
    const result = await analyzeRouteProjectDatabase(dbPath, { filter: { from: '2024-04-15', to: '2024-04-16' }, denominator: 'observed', hour: 7 }, [
      { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 0, stationId: 'A', stationName: '정류장A', latitude: 34.75, longitude: 127.73 },
      { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 1, stationId: 'B', stationName: '정류장B', latitude: 34.76, longitude: 127.74 },
      { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 2, stationId: 'C', stationName: '정류장C', latitude: 34.77, longitude: 127.75 }
    ], [{ routeId: 'R1', vehicleCapacity: 10, tripsByHour: { '7': 1 } }]);
    expect(result.selectedDays).toBe(1);
    expect(result.metrics.map((metric) => [metric.direction, metric.fromStationId, metric.toStationId, metric.peakOnboardPassengers, metric.congestionPercent])).toEqual([
      ['forward', 'A', 'B', 10, 100],
      ['forward', 'B', 'C', 10, 100]
    ]);
  });

  it('persists sequence-error flags and excludes those rows from OD and route analyses', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-quality-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    await writeProjectDatabase(dbPath, [
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', stationId: 'A', destinationStationId: 'B', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 7, route: 'R1', stationId: 'A', destinationStationId: 'A', boardingHour: 7, qualityErrors: ['경유정류장순번오류'] }
    ]);
    const filter = { from: '2024-04-15', to: '2024-04-15', route: 'R1' };
    const odResult = await analyzeODProjectDatabase(dbPath, { filter, denominator: 'observed' });
    const routeResult = await analyzeRouteProjectDatabase(dbPath, { filter, denominator: 'observed', hour: 7 }, [
      { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 1, stationId: 'A', stationName: '정류장A', latitude: 34.75, longitude: 127.73 },
      { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 2, stationId: 'B', stationName: '정류장B', latitude: 34.76, longitude: 127.74 }
    ], [{ routeId: 'R1', vehicleCapacity: 10, tripsByHour: { '7': 1 } }]);

    expect(odResult.totalBoardings).toBe(10);
    expect(odResult.excludedRows).toBe(1);
    expect(routeResult.totalBoardings).toBe(10);
    expect(routeResult.excludedRows).toBe(1);
  });

  it('upgrades legacy record tables without treating their null quality flag as an error', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'transit-analysis-legacy-quality-'));
    tempFolders.push(folder);
    const dbPath = join(folder, 'records.duckdb');
    const instance = await DuckDBInstance.create(dbPath);
    const connection = await instance.connect();
    await connection.run('CREATE TABLE records (service_date VARCHAR, boarding_count DOUBLE, route VARCHAR, station VARCHAR, region VARCHAR, vehicle_id VARCHAR, station_id VARCHAR, destination_station_id VARCHAR, boarding_hour INTEGER)');
    await connection.run("INSERT INTO records VALUES ('2024-01-01', 5, 'R1', NULL, NULL, NULL, 'A', 'B', 7)");
    connection.closeSync();
    instance.closeSync();

    const result = await analyzeODProjectDatabase(dbPath, { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    const legacyTripChainRecords = await readTripChainRecords(dbPath);

    expect(result.totalBoardings).toBe(5);
    expect(result.excludedRows).toBe(0);
    expect(legacyTripChainRecords[0]).toMatchObject({ serviceDate: '2024-01-01', boardingCount: 5, stationId: 'A', destinationStationId: 'B' });
    expect(legacyTripChainRecords[0].virtualCardId).toBeUndefined();
  });
});
