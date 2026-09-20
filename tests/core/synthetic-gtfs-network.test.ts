import { describe, expect, it } from 'vitest';
import { buildSyntheticGtfsNetwork } from '../../src/core/synthetic-gtfs/network-builder';
import type { MaterializedScenarioRoute } from '../../src/core/scenario-execution';
import type { ScenarioOperationPlan, ScenarioTravelTimeModel } from '../../src/shared/types';

const model: ScenarioTravelTimeModel = {
  modelVersion: 'network-test-1',
  speedsKph: { residential: 15, tertiary: 20, secondary: 25, primary: 30, trunk: 45, motorway: 60, unknown: 15 },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 30
};
const operation: ScenarioOperationPlan = {
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  headwayMinutes: 20,
  vehicleCount: 8,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: model
};
const route = (routeId: string, source: MaterializedScenarioRoute['source'], startSequence: number): MaterializedScenarioRoute => ({
  routeId,
  routeName: `노선-${routeId}`,
  transportMode: 'BUS',
  source,
  stopRecords: [
    { routeId, routeName: `노선-${routeId}`, transportMode: 'BUS', stationSequence: startSequence, stationId: `${routeId}-1`, stationName: `${routeId}-1`, latitude: 34.75, longitude: 127.73 },
    { routeId, routeName: `노선-${routeId}`, transportMode: 'BUS', stationSequence: startSequence + 1, stationId: `${routeId}-2`, stationName: `${routeId}-2`, latitude: 34.76, longitude: 127.74 }
  ],
  operation,
  warnings: source === 'current' ? ['MODEL_ESTIMATED: current default'] : []
});

describe('multi-route Synthetic GTFS network', () => {
  it('combines every materialized route and preserves scenario stop order', () => {
    const result = buildSyntheticGtfsNetwork({
      routes: [route('A', 'scenario-after', 7), route('B', 'current', 3)],
      agencyId: 'agency',
      agencyName: 'Test Agency',
      sourceName: 'scenario:s-1'
    });

    expect(result.summary.routeCount).toBe(2);
    expect(result.files['routes.txt']).toContain('A');
    expect(result.files['routes.txt']).toContain('B');
    expect(result.files['stops.txt']).toContain('A-1');
    expect(result.files['stop_times.txt'].indexOf('A-1')).toBeLessThan(result.files['stop_times.txt'].indexOf('A-2'));
  });
});
