import { buildRoutePathIndex } from './route-master';
import { createScenarioDefinition, type ScenarioDefinitionInput } from './scenario-contract';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from './synthetic-gtfs/draft-builder';
import type {
  RouteStopMasterRecord,
  CoordinateScenarioJourneyQuery,
  ScenarioDefinition,
  ScenarioEnvironment,
  ScenarioJourneyEndpoint,
  ScenarioJourneyQuery,
  ScenarioOperationPlan,
  ScenarioProvenance
} from '../shared/types';

export interface ScenarioOperationDraft {
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  headwayMinutes: string;
  vehicleCount: string;
  dwellSeconds: string;
  startDate: string;
  endDate: string;
  deriveReverseDirection: boolean;
}

export interface ScenarioRouteDraft {
  routeId: string;
  routeName: string;
  transportMode: string;
  baseStopIds: string[];
  scenarioStopText: string;
  beforeOperation: ScenarioOperationDraft;
  afterOperation: ScenarioOperationDraft;
}

export type JourneyEndpointDraft =
  | { kind: 'coordinate'; latitudeText: string; longitudeText: string; label: string }
  | { kind: 'stop'; stopId: string };

export interface ScenarioJourneyQueryDraft {
  origin: JourneyEndpointDraft;
  destination: JourneyEndpointDraft;
  departureDateTime: string;
}

export interface ScenarioEditorDraft {
  scenarioId: string;
  label: string;
  routeChanges: ScenarioRouteDraft[];
  journeyQueries: ScenarioJourneyQueryDraft[];
  source: ScenarioProvenance;
  environment?: ScenarioEnvironment;
  createdAt: string;
  updatedAt: string;
}

function cloneOperationModel(): ScenarioOperationPlan['travelTimeModel'] {
  return {
    ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS,
    speedsKph: { ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS.speedsKph }
  };
}

function operationToDraft(operation: ScenarioOperationPlan): ScenarioOperationDraft {
  return {
    serviceDays: [...operation.serviceDays],
    firstDeparture: operation.firstDeparture,
    lastDeparture: operation.lastDeparture,
    headwayMinutes: String(operation.headwayMinutes),
    vehicleCount: String(operation.vehicleCount),
    dwellSeconds: String(operation.dwellSeconds),
    startDate: operation.startDate,
    endDate: operation.endDate,
    deriveReverseDirection: operation.deriveReverseDirection
  };
}

function draftNumber(value: string): number {
  const normalized = value.trim();
  return normalized ? Number(normalized) : Number.NaN;
}

function draftOperationToPlan(operation: ScenarioOperationDraft): ScenarioOperationPlan {
  return {
    serviceDays: [...operation.serviceDays],
    firstDeparture: operation.firstDeparture.trim(),
    lastDeparture: operation.lastDeparture.trim(),
    headwayMinutes: draftNumber(operation.headwayMinutes),
    vehicleCount: draftNumber(operation.vehicleCount),
    dwellSeconds: draftNumber(operation.dwellSeconds),
    startDate: operation.startDate.trim(),
    endDate: operation.endDate.trim(),
    deriveReverseDirection: operation.deriveReverseDirection,
    travelTimeModel: cloneOperationModel()
  };
}

function sourceCopy(source: ScenarioProvenance): ScenarioProvenance {
  return {
    ...(source.projectId === undefined ? {} : { projectId: source.projectId }),
    ...(source.routeMasterSource === undefined ? {} : { routeMasterSource: source.routeMasterSource }),
    assumptions: [...source.assumptions],
    warnings: [...source.warnings],
    modelVersions: [...source.modelVersions]
  };
}

export function endpointDraftToValue(draft: JourneyEndpointDraft): ScenarioJourneyEndpoint {
  if (draft.kind === 'stop') return { kind: 'stop', stopId: draft.stopId.trim() };
  const label = draft.label.trim();
  return {
    kind: 'coordinate',
    latitude: Number(draft.latitudeText.trim()),
    longitude: Number(draft.longitudeText.trim()),
    ...(label ? { label } : {})
  };
}

function endpointToDraft(endpoint: ScenarioJourneyEndpoint): JourneyEndpointDraft {
  return endpoint.kind === 'stop'
    ? { kind: 'stop', stopId: endpoint.stopId }
    : { kind: 'coordinate', latitudeText: String(endpoint.latitude), longitudeText: String(endpoint.longitude), label: endpoint.label ?? '' };
}

function queryToDraft(query: ScenarioJourneyQuery): ScenarioJourneyQueryDraft {
  if ('origin' in query) {
    return { origin: endpointToDraft(query.origin), destination: endpointToDraft(query.destination), departureDateTime: query.departureDateTime };
  }
  return {
    origin: { kind: 'stop', stopId: query.originStopId },
    destination: { kind: 'stop', stopId: query.destinationStopId },
    departureDateTime: query.departureDateTime
  };
}

function endpointDraftHasContent(endpoint: JourneyEndpointDraft): boolean {
  return endpoint.kind === 'stop'
    ? endpoint.stopId.trim().length > 0
    : Boolean(endpoint.latitudeText.trim() || endpoint.longitudeText.trim() || endpoint.label.trim());
}

function emptyCoordinateEndpoint(): JourneyEndpointDraft {
  return { kind: 'coordinate', latitudeText: '', longitudeText: '', label: '' };
}

