import { buildRoutePathIndex, selectRoutePath, type RoutePath } from './route-master';
import type {
  AlightingAnalysisMode,
  AlightingCoverageRow,
  AlightingInferenceConfig,
  AlightingInferenceMetadata,
  AlightingInferenceResult,
  AlightingInferenceStatus,
  NormalizedRecord,
  RouteStopMasterRecord,
  StationMasterRecord
} from '../shared/types';

interface TimedRecord {
  record: NormalizedRecord;
  index: number;
  timestamp: number;
  serviceDayKey: string;
}

interface Candidate {
  item: TimedRecord;
  distanceMeters: number;
  routeCompatible: boolean;
}

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTime(value?: string): { hour: number; minute: number; second: number } | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function serviceDayKey(serviceDate: string, time: { hour: number }, boundaryHour: number): string | null {
  const date = parseDate(serviceDate);
  if (!date) return null;
  if (time.hour >= boundaryHour) return serviceDate;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function timedRecord(record: NormalizedRecord, index: number, boundaryHour: number): TimedRecord | null {
  const time = parseTime(record.boardingTime);
  const date = parseDate(record.serviceDate);
  if (!time || !date) return null;
  const timestamp = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), time.hour, time.minute, time.second);
  const key = serviceDayKey(record.serviceDate, time, boundaryHour);
  return key ? { record, index, timestamp, serviceDayKey: key } : null;
}

