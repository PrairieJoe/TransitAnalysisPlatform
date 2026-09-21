import type {
  ScenarioDefinition,
  ScenarioDefinition as ScenarioDefinitionType,
  ScenarioDelta,
  ScenarioEnvironment,
  CoordinateScenarioJourneyQuery,
  LegacyScenarioJourneyQuery,
  ScenarioJourneyEndpoint,
  ScenarioJourneyQuery,
  ScenarioSchemaVersion,
  ScenarioProvenance,
  ScenarioRouteChange
} from '../shared/types';

export interface ScenarioValidationResult {
  errors: string[];
  warnings: string[];
  isValid: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function integerAtLeast(value: unknown, minimum: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function addNonEmptyStringError(errors: string[], path: string, value: unknown, message: string): void {
  if (!nonEmptyString(value)) errors.push(`${path}: ${message}`);
}

function parseClockMinutes(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours > 47 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateStopPath(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: 정류장 경로는 배열이어야 합니다.`);
    return;
  }
  if (value.length < 2) errors.push(`${path}: Before/After 경로는 최소 2개 정류장이 필요합니다.`);
  if (value.some((stopId) => !nonEmptyString(stopId))) errors.push(`${path}: 정류장 ID는 비어 있지 않은 문자열이어야 합니다.`);
  if (new Set(value).size !== value.length) errors.push(`${path}: 정류장 ID가 중복되었습니다.`);
}

function validateTravelTimeModel(value: UnknownRecord, path: string, errors: string[]): void {
  addNonEmptyStringError(errors, `${path}.modelVersion`, value.modelVersion, '모델 버전이 비어 있습니다.');
  if (!isRecord(value.speedsKph) || Object.keys(value.speedsKph).length === 0) {
    errors.push(`${path}.speedsKph: 기준속도는 하나 이상 필요합니다.`);
  } else {
    for (const [roadClass, speed] of Object.entries(value.speedsKph)) {
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
        errors.push(`${path}.speedsKph.${roadClass}: 기준속도는 0보다 커야 합니다.`);
      }
    }
  }
  if (!integerAtLeast(value.intersectionDelaySeconds, 0)) errors.push(`${path}.intersectionDelaySeconds: 교차로 지연시간은 0초 이상의 정수여야 합니다.`);
  if (!integerAtLeast(value.turnDelaySeconds, 0)) errors.push(`${path}.turnDelaySeconds: 회전 지연시간은 0초 이상의 정수여야 합니다.`);
  if (!integerAtLeast(value.minimumSegmentSeconds, 0)) errors.push(`${path}.minimumSegmentSeconds: 최소 구간시간은 0초 이상의 정수여야 합니다.`);
}

function validateOperationPlan(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: 운행조건은 객체여야 합니다.`);
    return;
  }
  const serviceDays = value.serviceDays;
  if (!Array.isArray(serviceDays) || serviceDays.length === 0 || serviceDays.some((day) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) || new Set(serviceDays).size !== serviceDays.length) {
    errors.push(`${path}.serviceDays: 운행요일은 0~6 범위의 중복 없는 정수여야 합니다.`);
  }

  const firstDeparture = parseClockMinutes(value.firstDeparture);
  const lastDeparture = parseClockMinutes(value.lastDeparture);
  if (firstDeparture === undefined) errors.push(`${path}.firstDeparture: 시각은 HH:mm 형식이어야 합니다.`);
  if (lastDeparture === undefined) errors.push(`${path}.lastDeparture: 시각은 HH:mm 형식이어야 합니다.`);
  if (firstDeparture !== undefined && lastDeparture !== undefined && firstDeparture > lastDeparture) {
    errors.push(`${path}.firstDeparture: 첫차가 막차보다 늦습니다.`);
  }

  if (!integerAtLeast(value.headwayMinutes, 1)) errors.push(`${path}.headwayMinutes: 배차간격은 1분 이상의 정수여야 합니다.`);
  if (!integerAtLeast(value.vehicleCount, 1)) errors.push(`${path}.vehicleCount: 운행대수는 1 이상의 정수여야 합니다.`);
  if (!integerAtLeast(value.dwellSeconds, 0)) errors.push(`${path}.dwellSeconds: 정차시간은 0초 이상의 정수여야 합니다.`);
  if (typeof value.deriveReverseDirection !== 'boolean') errors.push(`${path}.deriveReverseDirection: 역방향 생성 여부는 boolean이어야 합니다.`);

  if (!isRecord(value.travelTimeModel)) errors.push(`${path}.travelTimeModel: 시간모델은 객체여야 합니다.`);
  else validateTravelTimeModel(value.travelTimeModel, `${path}.travelTimeModel`, errors);

  if (!isRealDate(value.startDate)) errors.push(`${path}.startDate: 유효한 날짜 범위가 아닙니다.`);
  if (!isRealDate(value.endDate)) errors.push(`${path}.endDate: 유효한 날짜 범위가 아닙니다.`);
  if (isRealDate(value.startDate) && isRealDate(value.endDate) && value.startDate > value.endDate) {
    errors.push(`${path}.startDate: 유효한 날짜 범위가 아닙니다.`);
  }
}

function validateRouteChange(value: unknown, index: number, errors: string[]): string | undefined {
  const path = `routeChanges[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: 노선 변경은 객체여야 합니다.`);
    return undefined;
  }
  const routeId = nonEmptyString(value.routeId) ? value.routeId : undefined;
  if (!routeId) errors.push(`${path}.routeId: 노선 ID가 비어 있습니다.`);
  if (value.routeName !== undefined && typeof value.routeName !== 'string') errors.push(`${path}.routeName: 노선명은 문자열이어야 합니다.`);
  if (value.transportMode !== undefined && typeof value.transportMode !== 'string') errors.push(`${path}.transportMode: 교통수단은 문자열이어야 합니다.`);
  validateStopPath(value.baseStopIds, `${path}.baseStopIds`, errors);
  validateStopPath(value.scenarioStopIds, `${path}.scenarioStopIds`, errors);
  validateOperationPlan(value.beforeOperation, `${path}.beforeOperation`, errors);
  validateOperationPlan(value.afterOperation, `${path}.afterOperation`, errors);
  return routeId;
}

