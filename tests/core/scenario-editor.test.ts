import { expect, it } from 'vitest';
import type { RouteStopMasterRecord, ScenarioDefinition, ScenarioOperationPlan } from '../../src/shared/types';
import {
  buildScenarioDefinitionInput,
  endpointDraftToValue,
  parseScenarioStopText,
  scenarioDefinitionToEditorDraft,
  selectRepresentativeRouteStopIds,
  validateScenarioEditorDraft,
  upsertScenarioDefinition,
  type ScenarioEditorDraft,
  type ScenarioOperationDraft
} from '../../src/core/scenario-editor';
import { createScenarioDefinition } from '../../src/core/scenario-contract';

const operation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: 10, vehicleCount: 4, dwellSeconds: 20,
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'baseline-stop-distance-1', speedsKph: { unknown: 15 },
    intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30
  },
  ...overrides
});

const stops: RouteStopMasterRecord[] = [
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 3, stationId: 'A-3', stationName: 'A3', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', serviceDate: '2026-04-01', stationSequence: 1, stationId: 'A-9', stationName: 'A9', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', serviceDate: '2026-04-01', stationSequence: 2, stationId: 'A-10', stationName: 'A10', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 1, stationId: 'B-1', stationName: 'B1', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 2, stationId: 'B-2', stationName: 'B2', latitude: 37, longitude: 127 }
];

const operationDraft = (overrides: Partial<ScenarioOperationDraft> = {}): ScenarioOperationDraft => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: '10', vehicleCount: '4', dwellSeconds: '20',
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  ...overrides
});

const draft = (): ScenarioEditorDraft => ({
  scenarioId: 'scenario-1', label: '다중 노선 입력',
  routeChanges: [
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', baseStopIds: ['A-1', 'A-2', 'A-3'], scenarioStopText: 'A-1, A-9, A-3', beforeOperation: operationDraft(), afterOperation: operationDraft({ headwayMinutes: '15', vehicleCount: '3' }) },
    { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', baseStopIds: ['B-1', 'B-2'], scenarioStopText: 'B-1,B-2', beforeOperation: operationDraft({ vehicleCount: '2' }), afterOperation: operationDraft({ vehicleCount: '5' }) }
  ],
  journeyQueries: [{ origin: { kind: 'stop', stopId: 'A-1' }, destination: { kind: 'stop', stopId: 'B-2' }, departureDateTime: '2026-04-01T08:00:00+09:00' }],
  source: { projectId: 'project-1', routeMasterSource: 'routes.csv', assumptions: [], warnings: [], modelVersions: ['baseline-stop-distance-1'] },
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z'
});

it('selects a stable representative route path', () => {
  expect(selectRepresentativeRouteStopIds(stops, 'R-A')).toEqual(['A-1', 'A-2', 'A-3']);
  expect(selectRepresentativeRouteStopIds(stops, 'missing')).toEqual([]);
});

it('preserves order and reports unknown or duplicate stop IDs', () => {
  expect(parseScenarioStopText(' A-1, A-9, A-1, ,A-3 ')).toEqual(['A-1', 'A-9', 'A-1', 'A-3']);
  const errors = validateScenarioEditorDraft({ ...draft(), routeChanges: [{ ...draft().routeChanges[0], scenarioStopText: 'A-1,A-404,A-1' }] }, stops);
  expect(errors).toEqual(expect.arrayContaining(['routeChanges[0].scenarioStopIds: master에 없는 정류장 ID A-404', 'routeChanges[0].scenarioStopIds: 정류장 ID가 중복되었습니다.']));
});

it('builds independent operation plans per route and side', () => {
  const input = buildScenarioDefinitionInput(draft());
  expect(input.routeChanges.map((change) => [change.beforeOperation.vehicleCount, change.afterOperation.vehicleCount])).toEqual([[4, 3], [2, 5]]);
  expect(input.routeChanges[0].beforeOperation).not.toBe(input.routeChanges[0].afterOperation);
  expect(input.routeChanges[0].afterOperation.headwayMinutes).toBe(15);
  expect(input.routeChanges[1].beforeOperation.vehicleCount).toBe(2);
});

it('round-trips an existing definition into an editable draft', () => {
  const definition: ScenarioDefinition = {
    scenarioSchemaVersion: 1, scenarioId: 'saved-1', label: '저장된 시나리오',
    routeChanges: [{ routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'], beforeOperation: operation(), afterOperation: operation({ vehicleCount: 3 }) }],
    journeyQueries: [], source: { assumptions: [], warnings: [], modelVersions: ['model-1'] }, createdAt: '2026-01-01', updatedAt: '2026-01-02'
  };
  const edited = scenarioDefinitionToEditorDraft(definition);
  expect(edited.scenarioId).toBe('saved-1');
  expect(edited.routeChanges[0].scenarioStopText).toBe('A-1,A-3');
  expect(edited.routeChanges[0].afterOperation.vehicleCount).toBe('3');
});

it('upserts by stable scenario id', () => {
  const existing = { scenarioId: 'scenario-1', label: 'old' } as ScenarioDefinition;
  const replacement = { scenarioId: 'scenario-1', label: 'new' } as ScenarioDefinition;
  const appended = { scenarioId: 'scenario-2', label: 'second' } as ScenarioDefinition;
  expect(upsertScenarioDefinition([existing], replacement)).toEqual([replacement]);
  expect(upsertScenarioDefinition([existing], appended)).toEqual([existing, appended]);
});

it('converts coordinate drafts without rounding or losing labels', () => {
  expect(endpointDraftToValue({ kind: 'coordinate', latitudeText: '34.7604', longitudeText: '127.6622', label: ' A ' })).toEqual({
    kind: 'coordinate', latitude: 34.7604, longitude: 127.6622, label: 'A'
  });
  expect(endpointDraftToValue({ kind: 'stop', stopId: ' 3250842 ' })).toEqual({ kind: 'stop', stopId: '3250842' });
});

it('round-trips migrated stop endpoints and saves coordinate endpoints in v2', () => {
  const source = draft();
  source.journeyQueries = [{
    origin: { kind: 'coordinate', latitudeText: '34.7604', longitudeText: '127.6622', label: 'A' },
    destination: { kind: 'stop', stopId: 'B-2' },
    departureDateTime: '2026-04-01T08:00'
  }];
  const input = buildScenarioDefinitionInput(source);
  expect(input.journeyQueries).toEqual([{
    origin: { kind: 'coordinate', latitude: 34.7604, longitude: 127.6622, label: 'A' },
    destination: { kind: 'stop', stopId: 'B-2' },
    departureDateTime: '2026-04-01T08:00'
  }]);

  const saved = createScenarioDefinition(buildScenarioDefinitionInput(source));
  const migrated = scenarioDefinitionToEditorDraft({
    ...saved,
    scenarioSchemaVersion: 1,
    journeyQueries: [{ originStopId: 'A-1', destinationStopId: 'B-2', departureDateTime: '2026-04-01T08:00' }]
  } as never);
  expect(migrated.journeyQueries[0]).toEqual({
    origin: { kind: 'stop', stopId: 'A-1' },
    destination: { kind: 'stop', stopId: 'B-2' },
    departureDateTime: '2026-04-01T08:00'
  });
});
