import { expect, it } from 'vitest';
import type {
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioOperationPlan,
  StationMasterRecord
} from '../../src/shared/types';
import {
  buildScenarioOverlayFingerprint,
  materializeScenarioNetwork
} from '../../src/core/scenario-network-overlay';

const operation = (): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: 10,
  vehicleCount: 4,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'overlay-test-1',
    speedsKph: { unknown: 20 },
    intersectionDelaySeconds: 5,
    turnDelaySeconds: 10,
    minimumSegmentSeconds: 30
  }
});

const stop = (stationId: string, stationSequence: number, latitude: number, longitude: number): RouteStopMasterRecord => ({
  routeId: 'R1',
  routeName: '기존 노선',
  transportMode: '버스',
  stationSequence,
  stationId,
  stationName: `정류장 ${stationId}`,
  latitude,
  longitude
});

const routeStops: RouteStopMasterRecord[] = [
  stop('S1', 1, 37.500, 127.100),
  stop('S2', 2, 37.510, 127.110),
  stop('S3', 3, 37.520, 127.120)
];

const station = (stationId: string): StationMasterRecord => ({
  stationId,
  stationName: `정류장 ${stationId}`,
  latitude: 37.515,
  longitude: 127.115
});

const routeChange = (scenarioStopIds = ['S1', 'S2', 'S3']) => ({
  routeId: 'R1',
  routeName: '기존 노선',
  transportMode: '버스',
  baseStopIds: ['S1', 'S2', 'S3'],
  scenarioStopIds,
  beforeOperation: operation(),
  afterOperation: operation()
});

const baseDefinition = (): ScenarioDefinition => ({
  scenarioSchemaVersion: 3,
  scenarioId: 'scenario-1',
  label: '개편안',
  routeChanges: [routeChange()],
  source: { assumptions: [], warnings: [], modelVersions: [] },
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z'
});

const overlayDefinition = (): ScenarioDefinition => ({
  ...baseDefinition(),
  addedStations: [{ stationId: 'S-new', stationName: '신규 정류장', latitude: 37.530, longitude: 127.130 }],
  stationOverrides: [{ stationId: 'S1', latitude: 37.501 }],
  addedRoutes: [{
    routeId: 'N-1',
    routeName: '신규 노선',
    transportMode: '버스',
    stopIds: ['S-new', 'S2'],
    afterOperation: operation()
  }]
});

it('adds an existing station-master stop to an existing route without mutating the source', () => {
  const source = structuredClone(routeStops);
  const definition = { ...baseDefinition(), routeChanges: [routeChange(['S1', 'S4', 'S2'])] };
  const result = materializeScenarioNetwork({ routeStops, stationMaster: [station('S4')], scenarioDefinition: definition });

  expect(result.scenarioRouteStops.filter((stop) => stop.routeId === 'R1').map((stop) => stop.stationId)).toEqual(['S1', 'S4', 'S2']);
  expect(routeStops).toEqual(source);
});

it('materializes a new station, station override, and new route only in the scenario network', () => {
  const sourceRouteStops = structuredClone(routeStops);
  const sourceStationMaster = [station('S-existing')];
  const result = materializeScenarioNetwork({ routeStops, stationMaster: sourceStationMaster, scenarioDefinition: overlayDefinition() });

  expect(result.currentRouteStops.some((stop) => stop.routeId === 'N-1')).toBe(false);
  expect(result.scenarioRouteStops.filter((stop) => stop.routeId === 'N-1').map((stop) => stop.stationId)).toEqual(['S-new', 'S2']);
  expect(result.scenarioRouteStops.find((stop) => stop.stationId === 'S1')?.latitude).toBe(37.501);
  expect(result.addedRouteIds).toEqual(['N-1']);
  expect(routeStops).toEqual(sourceRouteStops);
  expect(sourceStationMaster).toEqual([station('S-existing')]);
});

it('rejects missing stations, route ID collisions, and paths shorter than two stops', () => {
  expect(() => materializeScenarioNetwork({
    routeStops,
    scenarioDefinition: { ...baseDefinition(), routeChanges: [routeChange(['S1', 'missing-stop'])] }
  })).toThrow('정류장');
  expect(() => materializeScenarioNetwork({
    routeStops,
    scenarioDefinition: { ...overlayDefinition(), addedRoutes: [{ ...overlayDefinition().addedRoutes![0], routeId: 'R1' }] }
  })).toThrow('노선 ID');
  expect(() => materializeScenarioNetwork({
    routeStops,
    scenarioDefinition: { ...overlayDefinition(), addedRoutes: [{ ...overlayDefinition().addedRoutes![0], stopIds: ['S-new'] }] }
  })).toThrow('최소 2개');
});

it('changes the overlay fingerprint when order, coordinates, or new routes change', () => {
  const reordered = { ...baseDefinition(), routeChanges: [routeChange(['S1', 'S3', 'S2'])] };
  const moved = { ...baseDefinition(), stationOverrides: [{ stationId: 'S1', latitude: 37.501 }] };
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(reordered));
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(moved));
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(overlayDefinition()));
});
