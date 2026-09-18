import { describe, expect, it } from 'vitest';
import { inferAlighting } from '../../src/core/alighting-inference';
import { analyzeRouteRecords } from '../../src/core/route-analysis';
import { routeSegmentKey } from '../../src/core/route-demand-view';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../../src/core/synthetic-gtfs/draft-builder';
import { buildTransit3DModel } from '../../src/renderer/three/model';
import { createTransitLayers } from '../../src/renderer/three/layers';
import { disposeSceneResources } from '../../src/renderer/three/scene';
import type { NormalizedRecord, RouteStopMasterRecord } from '../../src/shared/types';

const stops: RouteStopMasterRecord[] = ['A', 'B', 'C', 'D'].map((stationId, stationSequence) => ({
  routeId: 'R1', routeName: '통합 검증 노선', transportMode: 'B', stationId, stationName: stationId,
  stationSequence, latitude: 37, longitude: 127 + stationSequence * 0.001
}));
const records: NormalizedRecord[] = [
  { serviceDate: '2026-09-18', boardingTime: '08:00:00', boardingHour: 8, boardingCount: 10, virtualCardId: 'TEST', vehicleId: 'V1', route: 'R1', stationId: 'A' },
  { serviceDate: '2026-09-18', boardingTime: '08:15:00', boardingHour: 8, boardingCount: 5, virtualCardId: 'TEST', vehicleId: 'V1', route: 'R1', stationId: 'C', destinationStationId: 'D' }
];
const service = [{ routeId: 'R1', vehicleCapacity: 20, tripsByHour: { '8': 2 } }];
const config = { filter: { from: '2026-09-18', to: '2026-09-18' }, denominator: 'observed' as const, hour: 8 as const };

describe('integrated alighting, route visualization and GTFS workflow', () => {
  it('passes inferred loads into pickable 3D geometry without changing observed-only results', () => {
    const inferred = inferAlighting(records, stops, stops, {
      primaryDistanceMeters: 500, fallbackDistanceMeters: 1000, maxTransferMinutes: 30, serviceDayBoundaryHour: 4
    });
    expect(inferred.records[0].inferredDestinationStationId).toBe('C');
    const observed = analyzeRouteRecords(inferred.records, stops, service, { ...config, alightingMode: 'observed' });
    const enhanced = analyzeRouteRecords(inferred.records, stops, service, { ...config, alightingMode: 'high-confidence' });
    expect(observed.totalBoardings).toBe(5);
    expect(enhanced.totalBoardings).toBe(15);
    expect(records[0].inferredDestinationStationId).toBeUndefined();

    const model = buildTransit3DModel(enhanced.metrics);
    expect(model.omittedCoordinateCount).toBe(0);
    expect(model.segments.map((segment) => segment.key)).toEqual(enhanced.metrics.map(routeSegmentKey));
    const first = model.segments.find((segment) => segment.fromStationId === 'A');
    expect(first).toMatchObject({ peakOnboardPassengers: 10, congestionPercent: 50 });
    const layers = createTransitLayers(model, { width: 800, height: 600 });
    try {
      expect(layers.segmentVolumeObjects.size).toBe(model.segments.length);
      expect(layers.segmentObjects.has(first!.key)).toBe(true);
    } finally {
      disposeSceneResources(layers.root);
    }
  });

  it('reuses the same route master for GTFS after estimation and 3D conversion', () => {
    const original = JSON.stringify(stops);
    const inferred = inferAlighting(records, stops, stops, {
      primaryDistanceMeters: 500, fallbackDistanceMeters: 1000, maxTransferMinutes: 30, serviceDayBoundaryHour: 4
    });
    buildTransit3DModel(analyzeRouteRecords(inferred.records, stops, service, { ...config, alightingMode: 'high-confidence' }).metrics);
    const draft = buildSyntheticGtfsDraft(stops, service, {
      agencyId: 'test', agencyName: '통합 검증', routeId: 'R1', serviceDays: [0, 1, 2, 3, 4],
      firstDeparture: '06:00', lastDeparture: '23:00', vehicleCount: 8, headwayMinutes: 20,
      startDate: '20260101', endDate: '20261231', sourceName: 'integration-test',
      deriveReverseDirection: true, dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
    });
    expect(draft.validation.isValid).toBe(true);
    expect(draft.summary).toMatchObject({ routeCount: 1, stopCount: 4, tripCount: 104 });
    expect(JSON.stringify(stops)).toBe(original);
    expect(draft.files['stop_times.txt']).toContain('06:00:00');
  });
});
