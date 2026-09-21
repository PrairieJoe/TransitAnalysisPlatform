import { describe, expect, it } from 'vitest';
import type {
  AnalysisConfig,
  ODDemandResult,
  ScenarioDirectionExecution,
  ScenarioExecutionEnvironment,
  ScenarioExecutionResult,
  ScenarioOperationPlan,
  ScenarioRouteExecution,
  ScenarioSegmentExecution,
  ScenarioTravelTimeModel
} from '../../src/shared/types';
import { estimateScenarioDemand } from '../../src/core/scenario-demand-estimation';
import type { ScenarioDemandEstimationConfig } from '../../src/core/scenario-demand-estimation';
import type { ScenarioComparisonTarget } from '../../src/core/scenario-comparison';

const travelTimeModel: ScenarioTravelTimeModel = {
  modelVersion: 'demand-test-model',
  speedsKph: { unknown: 30 },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 30
};

const operation = (headwayMinutes = 20): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  headwayMinutes,
  vehicleCount: 8,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel
});

const environment: ScenarioExecutionEnvironment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'sha-1',
  routingProfile: 'bus',
  travelTimeModelVersion: travelTimeModel.modelVersion,
  motisVersion: '2.11.3'
};

const config: ScenarioDemandEstimationConfig = {
  modelVersion: 'scenario-demand-direct-logit-v1',
  choiceSensitivity: 0.1,
  waitTimeWeight: 1
};

const analysisConfig: AnalysisConfig = {
  filter: { from: '2026-09-20', to: '2026-09-20' },
  denominator: 'observed',
  alightingMode: 'observed'
};

const target = (kind: 'current' | 'scenario', id: string, label: string): ScenarioComparisonTarget => kind === 'current'
  ? { kind, executionId: id, label }
  : { kind, scenarioId: id, executionId: id, label };

const segment = (
  fromStopId: string,
  toStopId: string,
  travelSeconds: number | null,
  distanceMeters: number | null = 1000,
  provenance: ScenarioSegmentExecution['provenance'] = {
    sourceType: 'OSM_ROUTED',
    confidence: 'high',
    modelVersion: travelTimeModel.modelVersion,
    assumptions: []
  }
): ScenarioSegmentExecution => ({
  fromStopId,
  toStopId,
  points: [],
  distanceMeters,
  travelSeconds,
  source: 'osm',
  provenance
});

const direction = (
  directionName: 'forward' | 'reverse',
  stopIds: string[],
  runtimes: Array<number | null>,
  distances?: Array<number | null>,
  provenances?: Array<ScenarioSegmentExecution['provenance']>
): ScenarioDirectionExecution => ({
  direction: directionName,
  segments: stopIds.slice(0, -1).map((fromStopId, index) => segment(
    fromStopId,
    stopIds[index + 1],
    runtimes[index],
    distances ? distances[index] : undefined,
    provenances?.[index]
  )),
  routeDistanceMeters: distances?.every((value) => value !== null) === false ? null : stopIds.length > 1 ? stopIds.slice(0, -1).length * 1000 : null,
  runtimeSeconds: runtimes.every((value) => value !== null) ? runtimes.reduce((sum, value) => sum + (value ?? 0), 0) : null,
  status: runtimes.every((value) => value !== null) ? 'complete' : 'partial'
});

const route = (
  routeId: string,
  stopIds: string[],
  forwardRuntimes: Array<number | null>,
  options: {
    reverse?: boolean;
    reverseRuntimes?: Array<number | null>;
    distances?: Array<number | null>;
    provenances?: Array<ScenarioSegmentExecution['provenance']>;
    routeStatus?: ScenarioRouteExecution['status'];
    warnings?: string[];
    headwayMinutes?: number;
    routeName?: string;
  } = {}
): ScenarioRouteExecution => ({
  routeId,
  routeName: options.routeName ?? `노선-${routeId}`,
  transportMode: 'BUS',
  source: 'scenario-after',
  stopIds,
  operation: operation(options.headwayMinutes),
  directions: [
    direction('forward', stopIds, forwardRuntimes, options.distances, options.provenances),
    ...(options.reverse === false ? [] : [direction('reverse', [...stopIds].reverse(), options.reverseRuntimes ?? [...forwardRuntimes].reverse(), options.distances ? [...options.distances].reverse() : undefined, options.provenances ? [...options.provenances].reverse() : undefined)])
  ],
  totalDistanceMeters: 1000,
  totalRuntimeSeconds: forwardRuntimes.every((value) => value !== null) ? forwardRuntimes.reduce((sum, value) => sum + (value ?? 0), 0) : null,
  status: options.routeStatus ?? (forwardRuntimes.every((value) => value !== null) ? 'complete' : 'partial'),
  warnings: options.warnings ?? []
});

