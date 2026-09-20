import { compareJourneys, type JourneyComparison, type NormalizedJourney } from './transit-comparison';
import type {
  ScenarioExecutionEnvironment,
  ScenarioExecutionResult,
  ScenarioJourneyQuery,
  ScenarioOperationPlan,
  ScenarioRouteExecution,
  ScenarioRouteChange
} from '../shared/types';

export type ScenarioComparisonTarget =
  | { kind: 'current'; executionId: string; label: string }
  | { kind: 'scenario'; scenarioId: string; executionId: string; label: string };

export interface ScenarioEnvironmentComparison {
  comparable: boolean;
  warnings: string[];
  before: ScenarioExecutionEnvironment;
  after: ScenarioExecutionEnvironment;
}

interface NullableValue<T> {
  before: T | null;
  after: T | null;
  changed: boolean;
}

interface NullableDelta<T> {
  before: T | null;
  after: T | null;
  delta: T extends number ? number | null : never;
}

export interface ScenarioOperationComparison {
  serviceDays: NullableValue<number[]>;
  firstDeparture: NullableValue<string>;
  lastDeparture: NullableValue<string>;
  headwayMinutes: NullableValue<number> & { delta: number | null };
  vehicleCount: NullableValue<number> & { delta: number | null };
  dwellSeconds: NullableValue<number> & { delta: number | null };
  deriveReverseDirection: NullableValue<boolean>;
}

export interface ScenarioRouteComparison {
  routeId: string;
  routeName: NullableValue<string>;
  transportMode: NullableValue<string>;
  beforeStopIds: string[];
  afterStopIds: string[];
  addedStopIds: string[];
  removedStopIds: string[];
  reordered: boolean;
  distanceMeters: NullableDelta<number>;
  runtimeSeconds: NullableDelta<number>;
  operation: ScenarioOperationComparison;
  status: 'complete' | 'partial' | 'missing';
  warnings: string[];
}

export interface ScenarioJourneyComparison {
  query: ScenarioJourneyQuery;
  before: NormalizedJourney;
  after: NormalizedJourney;
  journey: JourneyComparison;
  fare: {
    status: 'unavailable';
    amount: null;
    reason: string;
  };
}

export interface ScenarioComparisonResult {
  comparisonSchemaVersion: 1;
  before: ScenarioComparisonTarget;
  after: ScenarioComparisonTarget;
  environment: ScenarioEnvironmentComparison;
  routes: ScenarioRouteComparison[];
  journeys: ScenarioJourneyComparison[];
  warnings: string[];
}

export interface ScenarioExecutionComparisonInput {
  before: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  after: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  journeys?: Array<{
    query: ScenarioJourneyQuery;
    before: NormalizedJourney;
    after: NormalizedJourney;
  }>;
}

const FARE_UNAVAILABLE_REASON = '운임 규칙과 교통카드 환승 정책이 연결되지 않았습니다.';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function warningList(values: string[]): string[] {
  return unique(values.filter((value) => value.trim().length > 0));
}

function nullableValue<T>(before: T | undefined, after: T | undefined, equal: (left: T, right: T) => boolean = Object.is): NullableValue<T> {
  const beforeValue = before ?? null;
  const afterValue = after ?? null;
  return { before: beforeValue, after: afterValue, changed: beforeValue !== null && afterValue !== null ? !equal(beforeValue, afterValue) : beforeValue !== afterValue };
}

function nullableNumberDelta(before: number | null | undefined, after: number | null | undefined): NullableDelta<number> {
  const beforeValue = before ?? null;
  const afterValue = after ?? null;
  return { before: beforeValue, after: afterValue, delta: beforeValue === null || afterValue === null ? null : afterValue - beforeValue };
}

function sortedDays(value: number[] | undefined): number[] | undefined {
  return value ? [...value].sort((left, right) => left - right) : undefined;
}

