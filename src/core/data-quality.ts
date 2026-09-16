import { buildRoutePathIndex, resolveRouteJourney, selectRoutePath, type RoutePath } from './route-master';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  DATA_QUALITY_ERROR,
  type AnalysisConfig,
  type DataQualityAnalysisResult,
  type DataQualityErrorType,
  type DataQualityMetric,
  type NormalizedRecord,
  type RouteStopMasterRecord,
  type StationMasterRecord
} from '../shared/types';

export const DATA_QUALITY_ERROR_TYPES: DataQualityErrorType[] = [
  DATA_QUALITY_ERROR.boardingMissing,
  DATA_QUALITY_ERROR.alightingMissing,
  DATA_QUALITY_ERROR.boardingUnmatched,
  DATA_QUALITY_ERROR.alightingUnmatched,
  DATA_QUALITY_ERROR.routeMissing,
  DATA_QUALITY_ERROR.routeUnmatched,
  DATA_QUALITY_ERROR.routeStopUnmatched,
  DATA_QUALITY_ERROR.stopSequenceInvalid
];

function normalizedId(value?: string): string | undefined {
  return value?.trim() || undefined;
}

/** Classifies each normalized transaction against the merged station dictionary and applicable route path. */
export function classifyDataQuality(
  records: NormalizedRecord[],
  stationMaster: StationMasterRecord[],
  routeStops: RouteStopMasterRecord[]
): NormalizedRecord[] {
  const stationIds = new Set<string>();
  for (const station of stationMaster) {
    const stationId = normalizedId(station.stationId);
    if (stationId) stationIds.add(stationId);
  }
  const routeIds = new Set<string>();
  for (const stop of routeStops) {
    const stationId = normalizedId(stop.stationId);
    const routeId = normalizedId(stop.routeId);
    if (stationId) stationIds.add(stationId);
    if (routeId) routeIds.add(routeId);
  }
  const pathIndex = buildRoutePathIndex(routeStops);
  const selectedPaths = new Map<string, RoutePath | null>();
  const sequencesByPath = new WeakMap<RoutePath, Map<string, number[]>>();

  function sequencesForPath(path: RoutePath): Map<string, number[]> {
    const cached = sequencesByPath.get(path);
    if (cached) return cached;
    const sequences = new Map<string, number[]>();
    for (const stop of path.stops) {
      const occurrences = sequences.get(stop.stationId);
      if (occurrences) occurrences.push(stop.stationSequence);
      else sequences.set(stop.stationId, [stop.stationSequence]);
    }
    sequencesByPath.set(path, sequences);
    return sequences;
  }

  return records.map((record) => {
    const errors: DataQualityErrorType[] = [];
    const originId = normalizedId(record.stationId);
    const destinationId = normalizedId(record.destinationStationId);
    const routeId = normalizedId(record.route);

    if (!originId) errors.push(DATA_QUALITY_ERROR.boardingMissing);
    else if (!stationIds.has(originId)) errors.push(DATA_QUALITY_ERROR.boardingUnmatched);

    if (!destinationId) errors.push(DATA_QUALITY_ERROR.alightingMissing);
    else if (!stationIds.has(destinationId)) errors.push(DATA_QUALITY_ERROR.alightingUnmatched);

    if (!routeId) {
      errors.push(DATA_QUALITY_ERROR.routeMissing);
    } else if (!routeIds.has(routeId)) {
      errors.push(DATA_QUALITY_ERROR.routeUnmatched);
    } else if (originId && destinationId) {
      const pathKey = `${routeId}\u001f${record.serviceDate}`;
      if (!selectedPaths.has(pathKey)) selectedPaths.set(pathKey, selectRoutePath(pathIndex, routeId, record.serviceDate).path ?? null);
      const path = selectedPaths.get(pathKey);
      const sequences = path ? sequencesForPath(path) : undefined;
      const originSequences = sequences?.get(originId);
      const destinationSequences = sequences?.get(destinationId);
      if (!path || !originSequences?.length || !destinationSequences?.length) {
        errors.push(DATA_QUALITY_ERROR.routeStopUnmatched);
      } else if (!resolveRouteJourney(path, originId, destinationId)) {
        errors.push(DATA_QUALITY_ERROR.stopSequenceInvalid);
      }
    }

    return { ...record, qualityErrors: errors };
  });
}

/** Aggregates the rows currently selected by the quality tab's date and route filters. */
export function analyzeDataQuality(records: NormalizedRecord[], config: AnalysisConfig): DataQualityAnalysisResult {
  const totals = new Map<DataQualityErrorType, { transactionCount: number; boardingCount: number }>(
    DATA_QUALITY_ERROR_TYPES.map((type) => [type, { transactionCount: 0, boardingCount: 0 }])
  );
  let uniqueErrorTransactions = 0;
  let uniqueErrorBoardings = 0;
  let totalTransactions = 0;
  let totalBoardings = 0;

  for (const record of records) {
    if (record.serviceDate < config.filter.from || record.serviceDate > config.filter.to || (config.filter.route && record.route !== config.filter.route)) continue;
    totalTransactions += 1;
    totalBoardings += record.boardingCount;
    const errors = new Set(record.qualityErrors ?? []);
    if (errors.size) {
      uniqueErrorTransactions += 1;
      uniqueErrorBoardings += record.boardingCount;
    }
    for (const type of errors) {
      const current = totals.get(type);
      if (!current) continue;
      current.transactionCount += 1;
      current.boardingCount += record.boardingCount;
    }
  }

  const metrics: DataQualityMetric[] = DATA_QUALITY_ERROR_TYPES.map((type) => ({ type, ...totals.get(type)! }));
  return {
    metrics,
    totalTransactions,
    totalBoardings,
    uniqueErrorTransactions,
    uniqueErrorBoardings,
    warnings: totalTransactions ? [] : ['선택한 조건에 해당하는 데이터가 없습니다.'],
    config
  };
}

export function hasDataQualityError(record: NormalizedRecord, type: DataQualityErrorType): boolean {
  return record.qualityErrors?.includes(type) ?? false;
}

export function hasCurrentDataQualityClassification(records: NormalizedRecord[], schemaVersion: number): boolean {
  return schemaVersion >= CURRENT_PROJECT_SCHEMA_VERSION && records.every((record) => Array.isArray(record.qualityErrors));
}

export function legacyDataQualityWarnings(schemaVersion: number, hasMappedBoardingStationId: boolean): string[] {
  if (schemaVersion >= 7 || !hasMappedBoardingStationId) return [];
  return ['이전 버전에서는 승차 정류장 ID가 없는 거래행을 가져오기에서 제외했을 수 있어 승차누락 집계가 불완전합니다. 이 행은 저장된 프로젝트에서 복구할 수 없으므로 원본 거래내역을 다시 가져오세요.'];
}
