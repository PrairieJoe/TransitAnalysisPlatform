import { describe, expect, it, vi } from 'vitest';
import { runScenarioComparison, type ScenarioComparisonClientInput } from '../../src/renderer/scenario-comparison-client';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionManifest,
  ScenarioExecutionResult,
  ScenarioOperationPlan,
  ScenarioTravelTimeModel
} from '../../src/shared/types';

const model: ScenarioTravelTimeModel = {
  modelVersion: 'comparison-client-model-1',
  speedsKph: { unknown: 20 },
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

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 0, stationId: 'a-1', stationName: 'A-1', latitude: 34.75, longitude: 127.73 },
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 1, stationId: 'a-2', stationName: 'A-2', latitude: 34.76, longitude: 127.74 }
];
const serviceConfigs: RouteServiceConfig[] = [{ routeId: 'A', vehicleCapacity: 40, tripsByHour: { '7': 4 } }];
const definition: ScenarioDefinition = {
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-1',
  label: 'A 변경',
  routeChanges: [{
    routeId: 'A',
    routeName: '노선-A',
    transportMode: 'BUS',
    baseStopIds: ['a-1', 'a-2'],
    scenarioStopIds: ['a-2', 'a-1'],
    beforeOperation: operation,
    afterOperation: operation
  }],
  source: { assumptions: [], warnings: [], modelVersions: [model.modelVersion] },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
};

const environment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'sha-1',
  routingProfile: 'bus' as const,
  travelTimeModelVersion: model.modelVersion,
  motisVersion: '2.11.3'
};

const currentTarget = { kind: 'current' as const };
const scenarioTarget = { kind: 'scenario' as const, scenarioId: 'scenario-1' };
const query = { originStopId: 'a-1', destinationStopId: 'a-2', departureDateTime: '2026-09-20T08:00' };

function result(target: typeof currentTarget | typeof scenarioTarget, executionId: string, environmentOverride = {}): ScenarioExecutionResult {
  const route = {
    routeId: 'A',
    routeName: '노선-A',
    transportMode: 'BUS',
    source: target.kind === 'current' ? 'current' as const : 'scenario-after' as const,
    stopIds: ['a-1', 'a-2'],
    operation,
    directions: [],
    totalDistanceMeters: 1000,
    totalRuntimeSeconds: 120,
    status: 'complete' as const,
    warnings: []
  };
  return {
    executionSchemaVersion: 1,
    executionId,
    target,
    inputFingerprint: `fingerprint-${executionId}`,
    environment: { ...environment, ...environmentOverride },
    before: { routes: [route], status: 'complete', warnings: [] },
    after: { routes: [route], status: 'complete', warnings: [] },
    warnings: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };
}

function manifest(target: typeof currentTarget | typeof scenarioTarget, executionId: string, resultValue: ScenarioExecutionResult): ScenarioExecutionManifest {
  return {
    executionSchemaVersion: 1,
    executionId,
    target,
    inputFingerprint: resultValue.inputFingerprint,
    environment: resultValue.environment,
    status: 'complete',
    routeCount: 1,
    completeRouteCount: 1,
    warningCount: 0,
    artifactFileName: `scenario-executions/${executionId}.json`,
    createdAt: resultValue.createdAt,
    updatedAt: resultValue.updatedAt
  };
}

function input(overrides: Partial<ScenarioComparisonClientInput> = {}): ScenarioComparisonClientInput {
  return {
    projectId: 'project-1',
    before: { target: currentTarget, executionId: 'current-1', label: '현행' },
    after: { target: scenarioTarget, executionId: 'scenario-1', label: '시나리오 1' },
    routeStops,
    serviceConfigs,
    scenarioDefinitions: [definition],
    queries: [],
    ...overrides
  };
}

