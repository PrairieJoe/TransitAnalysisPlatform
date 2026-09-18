import { describe, expect, it } from 'vitest';
import type { RouteServiceConfig, RouteStopMasterRecord } from '../../src/shared/types';
import { adaptRouteMasterToSynthetic } from '../../src/core/synthetic-gtfs/source-adapter';

function stop(routeId: string, stationSequence: number, stationId: string, latitude = 34.74, longitude = 127.73): RouteStopMasterRecord {
  return {
    routeId,
    routeName: `노선 ${routeId}`,
    transportMode: '버스',
    stationSequence,
    stationId,
    stationName: `정류장 ${stationId}`,
    latitude,
    longitude
  };
}

const options = {
  agencyId: 'agency-1',
  agencyName: '테스트 교통',
  serviceDays: [0, 1, 2, 3, 4] as number[],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  departureCountByRoute: { R1: 60 },
  sourceName: 'route-master.csv',
  deriveReverseDirection: true
};

describe('Synthetic GTFS source adapter', () => {
  it('groups routes, sorts stops, and creates an explicit derived reverse direction', () => {
    const routes = adaptRouteMasterToSynthetic([
      stop('R1', 2, 'B'),
      stop('R1', 1, 'A'),
      stop('R1', 3, 'C')
    ], [], options);

    expect(routes).toHaveLength(1);
    expect(routes[0].directions[0].stops.map((item) => item.stopId)).toEqual(['A', 'B', 'C']);
    expect(routes[0].directions[1].stops.map((item) => item.stopId)).toEqual(['C', 'B', 'A']);
    expect(routes[0].directions[1].provenance).toMatchObject({ sourceType: 'DERIVED', confidence: 'low', isInferred: true });
    expect(routes[0].directions[1].provenance.assumptions).toContain('원본 방향 정보가 없어 정류장 순서를 역순으로 파생했습니다.');
    expect(routes[0].directions[0].servicePlans[0].departureCount).toBe(60);
  });

  it('uses route service configuration when an explicit route count is not supplied', () => {
    const service: RouteServiceConfig = { routeId: 'R2', vehicleCapacity: 45, tripsByHour: { '6': 2, '7': 3, '8': 4 } };
    const routes = adaptRouteMasterToSynthetic([stop('R2', 1, 'A'), stop('R2', 2, 'B')], [service], {
      ...options,
      departureCountByRoute: {}
    });

    expect(routes[0].directions[0].servicePlans[0].departureCount).toBe(9);
    expect(routes[0].directions[0].servicePlans[0].provenance.sourceType).toBe('DERIVED');
  });

  it('rejects duplicate sequences and invalid coordinates instead of silently dropping them', () => {
    expect(() => adaptRouteMasterToSynthetic([stop('R1', 1, 'A'), stop('R1', 1, 'B')], [], options)).toThrow('정류장 순번이 중복');
    expect(() => adaptRouteMasterToSynthetic([stop('R1', 1, 'A', 95)], [], options)).toThrow('좌표가 유효하지 않습니다');
  });

  it('rejects positive fractional headways with a headway-specific error', () => {
    expect(() => adaptRouteMasterToSynthetic([stop('R1', 1, 'A'), stop('R1', 2, 'B')], [], {
      ...options,
      headwayMinutes: 2.5,
      vehicleCount: 8
    })).toThrow('배차간격');
  });

  it('rejects a route with fewer than two stops', () => {
    expect(() => adaptRouteMasterToSynthetic([stop('R1', 1, 'A')], [], options)).toThrow('정류장이 2개 미만');
  });

  it('normalizes the zero-based sequence used by the existing route master and records the assumption', () => {
    const routes = adaptRouteMasterToSynthetic([
      stop('R0', 0, 'A'),
      stop('R0', 1, 'B'),
      stop('R0', 2, 'C')
    ], [], { ...options, departureCountByRoute: { R0: 2 } });

    expect(routes[0].directions[0].stops.map((item) => item.stopSequence)).toEqual([1, 2, 3]);
    expect(routes[0].provenance.assumptions).toContain('기존 노선자료의 0-based 정류장 순번을 1-based로 정규화했습니다.');
  });

  it('preserves repeated visits to the same physical stop when identity data agrees', () => {
    const routes = adaptRouteMasterToSynthetic([
      stop('LOOP', 1, 'A'),
      stop('LOOP', 2, 'B'),
      stop('LOOP', 3, 'A')
    ], [], { ...options, departureCountByRoute: { LOOP: 2 }, deriveReverseDirection: false });

    expect(routes[0].directions[0].stops.map((item) => item.stopId)).toEqual(['A', 'B', 'A']);
    expect(routes[0].provenance.assumptions).toContain('동일 정류장 ID 1개가 경로 순서상 반복되어 stop_times에 순서별로 유지했습니다.');
  });
});
