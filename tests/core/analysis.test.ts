import { describe, expect, it } from 'vitest';
import { analyzeHourlyRecords, analyzeODRecords, analyzeRecords, analyzeStationRecords } from '../../src/core/analysis';
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

  it('includes valid demand with missing boarding IDs and sequence errors in weekday totals', () => {
    const result = analyzeRecords([
      { serviceDate: '2024-01-01', boardingCount: 10, stationId: 'A' },
      { serviceDate: '2024-01-01', boardingCount: 5, qualityErrors: ['경유정류장순번오류'] }
    ], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });

    expect(result.totalBoardings).toBe(15);
    expect(result.metrics[0].average).toBe(15);
  });
});

describe('analyzeHourlyRecords', () => {
  const hourlyRecords: NormalizedRecord[] = [
    { serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '00:10:00', route: 'A' },
    { serviceDate: '2024-01-01', boardingCount: 100, boardingTime: '07:35:00', route: 'A' },
    { serviceDate: '2024-01-01', boardingCount: 40, boardingTime: '23:59:00', route: 'A' },
    { serviceDate: '2024-01-02', boardingCount: 300, boardingTime: '07:05:00', route: 'A' },
    { serviceDate: '2024-01-06', boardingCount: 50, boardingTime: '07:00:00', route: 'A' },
    { serviceDate: '2024-01-07', boardingCount: 150, boardingTime: '08:00:00', route: 'A' }
  ];
  const hourlyConfig = { filter: { from: '2024-01-01', to: '2024-01-07' }, denominator: 'observed' as const };

  it('returns separate weekday and weekend hourly averages and ratios', () => {
    const result = analyzeHourlyRecords(hourlyRecords, hourlyConfig);

    expect(result.weekdayDays).toBe(2);
    expect(result.weekendDays).toBe(2);
    expect(result.metrics[0].weekdayAverage).toBe(5);
    expect(result.metrics[7].weekdayAverage).toBe(200);
    expect(result.metrics[23].weekdayAverage).toBe(20);
    expect(result.metrics[7].weekendAverage).toBe(25);
    expect(result.metrics[8].weekendAverage).toBe(75);
    expect(result.metrics[7].weekendPercent).toBe(25);
    expect(result.metrics[8].weekendPercent).toBe(75);
  });

  it('uses all calendar group days when requested and applies filters', () => {
    const result = analyzeHourlyRecords(hourlyRecords, {
      ...hourlyConfig,
      denominator: 'calendar',
      filter: { ...hourlyConfig.filter, route: 'A' }
    });

    expect(result.weekdayDays).toBe(5);
    expect(result.weekendDays).toBe(2);
    expect(result.metrics[7].weekdayAverage).toBe(80);
  });

  it('reports missing time values without breaking the analysis', () => {
    const result = analyzeHourlyRecords([
      { serviceDate: '2024-01-01', boardingCount: 10 }
    ], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });

    expect(result.excludedRows).toBe(1);
    expect(result.warnings.join(' ')).toContain('시간');
    expect(result.metrics.every((metric) => metric.weekdayAverage === 0)).toBe(true);
  });
});

describe('analyzeStationRecords', () => {
  const stationRecords: NormalizedRecord[] = [
    { serviceDate: '2024-01-01', boardingCount: 100, stationId: 'B', route: 'A', region: '여수시' },
    { serviceDate: '2024-01-01', boardingCount: 50, stationId: 'A', route: 'A', region: '여수시' },
    { serviceDate: '2024-01-02', boardingCount: 150, stationId: 'A', route: 'A', region: '여수시' },
    { serviceDate: '2024-01-03', boardingCount: 30, stationId: 'B', route: 'B', region: '여수시' },
    { serviceDate: '2024-01-03', boardingCount: 10, route: 'A', region: '여수시' }
  ];

  it('aggregates stations, applies a common observed denominator, and ranks deterministically', () => {
    const result = analyzeStationRecords(stationRecords, { filter: { from: '2024-01-01', to: '2024-01-03' }, denominator: 'observed' });

    expect(result.selectedDays).toBe(3);
    expect(result.totalBoardings).toBe(330);
    expect(result.metrics).toEqual([
      { stationId: 'A', totalBoardings: 200, dailyAverage: 200 / 3, rank: 1 },
      { stationId: 'B', totalBoardings: 130, dailyAverage: 130 / 3, rank: 2 }
    ]);
    expect(result.excludedRows).toBe(1);
  });

  it('uses calendar dates and filters before grouping', () => {
    const result = analyzeStationRecords(stationRecords, {
      filter: { from: '2024-01-01', to: '2024-01-05', route: 'A' },
      denominator: 'calendar'
    });

    expect(result.selectedDays).toBe(5);
    expect(result.totalBoardings).toBe(300);
    expect(result.metrics).toEqual([
      { stationId: 'A', totalBoardings: 200, dailyAverage: 40, rank: 1 },
      { stationId: 'B', totalBoardings: 100, dailyAverage: 20, rank: 2 }
    ]);
  });

  it('returns a warning for empty station demand data', () => {
    const result = analyzeStationRecords([{ serviceDate: '2024-01-01', boardingCount: 10 }], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(result.metrics).toEqual([]);
    expect(result.warnings.join(' ')).toContain('정류장 수요');
  });
});

describe('analyzeODRecords', () => {
  it('aggregates origin-destination pairs, ranks ties deterministically, and excludes incomplete pairs', () => {
    const result = analyzeODRecords([
      { serviceDate: '2024-01-01', boardingCount: 10, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-01', boardingCount: 5, stationId: 'B', destinationStationId: 'A' },
      { serviceDate: '2024-01-02', boardingCount: 20, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-02', boardingCount: 25, stationId: 'B', destinationStationId: 'A' },
      { serviceDate: '2024-01-02', boardingCount: 99, stationId: 'A' }
    ], { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'observed' });

    expect(result.metrics).toEqual([
      { originStationId: 'A', destinationStationId: 'B', totalBoardings: 30, dailyAverage: 15, rank: 1 },
      { originStationId: 'B', destinationStationId: 'A', totalBoardings: 30, dailyAverage: 15, rank: 2 }
    ]);
    expect(result.totalBoardings).toBe(60);
    expect(result.excludedRows).toBe(1);
  });

  it('uses the full calendar as the OD denominator', () => {
    const result = analyzeODRecords([
      { serviceDate: '2024-01-01', boardingCount: 10, stationId: 'A', destinationStationId: 'B' }
    ], { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'calendar' });
    expect(result.selectedDays).toBe(2);
    expect(result.metrics[0].dailyAverage).toBe(5);
  });

  it('excludes sequence-error transactions from OD flows while retaining unmatched master IDs', () => {
    const result = analyzeODRecords([
      { serviceDate: '2024-01-01', boardingCount: 10, stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-01-01', boardingCount: 20, stationId: 'B', destinationStationId: 'A', qualityErrors: ['경유정류장순번오류'] }
    ], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });

    expect(result.totalBoardings).toBe(10);
    expect(result.excludedRows).toBe(1);
    expect(result.metrics.map((row) => [row.originStationId, row.destinationStationId])).toEqual([['A', 'B']]);
  });
});
