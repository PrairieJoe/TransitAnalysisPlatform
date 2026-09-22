import { expect, it } from 'vitest';
import { buildCurrentRouteSearchGtfs } from '../../src/core/route-search';
import type { RouteStopMasterRecord } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'S1', stationName: '시청', latitude: 37.1, longitude: 127.1 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'S2', stationName: '터미널', latitude: 37.2, longitude: 127.2 },
  { routeId: 'R2', routeName: '202번', transportMode: '버스', stationSequence: 1, stationId: 'S2', stationName: '터미널', latitude: 37.2, longitude: 127.2 },
  { routeId: 'R2', routeName: '202번', transportMode: '버스', stationSequence: 2, stationId: 'S3', stationName: '역', latitude: 37.3, longitude: 127.3 }
];

it('builds a current-network GTFS feed for independent route search', () => {
  const result = buildCurrentRouteSearchGtfs({ routeStops, serviceConfigs: [] });

  expect(result.validation.isValid).toBe(true);
  expect(result.summary.routeCount).toBe(2);
  expect(result.files['routes.txt']).toContain('R1');
  expect(result.files['routes.txt']).toContain('R2');
  expect(result.files['stops.txt']).toContain('S1');
});
