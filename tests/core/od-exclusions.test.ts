import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeODRecords } from '../../src/core/analysis';
import { analyzeODProjectDatabase, closeProjectDatabase, writeProjectDatabase } from '../../src/main/duckdb';
import { DATA_QUALITY_ERROR, type AnalysisConfig, type NormalizedRecord } from '../../src/shared/types';

it('separates missing IDs from sequence errors without double counting in JS and DuckDB', async () => {
  const config: AnalysisConfig = { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' };
  const base = { serviceDate: '2024-01-01', boardingCount: 5, stationId: 'A' };
  const records: NormalizedRecord[] = [
    { ...base, destinationStationId: 'B' },
    { ...base, destinationStationId: 'B', qualityErrors: [DATA_QUALITY_ERROR.stopSequenceInvalid] },
    { ...base, qualityErrors: [DATA_QUALITY_ERROR.stopSequenceInvalid] }
  ];
  const folder = await mkdtemp(join(tmpdir(), 'od-exclusions-'));
  const db = join(folder, 'records.duckdb');
  try {
    await writeProjectDatabase(db, records);
    for (const result of [analyzeODRecords(records, config), await analyzeODProjectDatabase(db, config)]) {
      expect(result.excludedRows).toBe(2);
      expect(result.totalBoardings).toBe(5);
      expect(result.warnings).toContain('1개 행의 승차 또는 하차 정류장 ID가 없어 OD 분석에서 제외되었습니다.');
      expect(result.warnings).toContain('1개 행의 경유정류장 순번이 잘못되어 OD 분석에서 제외되었습니다.');
    }
  } finally {
    await closeProjectDatabase(db);
    await rm(folder, { recursive: true, force: true });
  }
});

