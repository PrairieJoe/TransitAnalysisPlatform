import { describe, expect, it } from 'vitest';
import { executeScenarioNetwork } from '../../src/core/scenario-route-execution';
import type { MaterializedScenarioNetwork, MaterializedScenarioRoute } from '../../src/core/scenario-execution';
import type { ScenarioOperationPlan, ScenarioTravelTimeModel } from '../../src/shared/types';

const model: ScenarioTravelTimeModel = {
  modelVersion: 'route-test-1',
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
const route = (routeId: string, latitude: number): MaterializedScenarioRoute => ({
  routeId,
  routeName: `노선-${routeId}`,
  transportMode: 'BUS',
  source: 'scenario-after',
  stopRecords: [
    { routeId, routeName: `노선-${routeId}`, transportMode: 'BUS', stationSequence: 0, stationId: `${routeId}-1`, stationName: `${routeId}-1`, latitude, longitude: 127.73 },
    { routeId, routeName: `노선-${routeId}`, transportMode: 'BUS', stationSequence: 1, stationId: `${routeId}-2`, stationName: `${routeId}-2`, latitude: latitude + 0.01, longitude: 127.74 },
    { routeId, routeName: `노선-${routeId}`, transportMode: 'BUS', stationSequence: 2, stationId: `${routeId}-3`, stationName: `${routeId}-3`, latitude: latitude + 0.02, longitude: 127.75 }
  ],
  operation,
  warnings: []
});

const routeResponse = (start: { lat: number; lng: number }, destination: { lat: number; lng: number }) => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { way: 123 },
    geometry: { type: 'LineString', coordinates: [[start.lng, start.lat], [(start.lng + destination.lng) / 2, (start.lat + destination.lat) / 2], [destination.lng, destination.lat]] }
  }]
});

describe('scenario route execution', () => {
  it('stores routed forward and reverse segments with distance and model runtime', async () => {
    const network: MaterializedScenarioNetwork = { routes: [route('A', 34.75)], warnings: [] };
    const snapshot = await executeScenarioNetwork({
      network,
      request: async (_path, init) => {
        const body = JSON.parse(init?.body ?? '{}');
        return routeResponse(body.start, body.destination);
      }
    });

    const execution = snapshot.routes[0];
    expect(snapshot.status).toBe('complete');
    expect(execution.status).toBe('complete');
    expect(execution.directions).toHaveLength(2);
    expect(execution.directions[0].segments[0]).toMatchObject({ source: 'osm', provenance: { sourceType: 'OSM_ROUTED' } });
    expect(execution.totalDistanceMeters).toBeGreaterThan(0);
    expect(execution.totalRuntimeSeconds).toBeGreaterThan(0);
  });

  it('keeps successful routes and marks a fallback route partial', async () => {
    const network: MaterializedScenarioNetwork = { routes: [route('OK', 34.75), route('FAIL', 36.00)], warnings: [] };
    const snapshot = await executeScenarioNetwork({
      network,
      request: async (_path, init) => {
        const body = JSON.parse(init?.body ?? '{}');
        if (body.start.lat >= 36) throw new Error('MOTIS unavailable');
        return routeResponse(body.start, body.destination);
      }
    });

    expect(snapshot.status).toBe('partial');
    expect(snapshot.routes.find((item) => item.routeId === 'OK')?.status).toBe('complete');
    const failedRoute = snapshot.routes.find((item) => item.routeId === 'FAIL');
    expect(failedRoute?.status).toBe('partial');
    expect(failedRoute?.directions[0].segments[0].source).toBe('beeline');
    expect(failedRoute?.directions[0].segments[0].provenance.sourceType).toBe('BEELINE_FALLBACK');
  });
});
