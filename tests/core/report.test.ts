import { describe, expect, it } from 'vitest';
import { buildHourlySheetRows, buildHourlyTableRows, buildSummary, buildTableRows, formatPeople } from '../../src/core/report';
import { analyzeHourlyRecords, analyzeRecords } from '../../src/core/analysis';

describe('report model', () => {
  it('formats the table and summary values for Korean reports', () => {
    const result = analyzeRecords([{ serviceDate: '2024-01-01', boardingCount: 62000 }], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(buildTableRows(result)[0].values[0]).toBe('62.0');
    expect(buildTableRows(result)[0].label).toBe('이용인원(천 명/일)');
    expect(buildTableRows(result, '통행량')[0].label).toBe('통행량(건/일)');
    expect(formatPeople(result.overallAverage)).toBe('8,857');
    expect(buildSummary(result)).toBe('선택 기간 일평균 승차인원 약 8,857명');
  });

  it('formats weekday/weekend hourly report rows and spreadsheet data', () => {
    const result = analyzeHourlyRecords([
      { serviceDate: '2024-01-01', boardingCount: 62000, boardingTime: '07:00:00' },
      { serviceDate: '2024-01-06', boardingCount: 30000, boardingTime: '08:00:00' }
    ], { filter: { from: '2024-01-01', to: '2024-01-06' }, denominator: 'observed' });
    const rows = buildHourlyTableRows(result);
    const sheet = buildHourlySheetRows(result, '승차인원');

    expect(rows).toHaveLength(4);
    expect(rows[0].label).toBe('주중기준 승차인원(천 명/일)');
    expect(rows[0].values[7]).toBe('62.0');
    expect(rows[2].values[8]).toBe('30.0');
    expect(sheet[0]).toEqual(['구분', ...Array.from({ length: 24 }, (_, hour) => `${hour}시`)]);
    expect(sheet).toHaveLength(5);
  });
});