export function createEmptyJourneyQueryDraft(): ScenarioJourneyQueryDraft {
  return { origin: emptyCoordinateEndpoint(), destination: emptyCoordinateEndpoint(), departureDateTime: '' };
}

export function selectRepresentativeRouteStopIds(routeStops: RouteStopMasterRecord[], routeId: string): string[] {
  const index = buildRoutePathIndex(routeStops);
  const staticPath = index.static.get(routeId);
  const path = staticPath ?? [...(index.datedByRoute.get(routeId) ?? [])]
    .sort((left, right) => (left.serviceDate ?? '').localeCompare(right.serviceDate ?? ''))[0];
  return path?.stops.map((stop) => stop.stationId) ?? [];
}

export function parseScenarioStopText(value: string): string[] {
  return value.split(',').map((stopId) => stopId.trim()).filter(Boolean);
}

export function scenarioDefinitionToEditorDraft(definition: ScenarioDefinition): ScenarioEditorDraft {
  return {
    scenarioId: definition.scenarioId,
    label: definition.label,
    routeChanges: definition.routeChanges.map((change) => ({
      routeId: change.routeId,
      routeName: change.routeName ?? change.routeId,
      transportMode: change.transportMode ?? '',
      baseStopIds: [...change.baseStopIds],
      scenarioStopText: change.scenarioStopIds.join(','),
      beforeOperation: operationToDraft(change.beforeOperation),
      afterOperation: operationToDraft(change.afterOperation)
    })),
    journeyQueries: (definition.journeyQueries ?? []).map(queryToDraft),
    source: sourceCopy(definition.source),
    ...(definition.environment ? { environment: { ...definition.environment } } : {}),
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt
  };
}

export function buildScenarioDefinitionInput(draft: ScenarioEditorDraft): ScenarioDefinitionInput {
  const journeyQueries: CoordinateScenarioJourneyQuery[] = draft.journeyQueries
    .filter((query) => endpointDraftHasContent(query.origin) || endpointDraftHasContent(query.destination) || query.departureDateTime.trim())
    .map((query) => ({
      origin: endpointDraftToValue(query.origin),
      destination: endpointDraftToValue(query.destination),
      departureDateTime: query.departureDateTime.trim()
    }));

  return {
    scenarioId: draft.scenarioId.trim(),
    label: draft.label.trim(),
    routeChanges: draft.routeChanges.map((change) => ({
      routeId: change.routeId.trim(),
      routeName: change.routeName.trim(),
      transportMode: change.transportMode.trim(),
      baseStopIds: [...change.baseStopIds],
      scenarioStopIds: parseScenarioStopText(change.scenarioStopText),
      beforeOperation: draftOperationToPlan(change.beforeOperation),
      afterOperation: draftOperationToPlan(change.afterOperation)
    })),
    ...(journeyQueries.length ? { journeyQueries } : {}),
    source: sourceCopy(draft.source),
    ...(draft.environment ? { environment: { ...draft.environment } } : {}),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}

function addError(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}

export function validateScenarioEditorDraft(draft: ScenarioEditorDraft, routeStops: RouteStopMasterRecord[]): string[] {
  const errors: string[] = [];
  if (!draft.scenarioId.trim()) addError(errors, 'scenarioId', '시나리오 ID가 비어 있습니다.');
  if (!draft.label.trim()) addError(errors, 'label', '시나리오 라벨이 비어 있습니다.');
  if (draft.routeChanges.length === 0) addError(errors, 'routeChanges', '노선 변경은 1개 이상이어야 합니다.');

  const routeIds = new Set<string>();
  for (const [index, change] of draft.routeChanges.entries()) {
    const path = `routeChanges[${index}]`;
    if (routeIds.has(change.routeId.trim())) addError(errors, `${path}.routeId`, '노선 ID가 중복되었습니다.');
    routeIds.add(change.routeId.trim());

    const baseStopIds = selectRepresentativeRouteStopIds(routeStops, change.routeId.trim());
    if (baseStopIds.length < 2) addError(errors, `${path}.baseStopIds`, '노선 master에 유효한 대표 경로가 없습니다.');

    const scenarioStopIds = parseScenarioStopText(change.scenarioStopText);
    if (scenarioStopIds.length < 2) addError(errors, `${path}.scenarioStopIds`, 'After 경로는 최소 2개 정류장이 필요합니다.');
    if (new Set(scenarioStopIds).size !== scenarioStopIds.length) addError(errors, `${path}.scenarioStopIds`, '정류장 ID가 중복되었습니다.');
    const masterStopIds = new Set(routeStops.filter((stop) => stop.routeId === change.routeId.trim()).map((stop) => stop.stationId));
    for (const stopId of scenarioStopIds) {
      if (!masterStopIds.has(stopId)) addError(errors, `${path}.scenarioStopIds`, `master에 없는 정류장 ID ${stopId}`);
    }
  }

  try {
    createScenarioDefinition(buildScenarioDefinitionInput(draft));
  } catch (error) {
    if (error instanceof Error) errors.push(error.message);
    else errors.push('시나리오 정의가 유효하지 않습니다.');
  }
  return errors;
}

export function upsertScenarioDefinition(definitions: ScenarioDefinition[], next: ScenarioDefinition): ScenarioDefinition[] {
  const index = definitions.findIndex((definition) => definition.scenarioId === next.scenarioId);
  if (index < 0) return [...definitions, next];
  return definitions.map((definition, currentIndex) => currentIndex === index ? next : definition);
}