function validateCoordinate(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: 좌표는 유한한 숫자여야 합니다.`);
  }
}

function validateAddedStation(value: unknown, index: number, errors: string[]): string | undefined {
  const path = `addedStations[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: 신규 정류장은 객체여야 합니다.`);
    return undefined;
  }
  const stationId = nonEmptyString(value.stationId) ? value.stationId : undefined;
  if (!stationId) errors.push(`${path}.stationId: 정류장 ID가 비어 있습니다.`);
  if (!nonEmptyString(value.stationName)) errors.push(`${path}.stationName: 정류장명이 비어 있습니다.`);
  validateCoordinate(value.latitude, `${path}.latitude`, errors);
  validateCoordinate(value.longitude, `${path}.longitude`, errors);
  if (typeof value.latitude === 'number' && Number.isFinite(value.latitude) && (value.latitude < -90 || value.latitude > 90)) {
    errors.push(`${path}.latitude: 위도는 -90~90 범위여야 합니다.`);
  }
  if (typeof value.longitude === 'number' && Number.isFinite(value.longitude) && (value.longitude < -180 || value.longitude > 180)) {
    errors.push(`${path}.longitude: 경도는 -180~180 범위여야 합니다.`);
  }
  if (value.arsNumber !== undefined && typeof value.arsNumber !== 'string') errors.push(`${path}.arsNumber: ARS 번호는 문자열이어야 합니다.`);
  return stationId;
}

function validateStationOverride(value: unknown, index: number, errors: string[]): string | undefined {
  const path = `stationOverrides[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: 정류장 override는 객체여야 합니다.`);
    return undefined;
  }
  const stationId = nonEmptyString(value.stationId) ? value.stationId : undefined;
  if (!stationId) errors.push(`${path}.stationId: 정류장 ID가 비어 있습니다.`);
  const hasOverride = ['stationName', 'latitude', 'longitude', 'arsNumber'].some((field) => value[field] !== undefined);
  if (!hasOverride) errors.push(`${path}: 변경할 값이 하나 이상 필요합니다.`);
  if (value.stationName !== undefined && typeof value.stationName !== 'string') errors.push(`${path}.stationName: 정류장명은 문자열이어야 합니다.`);
  if (value.arsNumber !== undefined && typeof value.arsNumber !== 'string') errors.push(`${path}.arsNumber: ARS 번호는 문자열이어야 합니다.`);
  if (value.latitude !== undefined) {
    validateCoordinate(value.latitude, `${path}.latitude`, errors);
    if (typeof value.latitude === 'number' && Number.isFinite(value.latitude) && (value.latitude < -90 || value.latitude > 90)) errors.push(`${path}.latitude: 위도는 -90~90 범위여야 합니다.`);
  }
  if (value.longitude !== undefined) {
    validateCoordinate(value.longitude, `${path}.longitude`, errors);
    if (typeof value.longitude === 'number' && Number.isFinite(value.longitude) && (value.longitude < -180 || value.longitude > 180)) errors.push(`${path}.longitude: 경도는 -180~180 범위여야 합니다.`);
  }
  return stationId;
}

function validateAddedRoute(value: unknown, index: number, errors: string[]): string | undefined {
  const path = `addedRoutes[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: 신규 노선은 객체여야 합니다.`);
    return undefined;
  }
  const routeId = nonEmptyString(value.routeId) ? value.routeId : undefined;
  if (!routeId) errors.push(`${path}.routeId: 노선 ID가 비어 있습니다.`);
  if (!nonEmptyString(value.routeName)) errors.push(`${path}.routeName: 노선명이 비어 있습니다.`);
  if (!nonEmptyString(value.transportMode)) errors.push(`${path}.transportMode: 교통수단이 비어 있습니다.`);
  validateStopPath(value.stopIds, `${path}.stopIds`, errors);
  validateOperationPlan(value.afterOperation, `${path}.afterOperation`, errors);
  return routeId;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateJourneyEndpoint(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: 출발지/도착지는 객체여야 합니다.`);
    return;
  }
  if (value.kind === 'stop') {
    addNonEmptyStringError(errors, `${path}.stopId`, value.stopId, '정류장 ID가 비어 있습니다.');
    return;
  }
  if (value.kind !== 'coordinate') {
    errors.push(`${path}.kind: 출발지/도착지 유형은 coordinate 또는 stop이어야 합니다.`);
    return;
  }
  if (!isFiniteNumber(value.latitude) || value.latitude < -90 || value.latitude > 90) {
    errors.push(`${path}.latitude: 위도는 -90~90 범위의 유한한 숫자여야 합니다.`);
  }
  if (!isFiniteNumber(value.longitude) || value.longitude < -180 || value.longitude > 180) {
    errors.push(`${path}.longitude: 경도는 -180~180 범위의 유한한 숫자여야 합니다.`);
  }
  if (value.label !== undefined && typeof value.label !== 'string') errors.push(`${path}.label: 라벨은 문자열이어야 합니다.`);
}

function isLegacyJourneyQuery(value: unknown): value is LegacyScenarioJourneyQuery {
  return isRecord(value) && ('originStopId' in value || 'destinationStopId' in value);
}

function isCoordinateJourneyQuery(value: unknown): value is CoordinateScenarioJourneyQuery {
  return isRecord(value) && 'origin' in value && 'destination' in value;
}

function endpointIdentity(endpoint: ScenarioJourneyEndpoint): string {
  return endpoint.kind === 'stop'
    ? `stop:${endpoint.stopId.trim()}`
    : `coordinate:${endpoint.latitude},${endpoint.longitude}`;
}

function validateJourneyQueries(value: unknown, errors: string[], schemaVersion: ScenarioSchemaVersion | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('journeyQueries: 여정 질의는 배열이어야 합니다.');
    return;
  }
  const identities = new Set<string>();
  value.forEach((query, index) => {
    const path = `journeyQueries[${index}]`;
    if (!isRecord(query)) {
      errors.push(`${path}: 여정 질의는 객체여야 합니다.`);
      return;
    }
    if (schemaVersion === 1 || isLegacyJourneyQuery(query)) {
      addNonEmptyStringError(errors, `${path}.originStopId`, query.originStopId, '출발 정류장 ID가 비어 있습니다.');
      addNonEmptyStringError(errors, `${path}.destinationStopId`, query.destinationStopId, '도착 정류장 ID가 비어 있습니다.');
      addNonEmptyStringError(errors, `${path}.departureDateTime`, query.departureDateTime, '출발일시가 비어 있습니다.');
      if (nonEmptyString(query.originStopId) && nonEmptyString(query.destinationStopId) && nonEmptyString(query.departureDateTime)) {
        const identity = `stop:${query.originStopId.trim()}|stop:${query.destinationStopId.trim()}|${query.departureDateTime.trim()}`;
        if (identities.has(identity)) errors.push(`${path}: 동일한 여정 질의가 중복되었습니다.`);
        identities.add(identity);
      }
      return;
    }
    if (!isCoordinateJourneyQuery(query)) {
      errors.push(`${path}: v2 여정 질의는 origin, destination endpoint가 필요합니다.`);
      return;
    }
    validateJourneyEndpoint(query.origin, `${path}.origin`, errors);
    validateJourneyEndpoint(query.destination, `${path}.destination`, errors);
    addNonEmptyStringError(errors, `${path}.departureDateTime`, query.departureDateTime, '출발일시가 비어 있습니다.');
    if (query.origin && query.destination && query.origin.kind && query.destination.kind
      && endpointIdentity(query.origin as ScenarioJourneyEndpoint) === endpointIdentity(query.destination as ScenarioJourneyEndpoint)) {
      errors.push(`${path}: 출발지와 도착지는 달라야 합니다.`);
    }
    if (nonEmptyString(query.departureDateTime)) {
      const identity = `${endpointIdentity(query.origin as ScenarioJourneyEndpoint)}|${endpointIdentity(query.destination as ScenarioJourneyEndpoint)}|${query.departureDateTime.trim()}`;
      if (identities.has(identity)) errors.push(`${path}: 동일한 여정 질의가 중복되었습니다.`);
      identities.add(identity);
    }
  });
}

