import { describe, expect, it } from 'vitest';
import { ANALYSIS_DATA_USAGE, ANALYSIS_USAGE_STATUS_LABELS, buildDataQualitySheetRows, buildDataQualityDisplay, buildHourlySheetRows, buildHourlyTableRows, buildODDemandSheetRows, buildRouteCongestionSheetRows, buildStationDemandSheetRows, buildSummary, buildTableRows, buildWarningSummary, formatOperationError, formatPeople } from '../../src/core/report';
import { analyzeHourlyRecords, analyzeRecords } from '../../src/core/analysis';
import { buildStationDemandMapModel } from '../../src/core/station-demand-view';

describe('report model', () => {
  it('explains the inclusion and exclusion criteria of every analysis mode', () => {
    expect(ANALYSIS_DATA_USAGE.map((entry) => entry.mode)).toEqual(['weekday', 'hourly', 'station', 'od', 'route', 'quality']);
    expect(ANALYSIS_DATA_USAGE.every((entry) => entry.errorTypes)).toBe(true);
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'weekday')?.errorTypes.every((item) => item.status === 'included')).toBe(true);
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'station')?.errorTypes.find((item) => item.type === '승차누락')).toMatchObject({ status: 'excluded' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'station')?.errorTypes.find((item) => item.type === '승차매칭불가')).toMatchObject({ status: 'conditional' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'od')?.errorTypes.find((item) => item.type === '경유정류장순번오류')).toMatchObject({ status: 'excluded' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'od')?.errorTypes.find((item) => item.type === '하차매칭불가')).toMatchObject({ status: 'conditional' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'route')?.errorTypes.find((item) => item.type === '노선매칭불가')).toMatchObject({ status: 'excluded' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'quality')?.errorTypes).toHaveLength(8);
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'quality')?.label).toBe('데이터 품질 현황');
    expect(ANALYSIS_USAGE_STATUS_LABELS).toEqual({ included: '포함', conditional: '조건부', excluded: '제외' });
    expect(ANALYSIS_DATA_USAGE.find((entry) => entry.mode === 'station')?.rule).toContain('하차');
  });

  it('summarizes long warning lists while preserving actionable warning counts', () => {
    expect(buildWarningSummary(['안내: 정적 경로를 재사용합니다.', '804개 행에 순번 오류가 있어 제외되었습니다.'])).toEqual({
      count: 2,
      actionableCount: 1,
      label: '오류·경고 확인사항'
    });
    expect(buildWarningSummary(['안내: 정적 경로를 재사용합니다.'])).toEqual({
      count: 1,
      actionableCount: 0,
      label: '분석 안내'
    });
  });

  it('keeps actionable operation errors visible and falls back for unknown errors', () => {
    expect(formatOperationError(new Error('프로젝트를 저장할 수 없습니다.'), '분석을 실행하지 못했습니다.')).toBe('프로젝트를 저장할 수 없습니다.');
    expect(formatOperationError('분석 엔진 오류', '분석을 실행하지 못했습니다.')).toBe('분석 엔진 오류');
    expect(formatOperationError({ reason: 'unknown' }, '분석을 실행하지 못했습니다.')).toBe('분석을 실행하지 못했습니다.');
  });

  it('builds a spreadsheet summary with normal and unique error volumes', () => {
    const rows = buildDataQualitySheetRows({
      metrics: [
        { type: '승차누락', transactionCount: 2, boardingCount: 15 },
        { type: '하차누락', transactionCount: 1, boardingCount: 4 }
      ],
      totalTransactions: 10,
      totalBoardings: 80,
      uniqueErrorTransactions: 3,
      uniqueErrorBoardings: 19,
      warnings: [],
      config: { filter: { from: '2024-01-01', to: '2024-01-31', route: 'R1' }, denominator: 'observed' }
    }, '통행량');

    expect(rows[0]).toEqual(['구분', '통행량']);
    expect(rows[1]).toEqual(['전체 통행량', '10']);
    expect(rows[2]).toEqual(['정상 통행량(오류 없음)', '7']);
    expect(rows[3]).toEqual(['전체 오류 통행량(중복 제외)', '3']);
    expect(rows[4]).toEqual(['승차누락', '2']);
    expect(rows.at(-1)).toEqual(['노선 필터', 'R1']);
  });

  it('selects boarding volume for count-column projects and derives normal volume', () => {
    const result = {
      metrics: [
        { type: '승차누락', transactionCount: 2, boardingCount: 15 },
        { type: '하차누락', transactionCount: 1, boardingCount: 4 }
      ],
      totalTransactions: 10,
      totalBoardings: 80,
      uniqueErrorTransactions: 3,
      uniqueErrorBoardings: 19,
      warnings: [],
      config: { filter: { from: '2024-01-01', to: '2024-01-31' }, denominator: 'observed' as const }
    };

    expect(buildDataQualityDisplay(result, '이용인원')).toEqual({
      metricLabel: '이용인원',
      totalVolume: 80,
      normalVolume: 61,
      uniqueErrorVolume: 19,
      metrics: [
        { type: '승차누락', volume: 15 },
        { type: '하차누락', volume: 4 }
      ]
    });
  });

  it('formats the table and summary values for Korean reports', () => {
    const result = analyzeRecords([{ serviceDate: '2024-01-01', boardingCount: 62000 }], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(buildTableRows(result)[0].values[0]).toBe('62.0');
    expect(buildTableRows(result)[0].label).toBe('이용인원(천 명/일)');
    expect(buildTableRows(result, '이용인원', 'raw')[0].label).toBe('이용인원(명/일)');
    expect(buildTableRows(result, '이용인원', 'raw')[0].values[0]).toBe('62,000.0');
    expect(buildTableRows(result, '통행량')[0].label).toBe('통행량(건/일)');
    expect(formatPeople(result.overallAverage)).toBe('62,000');
    expect(buildSummary(result)).toBe('선택 기간 일평균 승차인원 약 62,000명');
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

  it('builds the image-style OD table sheet', () => {
    const rows = [{ originStationId: 'A', destinationStationId: 'B', originStationName: '시청', destinationStationName: '시장', totalBoardings: 100, dailyAverage: 50, rank: 1, originLatitude: 34.75, originLongitude: 127.73, destinationLatitude: 34.76, destinationLongitude: 127.74, mapAvailable: true }];
    expect(buildODDemandSheetRows(rows)[0]).toEqual(['순위', '승차정류장(O)', '하차정류장(D)', '승차인원(인/일)']);
    expect(buildODDemandSheetRows(rows)[1]).toEqual(['1', '시청', '시장', '50']);
    expect(buildODDemandSheetRows(rows, '통행량')[0][3]).toBe('통행량(건/일)');
  });

  it('builds a route congestion worksheet with segment and denominator metadata', () => {
    const result = {
      metrics: [{ routeId: 'R1', routeName: '노선1', transportMode: 'B', direction: 'forward' as const, directionLabel: '순방향', fromSequence: 0, toSequence: 1, fromStationId: 'A', toStationId: 'B', fromStationName: '시청', toStationName: '시장', fromLatitude: 34.75, fromLongitude: 127.73, toLatitude: 34.76, toLongitude: 127.74, segmentDistance: 1.2, previousOnboard: 0, boardings: 10, alightings: 2, onboardPassengers: 8, peakOnboardPassengers: 8, averageOnboardPassengers: 7, totalBoardings: 20, totalAlightings: 4, vehicleCapacity: 20, dailyTrips: 2, congestionPercent: 40, rank: 1 }],
      stopMetrics: [{ routeId: 'R1', routeName: '노선1', transportMode: 'B', direction: 'forward' as const, directionLabel: '순방향', stationSequence: 0, stationId: 'A', stationName: '시청', latitude: 34.75, longitude: 127.73, segmentDistance: 1.2, previousOnboard: 0, boardings: 10, alightings: 2, onboardPassengers: 8, peakOnboardPassengers: 8, averageOnboardPassengers: 7, totalBoardings: 20, totalAlightings: 4, vehicleCapacity: 20, dailyTrips: 2, congestionPercent: 40, rank: 1 }],
      summaries: [],
      selectedDays: 2,
      totalBoardings: 20,
      excludedRows: 0,
      loadBasis: 'vehicle' as const,
      warnings: [],
      config: { filter: { from: '2024-01-01', to: '2024-01-02' }, denominator: 'observed' as const, hour: 7 as const }
    };
    const rows = buildRouteCongestionSheetRows(result);
    expect(rows[0]).toEqual(['노선 ID', '노선명', '교통수단', '방향', '정류장', '이전 재차인원', '승차', '하차', '최대 재차인원', '평균 재차인원', '혼잡도', '다음 구간거리', '차량정원', '운행횟수']);
    expect(rows[1]).toEqual(['R1', '노선1', 'B', '순방향', '시청', '0.0', '10.0', '2.0', '8.0', '7.0', '40.0%', '1.2', '20', '2']);
    expect(rows.slice(-4)).toEqual([['시간대', '7시'], ['평균 계산 기준', '실제 관측일'], ['선택 기간 일수', '2'], ['재차인원 산출 기준', '차량 ID별 정류장 누적 최대값']]);
  });
});