function operationComparison(before: ScenarioOperationPlan | undefined, after: ScenarioOperationPlan | undefined): ScenarioOperationComparison {
  const beforeDays = sortedDays(before?.serviceDays);
  const afterDays = sortedDays(after?.serviceDays);
  return {
    serviceDays: nullableValue(beforeDays, afterDays, (left, right) => JSON.stringify(left) === JSON.stringify(right)),
    firstDeparture: nullableValue(before?.firstDeparture, after?.firstDeparture),
    lastDeparture: nullableValue(before?.lastDeparture, after?.lastDeparture),
    headwayMinutes: { ...nullableValue(before?.headwayMinutes, after?.headwayMinutes), ...nullableNumberDelta(before?.headwayMinutes, after?.headwayMinutes) },
    vehicleCount: { ...nullableValue(before?.vehicleCount, after?.vehicleCount), ...nullableNumberDelta(before?.vehicleCount, after?.vehicleCount) },
    dwellSeconds: { ...nullableValue(before?.dwellSeconds, after?.dwellSeconds), ...nullableNumberDelta(before?.dwellSeconds, after?.dwellSeconds) },
    deriveReverseDirection: nullableValue(before?.deriveReverseDirection, after?.deriveReverseDirection)
  };
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function routeStatus(before: ScenarioRouteExecution, after: ScenarioRouteExecution): ScenarioRouteComparison['status'] {
  return before.status === 'complete' && after.status === 'complete' ? 'complete' : 'partial';
}

function missingRoute(routeId: string, before: ScenarioRouteExecution | undefined, after: ScenarioRouteExecution | undefined): ScenarioRouteComparison {
  const route = before ?? after;
  const warnings = [`노선 ${routeId}가 ${before ? 'After 대상에는' : 'Before 대상에는'} 존재하지 않습니다.`];
  warnings.push(...(route?.warnings ?? []));
  return {
    routeId,
    routeName: nullableValue(before?.routeName, after?.routeName),
    transportMode: nullableValue(before?.transportMode, after?.transportMode),
    beforeStopIds: before?.stopIds ?? [],
    afterStopIds: after?.stopIds ?? [],
    addedStopIds: after?.stopIds ?? [],
    removedStopIds: before?.stopIds ?? [],
    reordered: false,
    distanceMeters: nullableNumberDelta(before?.totalDistanceMeters, after?.totalDistanceMeters),
    runtimeSeconds: nullableNumberDelta(before?.totalRuntimeSeconds, after?.totalRuntimeSeconds),
    operation: operationComparison(before?.operation, after?.operation),
    status: 'missing',
    warnings: warningList(warnings)
  };
}

function compareRoute(routeId: string, before: ScenarioRouteExecution, after: ScenarioRouteExecution): ScenarioRouteComparison {
  const beforeStopIds = [...before.stopIds];
  const afterStopIds = [...after.stopIds];
  const warnings = [...before.warnings, ...after.warnings];
  return {
    routeId,
    routeName: nullableValue(before.routeName, after.routeName),
    transportMode: nullableValue(before.transportMode, after.transportMode),
    beforeStopIds,
    afterStopIds,
    addedStopIds: afterStopIds.filter((stopId) => !beforeStopIds.includes(stopId)),
    removedStopIds: beforeStopIds.filter((stopId) => !afterStopIds.includes(stopId)),
    reordered: sameMembers(beforeStopIds, afterStopIds) && JSON.stringify(beforeStopIds) !== JSON.stringify(afterStopIds),
    distanceMeters: nullableNumberDelta(before.totalDistanceMeters, after.totalDistanceMeters),
    runtimeSeconds: nullableNumberDelta(before.totalRuntimeSeconds, after.totalRuntimeSeconds),
    operation: operationComparison(before.operation, after.operation),
    status: routeStatus(before, after),
    warnings: warningList(warnings)
  };
}

export function compareScenarioEnvironments(before: ScenarioExecutionEnvironment, after: ScenarioExecutionEnvironment): ScenarioEnvironmentComparison {
  const warnings: string[] = [];
  if (before.osmPbfSha256 !== after.osmPbfSha256) warnings.push('Before/After의 OSM PBF SHA-256이 달라 동일 도로망 조건으로 비교할 수 없습니다.');
  if (before.routingProfile !== after.routingProfile) warnings.push('Before/After의 routing profile이 달라 동일 경로 조건으로 비교할 수 없습니다.');
  if (before.travelTimeModelVersion !== after.travelTimeModelVersion) warnings.push('Before/After의 travel-time model 버전이 달라 동일 운행시간 조건으로 비교할 수 없습니다.');
  if (before.motisVersion && after.motisVersion && before.motisVersion !== after.motisVersion) warnings.push('Before/After의 MOTIS 버전이 다릅니다. 결과 해석에 주의하세요.');
  return { comparable: warnings.every((warning) => !/PBF|routing profile|travel-time model/.test(warning)), warnings: warningList(warnings), before, after };
}

export function compareScenarioExecutions(input: ScenarioExecutionComparisonInput): ScenarioComparisonResult {
  const environment = compareScenarioEnvironments(input.before.result.environment, input.after.result.environment);
  const beforeRoutes = new Map(input.before.result.after.routes.map((route) => [route.routeId, route]));
  const afterRoutes = new Map(input.after.result.after.routes.map((route) => [route.routeId, route]));
  const routeIds = [...new Set([...beforeRoutes.keys(), ...afterRoutes.keys()])].sort((left, right) => left.localeCompare(right));
  const routes = routeIds.map((routeId) => {
    const before = beforeRoutes.get(routeId);
    const after = afterRoutes.get(routeId);
    return before && after ? compareRoute(routeId, before, after) : missingRoute(routeId, before, after);
  });
  const warnings = [
    ...environment.warnings,
    ...input.before.result.warnings,
    ...input.after.result.warnings,
    ...input.before.result.after.warnings,
    ...input.after.result.after.warnings,
    ...routes.flatMap((route) => route.warnings)
  ];
  const journeys = environment.comparable
    ? (input.journeys ?? []).map((item) => ({
      query: item.query,
      before: item.before,
      after: item.after,
      journey: compareJourneys(item.before, item.after),
      fare: { status: 'unavailable' as const, amount: null, reason: FARE_UNAVAILABLE_REASON }
    }))
    : [];
  return {
    comparisonSchemaVersion: 1,
    before: input.before.target,
    after: input.after.target,
    environment,
    routes,
    journeys,
    warnings: warningList([...warnings, ...journeys.flatMap((journey) => journey.journey.warnings)])
  };
}
