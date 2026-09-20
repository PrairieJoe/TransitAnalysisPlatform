import { estimateSegmentTravelTimes } from './synthetic-gtfs/travel-time-estimator';
import {
  compareScenarioEnvironments,
  type ScenarioComparisonTarget,
  type ScenarioEnvironmentComparison
} from './scenario-comparison';
import type {
  ODDemandResult,
  ScenarioDirectionExecution,
  ScenarioExecutionResult,
  ScenarioOperationPlan,
  ScenarioPathProvenance,
  ScenarioRouteExecution,
  ScenarioSegmentExecution
} from '../shared/types';

export interface ScenarioDemandEstimationConfig {
  modelVersion: 'scenario-demand-direct-logit-v1';
  choiceSensitivity: number;
  waitTimeWeight: number;
}

export interface ScenarioDemandEstimationInput {
  demand: ODDemandResult;
  before: { target: ScenarioComparisonTarget; result: Omit<ScenarioExecutionResult, 'before'> };
  after: { target: ScenarioComparisonTarget; result: Omit<ScenarioExecutionResult, 'before'> };
  config?: ScenarioDemandEstimationConfig;
}

export interface ScenarioDemandAssignment {
  routeId: string;
  direction: 'forward' | 'reverse';
  share: number;
  dailyAverage: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  provenance?: ScenarioPathProvenance;
}

export interface ScenarioODDemandChange {
  originStationId: string;
  destinationStationId: string;
  observedDailyAverage: number;
  beforeDailyAverage: number;
  afterDailyAverage: number;
  deltaDailyAverage: number;
  unservedBeforeDailyAverage: number;
  unservedAfterDailyAverage: number;
  beforeAssignments: ScenarioDemandAssignment[];
  afterAssignments: ScenarioDemandAssignment[];
  warnings: string[];
}

export interface ScenarioRouteDemandChange {
  routeId: string;
  routeName: string | null;
  beforeBoardings: number;
  afterBoardings: number;
  deltaBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  deltaAlightings: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface ScenarioStationDemandChange {
  stationId: string;
  beforeBoardings: number;
  afterBoardings: number;
  deltaBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  deltaAlightings: number;
  warnings: string[];
}

export interface ScenarioDemandEstimationResult {
  demandSchemaVersion: 1;
  model: ScenarioDemandEstimationConfig;
  source: {
    selectedDays: ODDemandResult['selectedDays'];
    analysisConfig: ODDemandResult['config'];
    totalBoardings: number;
    demandWarnings: string[];
    assumptions: string[];
  };
  before: ScenarioComparisonTarget;
  after: ScenarioComparisonTarget;
  environment: ScenarioEnvironmentComparison;
  totals: {
    observedDailyAverage: number;
    beforeServedDailyAverage: number;
    afterServedDailyAverage: number;
    beforeUnservedDailyAverage: number;
    afterUnservedDailyAverage: number;
  };
  od: ScenarioODDemandChange[];
  routes: ScenarioRouteDemandChange[];
  stations: ScenarioStationDemandChange[];
  warnings: string[];
}

const MODEL_VERSION = 'scenario-demand-direct-logit-v1' as const;
export const DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG: ScenarioDemandEstimationConfig = {
  modelVersion: MODEL_VERSION,
  choiceSensitivity: 0.08,
  waitTimeWeight: 1
};
const BASE_ASSUMPTIONS = [
  'OD 수요는 관측된 dailyAverage를 직접 사용했습니다.',
  'Before/After 승객은 직접 운행 후보에만 할당하고 후보가 없으면 unserved로 남겼습니다.',
  '일평균 수요는 ODDemandResult의 selectedDays와 denominator를 그대로 사용했습니다.',
  '환승, 운임, 다른 OD로의 전이, 다중 노선 경로는 반영하지 않았습니다.'
];

type Confidence = ScenarioDemandAssignment['confidence'];

interface Candidate {
  routeId: string;
  routeName: string | null;
  direction: 'forward' | 'reverse';
  generalizedCost: number;
  utility: number;
  confidence: Confidence;
  warnings: string[];
  provenance: ScenarioPathProvenance;
}

interface CandidateSearchResult {
  candidates: Candidate[];
  warnings: string[];
}

interface RouteInfo {
  routeName: string | null;
  before?: ScenarioRouteExecution;
  after?: ScenarioRouteExecution;
}

interface RouteAggregate {
  beforeBoardings: number;
  afterBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  confidence: Confidence;
  warnings: string[];
}

interface StationAggregate {
  beforeBoardings: number;
  afterBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  warnings: string[];
}

interface SegmentPath {
  seconds: number;
  estimated: boolean;
  hasPartialWarning: boolean;
  warnings: string[];
  provenance?: ScenarioPathProvenance;
}

function uniqueWarnings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value.trim() || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function validateConfig(config: ScenarioDemandEstimationConfig): void {
  if (config.modelVersion !== MODEL_VERSION) {
    throw new Error(`modelVersion은 ${MODEL_VERSION}이어야 합니다.`);
  }
  if (!Number.isFinite(config.choiceSensitivity)) {
    throw new Error('choiceSensitivity는 유한한 숫자여야 합니다.');
  }
  if (config.choiceSensitivity <= 0) {
    throw new Error('choiceSensitivity는 0보다 커야 합니다.');
  }
  if (!Number.isFinite(config.waitTimeWeight)) {
    throw new Error('waitTimeWeight는 유한한 숫자여야 합니다.');
  }
  if (config.waitTimeWeight < 0) {
    throw new Error('waitTimeWeight는 0 이상이어야 합니다.');
  }
}

function mergePathProvenance(provenances: ScenarioPathProvenance[]): ScenarioPathProvenance {
  const confidenceRank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const sourceRank: Record<ScenarioPathProvenance['sourceType'], number> = {
    OSM_ROUTED: 1,
    BEELINE_FALLBACK: 2,
    MODEL_ESTIMATED: 3
  };
  const source = [...provenances].sort((left, right) => sourceRank[right.sourceType] - sourceRank[left.sourceType])[0];
  const weakest = [...provenances].sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence])[0];
  return {
    sourceType: source.sourceType,
    confidence: weakest.confidence,
    modelVersion: [...new Set(provenances.map((item) => item.modelVersion).filter(Boolean))].join(', ') || undefined,
    assumptions: uniqueWarnings(provenances.flatMap((item) => item.assumptions))
  };
}

