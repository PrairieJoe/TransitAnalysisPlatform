import { parseDelimited } from './parser';
import type { ODDemandMetric, ODDemandViewRow, StationDemandMetric, StationDemandViewRow, StationMasterMapping, StationMasterRecord } from '../shared/types';

const REQUIRED_HEADERS = ['station_id', 'station_name', 'latitude', 'longitude'] as const;

export interface StationMasterParseResult {
  stations: StationMasterRecord[];
  warnings: string[];
}

export interface StationMasterMergeResult {
  stations: StationMasterRecord[];
  warnings: string[];
}

export const EMPTY_STATION_MASTER_MAPPING: StationMasterMapping = {
  stationIdColumn: '',
  stationNameColumn: '',
  latitudeColumn: '',
  longitudeColumn: ''
};

function normalizedHeader(header: string): string {
  return header.replace(/[\s_()\-]/g, '').toLowerCase();
}

export function suggestStationMasterMapping(headers: string[], rows: Record<string, unknown>[] = []): StationMasterMapping {
  const aliases: Record<keyof StationMasterMapping, string[]> = {
    stationIdColumn: ['station_id', 'stationid', '정류장id', '정류장아이디', '정류장번호'],
    stationNameColumn: ['station_name', 'stationname', '정류장명', '정류장명칭'],
    latitudeColumn: ['latitude', 'lat', '위도'],
    longitudeColumn: ['longitude', 'lon', 'lng', '경도']
  };
  const normalized = headers.map(normalizedHeader);
  const find = (key: keyof StationMasterMapping): string => {
    const index = normalized.findIndex((header) => aliases[key].some((alias) => normalizedHeader(alias) === header));
    return index >= 0 ? headers[index] : '';
  };
  const suggestion = {
    stationIdColumn: find('stationIdColumn'),
    stationNameColumn: find('stationNameColumn'),
    latitudeColumn: find('latitudeColumn'),
    longitudeColumn: find('longitudeColumn')
  };
  const generated = headers.length >= 8 && headers.every((header, index) => normalizedHeader(header) === `필드${index + 1}`);
  if (generated && headers.length >= 14) {
    suggestion.stationIdColumn ||= headers[3];
    suggestion.stationNameColumn ||= headers[4];
    suggestion.latitudeColumn ||= headers[6];
    suggestion.longitudeColumn ||= headers[7];
  }
  if (rows.length > 0) {
    (Object.keys(suggestion) as Array<keyof StationMasterMapping>).forEach((key) => {
      const column = suggestion[key];
      if (column && !rows.some((row) => String(row[column] ?? '').trim())) suggestion[key] = '';
    });
  }
  return suggestion;
}

function parseCoordinate(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStationMasterCsv(text: string): StationMasterParseResult {
  const rows = parseDelimited(text.replace(/^\uFEFF/, ''), ',');
  const headers = (rows[0] ?? []).map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`정류장 사전에 필수 필드가 없습니다: ${missingHeaders.join(', ')}`);
  }

  const objects = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  return normalizeStationMasterRows(objects, {
    stationIdColumn: REQUIRED_HEADERS[0],
    stationNameColumn: REQUIRED_HEADERS[1],
    latitudeColumn: REQUIRED_HEADERS[2],
    longitudeColumn: REQUIRED_HEADERS[3]
  });
}

export function normalizeStationMasterRows(rows: Record<string, unknown>[], mapping: StationMasterMapping): StationMasterParseResult {
  if (Object.values(mapping).some((column) => !column)) {
    throw new Error('정류장 정보의 정류장 ID·정류장 명칭·위도·경도 필드를 모두 연결하세요.');
  }
  const stations: StationMasterRecord[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, StationMasterRecord>();
  const duplicateConflictIds = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + 1;
    const stationId = String(row[mapping.stationIdColumn] ?? '').trim();
    const stationName = String(row[mapping.stationNameColumn] ?? '').trim();
    const latitude = parseCoordinate(String(row[mapping.latitudeColumn] ?? ''));
    const longitude = parseCoordinate(String(row[mapping.longitudeColumn] ?? ''));
    if (!stationId || !stationName || latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      warnings.push(`정류장 사전 ${sourceRow}행을 건너뛰었습니다. ID·명칭·좌표를 확인하세요.`);
      return;
    }
    const existing = seen.get(stationId);
    if (existing) {
      const coordinatesDiffer = Math.abs(existing.latitude - latitude) > 1e-7 || Math.abs(existing.longitude - longitude) > 1e-7;
      if (existing.stationName !== stationName || coordinatesDiffer) duplicateConflictIds.add(stationId);
      return;
    }
    const station = { stationId, stationName, latitude, longitude };
    seen.set(stationId, station);
    stations.push(station);
  });
  if (duplicateConflictIds.size) {
    const examples = [...duplicateConflictIds].slice(0, 5).join(', ');
    warnings.push(`정류장 사전에서 좌표·명칭이 서로 다른 중복 ID ${duplicateConflictIds.size}개를 발견해 첫 번째 값을 유지했습니다. 대표 ID: ${examples}${duplicateConflictIds.size > 5 ? ' 외' : ''}.`);
  }

  return { stations, warnings };
}

