import { describe, expect, it } from 'vitest';
import { compareScenarioExecutions } from '../../src/core/scenario-comparison';
import type {
  ScenarioExecutionEnvironment,
  ScenarioExecutionResult,
  ScenarioJourneyQuery,
  ScenarioOperationPlan,
  ScenarioRouteExecution,
  ScenarioTravelTimeModel
} from '../../src/shared/types';
import type { NormalizedJourney } from '../../src/core/transit-comparison';

const travelTimeModel: ScenarioTravelTimeModel = {
  modelVersion: 'comparison-model-1',
  speedsKph: { unknown: 20 },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 30
};

const operation = (headwayMinutes = 20, vehicleCount = 8): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  headwayMinutes,
  vehicleCount,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel
});

const route = (routeId: string, stopIds: string[], distanceMeters: number | null, runtimeSeconds: number | null, routeOperation = operation()): ScenarioRouteExecution => ({
  routeId,
  routeName: `노선-${routeId}`,
  transportMode: 'BUS',
  source: 'scenario-after',
  stopIds,
  operation: routeOperation,
  directions: [],
  totalDistanceMeters: distanceMeters,
  totalRuntimeSeconds: runtimeSeconds,
  status: 'complete',
  warnings: []
});

const environment: ScenarioExecutionEnvironment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'sha-1',
  routingProfile: 'bus',
  travelTimeModelVersion: travelTimeModel.modelVersion,
  motisVersion: '2.11.3'
};

