import { describe, expect, it } from 'vitest';
import { routeSegmentKey } from '../../../src/core/route-demand-view';
import { buildTransit3DModel } from '../../../src/renderer/three/model';
import type { RouteSegmentMetric } from '../../../src/shared/types';

function metric(overrides: Partial<RouteSegmentMetric> = {}): RouteSegmentMetric {
  return {
    routeId: 'R1', routeName: '1번', transportMode: '버스', direction: 'forward', directionLabel: '순방향',
    fromSequence: 1, toSequence: 2, fromStationId: 'A', toStationId: 'B', fromStationName: '가', toStationName: '나',
    fromLatitude: 37, fromLongitude: 127, toLatitude: 37.01, toLongitude: 127.01, segmentDistance: 1.4,
    previousOnboard: 0, boardings: 10, alightings: 0, onboardPassengers: 10, peakOnboardPassengers: 10,
    averageOnboardPassengers: 8, totalBoardings: 10, totalAlightings: 0, vehicleCapacity: 40, dailyTrips: 10,
    congestionPercent: null, rank: 1, ...overrides
  };
}

describe('Transit 3D route model', () => {
  it('preserves segment keys and station sequence while encoding bounded heights', () => {
    const first = metric();
    const second = metric({
      fromSequence: 2, toSequence: 3, fromStationId: 'B', toStationId: 'C', fromStationName: '나', toStationName: '다',
      fromLatitude: 37.01, fromLongitude: 127.01, toLatitude: 37.02, toLongitude: 127.02,
      peakOnboardPassengers: 20, congestionPercent: 45, rank: 2
    });
    const model = buildTransit3DModel([first, second]);

    expect(model.segments.map((segment) => segment.key)).toEqual([routeSegmentKey(first), routeSegmentKey(second)]);
    expect(model.stops.map((stop) => stop.stationId)).toEqual(['A', 'B', 'C']);
    expect(model.segments[0].color).toBe('#b8c1c9');
    expect(model.segments[1].color).toBe('#e62626');
    expect(model.segments[0].height).toBeGreaterThan(0);
    expect(model.segments[1].height).toBeGreaterThan(model.segments[0].height);
    expect(model.segments.every((segment) => Number.isFinite(segment.height))).toBe(true);
    expect(model.geoBounds).toEqual({ minLatitude: 37, maxLatitude: 37.02, minLongitude: 127, maxLongitude: 127.02 });
  });

  it('omits invalid segment geometry while retaining valid endpoint metadata', () => {
    const invalid = metric({ toStationId: 'B', toLatitude: 91, toLongitude: 127 });
    const model = buildTransit3DModel([invalid]);

    expect(model.segments).toHaveLength(0);
    expect(model.stops.map((stop) => stop.stationId)).toEqual(['A']);
    expect(model.omittedCoordinateCount).toBe(1);
  });

  it('uses a stable minimum height when all peak values are zero', () => {
    const model = buildTransit3DModel([metric({ peakOnboardPassengers: 0 })]);

    expect(model.segments[0].height).toBeGreaterThan(0);
    expect(model.bounds.maxZ).toBe(model.segments[0].height);
  });
});
