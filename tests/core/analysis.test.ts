import { describe, expect, it } from 'vitest';
import { analyzeRecords } from '../../src/core/analysis';
import type { NormalizedRecord } from '../../src/shared/types';

const records: NormalizedRecord[] = [
  ['2024-01-01', 62000], ['2024-01-02', 60200], ['2024-01-03', 61430], ['2024-01-04', 60200], ['2024-01-05', 57800], ['2024-01-06', 49500], ['2024-01-07', 33900]
].map(([serviceDate, boardingCount]) => ({ serviceDate: String(serviceDate), boardingCount: Number(boardingCount), route: '전체', station: '전체', region: '여수시' }));

const config = { filter: { from: '2024-01-01', to: '2024-01-07' }, denominator: 'observed' as const };

describe('analyzeRecords', () => {
  it('reproduces the reference weekday values and ratios', () => {
    const result = analyzeRecords(records, config);
    expect(result.metrics.map((metric) => metric.displayAverage)).toEqual([62, 60.2, 61.4, 60.2, 57.8, 49.5, 33.9]);
    expect(result.metrics.map((metric) => metric.percent)).toEqual([16.1, 15.6, 16, 15.6, 15, 12.9, 8.8]);
    expect(result.overallAverage).toBeCloseTo(55004.286, 3);
  });

  it('supports calendar denominators by counting missing dates as zero', () => {
    const result = analyzeRecords(records.slice(0, 5), { ...config, denominator: 'calendar' });
    expect(result.metrics[5].average).toBe(0);
    expect(result.metrics[6].average).toBe(0);
    expect(result.selectedDays).toBe(7);
  });

  it('applies optional dimensions and returns an empty warning', () => {
    const result = analyzeRecords(records, { ...config, filter: { ...config.filter, route: '없는 노선' } });
    expect(result.totalBoardings).toBe(0);
    expect(result.warnings).toContain('선택한 조건에 해당하는 데이터가 없습니다.');
  });
});
