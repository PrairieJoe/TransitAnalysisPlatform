import type { RouteDirection, RouteStopMasterMapping, RouteStopMasterRecord } from '../shared/types';

export interface RoutePath {
  routeId: string;
  routeName: string;
  transportMode: string;
  serviceDate?: string;
  stops: RouteStopMasterRecord[];
}

export interface RoutePathIndex {
  paths: RoutePath[];
  exact: Map<string, RoutePath>;
  static: Map<string, RoutePath>;
  datedByRoute: Map<string, RoutePath[]>;
  warnings: string[];
}

export interface RouteJourneyMatch {
  direction: RouteDirection;
  originIndex: number;
  destinationIndex: number;
  distance: number;
  ambiguous: boolean;
}

export const EMPTY_ROUTE_STOP_MASTER_MAPPING: RouteStopMasterMapping = {
  routeIdColumn: '',
  routeNameColumn: '',
  transportModeColumn: '',
  stationSequenceColumn: '',
  stationIdColumn: '',
  stationNameColumn: '',
  latitudeColumn: '',
  longitudeColumn: ''
};

function normalizedHeader(header: string): string {
  return header.replace(/[\s_()\-]/g, '').toLowerCase();
}

function firstHeader(headers: string[], aliases: string[]): string {
  const normalized = headers.map(normalizedHeader);
  const index = normalized.findIndex((header) => aliases.some((alias) => normalizedHeader(alias) === header));
  return index >= 0 ? headers[index] : '';
}

export function normalizeRouteMasterDate(value: unknown): string | undefined {
  const raw = String(value ?? '').trim().replace(/[./]/g, '-');
  if (!raw) return undefined;
  const compact = raw.replace(/-/g, '');
  let year: string;
  let month: string;
  let day: string;
  if (/^\d{8}$/.test(compact)) {
    year = compact.slice(0, 4);
    month = compact.slice(4, 6);
    day = compact.slice(6, 8);
  } else if (/^\d{6}$/.test(compact)) {
    year = `20${compact.slice(0, 2)}`;
    month = compact.slice(2, 4);
    day = compact.slice(4, 6);
  } else if (/^0\d{6}$/.test(compact)) {
    year = `20${compact.slice(1, 3)}`;
    month = compact.slice(3, 5);
    day = compact.slice(5, 7);
  } else {
    const separated = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (!separated) return undefined;
    year = separated[1];
    month = separated[2];
    day = separated[3];
  }
  const candidate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  if (Number.isNaN(candidate.getTime()) || candidate.toISOString().slice(0, 10) !== `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`) return undefined;
  return candidate.toISOString().slice(0, 10);
}

