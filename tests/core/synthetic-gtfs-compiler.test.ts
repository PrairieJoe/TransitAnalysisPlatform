import { describe, expect, it } from 'vitest';
import { compileSyntheticGtfs } from '../../src/core/synthetic-gtfs/gtfs-compiler';
import type { ScheduleSynthesisResult, SegmentTravelEstimate, SyntheticGtfsBuildInput, SyntheticRoute } from '../../src/core/synthetic-gtfs/types';

const p = { sourceType: 'USER_INPUT' as const, confidence: 'medium' as const, isInferred: true, assumptions: ['운행횟수 시나리오'] };
const route: SyntheticRoute = {
  routeId: 'R1', routeName: '테스트 노선', transportMode: 'BUS', provenance: p,
  directions: [{
    directionId: 'R1-forward', directionLabel: '상행', provenance: p,
    stops: [
      { stopId: 'A', stopName: 'A', latitude: 34.7, longitude: 127.7, stopSequence: 1, timepoint: true, provenance: p },
      { stopId: 'B', stopName: 'B', latitude: 34.71, longitude: 127.71, stopSequence: 2, timepoint: false, provenance: p },
      { stopId: 'C', stopName: 'C', latitude: 34.72, longitude: 127.72, stopSequence: 3, timepoint: true, provenance: p }
    ],
    servicePlans: [{ serviceId: 'R1-forward-service', serviceDays: [0, 1, 2, 3, 4], firstDeparture: '06:00', lastDeparture: '23:00', departureCount: 2, sourceType: 'USER_INPUT', provenance: p }]
  }]
};
const travel: SegmentTravelEstimate[] = [
  { fromStopId: 'A', toStopId: 'B', travelSeconds: 240, provenance: { ...p, sourceType: 'MODEL_ESTIMATED', modelVersion: 'baseline-1' } },
  { fromStopId: 'B', toStopId: 'C', travelSeconds: 360, provenance: { ...p, sourceType: 'MODEL_ESTIMATED', modelVersion: 'baseline-1' } }
];
const schedule: ScheduleSynthesisResult = { departures: [
  { serviceId: 'R1-forward-service', directionId: 'R1-forward', departureTime: '06:00', sourceType: 'USER_INPUT' },
  { serviceId: 'R1-forward-service', directionId: 'R1-forward', departureTime: '23:00', sourceType: 'USER_INPUT' }
], warnings: [] };
const input: SyntheticGtfsBuildInput = {
  agencyId: 'agency-1', agencyName: '테스트 교통', routes: [route], travelTimesByDirection: { 'R1-forward': travel }, scheduleByDirection: { 'R1-forward': schedule }, startDate: '20260101', endDate: '20261231', shapeMode: 'missing'
};

describe('Synthetic GTFS compiler', () => {
  it('creates the required files with deterministic headers and accumulated stop times', () => {
    const result = compileSyntheticGtfs(input);

    expect(result.validation.isValid).toBe(true);
    expect(result.files['agency.txt']).toContain('agency_id,agency_name,agency_url,agency_timezone');
    expect(result.files['stops.txt']).toContain('A,A,34.7,127.7');
    expect(result.files['routes.txt']).toContain('R1,agency-1,R1,테스트 노선,3');
    expect(result.files['trips.txt']).toContain('R1,R1-forward-service,');
    expect(result.files['trips.txt']).toContain(',0');
    expect(result.files['stop_times.txt']).toContain('06:00:00,06:00:00,A,1,1');
    expect(result.files['stop_times.txt']).toContain('06:04:00,06:04:00,B,2,0');
    expect(result.files['stop_times.txt']).toContain('06:10:00,06:10:00,C,3,1');
    expect(result.files['calendar.txt']).toContain('R1-forward-service,1,1,1,1,1,0,0,20260101,20261231');
    expect(result.files['tap-motis-config.json']).toContain('"mode": "missing"');
    expect(JSON.parse(result.files['tap-provenance.json'])).toMatchObject({ datasetType: 'SYNTHETIC', routeCount: 1 });
    expect(result.summary).toMatchObject({ routeCount: 1, stopCount: 3, tripCount: 2 });
  });

  it('escapes commas and quotes in GTFS text fields', () => {
    const result = compileSyntheticGtfs({ ...input, agencyName: '테스트, "교통"' });

    expect(result.files['agency.txt']).toContain('agency-1,"테스트, ""교통""",https://example.invalid,Asia/Seoul');
  });

  it('throws before compilation when blocking validation errors exist', () => {
    expect(() => compileSyntheticGtfs({ ...input, routes: [] })).toThrow('Synthetic GTFS 검증에 실패했습니다.');
  });
});
