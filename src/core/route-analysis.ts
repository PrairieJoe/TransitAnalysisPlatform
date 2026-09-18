import { buildRoutePathIndex, resolveRouteJourney, selectRoutePath, type RoutePath, type RoutePathIndex } from './route-master';
import { DATA_QUALITY_ERROR, HOURS, type HourIndex, type NormalizedRecord, type RouteCongestionConfig, type RouteCongestionResult, type RouteDemandRow, type RouteDirection, type RouteSegmentMetric, type RouteServiceConfig, type RouteStopLoadMetric, type RouteStopMasterRecord } from '../shared/types';
import { hasDataQualityError } from './data-quality';
import { effectiveDestinationStationId } from './alighting-inference';

export const CONGESTION_BANDS = [
  { min: 0, max: 10, label: '0–10%', color: '#55b947' },
  { min: 10, max: 20, label: '11–20%', color: '#8bd25a' },
  { min: 20, max: 30, label: '21–30%', color: '#f2d13d' },
  { min: 30, max: 40, label: '31–40%', color: '#f39a3d' },
  { min: 40, max: Number.POSITIVE_INFINITY, label: '41% 이상', color: '#e62626' }
] as const;

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;
const AGGREGATE_VEHICLE_KEY = '__aggregate__';

interface LoadCohort {
  key: string;
  path: RoutePath;
  direction: RouteDirection;
  hour: HourIndex;
  vehicleId?: string;
  boardings: Map<number, number>;
  alightings: Map<number, number>;
}

interface PeakProfile {
  previousOnboard: number;
  boardings: number;
  alightings: number;
  onboardPassengers: number;
  isVehicle: boolean;
}

interface StopAggregate {
  path: RoutePath;
  direction: RouteDirection;
  stop: RouteStopMasterRecord;
  sumOnboard: number;
  weight: number;
  totalBoardings: number;
  totalAlightings: number;
  peak?: PeakProfile;
  hasVehicleCohort: boolean;
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateRange(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) dates.push(new Date(cursor).toISOString().slice(0, 10));
  return dates;
}

