import { describe, expect, it } from 'vitest';
import { buildHourlySheetRows, buildHourlyTableRows, buildStationDemandSheetRows, buildSummary, buildTableRows, formatPeople } from '../../src/core/report';
import { analyzeHourlyRecords, analyzeRecords } from '../../src/core/analysis';
import { buildStationDemandMapModel } from '../../src/core/station-demand-view';

describe('report model', () => {
  it('formats the table and summary values for Korean reports', () => {
    const result = analyzeRecords([{ serviceDate: '2024-01-01', boardingCount: 62000 }], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(buildTableRows(result)[0].values[0]).toBe('62.0');
    expect(buildTableRows(result)[0].label).toBe('이용인원(천 명/일)');
    expect(buildTableRows(result, '이용인원', 'raw')[0].label).toBe('이용인원(명/일)');
    expect(buildTableRows(result, '이용인원', 'raw')[0].values[0]).toBe('62,000.0');
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
    expect(rows[0].label).toBe('주중기준 승차인원(명/일)');
    expect(rows[0].values[7]).toBe('62,000.0');
    expect(rows[2].values[8]).toBe('30,000.0');
    expect(buildHourlyTableRows(result, '승차인원', 'thousand')[0].values[7]).toBe('62.0');
    expect(sheet[0]).toEqual(['구분', ...Array.from({ length: 24 }, (_, hour) => `${hour}시`)]);
    expect(sheet).toHaveLength(5);
  });

  it('keeps small passenger counts visible in hourly output', () => {
    const result = analyzeHourlyRecords([
      { serviceDate: '2024-01-01', boardingCount: 1, boardingTime: '07:00:00' }
    ], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });

    expect(buildHourlyTableRows(result)[0].label).toBe('주중기준 승차인원(명/일)');
    expect(buildHourlyTableRows(result)[0].values[7]).toBe('1.0');
  });

  it('formats station demand values in the image-style table and spreadsheet', () => {
    const rows = [
      { stationId: 'A', stationName: '시청', totalBoardings: 1852, dailyAverage: 1852.4, rank: 1, latitude: 34.75, longitude: 127.73, mapAvailable: true },
      { stationId: 'B', stationName: '시장', totalBoardings: 500, dailyAverage: 500, rank: 2, latitude: null, longitude: null, mapAvailable: false }
    ];

    expect(buildStationDemandSheetRows(rows)[0]).toEqual(['순위', '정류장 ID', '정류장명', '승차인원(인/일)']);
    expect(buildStationDemandSheetRows(rows)[1]).toEqual(['1', 'A', '시청', '1,852']);
    expect(buildStationDemandSheetRows(rows, '승차인원', 'thousand')[0]).toEqual(['순위', '정류장 ID', '정류장명', '승차인원(천 명/일)']);
    expect(buildStationDemandSheetRows(rows, '승차인원', 'thousand')[1][3]).toBe('1.9');
  });

  it('creates adaptive demand bands and excludes unmappable rows', () => {
    const model = buildStationDemandMapModel([
      { stationId: 'A', stationName: '시청', totalBoardings: 10, dailyAverage: 10, rank: 1, latitude: 34.75, longitude: 127.73, mapAvailable: true },
      { stationId: 'B', stationName: '시장', totalBoardings: 20, dailyAverage: 20, rank: 2, latitude: 34.76, longitude: 127.74, mapAvailable: true },
      { stationId: 'C', stationName: '미등록', totalBoardings: 30, dailyAverage: 30, rank: 3, latitude: null, longitude: null, mapAvailable: false }
    ]);

    expect(model.markers).toHaveLength(2);
    expect(model.bands.length).toBeGreaterThan(0);
    expect(model.markers[1].radius).toBeGreaterThan(model.markers[0].radius);
  });
});