function execution(
  target: ScenarioExecutionResult['target'],
  executionId: string,
  afterRoutes: ScenarioRouteExecution[],
  overrides: Partial<ScenarioExecutionResult> = {}
): ScenarioExecutionResult {
  const snapshot = { routes: afterRoutes, status: 'complete' as const, warnings: [] };
  return {
    executionSchemaVersion: 1,
    executionId,
    target,
    inputFingerprint: `fingerprint-${executionId}`,
    environment,
    before: snapshot,
    after: snapshot,
    warnings: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
}

const currentTarget = { kind: 'current' as const, executionId: 'current-1', label: '현행' };
const scenarioATarget = { kind: 'scenario' as const, scenarioId: 'scenario-a', executionId: 'scenario-a-1', label: '시나리오 A' };
const scenarioBTarget = { kind: 'scenario' as const, scenarioId: 'scenario-b', executionId: 'scenario-b-1', label: '시나리오 B' };
const query: ScenarioJourneyQuery = { originStopId: 'a-1', destinationStopId: 'b-2', departureDateTime: '2026-09-20T08:00' };

const foundJourney: NormalizedJourney = {
  found: true,
  totalSeconds: 1800,
  accessWalkSeconds: 60,
  egressWalkSeconds: 60,
  initialWaitSeconds: 300,
  transferWaitSeconds: 120,
  transferWalkSeconds: 60,
  transferCount: 1,
  inVehicleSeconds: 1200,
  walkMeters: 800,
  legs: [{ mode: 'BUS', routeId: 'A', rideSeconds: 1200, waitSeconds: 0, walkSeconds: 0, walkMeters: 0 }],
  warnings: []
};

const notFoundJourney: NormalizedJourney = {
  found: false,
  totalSeconds: 0,
  accessWalkSeconds: 0,
  egressWalkSeconds: 0,
  initialWaitSeconds: 0,
  transferWaitSeconds: 0,
  transferWalkSeconds: 0,
  transferCount: 0,
  inVehicleSeconds: 0,
  walkMeters: 0,
  legs: [],
  warnings: ['Before 경로가 없습니다.']
};

describe('scenario comparison engine', () => {
  it('compares route changes, reordering, distance, runtime, and operations', () => {
    const before = execution(currentTarget, 'current-1', [
      route('A', ['a-1', 'a-2', 'a-3'], 10000, 1200, operation(20, 8))
    ]);
    const after = execution(scenarioATarget, 'scenario-a-1', [
      route('A', ['a-1', 'a-3', 'a-2'], 11200, 1380, operation(15, 10)),
      route('B', ['b-1', 'b-2'], 5000, 600)
    ]);

    const result = compareScenarioExecutions({
      before: { target: currentTarget, result: before },
      after: { target: scenarioATarget, result: after }
    });
    const routeA = result.routes.find((item) => item.routeId === 'A')!;
    const routeB = result.routes.find((item) => item.routeId === 'B')!;

    expect(routeA.addedStopIds).toEqual([]);
    expect(routeA.removedStopIds).toEqual([]);
    expect(routeA.reordered).toBe(true);
    expect(routeA.distanceMeters.delta).toBe(1200);
    expect(routeA.runtimeSeconds.delta).toBe(180);
    expect(routeA.operation.headwayMinutes).toMatchObject({ before: 20, after: 15, delta: -5, changed: true });
    expect(routeA.operation.vehicleCount).toMatchObject({ before: 8, after: 10, delta: 2, changed: true });
    expect(routeB.status).toBe('new');
    expect(routeB.distanceMeters.delta).toBeNull();
  });

  it('compares each target after snapshot rather than scenario Before', () => {
    const scenarioA = execution(scenarioATarget, 'scenario-a-1', [route('A', ['a-before-1', 'a-before-2'], 1000, 120)]);
    const scenarioB = execution(scenarioBTarget, 'scenario-b-1', [route('A', ['b-after-1', 'b-after-2'], 2000, 240)]);
    scenarioA.before = { routes: [route('A', ['not-used-1', 'not-used-2'], 9000, 900)], status: 'complete', warnings: [] };
    scenarioB.before = { routes: [route('A', ['also-not-used-1', 'also-not-used-2'], 8000, 800)], status: 'complete', warnings: [] };

    const result = compareScenarioExecutions({
      before: { target: scenarioATarget, result: scenarioA },
      after: { target: scenarioBTarget, result: scenarioB }
    });

    expect(result.before.kind).toBe('scenario');
    expect(result.after.kind).toBe('scenario');
    expect(result.routes.find((item) => item.routeId === 'A')?.beforeStopIds).toEqual(['a-before-1', 'a-before-2']);
    expect(result.routes.find((item) => item.routeId === 'A')?.afterStopIds).toEqual(['b-after-1', 'b-after-2']);
  });

  it('blocks journey results when the PBF differs but keeps route comparison', () => {
    const before = execution(currentTarget, 'current-1', [route('A', ['a-1', 'a-2'], 1000, 120)], {
      environment: { ...environment, osmPbfSha256: 'sha-before' }
    });
    const after = execution(scenarioATarget, 'scenario-a-1', [route('A', ['a-1', 'a-3'], 1200, 150)], {
      environment: { ...environment, osmPbfSha256: 'sha-after' }
    });

    const result = compareScenarioExecutions({
      before: { target: currentTarget, result: before },
      after: { target: scenarioATarget, result: after },
      journeys: [{ query, before: foundJourney, after: foundJourney }]
    });

    expect(result.environment.comparable).toBe(false);
    expect(result.journeys).toEqual([]);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/PBF|환경|비교/);
  });

  it('does not convert a missing journey into a zero-minute improvement', () => {
    const before = execution(currentTarget, 'current-1', [route('A', ['a-1', 'a-2'], 1000, 120)]);
    const after = execution(scenarioATarget, 'scenario-a-1', [route('A', ['a-1', 'a-2'], 1000, 120)]);

    const result = compareScenarioExecutions({
      before: { target: currentTarget, result: before },
      after: { target: scenarioATarget, result: after },
      journeys: [{ query, before: notFoundJourney, after: foundJourney }]
    });

    expect(result.journeys[0].journey.delta.totalSeconds).toBeNull();
    expect(result.journeys[0].fare).toEqual({ status: 'unavailable', amount: null, reason: expect.any(String) });
  });
});
