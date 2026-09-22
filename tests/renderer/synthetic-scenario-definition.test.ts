import { describe, expect, it } from 'vitest';
import type { RouteStopMasterRecord, ScenarioAddedRoute, ScenarioOperationPlan, ScenarioRouteChange } from '../../src/shared/types';
import { buildPrimaryScenarioDefinition, preserveLegacyScenarioDefinitions, upsertScenarioAddedRoute, upsertScenarioRouteChange } from '../../src/renderer/synthetic-scenario-definition';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'A', stationName: 'A 정류장', latitude: 37.1, longitude: 127.1 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'B', stationName: 'B 정류장', latitude: 37.2, longitude: 127.2 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 3, stationId: 'C', stationName: 'C 정류장', latitude: 37.3, longitude: 127.3 }
];

const operation: ScenarioOperationPlan = {
  serviceDays: [0, 1, 2, 3, 4],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: 10,
  vehicleCount: 4,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: { modelVersion: 'test-model', speedsKph: { unknown: 15 }, intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30 }
};

describe('synthetic scenario definition adapter', () => {
  it('persists current and scenario paths with an automatic label', () => {
    const definition = buildPrimaryScenarioDefinition({ projectId: 'project-1', routeStops, routeId: 'R1', label: '', scenarioStopIds: ['B', 'A', 'C'], beforeOperation: operation, afterOperation: operation });

    expect(definition.label).toBe('101번 정류장 개편안');
    expect(definition.routeChanges[0].baseStopIds).toEqual(['A', 'B', 'C']);
    expect(definition.routeChanges[0].scenarioStopIds).toEqual(['B', 'A', 'C']);
    expect(definition.journeyQueries).toBeUndefined();
    expect(definition.source.projectId).toBe('project-1');
  });

  it('replaces only the matching definition and preserves other definitions', () => {
    const next = buildPrimaryScenarioDefinition({ projectId: 'project-1', routeStops, routeId: 'R1', label: '새 개편안', scenarioStopIds: ['A', 'C'], beforeOperation: operation, afterOperation: operation });
    const other = { ...next, scenarioId: 'other', label: '다른 시나리오' };
    const replaced = preserveLegacyScenarioDefinitions([other, next], { ...next, label: '수정된 개편안' });

    expect(replaced).toHaveLength(2);
    expect(replaced[0].label).toBe('다른 시나리오');
    expect(replaced[1].label).toBe('수정된 개편안');
  });

  it('writes schema v3 for a new-route-only overlay definition', () => {
    const definition = buildPrimaryScenarioDefinition({
      projectId: 'project-1', routeStops, routeId: 'R1', label: 'R1 + 신규 정류장', scenarioStopIds: ['A', 'scenario-stop-1', 'B'],
      addedStations: [{ stationId: 'scenario-stop-1', stationName: '새 정류장', latitude: 37.2, longitude: 127.2 }],
      stationOverrides: [],
      addedRoutes: [{ routeId: 'N-1', routeName: '신규 노선', transportMode: '버스', stopIds: ['A', 'scenario-stop-1'], afterOperation: operation }],
      routeChanges: [], beforeOperation: operation, afterOperation: operation
    });

    expect(definition.scenarioSchemaVersion).toBe(3);
    expect(definition.routeChanges).toEqual([]);
    expect(definition.addedRoutes?.[0].routeId).toBe('N-1');
  });

  it('keeps multiple existing-route changes and new routes in one scenario draft', () => {
    const firstChange = buildPrimaryScenarioDefinition({ projectId: 'project-1', routeStops, routeId: 'R1', label: '다중 노선', scenarioStopIds: ['A', 'C'], beforeOperation: operation, afterOperation: operation }).routeChanges[0];
    const secondChange: ScenarioRouteChange = { ...firstChange, routeId: 'R2', baseStopIds: ['X', 'Y'], scenarioStopIds: ['X', 'Y'] };
    const firstRoute: ScenarioAddedRoute = { routeId: 'N-1', routeName: '신규 1', transportMode: '버스', stopIds: ['A', 'B'], afterOperation: operation };
    const secondRoute: ScenarioAddedRoute = { ...firstRoute, routeId: 'N-2', routeName: '신규 2' };

    expect(upsertScenarioRouteChange([firstChange], secondChange).map((change) => change.routeId)).toEqual(['R1', 'R2']);
    expect(upsertScenarioRouteChange([firstChange], { ...firstChange, scenarioStopIds: ['C', 'A'] }).map((change) => change.scenarioStopIds)).toEqual([['C', 'A']]);
    expect(upsertScenarioAddedRoute([firstRoute], secondRoute).map((route) => route.routeId)).toEqual(['N-1', 'N-2']);
    expect(upsertScenarioAddedRoute([firstRoute], { ...firstRoute, routeName: '수정 신규 1' })[0].routeName).toBe('수정 신규 1');
  });
});