function haversineMeters(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }): number {
  const earthRadius = 6_371_000;
  const latitudeDelta = (right.latitude - left.latitude) * Math.PI / 180;
  const longitudeDelta = (right.longitude - left.longitude) * Math.PI / 180;
  const leftLatitude = left.latitude * Math.PI / 180;
  const rightLatitude = right.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stationLookup(stations: StationMasterRecord[], routeStops: RouteStopMasterRecord[]): Map<string, StationMasterRecord> {
  const lookup = new Map<string, StationMasterRecord>();
  for (const station of stations) lookup.set(station.stationId, station);
  for (const stop of routeStops) {
    if (!lookup.has(stop.stationId)) lookup.set(stop.stationId, { stationId: stop.stationId, stationName: stop.stationName, latitude: stop.latitude, longitude: stop.longitude });
  }
  return lookup;
}

function routeFor(record: NormalizedRecord, routeIndex: ReturnType<typeof buildRoutePathIndex>): RoutePath | undefined {
  if (!record.route) return undefined;
  return selectRoutePath(routeIndex, record.route, record.serviceDate).path;
}

function isDownstream(path: RoutePath | undefined, originStationId: string | undefined, candidateStationId: string | undefined): boolean {
  if (!path || !originStationId || !candidateStationId) return true;
  const origin = path.stops.findIndex((stop) => stop.stationId === originStationId);
  const candidate = path.stops.findIndex((stop) => stop.stationId === candidateStationId);
  return origin < 0 || candidate < 0 || candidate > origin;
}

function confidenceFor(status: AlightingInferenceStatus): number {
  if (status === 'observed') return 1;
  if (status === 'inferred-high') return 0.9;
  if (status === 'inferred-expected') return 0.6;
  return 0;
}

function unresolved(reason: string): AlightingInferenceMetadata {
  return { status: 'unresolved', method: 'unresolved', confidence: 0, reason };
}

function terminalCandidate(record: NormalizedRecord, path: RoutePath | undefined): string | undefined {
  if (!path || !record.stationId) return undefined;
  const originIndex = path.stops.findIndex((stop) => stop.stationId === record.stationId);
  if (originIndex < 0) return undefined;
  return path.stops.slice(originIndex + 1).at(-1)?.stationId;
}

function coverageRow(record: NormalizedRecord): AlightingCoverageRow {
  const metadata = record.alightingInference ?? unresolved('추정 결과가 없습니다.');
  return {
    serviceDate: record.serviceDate,
    route: record.route,
    stationId: record.stationId,
    destinationStationId: record.destinationStationId,
    inferredDestinationStationId: record.inferredDestinationStationId,
    status: metadata.status,
    method: metadata.method,
    confidence: metadata.confidence,
    distanceMeters: metadata.distanceMeters,
    timeGapMinutes: metadata.timeGapMinutes
  };
}

export function inferAlighting(
  records: NormalizedRecord[],
  stations: StationMasterRecord[],
  routeStops: RouteStopMasterRecord[],
  config: AlightingInferenceConfig
): AlightingInferenceResult {
  const stationById = stationLookup(stations, routeStops);
  const routeIndex = buildRoutePathIndex(routeStops);
  const timed = records.map((record, index) => timedRecord(record, index, config.serviceDayBoundaryHour)).filter((value): value is TimedRecord => Boolean(value));
  const timedByIndex = new Map<number, TimedRecord>();
  const byCardAndDay = new Map<string, TimedRecord[]>();
  for (const item of timed) {
    timedByIndex.set(item.index, item);
    if (!item.record.virtualCardId) continue;
    const key = `${item.record.virtualCardId}\u001f${item.serviceDayKey}`;
    const chain = byCardAndDay.get(key) ?? [];
    chain.push(item);
    byCardAndDay.set(key, chain);
  }
  for (const items of byCardAndDay.values()) items.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);

  const nextRecords = records.map((record) => ({ ...record }));
  for (let index = 0; index < nextRecords.length; index += 1) {
    const record = nextRecords[index];
    if (record.destinationStationId) {
      delete record.inferredDestinationStationId;
      record.alightingInference = { status: 'observed', method: 'observed', confidence: confidenceFor('observed') };
      continue;
    }

    delete record.inferredDestinationStationId;
    delete record.alightingInference;
    const current = timedByIndex.get(index);
    let metadata: AlightingInferenceMetadata | undefined;
    if (!record.virtualCardId) metadata = unresolved('가상카드번호가 없어 동일 이용자의 다음 승차를 연결할 수 없습니다.');
    else if (!current) metadata = unresolved('승차 일시가 없어 이용 순서를 정렬할 수 없습니다.');
    else {
      const chain = byCardAndDay.get(`${record.virtualCardId}\u001f${current.serviceDayKey}`) ?? [];
      const path = routeFor(record, routeIndex);
      const originStation = record.stationId ? stationById.get(record.stationId) : undefined;
      const candidates: Candidate[] = [];
      for (const item of chain) {
        if (item.timestamp <= current.timestamp || item.index === current.index || !item.record.stationId) continue;
        const gap = (item.timestamp - current.timestamp) / 60_000;
        if (gap > config.maxTransferMinutes) break;
        const destinationStation = stationById.get(item.record.stationId);
        if (!originStation || !destinationStation) continue;
        const distanceMeters = haversineMeters(originStation, destinationStation);
        if (distanceMeters > config.fallbackDistanceMeters) continue;
        if (item.record.route === record.route && !isDownstream(path, record.stationId, item.record.stationId)) continue;
        candidates.push({ item, distanceMeters, routeCompatible: Boolean(path && item.record.route === record.route) });
      }
      candidates.sort((left, right) => Number(right.routeCompatible) - Number(left.routeCompatible) || left.distanceMeters - right.distanceMeters || left.item.timestamp - right.item.timestamp);
      const candidate = candidates[0];
      if (candidate) {
        const timeGapMinutes = (candidate.item.timestamp - current.timestamp) / 60_000;
        const status: AlightingInferenceStatus = candidate.distanceMeters <= config.primaryDistanceMeters ? 'inferred-high' : 'inferred-expected';
        metadata = { status, method: 'next-boarding', confidence: confidenceFor(status), sourceRecordIndex: candidate.item.index, distanceMeters: candidate.distanceMeters, timeGapMinutes };
        record.inferredDestinationStationId = candidate.item.record.stationId;
      } else {
        const terminal = terminalCandidate(record, path);
        if (terminal) {
          metadata = { status: 'inferred-expected', method: 'route-terminal', confidence: confidenceFor('inferred-expected'), reason: '동일 이용자의 다음 승차가 없어 노선상 하차 종점으로 추정했습니다.' };
          record.inferredDestinationStationId = terminal;
        } else {
          metadata = unresolved('거리·시간·노선 제약을 만족하는 다음 승차 또는 종점이 없습니다.');
        }
      }
    }
    record.alightingInference = metadata ?? unresolved('추정 결과가 없습니다.');
  }

  const coverageRows = nextRecords.map(coverageRow);
  const missingBefore = records.filter((record) => !record.destinationStationId).length;
  const summary: AlightingInferenceResult['summary'] = {
    totalRows: nextRecords.length,
    totalBoardings: nextRecords.reduce((sum, record) => sum + record.boardingCount, 0),
    missingBefore,
    observed: coverageRows.filter((row) => row.status === 'observed').length,
    inferredHigh: coverageRows.filter((row) => row.status === 'inferred-high').length,
    inferredExpected: coverageRows.filter((row) => row.status === 'inferred-expected').length,
    unresolved: coverageRows.filter((row) => row.status === 'unresolved').length,
    warnings: [],
    config
  };
  if (!stations.length && !routeStops.length) summary.warnings.push('정류장 또는 노선 경로 정보가 없어 거리·경로 제약을 적용할 수 없습니다.');
  if (!timed.length && missingBefore) summary.warnings.push('승차 일시가 없어 하차 추정 대상의 이용 순서를 만들 수 없습니다.');
  if (summary.unresolved) summary.warnings.push(`하차누락 ${summary.unresolved.toLocaleString('ko-KR')}개 행은 제약조건을 만족하는 추정값이 없어 미해결로 남겼습니다.`);
  return { records: nextRecords, coverageRows, summary };
}

export function effectiveDestinationStationId(record: NormalizedRecord, mode: AlightingAnalysisMode = 'observed'): string | undefined {
  if (record.destinationStationId) return record.destinationStationId;
  if (!record.inferredDestinationStationId) return undefined;
  const status = record.alightingInference?.status;
  if (mode === 'expected-flow' && (status === 'inferred-high' || status === 'inferred-expected')) return record.inferredDestinationStationId;
  if (mode === 'high-confidence' && status === 'inferred-high') return record.inferredDestinationStationId;
  return undefined;
}
