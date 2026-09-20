import { buildRoutePathIndex, type RoutePath } from './route-master';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from './synthetic-gtfs/draft-builder';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionEnvironment,
  ScenarioExecutionManifest,
  ScenarioExecutionTarget,
  ScenarioOperationPlan,
  ScenarioTravelTimeModel
} from '../shared/types';

export interface MaterializedScenarioRoute {
  routeId: string;
  routeName: string;
  transportMode: string;
  stopRecords: RouteStopMasterRecord[];
  operation: ScenarioOperationPlan;
  source: 'current' | 'scenario-before' | 'scenario-after';
  warnings: string[];
}

export interface MaterializedScenarioNetwork {
  routes: MaterializedScenarioRoute[];
  warnings: string[];
}

export interface ScenarioMaterializationInput {
  target: ScenarioExecutionTarget;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinition?: ScenarioDefinition;
}

const DEFAULT_CURRENT_OPERATION: Omit<ScenarioOperationPlan, 'travelTimeModel'> = {
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  headwayMinutes: 20,
  vehicleCount: 8,
  dwellSeconds: 20,
  startDate: '1970-01-01',
  endDate: '2099-12-31',
  deriveReverseDirection: true
};

function cloneTravelTimeModel(model: ScenarioTravelTimeModel): ScenarioTravelTimeModel {
  return {
    ...model,
    speedsKph: { ...model.speedsKph }
  };
}

function cloneOperation(operation: ScenarioOperationPlan): ScenarioOperationPlan {
  return {
    ...operation,
    serviceDays: [...operation.serviceDays],
    travelTimeModel: cloneTravelTimeModel(operation.travelTimeModel)
  };
}

function buildModelEstimatedOperation(routeId: string, serviceConfig?: RouteServiceConfig): { operation: ScenarioOperationPlan; warnings: string[] } {
  const trips = Object.values(serviceConfig?.tripsByHour ?? {}).filter((value) => Number.isFinite(value) && value > 0);
  const peakTrips = trips.length ? Math.max(...trips) : 0;
  const headwayMinutes = peakTrips > 0 ? Math.max(1, Math.round(60 / peakTrips)) : DEFAULT_CURRENT_OPERATION.headwayMinutes;
  const operation: ScenarioOperationPlan = {
    ...DEFAULT_CURRENT_OPERATION,
    headwayMinutes,
    travelTimeModel: cloneTravelTimeModel(DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS)
  };
  const sourceMessage = serviceConfig
    ? `노선 ${routeId}의 현행 운행계획은 routeServiceConfigs의 시간당 운행횟수와 프로젝트 기본값으로 추정했습니다.`
    : `노선 ${routeId}의 현행 운행계획이 없어 프로젝트 기본값으로 추정했습니다.`;
  return {
    operation,
    warnings: [`MODEL_ESTIMATED: ${sourceMessage}`]
  };
}

export function buildCurrentOperationPlan(routeId: string, serviceConfig?: RouteServiceConfig): { operation: ScenarioOperationPlan; warnings: string[] } {
  return buildModelEstimatedOperation(routeId, serviceConfig);
}

function comparePath(left: RoutePath, right: RoutePath): number {
  return (right.serviceDate ?? '').localeCompare(left.serviceDate ?? '') || left.routeId.localeCompare(right.routeId);
}

function representativePath(index: ReturnType<typeof buildRoutePathIndex>, routeId: string): RoutePath | undefined {
  return index.static.get(routeId) ?? [...(index.datedByRoute.get(routeId) ?? [])].sort(comparePath)[0];
}

function routeChangeFor(definition: ScenarioDefinition | undefined, routeId: string) {
  return definition?.routeChanges.find((change) => change.routeId === routeId);
}

function assertTargetInput(input: ScenarioMaterializationInput): ScenarioDefinition | undefined {
  if (input.target.kind === 'current') return undefined;
  if (!input.target.scenarioId.trim()) throw new Error('시나리오 ID가 비어 있습니다.');
  if (!input.scenarioDefinition || input.scenarioDefinition.scenarioId !== input.target.scenarioId) {
    throw new Error(`저장된 시나리오 ${input.target.scenarioId}를 찾을 수 없습니다.`);
  }
  return input.scenarioDefinition;
}

function assertUnique(values: string[], label: string): void {
  if (values.length < 2) throw new Error(`${label}은(는) 최소 2개 정류장이 필요합니다.`);
  if (new Set(values).size !== values.length) throw new Error(`${label}에 중복 정류장이 있습니다.`);
}