function routeName(route: ScenarioRouteExecution | undefined): string | null {
  const value = route?.routeName?.trim();
  return value ? value : null;
}

function confidenceForPath(path: SegmentPath, route: ScenarioRouteExecution, direction: ScenarioDirectionExecution): Confidence {
  if (path.estimated) return 'low';
  if (path.hasPartialWarning || route.status !== 'complete' || direction.status !== 'complete' || route.warnings.length > 0) return 'medium';
  return 'high';
}

function strongerConfidence(left: Confidence, right: Confidence): Confidence {
  if (left === 'low' || right === 'low') return 'low';
  if (left === 'medium' || right === 'medium') return 'medium';
  return 'high';
}

function directionStops(direction: ScenarioDirectionExecution): string[] {
  if (!direction.segments.length) return [];
  return [direction.segments[0].fromStopId, ...direction.segments.map((segment) => segment.toStopId)];
}

function modelRoadClass(operation: ScenarioOperationPlan): string {
  if (Number.isFinite(operation.travelTimeModel.speedsKph.unknown) && operation.travelTimeModel.speedsKph.unknown > 0) return 'unknown';
  return Object.entries(operation.travelTimeModel.speedsKph).find(([, speed]) => Number.isFinite(speed) && speed > 0)?.[0] ?? 'unknown';
}

