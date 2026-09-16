import { describe, expect, it } from 'vitest';
import { analyzeODRecords } from '../../src/core/analysis';
import { analyzeDataQuality, classifyDataQuality, hasCurrentDataQualityClassification, legacyDataQualityWarnings } from '../../src/core/data-quality';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '../../src/shared/types';
import type { NormalizedRecord, RouteStopMasterRecord, StationMasterRecord } from '../../src/shared/types';

const stations: StationMasterRecord[] = ['A', 'B', 'C', 'D'].map((stationId) => ({
  stationId,
  stationName: stationId,
  latitude: 37,
  longitude: 127
}));

function stop(stationId: string, stationSequence: number, serviceDate?: string): RouteStopMasterRecord {
  return { routeId: 'R', routeName: '노선 R', transportMode: '버스', stationId, stationName: stationId, stationSequence, latitude: 37, longitude: 127, serviceDate };
}

const routeStops = [stop('A', 1), stop('B', 2), stop('C', 3)];

const records: NormalizedRecord[] = [
  { serviceDate: '2024-01-01', boardingCount: 2, stationId: 'A', destinationStationId: 'B', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 4, destinationStationId: 'B', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 5, stationId: 'A', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 6, stationId: 'UNKNOWN', destinationStationId: 'B', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 7, stationId: 'A', destinationStationId: 'UNKNOWN', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 8, stationId: 'A', destinationStationId: 'B' },
  { serviceDate: '2024-01-01', boardingCount: 9, stationId: 'A', destinationStationId: 'B', route: 'UNKNOWN' },
  { serviceDate: '2024-01-01', boardingCount: 10, stationId: 'A', destinationStationId: 'D', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 3, stationId: 'B', destinationStationId: 'A', route: 'R' },
  { serviceDate: '2024-01-01', boardingCount: 11, stationId: 'A', destinationStationId: 'A', route: 'R' }
];

describe('data quality classification and aggregation', () => {
  it('classifies all eight error types against the union station master and date-specific route path', () => {
    const classified = classifyDataQuality(records, stations, routeStops);

    expect(classified.map((record) => record.qualityErrors)).toEqual([
      [],
      ['승차누락'],
      ['하차누락'],
      ['승차매칭불가', '노선경유정류장매칭오류'],
      ['하차매칭불가', '노선경유정류장매칭오류'],
      ['노선누락'],
      ['노선매칭불가'],
      ['노선경유정류장매칭오류'],
      ['경유정류장순번오류'],
      ['경유정류장순번오류']
    ]);
  });

  it('counts overlapping errors per category, while unique affected rows are counted once', () => {
    const classified = classifyDataQuality(records, stations, routeStops);
    const result = analyzeDataQuality(classified, { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });

    expect(result.uniqueErrorTransactions).toBe(9);
    expect(result.uniqueErrorBoardings).toBe(63);
    expect(result.totalTransactions).toBe(10);
    expect(result.totalBoardings).toBe(65);
    expect(result.metrics).toEqual([
      { type: '승차누락', transactionCount: 1, boardingCount: 4 },
      { type: '하차누락', transactionCount: 1, boardingCount: 5 },
      { type: '승차매칭불가', transactionCount: 1, boardingCount: 6 },
      { type: '하차매칭불가', transactionCount: 1, boardingCount: 7 },
      { type: '노선누락', transactionCount: 1, boardingCount: 8 },
      { type: '노선매칭불가', transactionCount: 1, boardingCount: 9 },
      { type: '노선경유정류장매칭오류', transactionCount: 3, boardingCount: 23 },
      { type: '경유정류장순번오류', transactionCount: 2, boardingCount: 14 }
    ]);
  });

  it('flags reverse-order journeys as sequence errors and excludes them from OD', () => {
    const [classified] = classifyDataQuality([
      { serviceDate: '2024-01-01', boardingCount: 1, stationId: 'C', destinationStationId: 'A', route: 'R' }
    ], stations, routeStops);

    expect(classified.qualityErrors).toEqual(['경유정류장순번오류']);
    const odResult = analyzeODRecords([classified], { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' });
    expect(odResult).toMatchObject({ totalBoardings: 0, excludedRows: 1 });
  });

  it('uses dated-path selection and forward sequence rules, including repeated stops', () => {
    const dated = [
      stop('A', 1, '2024-01-01'), stop('B', 2, '2024-01-01'), stop('C', 3, '2024-01-01'),
      stop('C', 1, '2024-01-02'), stop('B', 2, '2024-01-02'), stop('A', 3, '2024-01-02')
    ];
    const classified = classifyDataQuality([
      { serviceDate: '2024-01-01', boardingCount: 1, stationId: 'A', destinationStationId: 'B', route: 'R' },
      { serviceDate: '2024-01-02', boardingCount: 1, stationId: 'A', destinationStationId: 'B', route: 'R' },
      { serviceDate: '2024-01-03', boardingCount: 1, stationId: 'A', destinationStationId: 'B', route: 'R' }
    ], stations, dated);

    expect(classified.map((record) => record.qualityErrors)).toEqual([
      [],
      ['경유정류장순번오류'],
      ['노선경유정류장매칭오류']
    ]);

    const repeated = classifyDataQuality([
      { serviceDate: '2024-01-01', boardingCount: 1, stationId: 'A', destinationStationId: 'C', route: 'R' }
    ], stations, [stop('A', 1), stop('B', 2), stop('A', 3), stop('C', 4)]);
    expect(repeated[0].qualityErrors).toEqual([]);
  });

  it('filters the quality report by date and route without requiring transaction time', () => {
    const classified = classifyDataQuality([
      { serviceDate: '2024-01-01', boardingCount: 2, route: 'R' },
      { serviceDate: '2024-01-02', boardingCount: 3, route: 'S', qualityErrors: ['승차누락'] }
    ], stations, routeStops);
    const result = analyzeDataQuality(classified, { filter: { from: '2024-01-02', to: '2024-01-02', route: 'S' }, denominator: 'observed' });

    expect(result.totalTransactions).toBe(1);
    expect(result.totalBoardings).toBe(3);
    expect(result.uniqueErrorTransactions).toBe(1);
    expect(result.metrics[0]).toMatchObject({ type: '승차누락', transactionCount: 1, boardingCount: 3 });
  });

  it('warns legacy projects that may already have discarded missing boarding IDs', () => {
    expect(legacyDataQualityWarnings(6, true).join(' ')).toContain('복구할 수 없으므로 원본 거래내역을 다시 가져오세요');
    expect(legacyDataQualityWarnings(6, false)).toEqual([]);
    expect(legacyDataQualityWarnings(7, true)).toEqual([]);
  });

  it('reclassifies schema 7 projects after the stop-order rule changes', () => {
    const previouslyClassified = [{ serviceDate: '2024-01-01', boardingCount: 1, qualityErrors: [] }];
    expect(hasCurrentDataQualityClassification(previouslyClassified, 7)).toBe(false);
    expect(hasCurrentDataQualityClassification(previouslyClassified, 8)).toBe(false);
    expect(hasCurrentDataQualityClassification(previouslyClassified, CURRENT_PROJECT_SCHEMA_VERSION)).toBe(true);
  });
});
