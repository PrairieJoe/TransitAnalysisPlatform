import { expect, it } from 'vitest';
import type { ScenarioDefinition, ScenarioOperationPlan } from '../../src/shared/types';
import {
  assertValidScenarioDefinition,
  createScenarioDefinition,
  createScenarioDefinitionFromLegacyDeltas,
  upgradeScenarioDefinition,
  scenarioDefinitionToLegacyDeltas,
  validateScenarioDefinition
} from '../../src/core/scenario-contract';
import type { ScenarioDelta } from '../../src/shared/types';

const operation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
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
    modelVersion: 'baseline-stop-distance-1',
    speedsKph: { unknown: 15, primary: 30 },
    intersectionDelaySeconds: 5,
    turnDelaySeconds: 10,
    minimumSegmentSeconds: 30
  },
  ...overrides
});

const definition = (): ScenarioDefinition => ({
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-1',
  label: '복수 노선 개편',
  routeChanges: [
    {
      routeId: 'R-A',
      routeName: 'A 노선',
      transportMode: 'bus',
      baseStopIds: ['A-1', 'A-2', 'A-3'],
      scenarioStopIds: ['A-1', 'A-4', 'A-3'],
      beforeOperation: operation(),
      afterOperation: operation({ headwayMinutes: 15, vehicleCount: 3 })
    },
    {
      routeId: 'R-B',
      routeName: 'B 노선',
      transportMode: 'bus',
      baseStopIds: ['B-1', 'B-2'],
      scenarioStopIds: ['B-1', 'B-2', 'B-3', 'B-4'],
      beforeOperation: operation({ firstDeparture: '07:00', lastDeparture: '20:00' }),
      afterOperation: operation({ firstDeparture: '05:30', lastDeparture: '23:00', dwellSeconds: 35 })
    }
  ],
  journeyQueries: [{ originStopId: 'A-1', destinationStopId: 'B-4', departureDateTime: '2026-03-02T08:00:00+09:00' }],
  source: {
    projectId: 'project-1',
    routeMasterSource: 'route-master.csv',
    assumptions: ['역간 도로등급은 unknown으로 시작한다.'],
    warnings: ['실제 도로 형상은 후속 단계에서 보강한다.'],
    modelVersions: ['baseline-stop-distance-1']
  },
  environment: { motisVersion: '2.11.3', osmPbfFileName: 'seoul.osm.pbf', osmPbfSha256: 'abc123' },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
});

it('accepts multiple routes with independent before and after operation plans', () => {
  const result = validateScenarioDefinition(definition());
  expect(result).toEqual({
    errors: [],
    warnings: ['실제 도로 형상은 후속 단계에서 보강한다.'],
    isValid: true
  });
});

it('rejects duplicate route and stop identifiers', () => {
  const duplicateRoute = definition();
  duplicateRoute.routeChanges[1].routeId = 'R-A';
  const duplicateStop = definition();
  duplicateStop.routeChanges[0].scenarioStopIds = ['A-1', 'A-1'];

  expect(validateScenarioDefinition(duplicateRoute).errors).toEqual(expect.arrayContaining([
    'routeChanges[1].routeId: 노선 ID가 중복되었습니다.'
  ]));
  expect(validateScenarioDefinition(duplicateStop).errors).toEqual(expect.arrayContaining([
    'routeChanges[0].scenarioStopIds: 정류장 ID가 중복되었습니다.'
  ]));
});

it('rejects invalid operation plans', () => {
  const invalid = definition();
  invalid.routeChanges[0].afterOperation = operation({
    serviceDays: [1, 1, 7],
    firstDeparture: '23:00',
    lastDeparture: '08:00',
    headwayMinutes: 0,
    vehicleCount: 0,
    dwellSeconds: -1,
    startDate: '2026-02-30',
    endDate: '2026-01-01',
    travelTimeModel: {
      modelVersion: '',
      speedsKph: { unknown: 0 },
      intersectionDelaySeconds: -1,
      turnDelaySeconds: 0,
      minimumSegmentSeconds: -1
    }
  });

  const result = validateScenarioDefinition(invalid);
  expect(result.isValid).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining([
    'routeChanges[0].afterOperation.serviceDays: 운행요일은 0~6 범위의 중복 없는 정수여야 합니다.',
    'routeChanges[0].afterOperation.firstDeparture: 첫차가 막차보다 늦습니다.',
    'routeChanges[0].afterOperation.headwayMinutes: 배차간격은 1분 이상의 정수여야 합니다.',
    'routeChanges[0].afterOperation.vehicleCount: 운행대수는 1 이상의 정수여야 합니다.',
    'routeChanges[0].afterOperation.startDate: 유효한 날짜 범위가 아닙니다.',
    'routeChanges[0].afterOperation.travelTimeModel.speedsKph.unknown: 기준속도는 0보다 커야 합니다.'
  ]));
});

it('rejects malformed runtime input with field paths', () => {
  const malformed = { scenarioId: '', routeChanges: 'not-an-array' };
  const result = validateScenarioDefinition(malformed);
  expect(result.isValid).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining([
    'scenarioSchemaVersion: 시나리오 스키마 버전은 1 또는 2이어야 합니다.',
    'scenarioId: 시나리오 ID가 비어 있습니다.',
    'routeChanges: 노선 변경은 1개 이상이어야 합니다.'
  ]));
  expect(() => assertValidScenarioDefinition(malformed)).toThrow('시나리오 정의가 유효하지 않습니다');
});

