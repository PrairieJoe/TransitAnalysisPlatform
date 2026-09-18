import { describe, expect, it } from 'vitest';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS, deriveDepartureCount } from '../../src/core/synthetic-gtfs/draft-builder';
import type { RouteStopMasterRecord } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '테스트 노선', transportMode: '버스', stationSequence: 1, stationId: 'A', stationName: 'A', latitude: 34.7, longitude: 127.7 },
  { routeId: 'R1', routeName: '테스트 노선', transportMode: '버스', stationSequence: 2, stationId: 'B', stationName: 'B', latitude: 34.71, longitude: 127.71 },
  { routeId: 'R1', routeName: '테스트 노선', transportMode: '버스', stationSequence: 3, stationId: 'C', stationName: 'C', latitude: 34.72, longitude: 127.72 }
];

describe('Synthetic GTFS draft builder', () => {
  it('derives an inclusive departure count from a minute-based headway', () => {
    expect(deriveDepartureCount('06:00', '23:00', 20)).toBe(52);
  });

  it('rejects positive fractional headways with a headway-specific error', () => {
    expect(() => deriveDepartureCount('06:00', '23:00', 20.5)).toThrow('배차간격');
  });

  it('builds both directions from existing route master data with a deterministic baseline', () => {
    const result = buildSyntheticGtfsDraft(routeStops, [], {
      agencyId: 'agency-1',
      agencyName: '테스트 교통',
      routeId: 'R1',
      serviceDays: [0, 1, 2, 3, 4],
      firstDeparture: '06:00',
      lastDeparture: '23:00',
      vehicleCount: 8,
      headwayMinutes: 20,
      startDate: '20260101',
      endDate: '20261231',
      sourceName: 'project-route-master',
      deriveReverseDirection: true,
      dwellSeconds: 20,
      travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    });

    expect(result.validation.isValid).toBe(true);
    expect(result.summary).toMatchObject({ routeCount: 1, stopCount: 3, tripCount: 104 });
    expect(result.files['tap-provenance.json']).toContain('R1-reverse');
    expect(result.files['tap-provenance.json']).toContain('운행대수');
    expect(result.files['tap-provenance.json']).toContain('8');
    expect(result.validation.warnings).toContain('차량 배정은 실제 운행자료가 없어 검증하지 않았습니다.');
    expect(result.validation.warnings).toEqual(expect.arrayContaining(['MOTIS가 OSM 기반으로 없는 shape를 추정합니다.']));
    expect(result.files['stop_times.txt']).toContain('06:00:00');
  });

  it('does not fabricate vehicle or block assignment fields in trips', () => {
    const result = buildSyntheticGtfsDraft(routeStops, [], {
      agencyId: 'agency-1', agencyName: '테스트 교통', routeId: 'R1', serviceDays: [0], firstDeparture: '06:00', lastDeparture: '07:00', vehicleCount: 8, headwayMinutes: 20, startDate: '20260101', endDate: '20261231', sourceName: 'test', deriveReverseDirection: false, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    });

    expect(result.files['trips.txt'].split('\r\n')[0]).toBe('route_id,service_id,trip_id,direction_id');
    expect(result.files['trips.txt']).not.toContain('vehicle_id');
    expect(result.files['trips.txt']).not.toContain('block_id');
  });

  it('only builds the selected route and rejects an unknown route before export', () => {
    expect(() => buildSyntheticGtfsDraft(routeStops, [], {
      agencyId: 'agency-1', agencyName: '테스트 교통', routeId: 'MISSING', serviceDays: [0], firstDeparture: '06:00', lastDeparture: '07:00', vehicleCount: 8, headwayMinutes: 20, startDate: '20260101', endDate: '20261231', sourceName: 'test', deriveReverseDirection: false, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    })).toThrow('생성할 노선이 없습니다.');
  });

  it('selects one valid dated route path instead of merging dates into duplicate sequences', () => {
    const datedStops = routeStops.flatMap((record) => [
      { ...record, serviceDate: '2025-01-01' },
      { ...record, serviceDate: '2025-02-01' }
    ]);
    const result = buildSyntheticGtfsDraft(datedStops, [], {
      agencyId: 'agency-1', agencyName: '테스트 교통', routeId: 'R1', serviceDays: [0], firstDeparture: '06:00', lastDeparture: '07:00', vehicleCount: 8, headwayMinutes: 20, startDate: '20260101', endDate: '20261231', sourceName: 'test', deriveReverseDirection: false, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    });

    expect(result.validation.isValid).toBe(true);
    expect(JSON.parse(result.files['tap-provenance.json']).routes[0].provenance.assumptions).toContain('동일 노선의 운행일자별 경로 2개 중 2025-02-01 경로를 대표 경로로 선택했습니다.');
  });

  it('rejects zero or non-integer vehicle counts with a fleet-specific error', () => {
    const options = {
      agencyId: 'agency-1', agencyName: '테스트 교통', routeId: 'R1', serviceDays: [0], firstDeparture: '06:00', lastDeparture: '07:00', vehicleCount: 8, headwayMinutes: 20, startDate: '20260101', endDate: '20261231', sourceName: 'test', deriveReverseDirection: false, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    };

    expect(() => buildSyntheticGtfsDraft(routeStops, [], { ...options, vehicleCount: 0 })).toThrow('운행대수');
    expect(() => buildSyntheticGtfsDraft(routeStops, [], { ...options, vehicleCount: 1.5 })).toThrow('운행대수');
  });

  it('rejects a non-positive headway with a headway-specific error', () => {
    expect(() => buildSyntheticGtfsDraft(routeStops, [], {
      agencyId: 'agency-1', agencyName: '테스트 교통', routeId: 'R1', serviceDays: [0], firstDeparture: '06:00', lastDeparture: '07:00', vehicleCount: 8, headwayMinutes: 0, startDate: '20260101', endDate: '20261231', sourceName: 'test', deriveReverseDirection: false, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    })).toThrow('배차간격');
  });
});