function hourFromRecord(record: NormalizedRecord): HourIndex | null {
  if (record.boardingHour !== undefined) return record.boardingHour;
  const match = /^(\d{2}):/.exec(record.boardingTime ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour as HourIndex : null;
}

function matchesFilter(record: NormalizedRecord, config: RouteCongestionConfig): boolean {
  return record.serviceDate >= config.filter.from && record.serviceDate <= config.filter.to &&
    (!config.filter.route || record.route === config.filter.route) &&
    (!config.filter.station || record.station === config.filter.station) &&
    (!config.filter.region || record.region === config.filter.region);
}

function configFor(configs: RouteServiceConfig[], routeId: string): RouteServiceConfig | undefined {
  return configs.find((candidate) => candidate.routeId === routeId);
}

function dailyTripsFor(config: RouteServiceConfig | undefined, hour: RouteCongestionConfig['hour']): number | null {
  if (!config) return null;
  const trips = HOURS.map((candidate) => Number(config.tripsByHour[String(candidate)] ?? 0));
  if (trips.some((value) => !Number.isInteger(value) || value < 0)) return null;
  if (hour === 'all') return trips.reduce((sum, value) => sum + value, 0);
  return trips[hour];
}

function tripsAtHour(config: RouteServiceConfig | undefined, hour: HourIndex): number | null {
  if (!config) return null;
  const trips = Number(config.tripsByHour[String(hour)] ?? 0);
  return Number.isInteger(trips) && trips >= 0 ? trips : null;
}

function directionLabel(direction: RouteDirection): string {
  return direction === 'forward' ? '순방향' : '역방향';
}

function directionStops(path: RoutePath, direction: RouteDirection): RouteStopMasterRecord[] {
  return direction === 'forward' ? path.stops : [...path.stops].reverse();
}

function addToMap<TKey>(map: Map<TKey, number>, key: TKey, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function stopKey(routeId: string, direction: RouteDirection, sequence: number, stationId: string): string {
  return [routeId, direction, sequence, stationId].join('\u001f');
}

function segmentKey(routeId: string, direction: RouteDirection, from: RouteStopMasterRecord, to: RouteStopMasterRecord): string {
  return [routeId, direction, from.stationSequence, to.stationSequence, from.stationId, to.stationId].join('\u001f');
}

function segmentDistance(from: RouteStopMasterRecord, to: RouteStopMasterRecord): number | undefined {
  if (from.cumulativeDistance !== undefined && to.cumulativeDistance !== undefined) return Math.abs(to.cumulativeDistance - from.cumulativeDistance);
  return to.stationDistance;
}

function compareNullable(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareLoad(left: number, right: number): number {
  return right - left;
}

export function congestionColor(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '#b8c1c9';
  return CONGESTION_BANDS.find((band) => percent <= band.max)?.color ?? CONGESTION_BANDS[CONGESTION_BANDS.length - 1].color;
}

export function analyzeRouteDemandRows(
  rows: RouteDemandRow[],
  routeStops: RouteStopMasterRecord[],
  serviceConfigs: RouteServiceConfig[],
  config: RouteCongestionConfig,
  initialExcludedRows = 0,
  initialWarnings: string[] = []
): RouteCongestionResult {
  const pathIndex = buildRoutePathIndex(routeStops);
  const validDates = new Set<string>();
  const cohorts = new Map<string, LoadCohort>();
  const warnings = new Set([...pathIndex.warnings, ...initialWarnings]);
  const missingJourneyRouteIds = new Set<string>();
  let missingJourneyRows = 0;
  let excludedRows = initialExcludedRows;
  let totalBoardings = 0;
  let vehicleRows = 0;
  let estimatedRows = 0;

  for (const row of rows) {
    const selected = selectRoutePath(pathIndex, row.routeId, row.serviceDate);
    if (selected.warning) warnings.add(selected.warning);
    if (!selected.path) {
      excludedRows += 1;
      continue;
    }
    const journey = resolveRouteJourney(selected.path, row.originStationId, row.destinationStationId);
    if (!journey) {
      missingJourneyRows += row.rowCount ?? 1;
      missingJourneyRouteIds.add(row.routeId);
      excludedRows += 1;
      continue;
    }
    const direction = journey.direction;
    const orderedJourneyStops = directionStops(selected.path, direction);
    const origin = orderedJourneyStops[journey.originIndex];
    const destination = orderedJourneyStops[journey.destinationIndex];
    const hour = row.hour;
    if (hour === undefined) {
      excludedRows += 1;
      warnings.add(`노선 ${row.routeId}의 승차 시간 정보가 없어 재차인원에서 제외한 행이 있습니다.`);
      continue;
    }
    const vehicleId = row.vehicleId?.trim() || undefined;
    const cohortKey = [row.serviceDate, row.routeId, hour, direction, vehicleId ?? AGGREGATE_VEHICLE_KEY].join('\u001f');
    const cohort = cohorts.get(cohortKey) ?? { key: cohortKey, path: selected.path, direction, hour, vehicleId, boardings: new Map<number, number>(), alightings: new Map<number, number>() };
    addToMap(cohort.boardings, origin.stationSequence, row.total);
    addToMap(cohort.alightings, destination.stationSequence, row.total);
    cohorts.set(cohortKey, cohort);
    validDates.add(row.serviceDate);
    totalBoardings += row.total;
    if (vehicleId) vehicleRows += 1;
    else estimatedRows += 1;
  }

  const aggregates = new Map<string, StopAggregate>();
  const allCohorts = [...cohorts.values()];
  for (const cohort of allCohorts) {
    const service = configFor(serviceConfigs, cohort.path.routeId);
    const trips = tripsAtHour(service, cohort.hour);
    const isEstimated = !cohort.vehicleId;
    const normalizationFactor = isEstimated && trips !== null && trips > 0 ? trips : 1;
    const orderedStops = directionStops(cohort.path, cohort.direction);
    let rawOnboard = 0;
    for (const stop of orderedStops) {
      const rawBoardings = cohort.boardings.get(stop.stationSequence) ?? 0;
      const rawAlightings = cohort.alightings.get(stop.stationSequence) ?? 0;
      const rawPrevious = rawOnboard;
      const rawNext = rawPrevious + rawBoardings - rawAlightings;
      if (rawNext < -EPSILON) {
        warnings.add(`노선 ${cohort.path.routeId} ${directionLabel(cohort.direction)} ${stop.stationName}에서 하차인원이 누적 재차인원보다 많아 0명으로 보정했습니다.`);
        rawOnboard = 0;
      } else {
        rawOnboard = rawNext;
      }
      const normalized = {
        previousOnboard: rawPrevious / normalizationFactor,
        boardings: rawBoardings / normalizationFactor,
        alightings: rawAlightings / normalizationFactor,
        onboardPassengers: rawOnboard / normalizationFactor
      };
      const key = stopKey(cohort.path.routeId, cohort.direction, stop.stationSequence, stop.stationId);
      const aggregate = aggregates.get(key) ?? { path: cohort.path, direction: cohort.direction, stop, sumOnboard: 0, weight: 0, totalBoardings: 0, totalAlightings: 0, hasVehicleCohort: false };
      // Each date/hour/direction cohort is one observed profile. The trip
      // count normalizes the profile itself; keep each selected profile
      // equally weighted in the auxiliary period average.
      const weight = 1;
      aggregate.sumOnboard += normalized.onboardPassengers * weight;
      aggregate.weight += weight;
      aggregate.hasVehicleCohort ||= !isEstimated;
      aggregate.totalBoardings += rawBoardings;
      aggregate.totalAlightings += rawAlightings;
      if (!aggregate.peak || compareLoad(normalized.onboardPassengers, aggregate.peak.onboardPassengers) < 0) aggregate.peak = { ...normalized, isVehicle: !isEstimated };
      aggregates.set(key, aggregate);
    }
  }

  const selectedDates = config.denominator === 'calendar' ? dateRange(config.filter.from, config.filter.to) : [...validDates].sort();
  const selectedDays = selectedDates.length;
  const loadBasis = vehicleRows > 0 && estimatedRows > 0 ? 'mixed' : vehicleRows > 0 ? 'vehicle' : 'estimated-average';
  if (loadBasis === 'estimated-average') warnings.add('차량 ID가 없어 시간대별 집계인원을 운행횟수로 나눈 평균 차내재차인원 추정치를 사용합니다.');
  if (loadBasis === 'mixed') warnings.add('일부 거래에 차량 ID가 없어 해당 거래는 운행횟수로 나눈 평균 차내재차인원 추정치를 사용합니다.');
  if (missingJourneyRows) {
    const routeExamples = [...missingJourneyRouteIds].slice(0, 10);
    warnings.add(`노선 ${missingJourneyRouteIds.size}개에서 승차·하차 정류장 ID가 경로에 없어 ${missingJourneyRows}개 행을 제외했습니다. 대표 노선: ${routeExamples.join(', ')}${missingJourneyRouteIds.size > routeExamples.length ? ' 외' : ''}.`);
  }
  const stopMetricsByRank: RouteStopLoadMetric[] = [...aggregates.values()].map((aggregate) => {
    const service = configFor(serviceConfigs, aggregate.path.routeId);
    const vehicleCapacity = service && Number.isInteger(service.vehicleCapacity) && service.vehicleCapacity > 0 ? service.vehicleCapacity : null;
    const dailyTrips = dailyTripsFor(service, config.hour);
    const peak = aggregate.peak ?? { previousOnboard: 0, boardings: 0, alightings: 0, onboardPassengers: 0, isVehicle: false };
    const averageOnboardPassengers = aggregate.weight ? aggregate.sumOnboard / aggregate.weight : 0;
    const estimated = !peak.isVehicle;
    const congestionPercent = vehicleCapacity !== null && (!estimated || dailyTrips !== null && dailyTrips > 0) ? peak.onboardPassengers / vehicleCapacity * 100 : null;
    if (vehicleCapacity === null) warnings.add(`노선 ${aggregate.path.routeId}의 차량 정원이 입력되지 않아 혼잡도를 계산할 수 없습니다.`);
    if (estimated && (dailyTrips === null || dailyTrips <= 0)) warnings.add(`노선 ${aggregate.path.routeId}의 운행횟수가 없어 평균 차내재차인원을 계산할 수 없습니다.`);
    return {
      routeId: aggregate.path.routeId,
      routeName: aggregate.path.routeName,
      transportMode: aggregate.path.transportMode,
      direction: aggregate.direction,
      directionLabel: directionLabel(aggregate.direction),
      stationSequence: aggregate.stop.stationSequence,
      stationId: aggregate.stop.stationId,
      stationName: aggregate.stop.stationName,
      latitude: aggregate.stop.latitude,
      longitude: aggregate.stop.longitude,
      segmentDistance: (() => {
        const ordered = directionStops(aggregate.path, aggregate.direction);
        const index = ordered.findIndex((stop) => stop.stationSequence === aggregate.stop.stationSequence);
        const next = ordered[index + 1];
        return next ? segmentDistance(aggregate.stop, next) : undefined;
      })(),
      previousOnboard: peak.previousOnboard,
      boardings: peak.boardings,
      alightings: peak.alightings,
      onboardPassengers: peak.onboardPassengers,
      peakOnboardPassengers: peak.onboardPassengers,
      averageOnboardPassengers,
      totalBoardings: aggregate.totalBoardings,
      totalAlightings: aggregate.totalAlightings,
      vehicleCapacity,
      dailyTrips,
      congestionPercent,
      rank: 0
    };
  }).sort((left, right) => compareNullable(left.congestionPercent, right.congestionPercent) || compareLoad(left.peakOnboardPassengers, right.peakOnboardPassengers) || left.routeId.localeCompare(right.routeId, 'ko') || left.direction.localeCompare(right.direction) || left.stationSequence - right.stationSequence).map((metric, index) => ({ ...metric, rank: index + 1 }));
  const stopMetrics = [...stopMetricsByRank].sort((left, right) => left.routeId.localeCompare(right.routeId, 'ko') || left.direction.localeCompare(right.direction) || (left.direction === 'forward' ? left.stationSequence - right.stationSequence : right.stationSequence - left.stationSequence));

  const metrics: RouteSegmentMetric[] = [];
  for (const direction of ['forward', 'reverse'] as const) {
    const routeGroups = new Map<string, RouteStopLoadMetric[]>();
    for (const stopMetric of stopMetrics.filter((metric) => metric.direction === direction)) routeGroups.set(stopMetric.routeId, [...(routeGroups.get(stopMetric.routeId) ?? []), stopMetric]);
    for (const group of routeGroups.values()) {
      const ordered = [...group].sort((left, right) => direction === 'forward' ? left.stationSequence - right.stationSequence : right.stationSequence - left.stationSequence);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const current = ordered[index];
        const next = ordered[index + 1];
        metrics.push({
          routeId: current.routeId,
          routeName: current.routeName,
          transportMode: current.transportMode,
          direction: current.direction,
          directionLabel: current.directionLabel,
          fromSequence: current.stationSequence,
          toSequence: next.stationSequence,
          fromStationId: current.stationId,
          toStationId: next.stationId,
          fromStationName: current.stationName,
          toStationName: next.stationName,
          fromLatitude: current.latitude,
          fromLongitude: current.longitude,
          toLatitude: next.latitude,
          toLongitude: next.longitude,
          segmentDistance: current.segmentDistance,
          previousOnboard: current.previousOnboard,
          boardings: current.boardings,
          alightings: current.alightings,
          onboardPassengers: current.onboardPassengers,
          peakOnboardPassengers: current.peakOnboardPassengers,
          averageOnboardPassengers: current.averageOnboardPassengers,
          totalBoardings: current.totalBoardings,
          totalAlightings: current.totalAlightings,
          vehicleCapacity: current.vehicleCapacity,
          dailyTrips: current.dailyTrips,
          congestionPercent: current.congestionPercent,
          rank: current.rank
        });
      }
    }
  }
  metrics.sort((left, right) => left.routeId.localeCompare(right.routeId, 'ko') || left.direction.localeCompare(right.direction) || (left.direction === 'forward' ? left.fromSequence - right.fromSequence : right.fromSequence - left.fromSequence));

  const summaries = [...new Map(stopMetrics.map((metric) => [`${metric.routeId}\u001f${metric.direction}`, metric])).values()].map((first) => {
    const best = stopMetrics.filter((metric) => metric.routeId === first.routeId && metric.direction === first.direction).sort((left, right) => compareNullable(left.congestionPercent, right.congestionPercent) || compareLoad(left.peakOnboardPassengers, right.peakOnboardPassengers) || left.stationSequence - right.stationSequence)[0];
    return {
      routeId: best.routeId,
      routeName: best.routeName,
      transportMode: best.transportMode,
      direction: best.direction,
      directionLabel: best.directionLabel,
      stationLabel: best.stationName,
      peakOnboardPassengers: best.peakOnboardPassengers,
      averageOnboardPassengers: best.averageOnboardPassengers,
      congestionPercent: best.congestionPercent,
      hour: config.hour
    };
  }).sort((left, right) => compareNullable(left.congestionPercent, right.congestionPercent) || compareLoad(left.peakOnboardPassengers, right.peakOnboardPassengers) || left.routeId.localeCompare(right.routeId, 'ko') || left.direction.localeCompare(right.direction));

  if (!rows.length || !stopMetrics.length) warnings.add('선택한 조건에 해당하는 노선 차내재차인원 데이터가 없습니다.');
  if (excludedRows) warnings.add(`${excludedRows}개 행이 노선 차내재차인원 분석에서 제외되었습니다.`);
  return { metrics, stopMetrics, summaries, selectedDays, totalBoardings, excludedRows, loadBasis, warnings: [...warnings], config };
}

export function analyzeRouteRecords(records: NormalizedRecord[], routeStops: RouteStopMasterRecord[], serviceConfigs: RouteServiceConfig[], config: RouteCongestionConfig): RouteCongestionResult {
  const rows: RouteDemandRow[] = [];
  let excludedRows = 0;
  let missingHourRows = 0;
  let missingLinkRows = 0;
  let sequenceErrorRows = 0;
  for (const record of records.filter((candidate) => matchesFilter(candidate, config))) {
    if (hasDataQualityError(record, DATA_QUALITY_ERROR.stopSequenceInvalid)) {
      excludedRows += 1;
      sequenceErrorRows += 1;
      continue;
    }
    const hour = hourFromRecord(record);
    if (hour === null) {
      excludedRows += 1;
      missingHourRows += 1;
      continue;
    }
    if (config.hour !== 'all' && hour !== config.hour) continue;
    const routeId = record.route?.trim();
    const originStationId = record.stationId?.trim();
    const destinationStationId = effectiveDestinationStationId(record, config.alightingMode)?.trim();
    if (!routeId || !originStationId || !destinationStationId) {
      excludedRows += 1;
      missingLinkRows += 1;
      continue;
    }
    rows.push({ serviceDate: record.serviceDate, routeId, vehicleId: record.vehicleId, originStationId, destinationStationId, hour, total: record.boardingCount });
  }
  const initialWarnings = [
    ...(sequenceErrorRows ? [`${sequenceErrorRows}개 행에 노선 경유정류장 순번 오류가 있어 노선 차내재차인원 분석에서 제외되었습니다.`] : []),
    ...(missingHourRows ? [`${missingHourRows}개 행에 승차 시간이 없어 시간대 분석에서 제외되었습니다.`] : []),
    ...(missingLinkRows ? [`${missingLinkRows}개 행에 노선·승차·하차 정류장 ID가 없어 노선 차내재차인원 분석에서 제외되었습니다.`] : [])
  ];
  return analyzeRouteDemandRows(rows, routeStops, serviceConfigs, config, excludedRows, initialWarnings);
}

export function routePathIndex(routeStops: RouteStopMasterRecord[]): RoutePathIndex {
  return buildRoutePathIndex(routeStops);
}
