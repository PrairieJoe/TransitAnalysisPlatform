import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG,
  type ScenarioDemandEstimationResult
} from '../../src/core/scenario-demand-estimation';
import {
  runScenarioDemandEstimation,
  type ScenarioDemandClientInput,
  type ScenarioDemandSelection
} from '../../src/renderer/scenario-demand-client';
import type {
  AnalysisConfig,
  ODDemandResult,
  ScenarioExecutionEnvironment,
  ScenarioExecutionManifest,
  ScenarioExecutionResult,
  ScenarioExecutionTarget,
  ScenarioOperationPlan,
  ScenarioRouteExecution
} from '../../src/shared/types';

const model: ScenarioOperationPlan['travelTimeModel'] = {
  modelVersion: 'scenario-demand-client-model-1',
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
  deriveReverseDirection: false,
  travelTimeModel: model
};

const environment: ScenarioExecutionEnvironment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'sha-1',
  routingProfile: 'bus',
  travelTimeModelVersion: model.modelVersion,
  motisVersion: '2.11.3'
};

const analysisConfig: AnalysisConfig = {
  selectedDays: [1, 2, 3, 4, 5],
  denominator: 'observed',
  selectedRoutes: [],
  selectedHours: 'all',
  excludeUnmatched: false
};

const demand: ODDemandResult = {
  metrics: [{ originStationId: 'a-1', destinationStationId: 'a-2', totalBoardings: 100, dailyAverage: 20, rank: 1 }],
  selectedDays: 5,
  totalBoardings: 100,
  excludedRows: 0,
  unmatchedOriginCount: 0,
  unmatchedDestinationCount: 0,
  warnings: [],
  config: analysisConfig
};

const currentTarget = { kind: 'current' as const };
const scenarioATarget = { kind: 'scenario' as const, scenarioId: 'scenario-a' };
const scenarioBTarget = { kind: 'scenario' as const, scenarioId: 'scenario-b' };

function route(target: ScenarioExecutionTarget): ScenarioRouteExecution {
  return {
    routeId: target.kind === 'current' ? 'current-route' : target.scenarioId,
    routeName: '테스트 노선',
    transportMode: 'BUS',
    source: target.kind === 'current' ? 'current' : 'scenario-after',
    stopIds: ['a-1', 'a-2'],
    operation,
    directions: [{
      direction: 'forward',
      segments: [{
        fromStopId: 'a-1',
        toStopId: 'a-2',
        points: [{ latitude: 34.75, longitude: 127.73 }, { latitude: 34.76, longitude: 127.74 }],
        distanceMeters: 1000,
        travelSeconds: 120,
        source: 'beeline',
        provenance: { sourceType: 'BEELINE_FALLBACK', confidence: 'medium', assumptions: [] }
      }],
      routeDistanceMeters: 1000,
      runtimeSeconds: 120,
      status: 'complete'
    }],
    totalDistanceMeters: 1000,
    totalRuntimeSeconds: 120,
    status: 'complete',
    warnings: []
  };
}

function execution(target: ScenarioExecutionTarget, executionId: string, fingerprint = `fingerprint-${executionId}`): ScenarioExecutionResult {
  return {
    executionSchemaVersion: 1,
    executionId,
    target,
    inputFingerprint: fingerprint,
    environment,
    before: { routes: [route(target)], status: 'complete', warnings: [] },
    after: { routes: [route(target)], status: 'complete', warnings: [] },
    warnings: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };
}

function manifest(result: ScenarioExecutionResult, status: ScenarioExecutionManifest['status'] = 'complete'): ScenarioExecutionManifest {
  return {
    executionSchemaVersion: 1,
    executionId: result.executionId,
    target: result.target,
    inputFingerprint: result.inputFingerprint,
    environment: result.environment,
    status,
    routeCount: result.after.routes.length,
    completeRouteCount: result.after.routes.filter((item) => item.status === 'complete').length,
    warningCount: result.warnings.length,
    artifactFileName: `scenario-executions/${result.executionId}.json`,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt
  };
}

function selection(target: ScenarioExecutionTarget, executionId: string, label = executionId): ScenarioDemandSelection {
  return { target, executionId, label };
}

function input(before = selection(currentTarget, 'current-1', '현재'), after = selection(scenarioATarget, 'scenario-a-1', '시나리오 A')): ScenarioDemandClientInput {
  return { projectId: 'project-1', demand, before, after };
}

function makeApi(results: ScenarioExecutionResult[], manifests = results.map((item) => manifest(item))) {
  const byId = new Map(results.map((item) => [item.executionId, item]));
  return {
    listScenarioExecutionManifests: vi.fn(async () => manifests),
    readScenarioExecution: vi.fn(async ({ projectId, executionId }: { projectId: string; executionId: string }) => {
      expect(projectId).toBe('project-1');
      return byId.get(executionId)!;
    }),
    requestMotis: vi.fn(),
    saveProject: vi.fn(),
    saveProjectMetadata: vi.fn(),
    saveScenarioExecution: vi.fn()
  };
}

function installApi(api: ReturnType<typeof makeApi>): () => void {
  const previous = globalThis.window;
  Object.assign(globalThis, { window: { transitDesktop: api } });
  return () => Object.assign(globalThis, { window: previous });
}