function parseNumber(value: unknown): number | undefined {
  const raw = String(value ?? '').trim().replace(/[,_\s]/g, '');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNumber(row: Record<string, unknown>, column?: string): number | undefined {
  return column ? parseNumber(row[column]) : undefined;
}

export function suggestRouteStopMasterMapping(headers: string[], rows: Record<string, unknown>[] = []): RouteStopMasterMapping {
  const suggestion: RouteStopMasterMapping = {
    serviceDateColumn: firstHeader(headers, ['운행일자', 'service_date', 'servicedate', 'date']),
    settlementCompanyIdColumn: firstHeader(headers, ['정산사id', '정산사아이디', 'settlement_company_id']),
    settlementRegionCodeColumn: firstHeader(headers, ['정산지역코드', 'settlement_region_code']),
    routeIdColumn: firstHeader(headers, ['노선id', '노선아이디', 'route_id', 'routeid']),
    routeNameColumn: firstHeader(headers, ['노선명칭', '노선명', 'route_name', 'routename']),
    transportModeColumn: firstHeader(headers, ['교통수단구분', '교통수단', 'transport_mode', 'mode']),
    stationSequenceColumn: firstHeader(headers, ['정류장순번', '정류장순서', 'station_sequence', 'stop_sequence', 'sequence']),
    stationIdColumn: firstHeader(headers, ['정류장id', '정류장아이디', 'station_id', 'stationid']),
    stationNameColumn: firstHeader(headers, ['정류장명칭', '정류장명', 'station_name', 'stationname']),
    latitudeColumn: firstHeader(headers, ['정류장x좌표', '위도', 'latitude', 'lat']),
    longitudeColumn: firstHeader(headers, ['정류장y좌표', '경도', 'longitude', 'lon', 'lng']),
    arsNumberColumn: firstHeader(headers, ['정류장ars번호', 'ars번호', 'ars_number', 'ars']),
    cumulativeDistanceColumn: firstHeader(headers, ['노선누적거리', 'cumulative_distance']),
    stationDistanceColumn: firstHeader(headers, ['정류장거리', 'station_distance'])
  };
  const generated = headers.length >= 14 && headers.every((header, index) => normalizedHeader(header) === `필드${index + 1}`);
  if (generated) {
    suggestion.serviceDateColumn ||= headers[0];
    suggestion.settlementCompanyIdColumn ||= headers[1];
    suggestion.settlementRegionCodeColumn ||= headers[2];
    suggestion.routeIdColumn ||= headers[3];
    suggestion.routeNameColumn ||= headers[4];
    suggestion.transportModeColumn ||= headers[5];
    suggestion.stationSequenceColumn ||= headers[6];
    suggestion.stationIdColumn ||= headers[7];
    suggestion.stationNameColumn ||= headers[8];
    suggestion.latitudeColumn ||= headers[9];
    suggestion.longitudeColumn ||= headers[10];
    suggestion.arsNumberColumn ||= headers[11];
    suggestion.cumulativeDistanceColumn ||= headers[12];
    suggestion.stationDistanceColumn ||= headers[13];
  }
  if (rows.length) {
    (Object.keys(suggestion) as Array<keyof RouteStopMasterMapping>).forEach((key) => {
      const column = suggestion[key];
      if (column && !rows.some((row) => String(row[column] ?? '').trim())) delete suggestion[key];
    });
  }
  return suggestion;
}

function requiredColumns(mapping: RouteStopMasterMapping): Array<keyof RouteStopMasterMapping> {
  return ['routeIdColumn', 'routeNameColumn', 'transportModeColumn', 'stationSequenceColumn', 'stationIdColumn', 'stationNameColumn', 'latitudeColumn', 'longitudeColumn'];
}

export interface RouteStopMasterParseResult {
  stops: RouteStopMasterRecord[];
  warnings: string[];
}

export function normalizeRouteStopMasterRows(rows: Record<string, unknown>[], mapping: RouteStopMasterMapping): RouteStopMasterParseResult {
  const missing = requiredColumns(mapping).filter((key) => !mapping[key]);
  if (missing.length) throw new Error('노선별 정류장정보의 노선 ID·노선명·교통수단·정류장 순번·정류장 ID·정류장명·좌표를 모두 연결하세요.');
  const stops: RouteStopMasterRecord[] = [];
  const warnings: string[] = [];
  const seenPathStopKeys = new Set<string>();
  let exactDuplicateRows = 0;
  rows.forEach((row, index) => {
    const sourceRow = index + 1;
    const routeId = String(row[mapping.routeIdColumn] ?? '').trim();
    const routeName = String(row[mapping.routeNameColumn] ?? '').trim();
    const transportMode = String(row[mapping.transportModeColumn] ?? '').trim();
    const stationId = String(row[mapping.stationIdColumn] ?? '').trim();
    const stationName = String(row[mapping.stationNameColumn] ?? '').trim();
    const sequence = parseNumber(row[mapping.stationSequenceColumn]);
    const latitude = parseNumber(row[mapping.latitudeColumn]);
    const longitude = parseNumber(row[mapping.longitudeColumn]);
    const rawDate = mapping.serviceDateColumn ? String(row[mapping.serviceDateColumn] ?? '').trim() : '';
    const serviceDate = rawDate ? normalizeRouteMasterDate(rawDate) : undefined;
    if (!routeId || !routeName || !transportMode || !stationId || !stationName || sequence === undefined || !Number.isInteger(sequence) || sequence < 0 || latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (rawDate && !serviceDate)) {
      warnings.push(`노선별 정류장정보 ${sourceRow}행을 건너뛰었습니다. 필수값·순번·좌표·운행일자를 확인하세요.`);
      return;
    }
    const cumulativeDistance = optionalNumber(row, mapping.cumulativeDistanceColumn);
    const stationDistance = optionalNumber(row, mapping.stationDistanceColumn);
    const pathStopKey = `${routeId}\u001f${serviceDate ?? ''}\u001f${sequence}\u001f${stationId}`;
    if (seenPathStopKeys.has(pathStopKey)) {
      exactDuplicateRows += 1;
      return;
    }
    seenPathStopKeys.add(pathStopKey);
    stops.push({
      serviceDate,
      settlementCompanyId: mapping.settlementCompanyIdColumn ? String(row[mapping.settlementCompanyIdColumn] ?? '').trim() || undefined : undefined,
      settlementRegionCode: mapping.settlementRegionCodeColumn ? String(row[mapping.settlementRegionCodeColumn] ?? '').trim() || undefined : undefined,
      routeId,
      routeName,
      transportMode,
      stationSequence: sequence,
      stationId,
      stationName,
      latitude,
      longitude,
      arsNumber: mapping.arsNumberColumn ? String(row[mapping.arsNumberColumn] ?? '').trim() || undefined : undefined,
      cumulativeDistance,
      stationDistance,
      sourceRow
    });
  });
  if (exactDuplicateRows) warnings.push(`노선별 정류장정보의 동일한 노선·운행일자·순번·정류장 ID ${exactDuplicateRows}개 행을 하나로 통합했습니다.`);
  return { stops, warnings };
}

function pathKey(routeId: string, serviceDate?: string): string {
  return `${routeId}\u001f${serviceDate ?? ''}`;
}

export function buildRoutePathIndex(stops: RouteStopMasterRecord[]): RoutePathIndex {
  const groups = new Map<string, RouteStopMasterRecord[]>();
  for (const stop of stops) {
    const key = pathKey(stop.routeId, stop.serviceDate);
    groups.set(key, [...(groups.get(key) ?? []), stop]);
  }
  const paths: RoutePath[] = [];
  const warnings: string[] = [];
  for (const group of groups.values()) {
    const routeId = group[0].routeId;
    const serviceDate = group[0].serviceDate;
    const sequenceSet = new Set<number>();
    let invalid = false;
    for (const stop of group) {
      if (sequenceSet.has(stop.stationSequence)) {
        warnings.push(`노선 ${routeId}${serviceDate ? `(${serviceDate})` : ''}의 정류장 순번 ${stop.stationSequence}가 중복되어 경로에서 제외되었습니다.`);
        invalid = true;
      }
      sequenceSet.add(stop.stationSequence);
    }
    const ordered = [...group].sort((left, right) => left.stationSequence - right.stationSequence);
    if (ordered.length < 2) {
      warnings.push(`노선 ${routeId}${serviceDate ? `(${serviceDate})` : ''}의 정류장이 2개 미만이라 경로에서 제외되었습니다.`);
      invalid = true;
    }
    if (invalid) continue;
    paths.push({ routeId, routeName: ordered[0].routeName, transportMode: ordered[0].transportMode, serviceDate, stops: ordered });
  }
  const exact = new Map<string, RoutePath>();
  const staticPaths = new Map<string, RoutePath>();
  const datedByRoute = new Map<string, RoutePath[]>();
  for (const path of paths) {
    if (path.serviceDate) {
      exact.set(pathKey(path.routeId, path.serviceDate), path);
      datedByRoute.set(path.routeId, [...(datedByRoute.get(path.routeId) ?? []), path]);
    } else {
      staticPaths.set(path.routeId, path);
    }
  }
  return { paths, exact, static: staticPaths, datedByRoute, warnings };
}

export function selectRoutePath(index: RoutePathIndex, routeId: string, serviceDate: string): { path?: RoutePath; warning?: string } {
  const exact = index.exact.get(pathKey(routeId, serviceDate));
  if (exact) return { path: exact };
  const staticPath = index.static.get(routeId);
  if (staticPath) return { path: staticPath };
  const dated = index.datedByRoute.get(routeId) ?? [];
  if (dated.length === 1) return { path: dated[0], warning: `노선 ${routeId}는 단일 날짜(${dated[0].serviceDate}) 경로를 ${serviceDate}에도 재사용합니다.` };
  if (dated.length > 1) return { warning: `노선 ${routeId}의 ${serviceDate} 경로를 찾지 못했습니다. 운행일자별 노선정보를 확인하세요.` };
  return { warning: `노선 ${routeId}의 경로를 찾지 못했습니다.` };
}

/** Resolves a trip in route sequence order; reverse-order trips are classified as sequence errors. */
export function resolveRouteJourney(path: RoutePath, originStationId: string, destinationStationId: string): RouteJourneyMatch | undefined {
  const candidates: Array<Omit<RouteJourneyMatch, 'ambiguous'>> = [];
  const origins = path.stops.map((stop, index) => stop.stationId === originStationId ? index : -1).filter((index) => index >= 0);
  const destinations = path.stops.map((stop, index) => stop.stationId === destinationStationId ? index : -1).filter((index) => index >= 0);
  for (const originIndex of origins) {
    for (const destinationIndex of destinations) {
      if (destinationIndex > originIndex) candidates.push({ direction: 'forward', originIndex, destinationIndex, distance: destinationIndex - originIndex });
    }
  }
  if (!candidates.length) return undefined;
  candidates.sort((left, right) => left.distance - right.distance || left.originIndex - right.originIndex || left.direction.localeCompare(right.direction));
  return { ...candidates[0], ambiguous: candidates.length > 1 };
}

export function routeOptions(index: RoutePathIndex): Array<{ routeId: string; routeName: string; transportMode: string }> {
  const options = new Map<string, { routeId: string; routeName: string; transportMode: string }>();
  for (const path of index.paths) options.set(path.routeId, { routeId: path.routeId, routeName: path.routeName, transportMode: path.transportMode });
  return [...options.values()].sort((left, right) => left.routeId.localeCompare(right.routeId, 'ko'));
}
