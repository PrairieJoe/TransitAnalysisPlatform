import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { analyzeDailyTotals, analyzeHourlyDailyTotals, analyzeODDailyTotals, analyzeStationDailyTotals } from '../core/analysis';
import { analyzeRouteDemandRows } from '../core/route-analysis';
import { DATA_QUALITY_ERROR, type AnalysisConfig, type AnalysisResult, type HourIndex, type HourlyAnalysisResult, type NormalizedRecord, type ODDemandResult, type RouteCongestionConfig, type RouteCongestionResult, type RouteDemandRow, type RouteServiceConfig, type RouteStopMasterRecord, type StationDemandResult } from '../shared/types';
import { hasDataQualityError } from '../core/data-quality';

const instances = new Map<string, DuckDBInstance>();

async function connectionFor(dbPath: string): Promise<DuckDBConnection> {
  let instance = instances.get(dbPath);
  if (!instance) {
    instance = await DuckDBInstance.create(dbPath, { threads: '4' });
    instances.set(dbPath, instance);
  }
  return instance.connect();
}

export async function writeProjectDatabase(dbPath: string, records: NormalizedRecord[]): Promise<void> {
  const connection = await connectionFor(dbPath);
  await connection.run('CREATE OR REPLACE TABLE records (service_date VARCHAR, boarding_count DOUBLE, route VARCHAR, station VARCHAR, region VARCHAR, vehicle_id VARCHAR, station_id VARCHAR, destination_station_id VARCHAR, boarding_hour INTEGER, sequence_error BOOLEAN, boarding_time VARCHAR, virtual_card_id VARCHAR, transaction_id VARCHAR, transfer_count INTEGER)');
  const appender = await connection.createAppender('records');
  try {
    for (const record of records) {
      appender.appendVarchar(record.serviceDate);
      appender.appendDouble(record.boardingCount);
      record.route ? appender.appendVarchar(record.route) : appender.appendNull();
      record.station ? appender.appendVarchar(record.station) : appender.appendNull();
      record.region ? appender.appendVarchar(record.region) : appender.appendNull();
      record.vehicleId ? appender.appendVarchar(record.vehicleId) : appender.appendNull();
      record.stationId ? appender.appendVarchar(record.stationId) : appender.appendNull();
      record.destinationStationId ? appender.appendVarchar(record.destinationStationId) : appender.appendNull();
      const hour = record.boardingHour ?? Number(record.boardingTime?.slice(0, 2));
      Number.isInteger(hour) && hour >= 0 && hour <= 23 ? appender.appendInteger(hour) : appender.appendNull();
      appender.appendBoolean(hasDataQualityError(record, DATA_QUALITY_ERROR.stopSequenceInvalid));
      record.boardingTime ? appender.appendVarchar(record.boardingTime) : appender.appendNull();
      record.virtualCardId ? appender.appendVarchar(record.virtualCardId) : appender.appendNull();
      record.transactionId ? appender.appendVarchar(record.transactionId) : appender.appendNull();
      Number.isInteger(record.transferCount) && (record.transferCount ?? -1) >= 0 ? appender.appendInteger(record.transferCount!) : appender.appendNull();
      appender.endRow();
    }
    appender.flushSync();
  } finally {
    appender.closeSync();
    connection.closeSync();
  }
}

async function ensureOptionalColumns(connection: DuckDBConnection): Promise<void> {
  const reader = await connection.runAndReadAll("PRAGMA table_info('records')");
  const columns = reader.getRowObjectsJS() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === 'boarding_hour')) await connection.run('ALTER TABLE records ADD COLUMN boarding_hour INTEGER');
  if (!columns.some((column) => column.name === 'station_id')) await connection.run('ALTER TABLE records ADD COLUMN station_id VARCHAR');
  if (!columns.some((column) => column.name === 'destination_station_id')) await connection.run('ALTER TABLE records ADD COLUMN destination_station_id VARCHAR');
  if (!columns.some((column) => column.name === 'vehicle_id')) await connection.run('ALTER TABLE records ADD COLUMN vehicle_id VARCHAR');
  if (!columns.some((column) => column.name === 'sequence_error')) await connection.run('ALTER TABLE records ADD COLUMN sequence_error BOOLEAN DEFAULT FALSE');
  if (!columns.some((column) => column.name === 'boarding_time')) await connection.run('ALTER TABLE records ADD COLUMN boarding_time VARCHAR');
  if (!columns.some((column) => column.name === 'virtual_card_id')) await connection.run('ALTER TABLE records ADD COLUMN virtual_card_id VARCHAR');
  if (!columns.some((column) => column.name === 'transaction_id')) await connection.run('ALTER TABLE records ADD COLUMN transaction_id VARCHAR');
  if (!columns.some((column) => column.name === 'transfer_count')) await connection.run('ALTER TABLE records ADD COLUMN transfer_count INTEGER');
}

