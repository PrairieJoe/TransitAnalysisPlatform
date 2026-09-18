import type { SyntheticGtfsBuildInput, ValidationReport } from './types';

function isGtfsDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hasInferredValue(input: SyntheticGtfsBuildInput): boolean {
  return input.routes.some((route) => route.provenance.isInferred
    || route.directions.some((direction) => direction.provenance.isInferred
      || direction.stops.some((stop) => stop.provenance.isInferred)
      || direction.servicePlans.some((plan) => plan.provenance.isInferred)))
    || Object.values(input.travelTimesByDirection).some((segments) => segments.some((segment) => segment.provenance.isInferred))
    || Object.values(input.scheduleByDirection).some((schedule) => schedule.departures.some((departure) => departure.sourceType !== 'OFFICIAL'));
}

function hasFleetAssumption(input: SyntheticGtfsBuildInput): boolean {
  return input.routes.some((route) => route.provenance.assumptions.some((assumption) => assumption.includes('운행대수'))
    || route.directions.some((direction) => direction.provenance.assumptions.some((assumption) => assumption.includes('운행대수'))
      || direction.servicePlans.some((plan) => plan.provenance.assumptions.some((assumption) => assumption.includes('운행대수')))));
}

export function validateSyntheticGtfs(input: SyntheticGtfsBuildInput): ValidationReport {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  if (!input.agencyId.trim()) blockingErrors.push('기관 ID가 없습니다.');
  if (!input.agencyName.trim()) blockingErrors.push('기관명이 없습니다.');
  if (!isGtfsDate(input.startDate)) blockingErrors.push('서비스 시작일이 YYYYMMDD 형식이 아닙니다.');
  if (!isGtfsDate(input.endDate)) blockingErrors.push('서비스 종료일이 YYYYMMDD 형식이 아닙니다.');
  if (isGtfsDate(input.startDate) && isGtfsDate(input.endDate) && input.startDate > input.endDate) blockingErrors.push('서비스 시작일이 종료일보다 늦습니다.');
  if (!input.routes.length) blockingErrors.push('생성할 노선이 없습니다.');
  if (input.shapeMode !== 'missing') blockingErrors.push('지원하지 않는 shape 생성 방식입니다.');

  const routeIds = new Set<string>();
  for (const route of input.routes) {
    if (routeIds.has(route.routeId)) blockingErrors.push(`${route.routeId} 노선 ID가 중복되었습니다.`);
    routeIds.add(route.routeId);
    if (!route.routeId.trim()) blockingErrors.push('노선 ID가 비어 있습니다.');
    if (!route.directions.length) blockingErrors.push(`${route.routeId} 노선의 방향이 없습니다.`);
    for (const direction of route.directions) {
      const directionKey = direction.directionId;
      if (direction.stops.length < 2) blockingErrors.push(`${directionKey} 방향의 정류장이 2개 미만입니다.`);
      const sequenceSet = new Set(direction.stops.map((stop) => stop.stopSequence));
      if (sequenceSet.size !== direction.stops.length) blockingErrors.push(`${directionKey} 방향의 정류장 순번이 중복되었습니다.`);
      if (direction.stops.some((stop, index) => stop.stopSequence !== index + 1)) blockingErrors.push(`${directionKey} 방향의 정류장 순번이 연속적이지 않습니다.`);
      if (!direction.servicePlans.length) blockingErrors.push(`${directionKey} 방향의 서비스 계획이 없습니다.`);
      const schedule = input.scheduleByDirection[directionKey];
      if (!schedule || !schedule.departures.length) blockingErrors.push(`${directionKey} 방향의 운행계획이 없습니다.`);
      const travelTimes = input.travelTimesByDirection[directionKey] ?? [];
      if (travelTimes.length !== Math.max(0, direction.stops.length - 1)) blockingErrors.push(`${directionKey} 방향의 정류장 간 예상시간 수가 정류장 구간 수와 다릅니다.`);
      if (travelTimes.some((segment) => !Number.isInteger(segment.travelSeconds) || segment.travelSeconds <= 0)) blockingErrors.push(`${directionKey} 방향의 예상 운행시간이 유효하지 않습니다.`);
      if (schedule?.warnings.length) warnings.push(...schedule.warnings);
      for (const plan of direction.servicePlans) {
        if (!plan.serviceDays.length || plan.serviceDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) blockingErrors.push(`${plan.serviceId} 서비스의 운행 요일이 유효하지 않습니다.`);
        if (plan.provenance.isInferred || plan.sourceType !== 'OFFICIAL') warnings.push('사용자 입력 또는 추정값이 포함된 Synthetic 데이터입니다.');
      }
    }
  }
  if (hasInferredValue(input)) warnings.push('사용자 입력 또는 추정값이 포함된 Synthetic 데이터입니다.');
  if (hasFleetAssumption(input)) warnings.push('차량 배정은 실제 운행자료가 없어 검증하지 않았습니다.');
  if (input.shapeMode === 'missing') warnings.push('MOTIS가 OSM 기반으로 없는 shape를 추정합니다.');
  return { blockingErrors: [...new Set(blockingErrors)], warnings: [...new Set(warnings)], isValid: blockingErrors.length === 0 };
}
