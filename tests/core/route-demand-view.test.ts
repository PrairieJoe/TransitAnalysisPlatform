import { describe, expect, it } from 'vitest';
import { buildRouteCongestionMapModel } from '../../src/core/route-demand-view';
import { congestionColor, CONGESTION_BANDS } from '../../src/core/route-analysis';

const metric = (overrides: Record<string, unknown> = {}) => ({
  routeId: 'R1', routeName: '노선1', transportMode: 'B', direction: 'forward', directionLabel: '순방향', fromSequence: 0, toSequence: 1, fromStationId: 'A', toStationId: 'B', fromStationName: 'A', toStationName: 'B', fromLatitude: 34.75, fromLongitude: 127.73, toLatitude: 34.76, toLongitude: 127.74, previousOnboard: 0, boardings: 10, alightings: 0, onboardPassengers: 10, peakOnboardPassengers: 10, averageOnboardPassengers: 10, totalBoardings: 10, totalAlightings: 0, vehicleCapacity: 10, dailyTrips: 1, congestionPercent: 50, rank: 1, ...overrides
});

describe('route congestion map model', () => {
  it('uses the five supplied bands and preserves selected segment emphasis', () => {
    expect(CONGESTION_BANDS).toHaveLength(5);
    expect(congestionColor(10)).toBe('#55b947');
    expect(congestionColor(10.1)).toBe('#8bd25a');
    expect(congestionColor(41)).toBe('#e62626');
    const model = buildRouteCongestionMapModel([metric(), metric({ fromSequence: 1, toSequence: 2, fromStationId: 'B', toStationId: 'C', fromStationName: 'B', toStationName: 'C', toLatitude: 34.77, toLongitude: 127.75, congestionPercent: 20, peakOnboardPassengers: 20 })], 'R1\u001fforward\u001f1\u001f2\u001fB\u001fC');
    expect(model.segments).toHaveLength(2);
    expect(model.segments[1].width).toBe(8);
    expect(model.stops.map((stop) => stop.stationId)).toEqual(['A', 'B', 'C']);
  });

  it('uses gray for an unavailable denominator', () => {
    expect(congestionColor(null)).toBe('#b8c1c9');
  });
});