/** Reads transaction identity and exact boarding time for downstream trip-chain analyses. */
export async function readTripChainRecords(dbPath: string): Promise<NormalizedRecord[]> {
  const connection = await connectionFor(dbPath);
  try {
    await ensureOptionalColumns(connection);
    const reader = await connection.runAndReadAll('SELECT service_date, boarding_count, boarding_time, virtual_card_id, route, station_id, destination_station_id, transaction_id, transfer_count FROM records ORDER BY service_date, boarding_time, virtual_card_id, transaction_id');
    return (reader.getRowObjectsJS() as Array<Record<string, unknown>>).map((row) => ({
      serviceDate: String(row.service_date ?? ''),
      boardingCount: Number(row.boarding_count ?? 0),
      boardingTime: row.boarding_time == null ? undefined : String(row.boarding_time),
      virtualCardId: row.virtual_card_id == null ? undefined : String(row.virtual_card_id),
      route: row.route == null ? undefined : String(row.route),
      stationId: row.station_id == null ? undefined : String(row.station_id),
      destinationStationId: row.destination_station_id == null ? undefined : String(row.destination_station_id),
      transactionId: row.transaction_id == null ? undefined : String(row.transaction_id),
      transferCount: row.transfer_count == null ? undefined : Number(row.transfer_count)
    }));
  } finally {
    connection.closeSync();
  }
}

function whereClause(config: AnalysisConfig): { sql: string; values: Record<string, string | number> } {
  const conditions = ['service_date BETWEEN $from AND $to'];
  const values: Record<string, string> = { from: config.filter.from, to: config.filter.to };
  if (config.filter.route) { conditions.push('route = $route'); values.route = config.filter.route; }
  if (config.filter.station) { conditions.push('station = $station'); values.station = config.filter.station; }
  if (config.filter.region) { conditions.push('region = $region'); values.region = config.filter.region; }
  return { sql: conditions.join(' AND '), values };
}