const demand = (...metrics: Array<{ originStationId: string; destinationStationId: string; dailyAverage: number }>): ODDemandResult => ({
  metrics: metrics.map((metric, rank) => ({ ...metric, totalBoardings: metric.dailyAverage, rank: rank + 1 })),
  selectedDays: 1,
  totalBoardings: metrics.reduce((sum, metric) => sum + metric.dailyAverage, 0) + 7,
  excludedRows: 0,
  unmatchedOriginCount: 0,
  unmatchedDestinationCount: 0,
  warnings: ['수요 warning', '수요 warning'],
  config: analysisConfig
});

const execution = (
  executionTarget: ScenarioExecutionResult['target'],
  executionId: string,
  routes: ScenarioRouteExecution[],
  overrides: Partial<ScenarioExecutionResult> = {},
  afterRoutes: ScenarioRouteExecution[] = routes
): ScenarioExecutionResult => {
  const beforeSnapshot = { routes, status: 'complete' as const, warnings: ['before snapshot warning', 'before snapshot warning'] };
  const afterSnapshot = { routes: afterRoutes, status: 'complete' as const, warnings: ['after snapshot warning', 'after snapshot warning'] };
  return {
    executionSchemaVersion: 1,
    executionId,
    target: executionTarget,
    inputFingerprint: `fingerprint-${executionId}`,
    environment,
    before: beforeSnapshot,
    after: afterSnapshot,
    warnings: ['execution warning', 'execution warning'],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides
  };
};

const estimate = (
  od: ODDemandResult,
  beforeRoutes: ScenarioRouteExecution[],
  afterRoutes: ScenarioRouteExecution[],
  beforeTarget = target('current', 'before-1', 'Before'),
  afterTarget = target('scenario', 'after-1', 'After'),
  overrides: Partial<ScenarioExecutionResult> = {},
  estimationConfig: ScenarioDemandEstimationConfig | null = config,
  afterOverrides: Partial<ScenarioExecutionResult> = {}
) => estimateScenarioDemand({
  demand: od,
  before: { target: beforeTarget, result: execution(beforeTarget, 'before-1', [], overrides, beforeRoutes) },
  after: { target: afterTarget, result: execution(afterTarget, 'after-1', [], { ...overrides, ...afterOverrides }, afterRoutes) },
  ...(estimationConfig ? { config: estimationConfig } : {})
});

