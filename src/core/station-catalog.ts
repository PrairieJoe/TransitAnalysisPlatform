import type {
  RouteStopMasterRecord,
  StationCatalog,
  StationCatalogConflict,
  StationCatalogConflictField,
  StationCatalogProvenance,
  StationCatalogRecord,
  StationMasterRecord
} from '../shared/types';
import { routeStopMembershipKey } from './route-master';

const COORDINATE_EPSILON = 1e-7;

export interface StationCatalogBuildOptions {
  stationMasterSource?: string;
  routeStopMasterSource?: string;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function provenanceKey(provenance: StationCatalogProvenance): string {
  return [
    provenance.source,
    provenance.sourceName ?? '',
    provenance.sourceRow ?? '',
    provenance.routeId ?? '',
    provenance.serviceDate ?? '',
    provenance.stationSequence ?? ''
  ].join('\u001f');
}

function addProvenance(station: StationCatalogRecord, provenance: StationCatalogProvenance): void {
  if (!station.provenance.some((candidate) => provenanceKey(candidate) === provenanceKey(provenance))) station.provenance.push(provenance);
}

function stationMasterProvenance(station: StationMasterRecord, sourceName?: string): StationCatalogProvenance {
  return { source: 'station-master', sourceName, sourceRow: undefined };
}

function routeStopProvenance(stop: RouteStopMasterRecord, sourceName?: string): StationCatalogProvenance {
  return {
    source: 'route-stop',
    sourceName,
    sourceRow: stop.sourceRow,
    routeId: stop.routeId,
    serviceDate: stop.serviceDate,
    stationSequence: stop.stationSequence
  };
}

function conflictValue(station: StationCatalogRecord, field: StationCatalogConflictField): string | number {
  return station[field];
}

function conflictLabel(field: StationCatalogConflictField): string {
  if (field === 'stationName') return '명칭';
  if (field === 'latitude') return '위도';
  return '경도';
}

function conflictParticle(field: StationCatalogConflictField): string {
  return field === 'stationName' ? '이' : '가';
}

function differs(left: string | number, right: string | number, field: StationCatalogConflictField): boolean {
  if (field === 'stationName') return left !== right;
  return Math.abs(Number(left) - Number(right)) > COORDINATE_EPSILON;
}

function addConflicts(
  station: StationCatalogRecord,
  incoming: { stationName: string; latitude: number; longitude: number },
  incomingSource: 'station-master' | 'route-stop',
  conflicts: StationCatalogConflict[],
  warnings: string[]
): void {
  for (const field of ['stationName', 'latitude', 'longitude'] as const) {
    const preferredValue = conflictValue(station, field);
    const conflictingValue = incoming[field];
    if (!differs(preferredValue, conflictingValue, field)) continue;
    const conflict: StationCatalogConflict = {
      stationId: station.stationId,
      field,
      preferredValue,
      conflictingValue,
      preferredSource: station.provenance[0]?.source ?? incomingSource,
      conflictingSource: incomingSource
    };
    if (!conflicts.some((candidate) => candidate.stationId === conflict.stationId
      && candidate.field === conflict.field
      && candidate.preferredValue === conflict.preferredValue
      && candidate.conflictingValue === conflict.conflictingValue
      && candidate.preferredSource === conflict.preferredSource
      && candidate.conflictingSource === conflict.conflictingSource)) {
      conflicts.push(conflict);
      warnings.push(`정류장 ID ${station.stationId}의 ${conflictLabel(field)}${conflictParticle(field)} ${conflict.preferredSource}와 ${conflict.conflictingSource}에서 달라 ${conflict.preferredSource} 값을 유지했습니다.`);
    }
  }
}

function addStation(
  stationsById: Map<string, StationCatalogRecord>,
  station: StationCatalogRecord,
  conflicts: StationCatalogConflict[],
  warnings: string[]
): StationCatalogRecord {
  const existing = stationsById.get(station.stationId);
  if (!existing) {
    stationsById.set(station.stationId, station);
    return station;
  }
  addConflicts(existing, station, station.provenance[0]?.source === 'station-master' ? 'station-master' : 'route-stop', conflicts, warnings);
  station.provenance.forEach((provenance) => addProvenance(existing, provenance));
  return existing;
}

export function buildStationCatalog(
  stationMaster: StationMasterRecord[],
  routeStopMaster: RouteStopMasterRecord[],
  options: StationCatalogBuildOptions = {}
): StationCatalog {
  const stationsById = new Map<string, StationCatalogRecord>();
  const routeMemberships: RouteStopMasterRecord[] = [];
  const conflicts: StationCatalogConflict[] = [];
  const warnings: string[] = [];

  stationMaster.forEach((source, index) => {
    if (!source.stationId || !source.stationName || !validCoordinate(source.latitude, source.longitude)) {
      warnings.push(`정류장 ID ${source.stationId || '(없음)'}의 station-master 원본을 좌표 범위 오류로 제외했습니다.`);
      return;
    }
    addStation(stationsById, {
      ...source,
      provenance: [{ ...stationMasterProvenance(source, options.stationMasterSource), sourceRow: source.sourceRow ?? index + 1 }]
    }, conflicts, warnings);
  });

  const seenMemberships = new Set<string>();
  const duplicateMembershipsByRoute = new Map<string, number>();
  routeStopMaster.forEach((source) => {
    if (!source.routeId || !source.stationId || !source.stationName || !validCoordinate(source.latitude, source.longitude)) {
      warnings.push(`노선 ${source.routeId || '(없음)'}의 정류장 ${source.stationId || '(없음)'}를 좌표 범위 오류로 제외했습니다.`);
      return;
    }
    const key = routeStopMembershipKey(source);
    if (seenMemberships.has(key)) {
      duplicateMembershipsByRoute.set(source.routeId, (duplicateMembershipsByRoute.get(source.routeId) ?? 0) + 1);
      return;
    }
    seenMemberships.add(key);
    routeMemberships.push(source);
    const existing = stationsById.get(source.stationId);
    if (existing) {
      addConflicts(existing, source, 'route-stop', conflicts, warnings);
      addProvenance(existing, routeStopProvenance(source, options.routeStopMasterSource));
      return;
    }
    addStation(stationsById, {
      stationId: source.stationId,
      stationName: source.stationName,
      latitude: source.latitude,
      longitude: source.longitude,
      provenance: [routeStopProvenance(source, options.routeStopMasterSource)]
    }, conflicts, warnings);
  });
  for (const [routeId, duplicateCount] of duplicateMembershipsByRoute) warnings.push(`노선 ${routeId}의 동일한 운행일자·순번·정류장 ID 중복 ${duplicateCount}개를 하나로 통합했습니다.`);

  return { schemaVersion: 1, stations: [...stationsById.values()], routeMemberships, conflicts, warnings };
}