function usableSegment(segment: ScenarioSegmentExecution, operation: ScenarioOperationPlan): { seconds: number; estimated: boolean; warnings: string[]; provenance: ScenarioPathProvenance } | null {
  if (segment.travelSeconds !== null && Number.isFinite(segment.travelSeconds) && segment.travelSeconds >= 0) {
    const estimated = segment.provenance.sourceType === 'MODEL_ESTIMATED';
    return {
      seconds: segment.travelSeconds,
      estimated,
      warnings: estimated ? ['MODEL_ESTIMATED: 구간 운행시간이 모델 추정값입니다.'] : [],
      provenance: segment.provenance
    };
  }

  if (segment.distanceMeters === null || !Number.isFinite(segment.distanceMeters) || segment.distanceMeters < 0) return null;
  try {
    const estimate = estimateSegmentTravelTimes([{
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId,
      distanceMeters: segment.distanceMeters,
      roadClass: modelRoadClass(operation),
      intersectionCount: 0,
      turnCount: 0,
      dwellSecondsAtFromStop: operation.dwellSeconds
    }], operation.travelTimeModel)[0];
    return {
      seconds: estimate.travelSeconds,
      estimated: true,
      warnings: ['MODEL_ESTIMATED: 거리와 travel-time model로 구간 운행시간을 추정했습니다.'],
      provenance: {
        sourceType: 'MODEL_ESTIMATED',
        confidence: estimate.provenance.confidence,
        modelVersion: estimate.provenance.modelVersion,
        assumptions: [...estimate.provenance.assumptions]
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      seconds: 0,
      estimated: true,
      warnings: [`SEGMENT_RUNTIME_UNAVAILABLE: ${message}`],
      provenance: {
        sourceType: 'MODEL_ESTIMATED',
        confidence: 'low',
        modelVersion: operation.travelTimeModel.modelVersion,
        assumptions: ['거리와 travel-time model로 구간 운행시간을 추정하려 했지만 모델 입력이 유효하지 않아 후보에서 제외했습니다.']
      }
    };
  }
}

function segmentPath(
  route: ScenarioRouteExecution,
  direction: ScenarioDirectionExecution,
  originStationId: string,
  destinationStationId: string
): SegmentPath | null {
  const stops = directionStops(direction);
  const originIndex = stops.indexOf(originStationId);
  const destinationIndex = stops.indexOf(destinationStationId);
  if (originIndex < 0 || destinationIndex <= originIndex) return null;

  const selected = direction.segments.slice(originIndex, destinationIndex);
  const warnings: string[] = [];
  let seconds = 0;
  let estimated = false;
  let hasPartialWarning = false;
  const provenances: ScenarioPathProvenance[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const segment = selected[index];
    const next = selected[index + 1];
    if (next && segment.toStopId !== next.fromStopId) {
      warnings.push('SEGMENT_RUNTIME_UNAVAILABLE: origin과 destination 사이의 인접 구간이 없습니다.');
      return { seconds: 0, estimated: false, hasPartialWarning: true, warnings: uniqueWarnings(warnings) };
    }
    const usable = usableSegment(segment, route.operation);
    if (!usable || usable.warnings.some((warning) => warning.startsWith('SEGMENT_RUNTIME_UNAVAILABLE'))) {
      warnings.push(...(usable?.warnings ?? ['SEGMENT_RUNTIME_UNAVAILABLE: 구간 운행시간이 없습니다.']));
      return { seconds: 0, estimated, hasPartialWarning: true, warnings: uniqueWarnings(warnings) };
    }
    seconds += usable.seconds;
    estimated ||= usable.estimated;
    provenances.push(usable.provenance);
    hasPartialWarning ||= Boolean(segment.warning) || segment.provenance.confidence !== 'high' || segment.provenance.sourceType === 'BEELINE_FALLBACK';
    warnings.push(...usable.warnings);
    if (segment.warning) warnings.push(segment.warning);
  }

  if (direction.status !== 'complete') hasPartialWarning = true;
  return { seconds, estimated, hasPartialWarning, warnings: uniqueWarnings(warnings), provenance: mergePathProvenance(provenances) };
}

function findCandidates(
  routes: ScenarioRouteExecution[],
  originStationId: string,
  destinationStationId: string,
  config: ScenarioDemandEstimationConfig
): CandidateSearchResult {
  const candidates: Candidate[] = [];
  const warnings: string[] = [];
  for (const route of routes) {
    if (route.status === 'failed') continue;
    for (const direction of route.directions) {
      if (direction.status === 'failed') continue;
      const path = segmentPath(route, direction, originStationId, destinationStationId);
      if (!path) continue;
      if (path.warnings.some((warning) => warning.startsWith('SEGMENT_RUNTIME_UNAVAILABLE'))) {
        warnings.push(...path.warnings);
        continue;
      }
      const headwayMinutes = route.operation.headwayMinutes;
      const averageWaitMinutes = Number.isFinite(headwayMinutes) && headwayMinutes >= 0 ? headwayMinutes / 2 : 0;
      const generalizedCost = path.seconds / 60 + averageWaitMinutes * config.waitTimeWeight;
      const utility = -config.choiceSensitivity * generalizedCost;
      if (!Number.isFinite(generalizedCost) || !Number.isFinite(utility) || !path.provenance) continue;
      const candidateWarnings = uniqueWarnings([...route.warnings, ...path.warnings]);
      candidates.push({
        routeId: route.routeId,
        routeName: routeName(route),
        direction: direction.direction,
        generalizedCost,
        utility,
        confidence: confidenceForPath(path, route, direction),
        warnings: candidateWarnings,
        provenance: path.provenance
      });
    }
  }
  return { candidates, warnings: uniqueWarnings(warnings) };
}

function assignmentsFor(
  observedDailyAverage: number,
  candidates: Candidate[]
): ScenarioDemandAssignment[] {
  if (!candidates.length) return [];
  const maxUtility = Math.max(...candidates.map((candidate) => candidate.utility));
  const weights = candidates.map((candidate) => Math.exp(candidate.utility - maxUtility));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return [];
  let assigned = 0;
  return candidates.map((candidate, index) => {
    const share = weights[index] / totalWeight;
    const dailyAverage = index === candidates.length - 1 ? observedDailyAverage - assigned : observedDailyAverage * share;
    assigned += dailyAverage;
    return {
      routeId: candidate.routeId,
      direction: candidate.direction,
      share,
      dailyAverage,
      confidence: candidate.confidence,
      warnings: [...candidate.warnings],
      provenance: candidate.provenance
    };
  });
}

function collectRouteInfo(beforeRoutes: ScenarioRouteExecution[], afterRoutes: ScenarioRouteExecution[]): Map<string, RouteInfo> {
  const info = new Map<string, RouteInfo>();
  for (const route of beforeRoutes) info.set(route.routeId, { routeName: routeName(route), before: route });
  for (const route of afterRoutes) {
    const current = info.get(route.routeId);
    info.set(route.routeId, { routeName: routeName(route) ?? current?.routeName ?? null, before: current?.before, after: route });
  }
  return info;
}

function aggregateAssignment(
  side: 'before' | 'after',
  originStationId: string,
  destinationStationId: string,
  assignment: ScenarioDemandAssignment,
  routes: Map<string, RouteAggregate>,
  stations: Map<string, StationAggregate>
): void {
  const routeAggregate = routes.get(assignment.routeId) ?? {
    beforeBoardings: 0,
    afterBoardings: 0,
    beforeAlightings: 0,
    afterAlightings: 0,
    confidence: assignment.confidence,
    warnings: []
  };
  routeAggregate.confidence = strongerConfidence(routeAggregate.confidence, assignment.confidence);
  routeAggregate.warnings.push(...assignment.warnings);
  if (side === 'before') {
    routeAggregate.beforeBoardings += assignment.dailyAverage;
    routeAggregate.beforeAlightings += assignment.dailyAverage;
  } else {
    routeAggregate.afterBoardings += assignment.dailyAverage;
    routeAggregate.afterAlightings += assignment.dailyAverage;
  }
  routes.set(assignment.routeId, routeAggregate);

  const origin = stations.get(originStationId) ?? { beforeBoardings: 0, afterBoardings: 0, beforeAlightings: 0, afterAlightings: 0, warnings: [] };
  const destination = stations.get(destinationStationId) ?? { beforeBoardings: 0, afterBoardings: 0, beforeAlightings: 0, afterAlightings: 0, warnings: [] };
  if (side === 'before') {
    origin.beforeBoardings += assignment.dailyAverage;
    destination.beforeAlightings += assignment.dailyAverage;
  } else {
    origin.afterBoardings += assignment.dailyAverage;
    destination.afterAlightings += assignment.dailyAverage;
  }
  origin.warnings.push(...assignment.warnings);
  destination.warnings.push(...assignment.warnings);
  stations.set(originStationId, origin);
  stations.set(destinationStationId, destination);
}

function resultSource(demand: ODDemandResult): ScenarioDemandEstimationResult['source'] {
  return {
    selectedDays: demand.selectedDays,
    analysisConfig: demand.config,
    totalBoardings: demand.totalBoardings,
    demandWarnings: uniqueWarnings(demand.warnings),
    assumptions: [...BASE_ASSUMPTIONS]
  };
}

function emptyResult(
  input: ScenarioDemandEstimationInput,
  environment: ScenarioEnvironmentComparison,
  warnings: string[],
  config: ScenarioDemandEstimationConfig
): ScenarioDemandEstimationResult {
  return {
    demandSchemaVersion: 1,
    model: { ...config },
    source: resultSource(input.demand),
    before: input.before.target,
    after: input.after.target,
    environment,
    totals: {
      observedDailyAverage: 0,
      beforeServedDailyAverage: 0,
      afterServedDailyAverage: 0,
      beforeUnservedDailyAverage: 0,
      afterUnservedDailyAverage: 0
    },
    od: [],
    routes: [],
    stations: [],
    warnings: uniqueWarnings(warnings)
  };
}

export function estimateScenarioDemand(
  input: ScenarioDemandEstimationInput
): ScenarioDemandEstimationResult {
  const config = { ...DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG, ...input.config };
  validateConfig(config);
  const environment = compareScenarioEnvironments(input.before.result.environment, input.after.result.environment);
  const beforeRoutes = input.before.result.after.routes;
  const afterRoutes = input.after.result.after.routes;
  const baseWarnings = [
    ...environment.warnings,
    ...input.demand.warnings,
    ...input.before.result.warnings,
    ...input.after.result.warnings,
    ...input.before.result.after.warnings,
    ...input.after.result.after.warnings,
    ...beforeRoutes.flatMap((route) => route.warnings),
    ...afterRoutes.flatMap((route) => route.warnings)
  ];
  if (!environment.comparable) return emptyResult(input, environment, baseWarnings, config);

  const routeAggregates = new Map<string, RouteAggregate>();
  const stationAggregates = new Map<string, StationAggregate>();
  const od: ScenarioODDemandChange[] = [];
  let observedTotal = 0;
  let beforeServedTotal = 0;
  let afterServedTotal = 0;
  let beforeUnservedTotal = 0;
  let afterUnservedTotal = 0;

  for (const metric of input.demand.metrics) {
    const observedDailyAverage = Number.isFinite(metric.dailyAverage) ? metric.dailyAverage : 0;
    const beforeSearch = findCandidates(beforeRoutes, metric.originStationId, metric.destinationStationId, config);
    const afterSearch = findCandidates(afterRoutes, metric.originStationId, metric.destinationStationId, config);
    const beforeCandidates = beforeSearch.candidates;
    const afterCandidates = afterSearch.candidates;
    const beforeAssignments = assignmentsFor(observedDailyAverage, beforeCandidates);
    const afterAssignments = assignmentsFor(observedDailyAverage, afterCandidates);
    const beforeDailyAverage = beforeAssignments.reduce((sum, assignment) => sum + assignment.dailyAverage, 0);
    const afterDailyAverage = afterAssignments.reduce((sum, assignment) => sum + assignment.dailyAverage, 0);
    const unservedBeforeDailyAverage = beforeCandidates.length ? 0 : observedDailyAverage;
    const unservedAfterDailyAverage = afterCandidates.length ? 0 : observedDailyAverage;
    const warnings = uniqueWarnings([
      ...beforeSearch.warnings,
      ...afterSearch.warnings,
      ...beforeAssignments.flatMap((assignment) => assignment.warnings),
      ...afterAssignments.flatMap((assignment) => assignment.warnings),
      ...(beforeCandidates.length ? [] : [`NO_DIRECT_CANDIDATE: Before에서 ${metric.originStationId}→${metric.destinationStationId} 직접 운행 후보가 없습니다.`]),
      ...(afterCandidates.length ? [] : [`NO_DIRECT_CANDIDATE: After에서 ${metric.originStationId}→${metric.destinationStationId} 직접 운행 후보가 없습니다.`])
    ]);
    for (const assignment of beforeAssignments) aggregateAssignment('before', metric.originStationId, metric.destinationStationId, assignment, routeAggregates, stationAggregates);
    for (const assignment of afterAssignments) aggregateAssignment('after', metric.originStationId, metric.destinationStationId, assignment, routeAggregates, stationAggregates);
    observedTotal += observedDailyAverage;
    beforeServedTotal += beforeDailyAverage;
    afterServedTotal += afterDailyAverage;
    beforeUnservedTotal += unservedBeforeDailyAverage;
    afterUnservedTotal += unservedAfterDailyAverage;
    od.push({
      originStationId: metric.originStationId,
      destinationStationId: metric.destinationStationId,
      observedDailyAverage,
      beforeDailyAverage,
      afterDailyAverage,
      deltaDailyAverage: afterDailyAverage - beforeDailyAverage,
      unservedBeforeDailyAverage,
      unservedAfterDailyAverage,
      beforeAssignments,
      afterAssignments,
      warnings
    });
  }

  const routeInfo = collectRouteInfo(beforeRoutes, afterRoutes);
  const routeIds = [...new Set([...routeInfo.keys(), ...routeAggregates.keys()])].sort((left, right) => left.localeCompare(right));
  const routes = routeIds.map((routeId) => {
    const info = routeInfo.get(routeId);
    const aggregate = routeAggregates.get(routeId) ?? { beforeBoardings: 0, afterBoardings: 0, beforeAlightings: 0, afterAlightings: 0, confidence: 'high' as const, warnings: [] };
    const warnings = [...(info?.before?.warnings ?? []), ...(info?.after?.warnings ?? []), ...aggregate.warnings];
    if (!info?.before) warnings.push(`노선 ${routeId}가 Before 대상에는 존재하지 않습니다.`);
    if (!info?.after) warnings.push(`노선 ${routeId}가 After 대상에는 존재하지 않습니다.`);
    return {
      routeId,
      routeName: info?.routeName ?? null,
      beforeBoardings: aggregate.beforeBoardings,
      afterBoardings: aggregate.afterBoardings,
      deltaBoardings: aggregate.afterBoardings - aggregate.beforeBoardings,
      beforeAlightings: aggregate.beforeAlightings,
      afterAlightings: aggregate.afterAlightings,
      deltaAlightings: aggregate.afterAlightings - aggregate.beforeAlightings,
      confidence: aggregate.confidence,
      warnings: uniqueWarnings(warnings)
    };
  });

  const stationIds = [...stationAggregates.keys()].sort((left, right) => left.localeCompare(right));
  const stations = stationIds.map((stationId) => {
    const aggregate = stationAggregates.get(stationId)!;
    return {
      stationId,
      beforeBoardings: aggregate.beforeBoardings,
      afterBoardings: aggregate.afterBoardings,
      deltaBoardings: aggregate.afterBoardings - aggregate.beforeBoardings,
      beforeAlightings: aggregate.beforeAlightings,
      afterAlightings: aggregate.afterAlightings,
      deltaAlightings: aggregate.afterAlightings - aggregate.beforeAlightings,
      warnings: uniqueWarnings(aggregate.warnings)
    };
  });

  return {
    demandSchemaVersion: 1,
    model: { ...config },
    source: resultSource(input.demand),
    before: input.before.target,
    after: input.after.target,
    environment,
    totals: {
      observedDailyAverage: observedTotal,
      beforeServedDailyAverage: beforeServedTotal,
      afterServedDailyAverage: afterServedTotal,
      beforeUnservedDailyAverage: beforeUnservedTotal,
      afterUnservedDailyAverage: afterUnservedTotal
    },
    od,
    routes,
    stations,
    warnings: uniqueWarnings([...baseWarnings, ...od.flatMap((item) => item.warnings), ...routes.flatMap((item) => item.warnings), ...stations.flatMap((item) => item.warnings)])
  };
}