export async function analyzeRouteProjectDatabase(
  dbPath: string,
  config: RouteCongestionConfig,
  routeStops: RouteStopMasterRecord[],
  serviceConfigs: RouteServiceConfig[]
): Promise<RouteCongestionResult> {
  const connection = await connectionFor(dbPath);
  try {
    await ensureOptionalColumns(connection);
    const where = whereClause(config);
    const baseValues = { ...where.values };
    const validRouteDemand = "route IS NOT NULL AND route <> '' AND station_id IS NOT NULL AND station_id <> '' AND destination_station_id IS NOT NULL AND destination_station_id <> '' AND boarding_hour IS NOT NULL AND NOT COALESCE(sequence_error, FALSE)";
    const hourClause = config.hour === 'all' ? '' : ' AND boarding_hour = $analysis_hour';
    if (config.hour !== 'all') where.values.analysis_hour = config.hour;
    const reader = await connection.runAndReadAll(`SELECT service_date, route, vehicle_id, station_id, destination_station_id, boarding_hour, COUNT(*) AS row_count, SUM(boarding_count) AS total FROM records WHERE ${where.sql} AND ${validRouteDemand}${hourClause} GROUP BY service_date, route, vehicle_id, station_id, destination_station_id, boarding_hour ORDER BY service_date, route, vehicle_id, station_id, destination_station_id, boarding_hour`, where.values);
    const rows = reader.getRowObjectsJS() as Array<{ service_date: string; route: string; vehicle_id?: string | null; station_id: string; destination_station_id: string; boarding_hour: number; row_count: number; total: number }>;
    const excludedReader = await connection.runAndReadAll(`SELECT COUNT(*) AS total FROM records WHERE ${where.sql} AND NOT (${validRouteDemand})${hourClause}`, where.values);
    const excludedRows = Number((excludedReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    const missingHourReader = await connection.runAndReadAll(`SELECT COUNT(*) AS total FROM records WHERE ${where.sql} AND boarding_hour IS NULL`, baseValues);
    const missingHourRows = Number((missingHourReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    const demandRows: RouteDemandRow[] = rows.map((row) => ({ serviceDate: row.service_date, routeId: row.route, vehicleId: row.vehicle_id?.trim() || undefined, originStationId: row.station_id, destinationStationId: row.destination_station_id, hour: Number(row.boarding_hour) as HourIndex, total: Number(row.total), rowCount: Number(row.row_count) }));
    return analyzeRouteDemandRows(demandRows, routeStops, serviceConfigs, config, excludedRows, missingHourRows ? [`${missingHourRows}개 행에 승차 시간이 없어 시간대 분석에서 제외되었습니다.`] : []);
  } finally {
    connection.closeSync();
  }
}

export async function analyzeProjectDatabase(dbPath: string, config: AnalysisConfig): Promise<AnalysisResult> {
  const connection = await connectionFor(dbPath);
  try {
    const where = whereClause(config);
    const reader = await connection.runAndReadAll(`SELECT service_date, SUM(boarding_count) AS total FROM records WHERE ${where.sql} GROUP BY service_date ORDER BY service_date`, where.values);
    const rows = reader.getRowObjectsJS() as Array<{ service_date: string; total: number }>;
    const totalReader = await connection.runAndReadAll(`SELECT COALESCE(SUM(boarding_count), 0) AS total FROM records WHERE ${where.sql}`, where.values);
    const total = Number((totalReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    return analyzeDailyTotals(rows.map((row) => ({ serviceDate: row.service_date, total: Number(row.total) })), config, total);
  } finally {
    connection.closeSync();
  }
}

export async function analyzeHourlyProjectDatabase(dbPath: string, config: AnalysisConfig): Promise<HourlyAnalysisResult> {
  const connection = await connectionFor(dbPath);
  try {
    await ensureOptionalColumns(connection);
    const where = whereClause(config);
    const reader = await connection.runAndReadAll(`SELECT service_date, boarding_hour, SUM(boarding_count) AS total FROM records WHERE ${where.sql} AND boarding_hour IS NOT NULL GROUP BY service_date, boarding_hour ORDER BY service_date, boarding_hour`, where.values);
    const rows = reader.getRowObjectsJS() as Array<{ service_date: string; boarding_hour: number; total: number }>;
    const totalReader = await connection.runAndReadAll(`SELECT COALESCE(SUM(boarding_count), 0) AS total FROM records WHERE ${where.sql} AND boarding_hour IS NOT NULL`, where.values);
    const total = Number((totalReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    const excludedReader = await connection.runAndReadAll(`SELECT COUNT(*) AS total FROM records WHERE ${where.sql} AND boarding_hour IS NULL`, where.values);
    const excludedRows = Number((excludedReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    return analyzeHourlyDailyTotals(rows.map((row) => ({ serviceDate: row.service_date, hour: Number(row.boarding_hour) as HourIndex, total: Number(row.total) })), config, total, excludedRows);
  } finally {
    connection.closeSync();
  }
}

export async function analyzeStationProjectDatabase(dbPath: string, config: AnalysisConfig): Promise<StationDemandResult> {
  const connection = await connectionFor(dbPath);
  try {
    await ensureOptionalColumns(connection);
    const where = whereClause(config);
    const validStation = "station_id IS NOT NULL AND station_id <> ''";
    const reader = await connection.runAndReadAll(`SELECT service_date, station_id, SUM(boarding_count) AS total FROM records WHERE ${where.sql} AND ${validStation} GROUP BY service_date, station_id ORDER BY service_date, station_id`, where.values);
    const rows = reader.getRowObjectsJS() as Array<{ service_date: string; station_id: string; total: number }>;
    const totalReader = await connection.runAndReadAll(`SELECT COALESCE(SUM(boarding_count), 0) AS total FROM records WHERE ${where.sql} AND ${validStation}`, where.values);
    const total = Number((totalReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    const excludedReader = await connection.runAndReadAll(`SELECT COUNT(*) AS total FROM records WHERE ${where.sql} AND NOT (${validStation})`, where.values);
    const excludedRows = Number((excludedReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    return analyzeStationDailyTotals(rows.map((row) => ({ serviceDate: row.service_date, stationId: row.station_id, total: Number(row.total) })), config, total, excludedRows);
  } finally {
    connection.closeSync();
  }
}

export async function analyzeODProjectDatabase(dbPath: string, config: AnalysisConfig): Promise<ODDemandResult> {
  const connection = await connectionFor(dbPath);
  try {
    await ensureOptionalColumns(connection);
    const where = whereClause(config);
    const validOD = "station_id IS NOT NULL AND station_id <> '' AND destination_station_id IS NOT NULL AND destination_station_id <> '' AND NOT COALESCE(sequence_error, FALSE)";
    const reader = await connection.runAndReadAll(`SELECT service_date, station_id, destination_station_id, SUM(boarding_count) AS total FROM records WHERE ${where.sql} AND ${validOD} GROUP BY service_date, station_id, destination_station_id ORDER BY service_date, station_id, destination_station_id`, where.values);
    const rows = reader.getRowObjectsJS() as Array<{ service_date: string; station_id: string; destination_station_id: string; total: number }>;
    const totalReader = await connection.runAndReadAll(`SELECT COALESCE(SUM(boarding_count), 0) AS total FROM records WHERE ${where.sql} AND ${validOD}`, where.values);
    const total = Number((totalReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    const excludedReader = await connection.runAndReadAll(`SELECT COUNT(*) AS total FROM records WHERE ${where.sql} AND NOT (${validOD})`, where.values);
    const excludedRows = Number((excludedReader.getRowObjectsJS()[0] as { total: number })?.total ?? 0);
    return analyzeODDailyTotals(rows.map((row) => ({ serviceDate: row.service_date, originStationId: row.station_id, destinationStationId: row.destination_station_id, total: Number(row.total) })), config, total, excludedRows);
  } finally {
    connection.closeSync();
  }
}

export async function closeProjectDatabase(dbPath: string): Promise<void> {
  instances.delete(dbPath);
}
