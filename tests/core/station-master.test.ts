import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFileRows } from '../../src/core/parser';
import { joinODDemandMetrics, joinStationDemandMetrics, mergeStationMasterRecords, normalizeStationMasterRows, parseStationMasterCsv, suggestStationMasterMapping } from '../../src/core/station-master';

describe('station master', () => {
  it('parses valid stations and skips invalid or duplicate rows', () => {
    const parsed = parseStationMasterCsv([
      'station_id,station_name,latitude,longitude',
      'A,시청,34.75,127.73',
      'A,중복,34.76,127.74',
      'B,잘못된 좌표,91,127.75',
      'C,시장,34.76,127.75'
    ].join('\n'));

    expect(parsed.stations).toEqual([
      { stationId: 'A', stationName: '시청', latitude: 34.75, longitude: 127.73 },
      { stationId: 'C', stationName: '시장', latitude: 34.76, longitude: 127.75 }
    ]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('requires the canonical headers', () => {
    expect(() => parseStationMasterCsv('id,name,lat,lon\nA,시청,34,127')).toThrow('필수 필드');
  });

  it('normalizes a headerless pipe-delimited source after field mapping', () => {
    const parsed = normalizeStationMasterRows([
      { 필드1: '20240415', 필드2: '03', 필드3: 'MM10146000', 필드4: '2700040', 필드5: '남정마을', 필드6: '~', 필드7: '34.971170', 필드8: '127.352270' }
    ], { stationIdColumn: '필드4', stationNameColumn: '필드5', latitudeColumn: '필드7', longitudeColumn: '필드8' });

    expect(parsed.stations).toEqual([{ stationId: '2700040', stationName: '남정마을', latitude: 34.97117, longitude: 127.35227 }]);
  });

  it('suggests mappings for canonical headers without requiring a bundled master', () => {
    expect(suggestStationMasterMapping(['운행일자', '정류장 ID', '정류장 명칭', '위도', '경도'])).toMatchObject({
      stationIdColumn: '정류장 ID',
      stationNameColumn: '정류장 명칭',
      latitudeColumn: '위도',
      longitudeColumn: '경도'
    });
  });

  it('suggests the standard positions for the headerless station source', () => {
    const headers = Array.from({ length: 14 }, (_value, index) => `필드${index + 1}`);
    const rows = [{ 필드4: '2700040', 필드5: '남정마을', 필드7: '34.971170', 필드8: '127.352270' }];
    expect(suggestStationMasterMapping(headers, rows)).toEqual({
      stationIdColumn: '필드4', stationNameColumn: '필드5', latitudeColumn: '필드7', longitudeColumn: '필드8'
    });
  });

  it('loads the paired Yeosu station source and matches transaction station IDs', async () => {
    const file = new File([
      readFileSync(new URL('../../fixtures/yeosu-station-master-sample.dat', import.meta.url), 'utf8')
    ], 'yeosu-station-master-sample.dat');
    const parsed = await parseFileRows(file, { headerRow: -1 });
    const normalized = normalizeStationMasterRows(parsed.rows, {
      stationIdColumn: '필드4', stationNameColumn: '필드5', latitudeColumn: '필드7', longitudeColumn: '필드8'
    });

    expect(normalized.stations).toHaveLength(11);
    expect(normalized.stations.find((station) => station.stationId === '3250842')).toMatchObject({ stationName: '서시장', latitude: 34.7442, longitude: 127.7341 });
  });

  it('joins metrics by exact ID and keeps unmatched demand visible', () => {
    const result = joinStationDemandMetrics([
      { stationId: 'A', totalBoardings: 100, dailyAverage: 50, rank: 1 },
      { stationId: 'UNKNOWN', totalBoardings: 40, dailyAverage: 20, rank: 2 }
    ], [{ stationId: 'A', stationName: '시청', latitude: 34.75, longitude: 127.73 }]);

    expect(result.rows[0]).toMatchObject({ stationId: 'A', stationName: '시청', mapAvailable: true });
    expect(result.rows[1]).toMatchObject({ stationId: 'UNKNOWN', stationName: '사전 미등록', mapAvailable: false });
    expect(result.unmatchedCount).toBe(1);
  });

  it('joins both OD endpoints and reports unmapped origins or destinations', () => {
    const result = joinODDemandMetrics([
      { originStationId: 'A', destinationStationId: 'B', totalBoardings: 100, dailyAverage: 50, rank: 1 },
      { originStationId: 'UNKNOWN', destinationStationId: 'B', totalBoardings: 40, dailyAverage: 20, rank: 2 }
    ], [{ stationId: 'A', stationName: '시청', latitude: 34.75, longitude: 127.73 }, { stationId: 'B', stationName: '시장', latitude: 34.76, longitude: 127.74 }]);

    expect(result.rows[0]).toMatchObject({ originStationName: '시청', destinationStationName: '시장', mapAvailable: true });
    expect(result.rows[1]).toMatchObject({ originStationName: '사전 미등록', destinationStationName: '시장', mapAvailable: false });
    expect(result.unmatchedOriginCount).toBe(1);
    expect(result.unmatchedDestinationCount).toBe(0);
  });

  it('merges route-derived stations without overriding the primary station dictionary', () => {
    const result = mergeStationMasterRecords([
      { stationId: 'A', stationName: '기준A', latitude: 34.75, longitude: 127.73 }
    ], [
      { stationId: 'A', stationName: '노선A', latitude: 34.7501, longitude: 127.7301 },
      { stationId: 'B', stationName: '노선B', latitude: 34.76, longitude: 127.74 }
    ]);

    expect(result.stations).toHaveLength(2);
    expect(result.stations[0].stationName).toBe('기준A');
    expect(result.stations[1].stationId).toBe('B');
    expect(result.warnings.join(' ')).toContain('기존 정류장 사전 값을 유지');
  });
});
