import { parseDelimited } from './parser';
import type { StationDemandMetric, StationDemandViewRow, StationMasterMapping, StationMasterRecord } from '../shared/types';

const REQUIRED_HEADERS = ['station_id', 'station_name', 'latitude', 'longitude'] as const;

export interface StationMasterParseResult {
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
  const seen = new Set<string>();

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
    if (seen.has(stationId)) {
      warnings.push(`정류장 사전 ${sourceRow}행의 중복 ID ${stationId}를 건너뛰었습니다.`);
      return;
    }
    seen.add(stationId);
    stations.push({ stationId, stationName, latitude, longitude });
  });

  return { stations, warnings };
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
