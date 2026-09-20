import type { ScenarioDefinition } from '../shared/types';

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

function validateJourneyQueries(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('journeyQueries: 여정 질의는 배열이어야 합니다.');
    return;
  }
  value.forEach((query, index) => {
    const path = `journeyQueries[${index}]`;
    if (!isRecord(query)) {
      errors.push(`${path}: 여정 질의는 객체여야 합니다.`);
      return;
    }
    addNonEmptyStringError(errors, `${path}.originStopId`, query.originStopId, '출발 정류장 ID가 비어 있습니다.');
    addNonEmptyStringError(errors, `${path}.destinationStopId`, query.destinationStopId, '도착 정류장 ID가 비어 있습니다.');
    addNonEmptyStringError(errors, `${path}.departureDateTime`, query.departureDateTime, '출발일시가 비어 있습니다.');
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
  if (candidate.scenarioSchemaVersion !== 1) errors.push('scenarioSchemaVersion: 시나리오 스키마 버전은 1이어야 합니다.');
  if (!nonEmptyString(candidate.scenarioId)) errors.push('scenarioId: 시나리오 ID가 비어 있습니다.');
  if (!nonEmptyString(candidate.label)) errors.push('label: 시나리오 라벨이 비어 있습니다.');

  const routeChanges = candidate.routeChanges;
  if (!Array.isArray(routeChanges) || routeChanges.length < 1) {
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
  }

  validateJourneyQueries(candidate.journeyQueries, errors);
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