function resolveStops(path: RoutePath, stopIds: string[], label: string, availableStops = path.stops): RouteStopMasterRecord[] {
  assertUnique(stopIds, label);
  const byId = new Map<string, RouteStopMasterRecord>();
  for (const stop of availableStops) if (!byId.has(stop.stationId)) byId.set(stop.stationId, stop);
  const missing = stopIds.filter((stopId) => !byId.has(stopId));
  if (missing.length) throw new Error(`${label}에 master에 없는 정류장 ID가 있습니다: ${missing.join(', ')}`);
  return stopIds.map((stopId) => ({ ...byId.get(stopId)! }));
}

function materializeRoute(
  path: RoutePath,
  routeId: string,
  source: MaterializedScenarioRoute['source'],
  stopIds: string[],
  operation: ScenarioOperationPlan,
  operationWarnings: string[],
  availableStops: RouteStopMasterRecord[] = path.stops,
  routeName?: string,
  transportMode?: string
): MaterializedScenarioRoute {
  return {
    routeId,
    routeName: routeName?.trim() || path.routeName,
    transportMode: transportMode?.trim() || path.transportMode,
    stopRecords: resolveStops(path, stopIds, `${routeId} ${source} 경로`, availableStops),
    operation: cloneOperation(operation),
    source,
    warnings: [...operationWarnings]
  };
}

function materializeSnapshot(
  paths: Map<string, RoutePath>,
  routeIds: string[],
  definition: ScenarioDefinition | undefined,
  side: 'before' | 'after',
  serviceConfigs: Map<string, RouteServiceConfig>,
  allStopsByRoute: Map<string, RouteStopMasterRecord[]>
): MaterializedScenarioNetwork {
  const routes: MaterializedScenarioRoute[] = [];
  const warnings: string[] = [];
  for (const routeId of routeIds) {
    const path = paths.get(routeId);
    if (!path) throw new Error(`노선 ${routeId}의 유효한 현행 경로를 찾을 수 없습니다.`);
    const change = routeChangeFor(definition, routeId);
    if (change) {
      const stopIds = side === 'before' ? change.baseStopIds : change.scenarioStopIds;
      const operation = side === 'before' ? change.beforeOperation : change.afterOperation;
      routes.push(materializeRoute(
        path,
        routeId,
        side === 'before' ? 'scenario-before' : 'scenario-after',
        stopIds,
        operation,
        [],
        [
          ...path.stops,
          ...(allStopsByRoute.get(routeId) ?? [])
        ],
        change.routeName,
        change.transportMode
      ));
      continue;
    }
    const estimated = buildCurrentOperationPlan(routeId, serviceConfigs.get(routeId));
    const route = materializeRoute(path, routeId, 'current', path.stops.map((stop) => stop.stationId), estimated.operation, estimated.warnings);
    routes.push(route);
    warnings.push(...estimated.warnings);
  }
  return { routes, warnings };
}

export function materializeScenarioNetworks(input: ScenarioMaterializationInput): { before: MaterializedScenarioNetwork; after: MaterializedScenarioNetwork } {
  const definition = assertTargetInput(input);
  const index = buildRoutePathIndex(input.routeStops);
  const allStopsByRoute = new Map<string, RouteStopMasterRecord[]>();
  for (const stop of input.routeStops) {
    const routeStops = allStopsByRoute.get(stop.routeId) ?? [];
    routeStops.push(stop);
    allStopsByRoute.set(stop.routeId, routeStops);
  }
  const paths = new Map<string, RoutePath>();
  for (const routeId of new Set(input.routeStops.map((stop) => stop.routeId))) {
    const path = representativePath(index, routeId);
    if (path) paths.set(routeId, path);
  }
  if (!paths.size) throw new Error('실행할 유효한 노선 경로가 없습니다.');

  const changes = definition?.routeChanges ?? [];
  const changeRouteIds = new Set<string>();
  for (const change of changes) {
    if (!change.routeId.trim()) throw new Error('시나리오 변경 노선 ID가 비어 있습니다.');
    if (changeRouteIds.has(change.routeId)) throw new Error(`시나리오 변경 노선 ${change.routeId}가 중복되었습니다.`);
    changeRouteIds.add(change.routeId);
    if (!paths.has(change.routeId)) throw new Error(`시나리오 변경 노선 ${change.routeId}가 route master에 없습니다.`);
    assertUnique(change.baseStopIds, `${change.routeId} Before 경로`);
    assertUnique(change.scenarioStopIds, `${change.routeId} After 경로`);
    const path = paths.get(change.routeId)!;
    const availableStops = [
      ...path.stops,
      ...(allStopsByRoute.get(change.routeId) ?? [])
    ];
    resolveStops(path, change.baseStopIds, `${change.routeId} Before 경로`, availableStops);
    resolveStops(path, change.scenarioStopIds, `${change.routeId} After 경로`, availableStops);
  }

  const routeIds = [...new Set([...paths.keys(), ...changes.map((change) => change.routeId)])].sort((left, right) => left.localeCompare(right));
  const serviceConfigs = new Map(input.serviceConfigs.map((config) => [config.routeId, config]));
  const before = materializeSnapshot(paths, routeIds, definition, 'before', serviceConfigs, allStopsByRoute);
  const after = materializeSnapshot(paths, routeIds, definition, 'after', serviceConfigs, allStopsByRoute);
  return { before, after };
}