describe('scenario demand client', () => {
  it('reads exactly two artifacts and passes both after snapshots and demand to the estimator', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      const estimator = vi.fn((value): ScenarioDemandEstimationResult => ({
        demandSchemaVersion: 1,
        model: DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG,
        source: { selectedDays: value.demand.selectedDays, analysisConfig: value.demand.config, totalBoardings: value.demand.totalBoardings, demandWarnings: [], assumptions: [] },
        before: value.before.target,
        after: value.after.target,
        environment: { comparable: true, warnings: [], before: value.before.result.environment, after: value.after.result.environment },
        totals: { observedDailyAverage: 0, beforeServedDailyAverage: 0, afterServedDailyAverage: 0, beforeUnservedDailyAverage: 0, afterUnservedDailyAverage: 0 },
        od: [], routes: [], stations: [], warnings: []
      }));
      const result = await runScenarioDemandEstimation(input(), undefined, estimator);

      expect(api.listScenarioExecutionManifests).toHaveBeenCalledTimes(1);
      expect(api.readScenarioExecution).toHaveBeenCalledTimes(2);
      expect(estimator).toHaveBeenCalledTimes(1);
      const estimatorInput = estimator.mock.calls[0][0];
      expect(estimatorInput).toMatchObject({
        demand,
        before: { target: { ...currentTarget, executionId: 'current-1', label: '현재' }, result: { after: before.after } },
        after: { target: { ...scenarioATarget, executionId: 'scenario-a-1', label: '시나리오 A' }, result: { after: after.after } },
        config: DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG
      });
      expect(estimatorInput.before.result).not.toHaveProperty('before');
      expect(estimatorInput.after.result).not.toHaveProperty('before');
      expect(estimatorInput.before.result.after).toBe(before.after);
      expect(estimatorInput.after.result.after).toBe(after.after);
      expect(result).toBeDefined();
    } finally { restore(); }
  });

  it('uses the same artifact flow and result contract for scenario A versus scenario B', async () => {
    const before = execution(scenarioATarget, 'scenario-a-1');
    const after = execution(scenarioBTarget, 'scenario-b-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      const result = await runScenarioDemandEstimation(input(selection(scenarioATarget, 'scenario-a-1'), selection(scenarioBTarget, 'scenario-b-1')));
      expect(result.before).toMatchObject({ kind: 'scenario', scenarioId: 'scenario-a' });
      expect(result.after).toMatchObject({ kind: 'scenario', scenarioId: 'scenario-b' });
      expect(api.readScenarioExecution).toHaveBeenCalledTimes(2);
    } finally { restore(); }
  });

  it('passes the Task 1 default config when config is omitted', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      const result = await runScenarioDemandEstimation(input());
      expect(result.model).toEqual({ modelVersion: 'scenario-demand-direct-logit-v1', choiceSensitivity: 0.08, waitTimeWeight: 1 });
    } finally { restore(); }
  });

  it('rejects failed artifacts before calling the estimator', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after], [manifest(before, 'failed'), manifest(after)]);
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/실패/);
      expect(api.readScenarioExecution).toHaveBeenCalledTimes(1);
    } finally { restore(); }
  });

  it('rejects an executionId mismatch between the manifest and read result', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    api.readScenarioExecution.mockImplementationOnce(async () => ({ ...before, executionId: 'different-execution' }));
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/identity|일치/);
    } finally { restore(); }
  });

  it('rejects a scenarioId mismatch between the requested target and manifest', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const mismatchedAfterManifest = { ...manifest(after), target: scenarioBTarget };
    const api = makeApi([before, after], [manifest(before), mismatchedAfterManifest]);
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/대상|일치/);
    } finally { restore(); }
  });

  it('rejects a fingerprint mismatch between the manifest and read result', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const staleManifest = { ...manifest(before), inputFingerprint: 'stale-fingerprint' };
    const api = makeApi([before, after], [staleManifest, manifest(after)]);
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/identity|stale/);
    } finally { restore(); }
  });

  it('rejects an invalid project id before reading artifacts', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation({ ...input(), projectId: ' ' })).rejects.toThrow(/프로젝트 ID/);
      expect(api.listScenarioExecutionManifests).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it('does not call MOTIS or project-state write APIs', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      await runScenarioDemandEstimation(input());
      expect(api.requestMotis).not.toHaveBeenCalled();
      expect(api.saveProject).not.toHaveBeenCalled();
      expect(api.saveProjectMetadata).not.toHaveBeenCalled();
      expect(api.saveScenarioExecution).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it('wraps artifact read failures with an actionable panel error', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    api.readScenarioExecution.mockRejectedValueOnce(new Error('disk unavailable'));
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/실행 결과 .* 불러오지 못했습니다.*disk unavailable/);
    } finally { restore(); }
  });

  it('wraps a null artifact read as an actionable artifact error', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    api.readScenarioExecution.mockResolvedValueOnce(null as never);
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/실행 결과 .*artifact|artifact identity/);
    } finally { restore(); }
  });

  it('wraps manifest list failures with panel context', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    api.listScenarioExecutionManifests.mockRejectedValueOnce(new Error('metadata unavailable'));
    const restore = installApi(api);
    try {
      await expect(runScenarioDemandEstimation(input())).rejects.toThrow(/실행 artifact 목록을 불러오지 못했습니다.*metadata unavailable/);
    } finally { restore(); }
  });

  it('reports loading, validating, estimating, and complete in order', async () => {
    const before = execution(currentTarget, 'current-1');
    const after = execution(scenarioATarget, 'scenario-a-1');
    const api = makeApi([before, after]);
    const restore = installApi(api);
    try {
      const phases: string[] = [];
      await runScenarioDemandEstimation(input(), (progress) => phases.push(progress.phase));
      expect(phases).toEqual(['loading', 'validating', 'estimating', 'complete']);
    } finally { restore(); }
  });
});