/** Keeps the primary station source authoritative and fills missing stations from a secondary source. */
export function mergeStationMasterRecords(primary: StationMasterRecord[], supplemental: StationMasterRecord[]): StationMasterMergeResult {
  const stations = [...primary];
  const byId = new Map(stations.map((station) => [station.stationId, station]));
  const warnings = new Set<string>();
  for (const candidate of supplemental) {
    const existing = byId.get(candidate.stationId);
    if (!existing) {
      stations.push(candidate);
      byId.set(candidate.stationId, candidate);
      continue;
    }
    const coordinatesDiffer = Math.abs(existing.latitude - candidate.latitude) > 1e-7 || Math.abs(existing.longitude - candidate.longitude) > 1e-7;
    if (existing.stationName !== candidate.stationName || coordinatesDiffer) warnings.add(`정류장 ID ${candidate.stationId}의 사전·노선 좌표 또는 명칭이 달라 기존 정류장 사전 값을 유지했습니다.`);
  }
  return { stations, warnings: [...warnings] };
}

export function joinStationDemandMetrics(metrics: StationDemandMetric[], stations: StationMasterRecord[]): { rows: StationDemandViewRow[]; unmatchedCount: number; warnings: string[] } {
  const stationById = new Map(stations.map((station) => [station.stationId, station]));
  let unmatchedCount = 0;
  const rows = metrics.map((metric) => {
    const station = stationById.get(metric.stationId);
    if (!station) {
      unmatchedCount += 1;
      return { ...metric, stationName: '사전 미등록', latitude: null, longitude: null, mapAvailable: false };
    }
    return { ...metric, stationName: station.stationName, latitude: station.latitude, longitude: station.longitude, mapAvailable: true };
  });
  const warnings = unmatchedCount ? [`정류장 사전에 없는 ID ${unmatchedCount}개는 지도에 표시되지 않습니다.`] : [];
  return { rows, unmatchedCount, warnings };
}

export function joinODDemandMetrics(metrics: ODDemandMetric[], stations: StationMasterRecord[]): { rows: ODDemandViewRow[]; unmatchedOriginCount: number; unmatchedDestinationCount: number; warnings: string[] } {
  const stationById = new Map(stations.map((station) => [station.stationId, station]));
  let unmatchedOriginCount = 0;
  let unmatchedDestinationCount = 0;
  const rows = metrics.map((metric) => {
    const origin = stationById.get(metric.originStationId);
    const destination = stationById.get(metric.destinationStationId);
    if (!origin) unmatchedOriginCount += 1;
    if (!destination) unmatchedDestinationCount += 1;
    return {
      ...metric,
      originStationName: origin?.stationName ?? '사전 미등록',
      destinationStationName: destination?.stationName ?? '사전 미등록',
      originLatitude: origin?.latitude ?? null,
      originLongitude: origin?.longitude ?? null,
      destinationLatitude: destination?.latitude ?? null,
      destinationLongitude: destination?.longitude ?? null,
      mapAvailable: Boolean(origin && destination)
    };
  });
  const warnings: string[] = [];
  if (unmatchedOriginCount) warnings.push(`승차 정류장 사전에 없는 ID ${unmatchedOriginCount}개는 지도에 표시되지 않습니다.`);
  if (unmatchedDestinationCount) warnings.push(`하차 정류장 사전에 없는 ID ${unmatchedDestinationCount}개는 지도에 표시되지 않습니다.`);
  return { rows, unmatchedOriginCount, unmatchedDestinationCount, warnings };
}