function canonicalOperation(operation: ScenarioOperationPlan) {
  return {
    ...operation,
    serviceDays: [...operation.serviceDays].sort((left, right) => left - right),
    travelTimeModel: {
      ...operation.travelTimeModel,
      speedsKph: Object.fromEntries(Object.entries(operation.travelTimeModel.speedsKph).sort(([left], [right]) => left.localeCompare(right)))
    }
  };
}

function canonicalScenarioDefinition(definition: ScenarioDefinition | undefined) {
  if (!definition) return undefined;
  return {
    scenarioId: definition.scenarioId,
    updatedAt: definition.updatedAt,
    routeChanges: [...definition.routeChanges]
      .sort((left, right) => left.routeId.localeCompare(right.routeId))
      .map((change) => ({
        routeId: change.routeId,
        routeName: change.routeName,
        transportMode: change.transportMode,
        baseStopIds: [...change.baseStopIds],
        scenarioStopIds: [...change.scenarioStopIds],
        beforeOperation: canonicalOperation(change.beforeOperation),
        afterOperation: canonicalOperation(change.afterOperation)
      }))
  };
}

export function buildScenarioInputFingerprint(input: ScenarioMaterializationInput & { environment: ScenarioExecutionEnvironment }): string {
  const routeStops = [...input.routeStops]
    .map((stop) => ({
      serviceDate: stop.serviceDate ?? null,
      routeId: stop.routeId,
      stationSequence: stop.stationSequence,
      stationId: stop.stationId,
      stationName: stop.stationName,
      latitude: stop.latitude,
      longitude: stop.longitude,
      routeName: stop.routeName,
      transportMode: stop.transportMode
    }))
    .sort((left, right) => `${left.routeId}\u0000${left.serviceDate ?? ''}\u0000${left.stationSequence}\u0000${left.stationId}`.localeCompare(`${right.routeId}\u0000${right.serviceDate ?? ''}\u0000${right.stationSequence}\u0000${right.stationId}`));
  const serviceConfigs = [...input.serviceConfigs]
    .map((config) => ({
      routeId: config.routeId,
      vehicleCapacity: config.vehicleCapacity,
      tripsByHour: Object.fromEntries(Object.entries(config.tripsByHour).sort(([left], [right]) => left.localeCompare(right)))
    }))
    .sort((left, right) => left.routeId.localeCompare(right.routeId));
  return JSON.stringify({
    target: input.target,
    routeStops,
    serviceConfigs,
    scenarioDefinition: input.target.kind === 'scenario' ? canonicalScenarioDefinition(input.scenarioDefinition) : undefined,
    environment: input.environment
  });
}

export function createScenarioExecutionManifest(input: {
  executionId: string;
  target: ScenarioExecutionTarget;
  scenarioDefinitionUpdatedAt?: string;
  inputFingerprint: string;
  environment: ScenarioExecutionEnvironment;
  status: ScenarioExecutionManifest['status'];
  routeCount: number;
  completeRouteCount: number;
  warningCount: number;
  artifactFileName: string;
  now: string;
}): ScenarioExecutionManifest {
  return {
    executionSchemaVersion: 1,
    executionId: input.executionId,
    target: input.target,
    ...(input.scenarioDefinitionUpdatedAt ? { scenarioDefinitionUpdatedAt: input.scenarioDefinitionUpdatedAt } : {}),
    inputFingerprint: input.inputFingerprint,
    environment: { ...input.environment },
    status: input.status,
    routeCount: input.routeCount,
    completeRouteCount: input.completeRouteCount,
    warningCount: input.warningCount,
    artifactFileName: input.artifactFileName,
    createdAt: input.now,
    updatedAt: input.now
  };
}
