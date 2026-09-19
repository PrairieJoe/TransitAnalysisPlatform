import { expect, it } from 'vitest';
import { buildRouteCongestionMapModel, routeSegmentKey } from '../../../src/core/route-demand-view';
import { buildTransit3DModel } from '../../../src/renderer/three/model';
import { createTransitLayers, updateSegmentSelection } from '../../../src/renderer/three/layers';
import { disposeSceneResources } from '../../../src/renderer/three/scene';
import type { RouteSegmentMetric } from '../../../src/shared/types';

const metric: RouteSegmentMetric = {
  routeId: 'R', routeName: 'R', transportMode: 'B', direction: 'forward', directionLabel: '순방향',
  fromSequence: 1, toSequence: 2, fromStationId: 'A', toStationId: 'B', fromStationName: 'A', toStationName: 'B',
  fromLatitude: 37, fromLongitude: 127, toLatitude: 37.01, toLongitude: 127.01,
  previousOnboard: 0, boardings: 10, alightings: 0, onboardPassengers: 10, peakOnboardPassengers: 10,
  averageOnboardPassengers: 10, totalBoardings: 10, totalAlightings: 0, vehicleCapacity: 40, dailyTrips: 10, congestionPercent: 25, rank: 1
};
const points = [{ latitude: 37, longitude: 127 }, { latitude: 37.02, longitude: 127 }, { latitude: 37.01, longitude: 127.01 }];

it('uses the same curved road shape in 2D and 3D without changing demand or selection keys', () => {
  const shapes = [{ key: routeSegmentKey(metric), points, source: 'osm' as const }];
  const map = buildRouteCongestionMapModel([metric], undefined, shapes);
  expect(map.segments[0].points).toEqual(points);
  const model = buildTransit3DModel([metric], shapes);
  expect(model.geoBounds.maxLatitude).toBe(37.02);
  expect(model.segments[0].path).toHaveLength(3);
  expect(model.segments[0].peakOnboardPassengers).toBe(10);
  const layers = createTransitLayers(model, { width: 800, height: 600 });
  try {
    const line = layers.segmentObjects.get(routeSegmentKey(metric))!;
    expect(line.geometry.getAttribute('instanceStart').count).toBe(2);
    const volume = layers.segmentVolumeObjects.get(routeSegmentKey(metric))!;
    expect(volume.geometry.getAttribute('position').count).toBe(48);
    updateSegmentSelection(layers, routeSegmentKey(metric));
    expect(volume.userData.selected).toBe(true);
  } finally { disposeSceneResources(layers.root); }
});

it('ignores mismatched keys, invalid geometry and stale endpoints', () => {
  for (const shape of [
    { key: 'other', points },
    { key: routeSegmentKey(metric), points: [{ latitude: NaN, longitude: 127 }, ...points] },
    { key: routeSegmentKey(metric), points: points.slice(1) }
  ]) {
    const map = buildRouteCongestionMapModel([metric], undefined, [shape]);
    expect(map.segments[0].points).toHaveLength(2);
  }
});