function validateStringArrayField(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) errors.push(`${path}: 문자열 배열이어야 합니다.`);
}

function extractWarnings(value: unknown): string[] {
  return isRecord(value) && isRecord(value.source) && Array.isArray(value.source.warnings) && value.source.warnings.every((warning) => typeof warning === 'string')
    ? [...value.source.warnings]
    : [];
}

export function validateScenarioDefinition(value: unknown): ScenarioValidationResult {
  const errors: string[] = [];
  const warnings = extractWarnings(value);
  const candidate = isRecord(value) ? value : {};
  const schemaVersion = candidate.scenarioSchemaVersion === 1 || candidate.scenarioSchemaVersion === 2 || candidate.scenarioSchemaVersion === 3
    ? candidate.scenarioSchemaVersion
    : undefined;
  if (schemaVersion === undefined) {
    errors.push(candidate.scenarioSchemaVersion === undefined
      ? 'scenarioSchemaVersion: 시나리오 스키마 버전은 1, 2 또는 3이어야 합니다.'
      : 'scenarioSchemaVersion: 지원하지 않는 시나리오 스키마 버전입니다.');
  }
  if (!nonEmptyString(candidate.scenarioId)) errors.push('scenarioId: 시나리오 ID가 비어 있습니다.');
  if (!nonEmptyString(candidate.label)) errors.push('label: 시나리오 라벨이 비어 있습니다.');

  const routeChanges = candidate.routeChanges;
  const addedRoutes = candidate.addedRoutes;
  const hasAddedRoutes = schemaVersion === 3 && Array.isArray(addedRoutes) && addedRoutes.length > 0;
  if (!Array.isArray(routeChanges) || (routeChanges.length < 1 && !hasAddedRoutes)) {
    errors.push('routeChanges: 노선 변경은 1개 이상이어야 합니다.');
  } else {
    const routeIds = routeChanges.map((routeChange, index) => validateRouteChange(routeChange, index, errors)).filter((routeId): routeId is string => Boolean(routeId));
    if (new Set(routeIds).size !== routeIds.length) {
      routeChanges.forEach((routeChange, index) => {
        if (isRecord(routeChange) && nonEmptyString(routeChange.routeId) && routeIds.indexOf(routeChange.routeId) !== index) {
          errors.push(`routeChanges[${index}].routeId: 노선 ID가 중복되었습니다.`);
        }
      });
    }

    if (Array.isArray(addedRoutes)) {
      const addedRouteIds = addedRoutes.map((route, index) => validateAddedRoute(route, index, errors)).filter((routeId): routeId is string => Boolean(routeId));
      const routeIdsInUse = new Set(routeIds);
      for (const [index, routeId] of addedRouteIds.entries()) {
        if (routeIdsInUse.has(routeId)) errors.push(`addedRoutes[${index}].routeId: 노선 ID가 중복되었습니다.`);
        routeIdsInUse.add(routeId);
      }
      if (new Set(addedRouteIds).size !== addedRouteIds.length) {
        addedRoutes.forEach((route, index) => {
          if (isRecord(route) && nonEmptyString(route.routeId) && addedRouteIds.indexOf(route.routeId) !== index) {
            errors.push(`addedRoutes[${index}].routeId: 노선 ID가 중복되었습니다.`);
          }
        });
      }
    } else if (candidate.addedRoutes !== undefined) {
      errors.push('addedRoutes: 신규 노선은 배열이어야 합니다.');
    }
  }

  if (schemaVersion === 3) {
    const addedStations = candidate.addedStations;
    const stationIds = Array.isArray(addedStations)
      ? addedStations.map((station, index) => validateAddedStation(station, index, errors)).filter((stationId): stationId is string => Boolean(stationId))
      : [];
    if (candidate.addedStations !== undefined && !Array.isArray(addedStations)) errors.push('addedStations: 신규 정류장은 배열이어야 합니다.');
    if (new Set(stationIds).size !== stationIds.length) {
      stationIds.forEach((stationId, index) => {
        if (stationIds.indexOf(stationId) !== index) errors.push(`addedStations[${index}].stationId: 정류장 ID가 중복되었습니다.`);
      });
    }

    const routeStopIds = new Set<string>();
    if (Array.isArray(routeChanges)) {
      routeChanges.forEach((routeChange) => {
        if (!isRecord(routeChange)) return;
        for (const field of ['baseStopIds', 'scenarioStopIds']) {
          if (Array.isArray(routeChange[field])) routeChange[field].forEach((stopId) => { if (typeof stopId === 'string') routeStopIds.add(stopId); });
        }
      });
    }
    stationIds.forEach((stationId, index) => {
      if (routeStopIds.has(stationId)) errors.push(`addedStations[${index}].stationId: 원본 경로 정류장 ID와 충돌합니다.`);
    });

    const stationOverrides = candidate.stationOverrides;
    const overrideIds = Array.isArray(stationOverrides)
      ? stationOverrides.map((override, index) => validateStationOverride(override, index, errors)).filter((stationId): stationId is string => Boolean(stationId))
      : [];
    if (candidate.stationOverrides !== undefined && !Array.isArray(stationOverrides)) errors.push('stationOverrides: 정류장 override는 배열이어야 합니다.');
    if (new Set(overrideIds).size !== overrideIds.length) {
      overrideIds.forEach((stationId, index) => {
        if (overrideIds.indexOf(stationId) !== index) errors.push(`stationOverrides[${index}].stationId: override 대상이 중복되었습니다.`);
      });
    }
    stationIds.forEach((stationId, index) => {
      if (overrideIds.includes(stationId)) errors.push(`addedStations[${index}].stationId: override 대상 ID와 충돌합니다.`);
    });
  } else {
    if (candidate.addedStations !== undefined) errors.push('addedStations: v3 시나리오에서만 사용할 수 있습니다.');
    if (candidate.stationOverrides !== undefined) errors.push('stationOverrides: v3 시나리오에서만 사용할 수 있습니다.');
    if (candidate.addedRoutes !== undefined) errors.push('addedRoutes: v3 시나리오에서만 사용할 수 있습니다.');
  }

  validateJourneyQueries(candidate.journeyQueries, errors, schemaVersion);
  if (!isRecord(candidate.source)) {
    errors.push('source: 원천정보는 객체여야 합니다.');
  } else {
    validateStringArrayField(candidate.source.assumptions, 'source.assumptions', errors);
    validateStringArrayField(candidate.source.warnings, 'source.warnings', errors);
    validateStringArrayField(candidate.source.modelVersions, 'source.modelVersions', errors);
    if (candidate.source.projectId !== undefined && typeof candidate.source.projectId !== 'string') errors.push('source.projectId: 프로젝트 ID는 문자열이어야 합니다.');
    if (candidate.source.routeMasterSource !== undefined && typeof candidate.source.routeMasterSource !== 'string') errors.push('source.routeMasterSource: 노선 원천은 문자열이어야 합니다.');
  }
  if (candidate.environment !== undefined) {
    if (!isRecord(candidate.environment)) errors.push('environment: 실행환경은 객체여야 합니다.');
    else for (const field of ['motisVersion', 'osmPbfFileName', 'osmPbfSha256']) if (candidate.environment[field] !== undefined && typeof candidate.environment[field] !== 'string') errors.push(`environment.${field}: 문자열이어야 합니다.`);
  }
  if (!nonEmptyString(candidate.createdAt)) errors.push('createdAt: 생성일시가 비어 있습니다.');
  if (!nonEmptyString(candidate.updatedAt)) errors.push('updatedAt: 수정일시가 비어 있습니다.');

  return { errors, warnings, isValid: errors.length === 0 };
}

