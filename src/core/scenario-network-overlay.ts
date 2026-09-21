import type {
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioOperationPlan,
  StationMasterRecord
} from '../shared/types';

export interface ScenarioNetworkMaterialization {
  currentRouteStops: RouteStopMasterRecord[];
  scenarioRouteStops: RouteStopMasterRecord[];
  addedRouteIds: string[];
  warnings: string[];
}

export interface ScenarioNetworkMaterializationInput {
  routeStops: RouteStopMasterRecord[];
  stationMaster?: StationMasterRecord[];
  scenarioDefinition?: ScenarioDefinition;
}

interface StationRecord extends RouteStopMasterRecord {
  source: 'route-master' | 'station-master' | 'scenario';
}

function cloneRouteStop(stop: RouteStopMasterRecord): RouteStopMasterRecord {
  return { ...stop };
}

function stationRecordFromMaster(station: StationMasterRecord): StationRecord {
  return {
    routeId: '',
    routeName: '',
    transportMode: '',
    stationSequence: 0,
    stationId: station.stationId,
    stationName: station.stationName,
    latitude: station.latitude,
    longitude: station.longitude,
    source: 'station-master'
  };
}

function buildStationCatalog(routeStops: RouteStopMasterRecord[], stationMaster: StationMasterRecord[] | undefined, definition: ScenarioDefinition | undefined): Map<string, StationRecord> {
  const catalog = new Map<string, StationRecord>();
  for (const stop of routeStops) {
    if (!catalog.has(stop.stationId)) catalog.set(stop.stationId, { ...stop, source: 'route-master' });
  }
  for (const station of stationMaster ?? []) {
    if (!catalog.has(station.stationId)) catalog.set(station.stationId, stationRecordFromMaster(station));
  }
  for (const station of definition?.addedStations ?? []) {
    if (catalog.has(station.stationId)) throw new Error(`신규 정류장 ID ${station.stationId}가 기존 정류장과 충돌합니다.`);
    catalog.set(station.stationId, {
      routeId: '',
      routeName: '',
      transportMode: '',
      stationSequence: 0,
      stationId: station.stationId,
      stationName: station.stationName,
      latitude: station.latitude,
      longitude: station.longitude,
      ...(station.arsNumber === undefined ? {} : { arsNumber: station.arsNumber }),
      source: 'scenario'
    });
  }
  return catalog;
}

function applyStationOverride(station: StationRecord, definition: ScenarioDefinition | undefined): StationRecord {
  const override = definition?.stationOverrides?.find((candidate) => candidate.stationId === station.stationId);
  if (!override) return { ...station };
  return {
    ...station,
    ...(override.stationName === undefined ? {} : { stationName: override.stationName }),
    ...(override.latitude === undefined ? {} : { latitude: override.latitude }),
    ...(override.longitude === undefined ? {} : { longitude: override.longitude }),
    ...(override.arsNumber === undefined ? {} : { arsNumber: override.arsNumber })
  };
}

function assertPath(stopIds: string[], label: string): void {
  if (stopIds.length < 2) throw new Error(`${label}은(는) 최소 2개 정류장이 필요합니다.`);
  if (new Set(stopIds).size !== stopIds.length) throw new Error(`${label}에 중복 정류장이 있습니다.`);
}

function resolveStation(catalog: Map<string, StationRecord>, stationId: string, label: string, definition: ScenarioDefinition | undefined): StationRecord {
  const station = catalog.get(stationId);
  if (!station) throw new Error(`${label}에 master에 없는 정류장 ID가 있습니다: ${stationId}`);
  return applyStationOverride(station, definition);
}

function routeTemplate(routeStops: RouteStopMasterRecord[], routeId: string): RouteStopMasterRecord {
  const template = routeStops.find((stop) => stop.routeId === routeId);
  if (!template) throw new Error(`노선 ${routeId}의 route master 경로를 찾을 수 없습니다.`);
  return template;
}

function toRouteStop(template: RouteStopMasterRecord, station: StationRecord, routeId: string, routeName: string, transportMode: string, stationSequence: number): RouteStopMasterRecord {
  const {
    source: _source,
    routeId: _stationRouteId,
    routeName: _stationRouteName,
    transportMode: _stationTransportMode,
    stationSequence: _stationSequence,
    serviceDate: _stationServiceDate,
    cumulativeDistance: _stationCumulativeDistance,
    stationDistance: _stationDistance,
    ...stationFields
  } = station;
  return {
    ...stationFields,
    routeId,
    routeName,
    transportMode,
    stationSequence,
    ...(template.serviceDate === undefined ? {} : { serviceDate: template.serviceDate })
  };
}

function materializeChangedRoute(
  routeStops: RouteStopMasterRecord[],
  catalog: Map<string, StationRecord>,
  definition: ScenarioDefinition,
  change: ScenarioDefinition['routeChanges'][number]
): RouteStopMasterRecord[] {
  assertPath(change.scenarioStopIds, `${change.routeId} 개편안 경로`);
  const template = routeTemplate(routeStops, change.routeId);
  const routeName = change.routeName?.trim() || template.routeName;
  const transportMode = change.transportMode?.trim() || template.transportMode;
  return change.scenarioStopIds.map((stationId, index) => toRouteStop(
    template,
    resolveStation(catalog, stationId, `${change.routeId} 개편안 경로`, definition),
    change.routeId,
    routeName,
    transportMode,
    index + 1
  ));
}

