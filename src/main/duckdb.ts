import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { analyzeDailyTotals } from '../core/analysis';
import type { AnalysisConfig, AnalysisResult, NormalizedRecord } from '../shared/types';

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
  await connection.run('CREATE OR REPLACE TABLE records (service_date VARCHAR, boarding_count DOUBLE, route VARCHAR, station VARCHAR, region VARCHAR)');
  const appender = await connection.createAppender('records');
  try {
    for (const record of records) {
      appender.appendVarchar(record.serviceDate);
      appender.appendDouble(record.boardingCount);
      record.route ? appender.appendVarchar(record.route) : appender.appendNull();
      record.station ? appender.appendVarchar(record.station) : appender.appendNull();
      record.region ? appender.appendVarchar(record.region) : appender.appendNull();
      appender.endRow();
    }
    appender.flushSync();
  } finally {
    appender.closeSync();
    connection.closeSync();
  }
}

function whereClause(config: AnalysisConfig): { sql: string; values: Record<string, string> } {
  const conditions = ['service_date BETWEEN $from AND $to'];
  const values: Record<string, string> = { from: config.filter.from, to: config.filter.to };
  if (config.filter.route) { conditions.push('route = $route'); values.route = config.filter.route; }
  if (config.filter.station) { conditions.push('station = $station'); values.station = config.filter.station; }
  if (config.filter.region) { conditions.push('region = $region'); values.region = config.filter.region; }
  return { sql: conditions.join(' AND '), values };
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

export async function closeProjectDatabase(dbPath: string): Promise<void> {
  instances.delete(dbPath);
}