export type ScenarioDefinitionInput = Omit<ScenarioDefinition, 'scenarioSchemaVersion'>;

export function createScenarioDefinition(input: ScenarioDefinitionInput): ScenarioDefinition {
  const hasOverlay = [input.addedStations, input.stationOverrides, input.addedRoutes].some((items) => Array.isArray(items) && items.length > 0);
  const definition: ScenarioDefinition = {
    ...input,
    scenarioSchemaVersion: hasOverlay ? 3 : 2,
    ...(input.journeyQueries ? { journeyQueries: input.journeyQueries.map(upgradeJourneyQuery) } : {})
  };
  assertValidScenarioDefinition(definition);
  return definition;
}

function upgradeJourneyQuery(query: ScenarioJourneyQuery): CoordinateScenarioJourneyQuery {
  if (isLegacyJourneyQuery(query)) {
    return {
      origin: { kind: 'stop', stopId: query.originStopId.trim() },
      destination: { kind: 'stop', stopId: query.destinationStopId.trim() },
      departureDateTime: query.departureDateTime
    };
  }
  return {
    origin: { ...query.origin, ...(query.origin.kind === 'coordinate' && query.origin.label ? { label: query.origin.label } : {}) },
    destination: { ...query.destination, ...(query.destination.kind === 'coordinate' && query.destination.label ? { label: query.destination.label } : {}) },
    departureDateTime: query.departureDateTime
  };
}

