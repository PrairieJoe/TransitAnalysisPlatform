import { describe, expect, it } from 'vitest';
import { buildSummary, buildTableRows, formatPeople } from '../../src/core/report';
import { analyzeRecords } from '../../src/core/analysis';

describe('report model', () => {
  it('formats the table and summary values for Korean reports', () => {
    const result = analyzeRecords([{ serviceDate: '2024-01-01', boardingCount: 62000 }], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(buildTableRows(result)[0].values[0]).toBe('62.0');
    expect(buildTableRows(result)[0].label).toBe('이용인원(천 명/일)');
    expect(buildTableRows(result, '통행량')[0].label).toBe('통행량(건/일)');
    expect(formatPeople(result.overallAverage)).toBe('8,857');
    expect(buildSummary(result)).toBe('선택 기간 일평균 승차인원 약 8,857명');
  });
});
