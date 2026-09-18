import { describe, expect, it } from 'vitest';
import { validateSyntheticGtfs } from '../../src/core/synthetic-gtfs/validator';
import type { ScheduleSynthesisResult, SegmentTravelEstimate, SyntheticGtfsBuildInput, SyntheticRoute } from '../../src/core/synthetic-gtfs/types';

const provenance = { sourceType: 'USER_INPUT' as const, confidence: 'medium' as const, isInferred: true, assumptions: ['테스트'] };
const route: SyntheticRoute = {
  routeId: 'R1',
  routeName: '테스트 노선',
  transportMode: 'BUS',
  provenance,
  directions: [{
    directionId: 'R1-forward',
    directionLabel: '상행',
    provenance,
    stops: [
      { stopId: 'A', stopName: 'A', latitude: 34.7, longitude: 127.7, stopSequence: 1, timepoint: true, provenance },
      { stopId: 'B', stopName: 'B', latitude: 34.71, longitude: 127.71, stopSequence: 2, timepoint: false, provenance },
      { stopId: 'C', stopName: 'C', latitude: 34.72, longitude: 127.72, stopSequence: 3, timepoint: true, provenance }
    ],
    servicePlans: [{ serviceId: 'R1-forward-service', serviceDays: [0, 1, 2, 3, 4], firstDeparture: '06:00', lastDeparture: '23:00', departureCount: 2, sourceType: 'USER_INPUT', provenance }]
  }]
};
const schedule: ScheduleSynthesisResult = { departures: [
  { serviceId: 'R1-forward-service', directionId: 'R1-forward', departureTime: '06:00', sourceType: 'USER_INPUT' },
  { serviceId: 'R1-forward-service', directionId: 'R1-forward', departureTime: '23:00', sourceType: 'USER_INPUT' }
], warnings: [] };
const travel: SegmentTravelEstimate[] = [
  { fromStopId: 'A', toStopId: 'B', travelSeconds: 240, provenance: { ...provenance, sourceType: 'MODEL_ESTIMATED', modelVersion: 'baseline-1' } },
  { fromStopId: 'B', toStopId: 'C', travelSeconds: 360, provenance: { ...provenance, sourceType: 'MODEL_ESTIMATED', modelVersion: 'baseline-1' } }
];

function input(overrides: Partial<SyntheticGtfsBuildInput> = {}): SyntheticGtfsBuildInput {
  return {
    agencyId: 'agency-1',
    agencyName: '테스트 교통',
    routes: [route],
    travelTimesByDirection: { 'R1-forward': travel },
    scheduleByDirection: { 'R1-forward': schedule },
    startDate: '20260101',
    endDate: '20261231',
    shapeMode: 'missing',
    ...overrides
  };
}

describe('Synthetic GTFS validator', () => {
  it('accepts a complete build input but reports inferred and user-input warnings', () => {
    const result = validateSyntheticGtfs(input());

    expect(result.isValid).toBe(true);
    expect(result.blockingErrors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining(['사용자 입력 또는 추정값이 포함된 Synthetic 데이터입니다.', 'MOTIS가 OSM 기반으로 없는 shape를 추정합니다.']));
  });

  it('blocks missing routes, missing schedules, and mismatched segment times', () => {
    expect(validateSyntheticGtfs(input({ routes: [] })).blockingErrors).toContain('생성할 노선이 없습니다.');
    expect(validateSyntheticGtfs(input({ scheduleByDirection: {} })).blockingErrors).toContain('R1-forward 방향의 운행계획이 없습니다.');
    expect(validateSyntheticGtfs(input({ travelTimesByDirection: { 'R1-forward': [travel[0]] } })).blockingErrors).toContain('R1-forward 방향의 정류장 간 예상시간 수가 정류장 구간 수와 다릅니다.');
  });

  it('blocks invalid service dates and service days', () => {
    const invalidRoute = { ...route, directions: [{ ...route.directions[0], servicePlans: [{ ...route.directions[0].servicePlans[0], serviceDays: [7] }] }] };
    const result = validateSyntheticGtfs(input({ routes: [invalidRoute], startDate: '20261301' }));

    expect(result.blockingErrors).toEqual(expect.arrayContaining(['서비스 시작일이 YYYYMMDD 형식이 아닙니다.', 'R1-forward-service 서비스의 운행 요일이 유효하지 않습니다.']));
  });
});