export function upgradeScenarioDefinition(value: unknown): ScenarioDefinition {
  if (!isRecord(value)) throw new Error('시나리오 정의가 객체가 아닙니다.');
  if (value.scenarioSchemaVersion === 2 || value.scenarioSchemaVersion === 3) {
    const candidate = { ...value, journeyQueries: Array.isArray(value.journeyQueries) ? value.journeyQueries.map((query) => upgradeJourneyQuery(query as ScenarioJourneyQuery)) : value.journeyQueries };
    assertValidScenarioDefinition(candidate);
    return candidate as unknown as ScenarioDefinition;
  }
  if (value.scenarioSchemaVersion !== 1) throw new Error('지원하지 않는 시나리오 스키마 버전입니다.');
  const legacy = value.journeyQueries;
  const upgraded = {
    ...value,
    scenarioSchemaVersion: 2,
    ...(Array.isArray(legacy) ? { journeyQueries: legacy.map((query) => upgradeJourneyQuery(query as ScenarioJourneyQuery)) } : {})
  };
  assertValidScenarioDefinition(upgraded);
  return upgraded as unknown as ScenarioDefinition;
}

export function scenarioDefinitionToLegacyDeltas(definition: ScenarioDefinition): ScenarioDelta[] {
  assertValidScenarioDefinition(definition);
  return definition.routeChanges.map((routeChange) => {
    const baseStopIds = [...routeChange.baseStopIds];
    const scenarioStopIds = [...routeChange.scenarioStopIds];
    const baseSet = new Set(baseStopIds);
    const scenarioSet = new Set(scenarioStopIds);
    return {
      scenarioId: `${definition.scenarioId}:${routeChange.routeId}`,
      label: definition.label,
      routeId: routeChange.routeId,
      baseStopIds,
      scenarioStopIds,
      addedStopIds: scenarioStopIds.filter((stopId) => !baseSet.has(stopId)),
      removedStopIds: baseStopIds.filter((stopId) => !scenarioSet.has(stopId)),
      warnings: [...definition.source.warnings],
      createdAt: definition.createdAt
    };
  });
}