function makeApi() {
  const current = result(currentTarget, 'current-1');
  const scenario = result(scenarioTarget, 'scenario-1');
  const manifests = [manifest(currentTarget, 'current-1', current), manifest(scenarioTarget, 'scenario-1', scenario)];
  const results = new Map([[current.executionId, current], [scenario.executionId, scenario]]);
  const api = {
    listScenarioExecutionManifests: vi.fn(async () => manifests),
    readScenarioExecution: vi.fn(async ({ executionId }: { executionId: string }) => results.get(executionId)),
    selectMotisOsmPbf: vi.fn(async () => ({ path: 'C:\\data\\region.osm.pbf', fileName: 'region.osm.pbf', sizeBytes: 10, sha256: 'sha-1' })),
    prepareMotis: vi.fn(async () => ({ archivePath: 'archive', message: 'prepared' })),
    startMotis: vi.fn(async () => ({ state: 'ready' as const, message: 'ready' })),
    requestMotis: vi.fn(async () => ({
      itineraries: [{
        duration: 900,
        transfers: 0,
        startTime: '2026-09-20T08:00:00+09:00',
        endTime: '2026-09-20T08:15:00+09:00',
        legs: [{ mode: 'BUS', duration: 900, routeId: 'A', from: { stopId: 'a-1' }, to: { stopId: 'a-2' } }]
      }]
    })),
    stopMotis: vi.fn(async () => ({ state: 'stopped' as const }))
  };
  return { api, manifests, results };
}

describe('scenario comparison client', () => {
  it('loads both selected artifacts and computes route comparison without MOTIS for empty queries', async () => {
    const { api } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    try {
      const resultValue = await runScenarioComparison(input());

      expect(api.listScenarioExecutionManifests).toHaveBeenCalledWith('project-1');
      expect(api.readScenarioExecution).toHaveBeenCalledTimes(2);
      expect(resultValue.before.kind).toBe('current');
      expect(resultValue.after.kind).toBe('scenario');
      expect(api.prepareMotis).not.toHaveBeenCalled();
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('checks both environments and routes the same query against both targets', async () => {
    const { api } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    const progress: string[] = [];
    try {
      const resultValue = await runScenarioComparison(input({ queries: [query] }), (item) => progress.push(item.phase));

      expect(api.selectMotisOsmPbf).toHaveBeenCalledTimes(1);
      expect(api.prepareMotis).toHaveBeenCalledTimes(2);
      expect(api.startMotis).toHaveBeenCalledTimes(2);
      expect(api.requestMotis).toHaveBeenCalledTimes(2);
      expect(api.stopMotis).toHaveBeenCalledTimes(2);
      expect(resultValue.journeys).toHaveLength(1);
      expect(resultValue.journeys[0].before.found).toBe(true);
      expect(resultValue.journeys[0].after.legs[0].mode).toBe('BUS');
      expect(progress).toEqual(['loading', 'validating', 'routing-before', 'routing-after', 'complete']);
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('rejects missing artifacts, target mismatches, and missing scenario definitions before MOTIS', async () => {
    const { api, manifests } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    try {
      await expect(runScenarioComparison(input({ before: { target: currentTarget, executionId: 'missing', label: '없음' } }))).rejects.toThrow(/실행 결과|찾을/);
      api.listScenarioExecutionManifests.mockResolvedValueOnce([manifests[0], { ...manifests[1], target: currentTarget }]);
      await expect(runScenarioComparison(input())).rejects.toThrow(/대상|일치/);
      api.listScenarioExecutionManifests.mockResolvedValueOnce(manifests);
      await expect(runScenarioComparison(input({ scenarioDefinitions: [] }))).rejects.toThrow(/시나리오/);
      expect(api.prepareMotis).not.toHaveBeenCalled();
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('returns route-only comparison when execution environments differ', async () => {
    const { api, results, manifests } = makeApi();
    const changedScenario = result(scenarioTarget, 'scenario-1', { osmPbfSha256: 'sha-2' });
    results.set('scenario-1', changedScenario);
    manifests[1] = manifest(scenarioTarget, 'scenario-1', changedScenario);
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    try {
      const resultValue = await runScenarioComparison(input({ queries: [query] }));

      expect(resultValue.environment.comparable).toBe(false);
      expect(resultValue.journeys).toEqual([]);
      expect(api.prepareMotis).not.toHaveBeenCalled();
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('fails closed for coordinate queries until the cancellable A-B comparison job is connected', async () => {
    const { api } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    try {
      await expect(runScenarioComparison(input({ queries: [{
        origin: { kind: 'coordinate', latitude: 34.7604, longitude: 127.6622 },
        destination: { kind: 'coordinate', latitude: 34.7463, longitude: 127.7441 },
        departureDateTime: '2026-09-20T08:00'
      }] }))).rejects.toThrow('좌표 A–B 비교 job 연결이 완료된 뒤 실행하세요');
      expect(api.prepareMotis).not.toHaveBeenCalled();
    } finally { Object.assign(globalThis, { window: previous }); }
  });
});
