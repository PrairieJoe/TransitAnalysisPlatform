import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from '../../src/core/station-catalog';
import type { RouteStopMasterRecord, StationMasterRecord } from '../../src/shared/types';

const station = (overrides: Partial<StationMasterRecord> = {}): StationMasterRecord => ({
  stationId: 'S1', stationName: '시청', latitude: 37, longitude: 127, ...overrides
});

const stop = (overrides: Partial<RouteStopMasterRecord> = {}): RouteStopMasterRecord => ({
  routeId: 'R1', routeName: '1번 노선', transportMode: 'B', stationSequence: 1,
  stationId: 'S1', stationName: '시청', latitude: 37, longitude: 127, ...overrides
});

describe('station catalog', () => {
  it('deduplicates a station shared by STTN and ROUTESTTN while keeping route memberships', () => {
    const catalog = buildStationCatalog(
      [station()],
      [stop(), stop({ routeId: 'R2', routeName: '2번 노선', stationSequence: 4 })]
    );

    expect(catalog.stations).toHaveLength(1);
    expect(catalog.stations[0]).toMatchObject({ stationId: 'S1', stationName: '시청' });
    expect(catalog.routeMemberships.map((membership) => membership.routeId)).toEqual(['R1', 'R2']);
    expect(new Set(catalog.stations[0].provenance.map((item) => item.source))).toEqual(new Set(['station-master', 'route-stop']));
  });

  it('keeps station-master values and records deterministic name and coordinate conflicts', () => {
    const catalog = buildStationCatalog(
      [station({ stationName: '기준 시청', latitude: 37.000001 })],
      [stop({ stationName: '노선 시청', latitude: 37.01, longitude: 127.02 })]
    );

    expect(catalog.stations[0]).toMatchObject({ stationName: '기준 시청', latitude: 37.000001, longitude: 127 });
    expect(catalog.conflicts.map(({ field }) => field)).toEqual(['stationName', 'latitude', 'longitude']);
    expect(catalog.warnings).toEqual([
      '정류장 ID S1의 명칭이 station-master와 route-stop에서 달라 station-master 값을 유지했습니다.',
      '정류장 ID S1의 위도가 station-master와 route-stop에서 달라 station-master 값을 유지했습니다.',
      '정류장 ID S1의 경도가 station-master와 route-stop에서 달라 station-master 값을 유지했습니다.'
    ]);
  });

  it('derives missing stations from route stops and deduplicates exact route memberships', () => {
    const catalog = buildStationCatalog([], [
      stop({ stationId: 'S2', stationName: '시장', stationSequence: 2 }),
      stop({ stationId: 'S2', stationName: '시장', stationSequence: 2 }),
      stop({ stationId: 'S3', stationName: '터미널', stationSequence: 3 })
    ]);

    expect(catalog.stations.map(({ stationId }) => stationId)).toEqual(['S2', 'S3']);
    expect(catalog.routeMemberships).toHaveLength(2);
    expect(catalog.warnings).toContain('노선 R1의 동일한 운행일자·순번·정류장 ID 중복 1개를 하나로 통합했습니다.');
  });

  it('rejects invalid coordinates without creating a station or membership', () => {
    const catalog = buildStationCatalog([station({ latitude: 91 })], [stop({ stationId: 'S2', longitude: 181 })]);

    expect(catalog.stations).toEqual([]);
    expect(catalog.routeMemberships).toEqual([]);
    expect(catalog.warnings).toEqual([
      '정류장 ID S1의 station-master 원본을 좌표 범위 오류로 제외했습니다.',
      '노선 R1의 정류장 S2를 좌표 범위 오류로 제외했습니다.'
    ]);
  });
});