it('creates one validated definition and derives one legacy delta per route', () => {
  const source = definition();
  const { scenarioSchemaVersion: _version, ...input } = source;
  const created = createScenarioDefinition(input);
  const deltas = scenarioDefinitionToLegacyDeltas(created);

  expect(created.scenarioSchemaVersion).toBe(2);
  expect(deltas).toHaveLength(2);
  expect(deltas.map((delta) => delta.routeId)).toEqual(['R-A', 'R-B']);
  expect(deltas[0]).toMatchObject({
    scenarioId: 'scenario-1:R-A',
    label: '복수 노선 개편',
    baseStopIds: ['A-1', 'A-2', 'A-3'],
    scenarioStopIds: ['A-1', 'A-4', 'A-3'],
    addedStopIds: ['A-4'],
    removedStopIds: ['A-2'],
    createdAt: source.createdAt
  });
});

it('always writes the current scenario schema version for runtime input', () => {
  const source = definition();
  const { scenarioSchemaVersion: _version, ...input } = source;
  const created = createScenarioDefinition({ ...input, scenarioSchemaVersion: 99 } as never);
  expect(created.scenarioSchemaVersion).toBe(2);
});

it('requires explicit operation plans when promoting legacy deltas', () => {
  const legacy: ScenarioDelta[] = [
    {
      scenarioId: 'legacy-a', label: '기존 개편', routeId: 'R-A',
      baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'],
      addedStopIds: ['A-3'], removedStopIds: ['A-2'], warnings: ['경로 확인 필요'], createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      scenarioId: 'legacy-b', label: '기존 개편', routeId: 'R-B',
      baseStopIds: ['B-1', 'B-2'], scenarioStopIds: ['B-1', 'B-2', 'B-3'],
      addedStopIds: ['B-3'], removedStopIds: [], warnings: [], createdAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  const input = {
    scenarioId: 'promoted-1',
    label: '승격한 개편',
    deltas: legacy,
    operationsByRouteId: {
      'R-A': { beforeOperation: operation(), afterOperation: operation({ headwayMinutes: 15 }) },
      'R-B': { beforeOperation: operation({ vehicleCount: 2 }), afterOperation: operation({ vehicleCount: 5 }) }
    },
    source: { assumptions: [], warnings: [], modelVersions: [] },
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };

  const promoted = createScenarioDefinitionFromLegacyDeltas(input);
  expect(promoted.routeChanges).toHaveLength(2);
  expect(promoted.routeChanges[0].afterOperation.headwayMinutes).toBe(15);
  expect(promoted.routeChanges[1].beforeOperation.vehicleCount).toBe(2);
  expect(promoted.source.warnings).toEqual(['경로 확인 필요']);

  expect(() => createScenarioDefinitionFromLegacyDeltas({
    ...input,
    operationsByRouteId: { 'R-A': input.operationsByRouteId['R-A'] }
  })).toThrow('R-B');
});

it('accepts coordinate A-B queries in scenario schema v2', () => {
  const source = definition();
  const candidate = {
    ...source,
    scenarioSchemaVersion: 2,
    journeyQueries: [{
      origin: { kind: 'coordinate', latitude: 34.7604, longitude: 127.6622, label: 'A' },
      destination: { kind: 'coordinate', latitude: 34.7463, longitude: 127.7441, label: 'B' },
      departureDateTime: '2026-09-20T08:00'
    }]
  };
  expect(validateScenarioDefinition(candidate)).toMatchObject({ errors: [], isValid: true });
});

it('rejects unsafe or identical coordinate endpoints', () => {
  const source = definition();
  const candidate = {
    ...source,
    scenarioSchemaVersion: 2,
    journeyQueries: [{
      origin: { kind: 'coordinate', latitude: 91, longitude: Number.NaN },
      destination: { kind: 'coordinate', latitude: 37, longitude: 127 },
      departureDateTime: '2026-09-20T08:00'
    }]
  };
  const invalid = validateScenarioDefinition(candidate);
  expect(invalid.errors).toEqual(expect.arrayContaining([
    'journeyQueries[0].origin.latitude: 위도는 -90~90 범위의 유한한 숫자여야 합니다.',
    'journeyQueries[0].origin.longitude: 경도는 -180~180 범위의 유한한 숫자여야 합니다.'
  ]));

  const identical = {
    ...candidate,
    journeyQueries: [{
      origin: { kind: 'coordinate', latitude: 37, longitude: 127 },
      destination: { kind: 'coordinate', latitude: 37, longitude: 127 },
      departureDateTime: '2026-09-20T08:00'
    }]
  };
  expect(validateScenarioDefinition(identical).errors).toContain('journeyQueries[0]: 출발지와 도착지는 달라야 합니다.');
});

it('upgrades legacy v1 stop queries to v2 without pretending they are coordinates', () => {
  const upgraded = upgradeScenarioDefinition(definition());
  expect(upgraded.scenarioSchemaVersion).toBe(2);
  expect(upgraded.journeyQueries).toEqual([{
    origin: { kind: 'stop', stopId: 'A-1' },
    destination: { kind: 'stop', stopId: 'B-4' },
    departureDateTime: '2026-03-02T08:00:00+09:00'
  }]);
  expect(definition().scenarioSchemaVersion).toBe(1);
});

it('rejects an unknown future scenario schema version', () => {
  const result = validateScenarioDefinition({ ...definition(), scenarioSchemaVersion: 3 });
  expect(result.errors).toContain('scenarioSchemaVersion: 지원하지 않는 시나리오 스키마 버전입니다.');
  expect(() => upgradeScenarioDefinition({ ...definition(), scenarioSchemaVersion: 3 })).toThrow('지원하지 않는 시나리오 스키마 버전입니다.');
});