describe('scenario demand estimation engine', () => {
  it('keeps OD, route, and station totals identical for the same network', () => {
    const network = [route('A', ['o', 'm', 'd'], [600, 600])];
    const result = estimate(demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }), network, network);

    expect(result.od[0].beforeAssignments).toEqual(result.od[0].afterAssignments);
    expect(result.od[0].beforeDailyAverage).toBe(result.od[0].afterDailyAverage);
    expect(result.routes).toEqual(result.routes.map((item) => ({ ...item, beforeBoardings: item.afterBoardings, beforeAlightings: item.afterAlightings, deltaBoardings: 0, deltaAlightings: 0 })));
    expect(result.stations.every((item) => item.beforeBoardings === item.afterBoardings && item.beforeAlightings === item.afterAlightings)).toBe(true);
  });

  it('uses the approved default config when config is omitted', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [600], { reverse: false })],
      [route('A', ['o', 'd'], [600], { reverse: false })],
      undefined,
      undefined,
      {},
      null
    );

    expect(result.model).toEqual({
      modelVersion: 'scenario-demand-direct-logit-v1',
      choiceSensitivity: 0.08,
      waitTimeWeight: 1
    });
  });

  it('preserves demand when raw exponentials would underflow for valid candidates', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [1_000_000_000], { reverse: false })],
      [
        route('A', ['o', 'd'], [1_000_000_000], { reverse: false }),
        route('B', ['o', 'd'], [1_000_000_001], { reverse: false })
      ],
      undefined,
      undefined,
      {},
      { ...config, waitTimeWeight: 0 }
    );

    expect(result.od[0].afterAssignments).toHaveLength(2);
    expect(result.od[0].afterAssignments.reduce((sum, item) => sum + item.dailyAverage, 0)).toBeCloseTo(10);
    expect(result.totals.afterServedDailyAverage).toBeCloseTo(10);
  });

  it('redistributes to a direct candidate and leaves demand unserved when no candidate exists', () => {
    const before = [route('A', ['o', 'd'], [600], { reverse: false })];
    const after = [route('B', ['o', 'd'], [600], { reverse: false })];
    const result = estimate(demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }), before, after);

    expect(result.od[0].beforeAssignments).toHaveLength(1);
    expect(result.od[0].afterAssignments).toEqual([expect.objectContaining({ routeId: 'B', dailyAverage: 10 })]);
    expect(result.od[0].unservedBeforeDailyAverage).toBe(0);
    expect(result.od[0].unservedAfterDailyAverage).toBe(0);

    const unserved = estimate(demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }), before, [route('B', ['x', 'd'], [600], { reverse: false })]);
    expect(unserved.od[0].afterAssignments).toEqual([]);
    expect(unserved.od[0].unservedAfterDailyAverage).toBe(10);
  });

  it('splits demand by logit cost and preserves the observed OD total', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [600], { reverse: false })],
      [route('A', ['o', 'd'], [600], { reverse: false }), route('B', ['o', 'x', 'd'], [1200, 1200], { reverse: false })]
    );
    const assignments = result.od[0].afterAssignments;
    const expectedAWeight = Math.exp(-0.1 * (10 + 10));
    const expectedBWeight = Math.exp(-0.1 * (40 + 10));

    expect(assignments).toHaveLength(2);
    expect(assignments.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
    expect(assignments.reduce((sum, item) => sum + item.dailyAverage, 0)).toBeCloseTo(10);
    expect(assignments.find((item) => item.routeId === 'A')?.share).toBeCloseTo(expectedAWeight / (expectedAWeight + expectedBWeight));
  });

  it('handles intermediate stops and keeps forward and reverse assignments separate', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'm', 'd'], [300, 300], { reverse: false })],
      [route('A', ['o', 'm', 'd'], [300, 300], { reverse: false }), route('B', ['d', 'm', 'o'], [400, 400])]
    );

    expect(result.od[0].afterAssignments.map((item) => [item.routeId, item.direction])).toEqual([['A', 'forward'], ['B', 'reverse']]);
    expect(result.routes.find((item) => item.routeId === 'A')?.afterBoardings).toBeGreaterThan(0);
    expect(result.stations.find((item) => item.stationId === 'o')?.afterBoardings).toBeCloseTo(10);
    expect(result.stations.find((item) => item.stationId === 'd')?.afterAlightings).toBeCloseTo(10);
  });

  it('uses the same result contract for current-to-scenario and scenario-to-scenario targets', () => {
    const scenarioA = target('scenario', 'scenario-a', '시나리오 A');
    const scenarioB = target('scenario', 'scenario-b', '시나리오 B');
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 5 }),
      [route('A', ['o', 'd'], [300], { reverse: false })],
      [route('A', ['o', 'd'], [300], { reverse: false })],
      scenarioA,
      scenarioB
    );

    expect(result.before).toEqual(scenarioA);
    expect(result.after).toEqual(scenarioB);
    expect(result.demandSchemaVersion).toBe(1);
  });

  it('excludes a candidate with unavailable segment runtime instead of treating it as zero minutes', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [null] })],
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [null] })]
    );

    expect(result.od[0].beforeAssignments).toEqual([]);
    expect(result.od[0].unservedBeforeDailyAverage).toBe(10);
    expect(result.od[0].warnings.some((warning) => warning.includes('SEGMENT_RUNTIME_UNAVAILABLE'))).toBe(true);
  });

  it('uses distance-based runtime estimation with low confidence and provenance warning', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [1000] })],
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [1000] })]
    );
    const assignment = result.od[0].beforeAssignments[0];

    expect(assignment).toEqual(expect.objectContaining({ confidence: 'low', dailyAverage: 10 }));
    expect(assignment.warnings.some((warning) => warning.includes('MODEL_ESTIMATED'))).toBe(true);
  });

  it('preserves structured runtime provenance on model-estimated assignments', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [1000] })],
      [route('A', ['o', 'd'], [null], { reverse: false, distances: [1000] })]
    );

    expect(result.od[0].beforeAssignments[0].provenance).toMatchObject({
      sourceType: 'MODEL_ESTIMATED',
      modelVersion: travelTimeModel.modelVersion,
      assumptions: expect.arrayContaining([expect.stringContaining('기준속도')])
    });
  });

  it('handles a travel-time model estimation failure through the unavailable-runtime path', () => {
    const invalidOperation = {
      ...operation(),
      travelTimeModel: { ...travelTimeModel, speedsKph: { unknown: 0 } }
    };
    const invalidRoute = {
      ...route('A', ['o', 'd'], [null], { reverse: false, distances: [1000] }),
      operation: invalidOperation
    };
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [invalidRoute],
      [invalidRoute]
    );

    expect(result.od[0].beforeAssignments).toEqual([]);
    expect(result.od[0].unservedBeforeDailyAverage).toBe(10);
    expect(result.od[0].warnings.some((warning) => warning.includes('SEGMENT_RUNTIME_UNAVAILABLE'))).toBe(true);
  });

  it('preserves source fields and reads each execution result after snapshot', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [300], { reverse: false })],
      [route('B', ['o', 'd'], [300], { reverse: false })]
    );

    expect(result.source.selectedDays).toBe(1);
    expect(result.source.totalBoardings).toBe(17);
    expect(result.source.analysisConfig).toEqual(analysisConfig);
    expect(result.source.demandWarnings).toEqual(['수요 warning']);
    expect(result.routes.find((item) => item.routeId === 'A')).toEqual(expect.objectContaining({ afterBoardings: 0 }));
    expect(result.routes.find((item) => item.routeId === 'B')).toEqual(expect.objectContaining({ afterBoardings: 10 }));
    expect(result.warnings).toContain('after snapshot warning');
    expect(result.warnings).not.toContain('before snapshot warning');
  });

  it('blocks all numeric demand outputs when PBF, routing, or travel-time model differs', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [300], { reverse: false })],
      [route('A', ['o', 'd'], [300], { reverse: false })],
      undefined,
      undefined,
      {},
      config,
      { environment: { ...environment, osmPbfSha256: 'different-sha' } }
    );

    expect(result.environment.comparable).toBe(false);
    expect(result.od).toEqual([]);
    expect(result.routes).toEqual([]);
    expect(result.stations).toEqual([]);
    expect(result.totals).toEqual({
      observedDailyAverage: 0,
      beforeServedDailyAverage: 0,
      afterServedDailyAverage: 0,
      beforeUnservedDailyAverage: 0,
      afterUnservedDailyAverage: 0
    });
    expect(result.warnings.join(' ')).toMatch(/PBF/);
  });

  it('keeps delta as after minus before and never emits percentage fields for zero baselines', () => {
    const result = estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 10 }),
      [route('A', ['o', 'd'], [300], { reverse: false })],
      [route('B', ['x', 'd'], [300], { reverse: false })]
    );
    const od = result.od[0];

    expect(od.beforeDailyAverage).toBe(10);
    expect(od.afterDailyAverage).toBe(0);
    expect(od.deltaDailyAverage).toBe(od.afterDailyAverage - od.beforeDailyAverage);
    expect(JSON.stringify(result)).not.toContain('percent');
  });

  it('rejects invalid estimation configuration at the function boundary', () => {
    expect(() => estimate(
      demand({ originStationId: 'o', destinationStationId: 'd', dailyAverage: 1 }),
      [],
      [],
      undefined,
      undefined,
      {},
      { ...config, choiceSensitivity: 0 }
    )).toThrow(/choiceSensitivity|민감도/);
  });
});