function materializeAddedRoute(
  routeStops: RouteStopMasterRecord[],
  catalog: Map<string, StationRecord>,
  definition: ScenarioDefinition,
  addedRoute: NonNullable<ScenarioDefinition['addedRoutes']>[number]
): RouteStopMasterRecord[] {
  assertPath(addedRoute.stopIds, `${addedRoute.routeId} 신규 노선 경로`);
  const template = routeStops[0] ?? {
    routeId: addedRoute.routeId,
    routeName: addedRoute.routeName,
    transportMode: addedRoute.transportMode,
    stationSequence: 0,
    stationId: '',
    stationName: '',
    latitude: 0,
    longitude: 0
  };
  return addedRoute.stopIds.map((stationId, index) => toRouteStop(
    template,
    resolveStation(catalog, stationId, `${addedRoute.routeId} 신규 노선 경로`, definition),
    addedRoute.routeId,
    addedRoute.routeName,
    addedRoute.transportMode,
    index + 1
  ));
}

function materializeUnchangedRoute(stop: RouteStopMasterRecord, definition: ScenarioDefinition | undefined, catalog: Map<string, StationRecord>): RouteStopMasterRecord {
  const station = catalog.get(stop.stationId);
  if (!station) return cloneRouteStop(stop);
  const resolved = applyStationOverride(station, definition);
  return {
    ...stop,
    stationName: resolved.stationName,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    ...(resolved.arsNumber === undefined ? {} : { arsNumber: resolved.arsNumber })
  };
}

export function materializeScenarioNetwork(input: ScenarioNetworkMaterializationInput): ScenarioNetworkMaterialization {
  const definition = input.scenarioDefinition;
  const routeStops = input.routeStops.map(cloneRouteStop);
  const catalog = buildStationCatalog(input.routeStops, input.stationMaster, definition);
  const routeIds = new Set(input.routeStops.map((stop) => stop.routeId));
  const routeChanges = definition?.routeChanges ?? [];
  const changedRouteIds = new Set<string>();

  for (const override of definition?.stationOverrides ?? []) {
    if (!catalog.has(override.stationId)) throw new Error(`override 대상 정류장 ${override.stationId}를 찾을 수 없습니다.`);
  }

  for (const change of routeChanges) {
    if (changedRouteIds.has(change.routeId)) throw new Error(`노선 ID ${change.routeId}가 중복되었습니다.`);
    if (!routeIds.has(change.routeId)) throw new Error(`노선 ID ${change.routeId}가 route master에 없습니다.`);
    assertPath(change.baseStopIds, `${change.routeId} 현행 경로`);
    assertPath(change.scenarioStopIds, `${change.routeId} 개편안 경로`);
    for (const stationId of change.baseStopIds) resolveStation(catalog, stationId, `${change.routeId} 현행 경로`, definition);
    for (const stationId of change.scenarioStopIds) resolveStation(catalog, stationId, `${change.routeId} 개편안 경로`, definition);
    changedRouteIds.add(change.routeId);
  }

  const addedRouteIds: string[] = [];
  const addedRouteSet = new Set<string>();
  for (const addedRoute of definition?.addedRoutes ?? []) {
    if (routeIds.has(addedRoute.routeId) || addedRouteSet.has(addedRoute.routeId)) throw new Error(`노선 ID ${addedRoute.routeId}가 기존 또는 신규 노선과 충돌합니다.`);
    assertPath(addedRoute.stopIds, `${addedRoute.routeId} 신규 노선 경로`);
    addedRouteSet.add(addedRoute.routeId);
    addedRouteIds.push(addedRoute.routeId);
  }

  const scenarioRouteStops: RouteStopMasterRecord[] = [];
  for (const routeId of routeIds) {
    const change = routeChanges.find((candidate) => candidate.routeId === routeId);
    if (change) {
      scenarioRouteStops.push(...materializeChangedRoute(input.routeStops, catalog, definition!, change));
    } else {
      scenarioRouteStops.push(...input.routeStops.filter((stop) => stop.routeId === routeId).map((stop) => materializeUnchangedRoute(stop, definition, catalog)));
    }
  }
  for (const addedRoute of definition?.addedRoutes ?? []) {
    scenarioRouteStops.push(...materializeAddedRoute(input.routeStops, catalog, definition!, addedRoute));
  }

  return {
    currentRouteStops: routeStops,
    scenarioRouteStops,
    addedRouteIds,
    warnings: []
  };
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

export function buildScenarioOverlayFingerprint(definition: ScenarioDefinition | undefined): string {
  if (!definition) return JSON.stringify(null);
  return JSON.stringify({
    scenarioSchemaVersion: definition.scenarioSchemaVersion,
    scenarioId: definition.scenarioId,
    updatedAt: definition.updatedAt,
    routeChanges: [...definition.routeChanges].sort((left, right) => left.routeId.localeCompare(right.routeId)).map((change) => ({
      routeId: change.routeId,
      routeName: change.routeName,
      transportMode: change.transportMode,
      baseStopIds: [...change.baseStopIds],
      scenarioStopIds: [...change.scenarioStopIds],
      beforeOperation: canonicalOperation(change.beforeOperation),
      afterOperation: canonicalOperation(change.afterOperation)
    })),
    addedStations: [...(definition.addedStations ?? [])].sort((left, right) => left.stationId.localeCompare(right.stationId)),
    stationOverrides: [...(definition.stationOverrides ?? [])].sort((left, right) => left.stationId.localeCompare(right.stationId)),
    addedRoutes: [...(definition.addedRoutes ?? [])].sort((left, right) => left.routeId.localeCompare(right.routeId)).map((route) => ({
      routeId: route.routeId,
      routeName: route.routeName,
      transportMode: route.transportMode,
      stopIds: [...route.stopIds],
      afterOperation: canonicalOperation(route.afterOperation)
    }))
  });
}