export interface LegacyScenarioPromotionInput {
  scenarioId: string;
  label: string;
  deltas: ScenarioDelta[];
  operationsByRouteId: Record<string, Pick<ScenarioRouteChange, 'beforeOperation' | 'afterOperation'>>;
  source: ScenarioProvenance;
  journeyQueries?: ScenarioJourneyQuery[];
  environment?: ScenarioEnvironment;
  createdAt: string;
  updatedAt: string;
}

export function createScenarioDefinitionFromLegacyDeltas(input: LegacyScenarioPromotionInput): ScenarioDefinition {
  if (input.deltas.length === 0) throw new Error('승격할 레거시 delta가 없습니다.');
  const warnings = [...new Set([
    ...input.source.warnings,
    ...input.deltas.flatMap((delta) => delta.warnings)
  ])];
  const routeChanges: ScenarioRouteChange[] = input.deltas.map((delta) => {
    const operations = input.operationsByRouteId[delta.routeId];
    if (!operations) throw new Error(`${delta.routeId} 노선의 Before/After 운행조건이 필요합니다.`);
    return {
      routeId: delta.routeId,
      baseStopIds: [...delta.baseStopIds],
      scenarioStopIds: [...delta.scenarioStopIds],
      beforeOperation: operations.beforeOperation,
      afterOperation: operations.afterOperation
    };
  });
  const definition: Omit<ScenarioDefinitionType, 'scenarioSchemaVersion'> = {
    scenarioId: input.scenarioId,
    label: input.label,
    routeChanges,
    ...(input.journeyQueries ? { journeyQueries: input.journeyQueries } : {}),
    source: { ...input.source, warnings },
    ...(input.environment ? { environment: input.environment } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
  return createScenarioDefinition(definition);
}

export function assertValidScenarioDefinition(value: unknown): asserts value is ScenarioDefinition {
  const result = validateScenarioDefinition(value);
  if (!result.isValid) throw new Error(`시나리오 정의가 유효하지 않습니다: ${result.errors.join(' ')}`);
}

export function assertValidScenarioDefinitions(definitions: readonly unknown[] | undefined): void {
  for (const [index, definition] of (definitions ?? []).entries()) {
    try {
      assertValidScenarioDefinition(definition);
    } catch (error) {
      throw new Error(`scenarioDefinitions[${index}]: ${(error as Error).message}`, { cause: error });
    }
  }
}
