import {
  type AnalysisConfig,
  type AnalysisResult,
  DATA_QUALITY_ERROR,
  HOURS,
  type HourIndex,
  type HourlyAnalysisResult,
  type NormalizedRecord,
  type ODDemandResult,
  type StationDemandResult,
  WEEKDAYS,
  type WeekdayIndex
} from '../shared/types';
import { hasDataQualityError } from './data-quality';

const DAY_MS = 86_400_000;

function parseDate(value: string): Date | null {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[0]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekdayFromDate(value: string): WeekdayIndex | null {
  const date = parseDate(value);
  if (!date) return null;
  const sundayFirst = date.getUTCDay();
  return ((sundayFirst + 6) % 7) as WeekdayIndex;
}

function dateRange(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end || start > end) return [];
  const result: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) {
    result.push(toIsoDate(new Date(cursor)));
  }
  return result;
}

function matchesFilter(record: NormalizedRecord, config: AnalysisConfig): boolean {
  const { filter } = config;
  return (
    record.serviceDate >= filter.from &&
    record.serviceDate <= filter.to &&
    (!filter.route || record.route === filter.route) &&
    (!filter.station || record.station === filter.station) &&
    (!filter.region || record.region === filter.region)
  );
}

export function analyzeRecords(records: NormalizedRecord[], config: AnalysisConfig): AnalysisResult {
  const filtered = records.filter((record) => matchesFilter(record, config));
  const daily = new Map<string, number>();
  for (const record of filtered) {
    daily.set(record.serviceDate, (daily.get(record.serviceDate) ?? 0) + record.boardingCount);
  }

  return analyzeDailyTotals([...daily.entries()].map(([serviceDate, total]) => ({ serviceDate, total })), config, filtered.length ? filtered.reduce((sum, record) => sum + record.boardingCount, 0) : 0);
}

export function analyzeDailyTotals(dailyRows: Array<{ serviceDate: string; total: number }>, config: AnalysisConfig, totalBoardings = dailyRows.reduce((sum, row) => sum + row.total, 0)): AnalysisResult {
  const daily = new Map(dailyRows.map((row) => [row.serviceDate, row.total]));
  const allDates = config.denominator === 'calendar'
    ? dateRange(config.filter.from, config.filter.to)
    : [...daily.keys()].sort();
  const totals = Array.from({ length: 7 }, () => 0);
  const counts = Array.from({ length: 7 }, () => 0);
  for (const date of allDates) {
    const weekday = weekdayFromDate(date);
    if (weekday === null) continue;
    totals[weekday] += daily.get(date) ?? 0;
    counts[weekday] += 1;
  }

  const averages = totals.map((total, index) => (counts[index] ? total / counts[index] : 0));
  const averageSum = averages.reduce((sum, value) => sum + value, 0);
  const metrics = averages.map((average, index) => ({
    weekday: index as WeekdayIndex,
    label: WEEKDAYS[index],
    average,
    displayAverage: Math.round((average / 1000) * 10) / 10,
    percent: averageSum ? Math.round((average / averageSum) * 1000) / 10 : null,
    observedDays: counts[index]
  }));

  return {
    metrics,
    weekdayAverage: averages.slice(0, 5).reduce((sum, value) => sum + value, 0) / 5,
    weekendAverage: averages.slice(5).reduce((sum, value) => sum + value, 0) / 2,
    overallAverage: averageSum / 7,
    totalBoardings,
    selectedDays: allDates.length,
    excludedRows: 0,
    warnings: dailyRows.length ? [] : ['선택한 조건에 해당하는 데이터가 없습니다.'],
    config
  };
}

function hourFromRecord(record: NormalizedRecord): HourIndex | null {
  if (record.boardingHour !== undefined) return record.boardingHour;
  const match = /^(\d{2}):/.exec(record.boardingTime ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour as HourIndex : null;
}

export function analyzeHourlyDailyTotals(
  dailyRows: Array<{ serviceDate: string; hour: HourIndex; total: number }>,
  config: AnalysisConfig,
  totalBoardings = dailyRows.reduce((sum, row) => sum + row.total, 0),
  excludedRows = 0
): HourlyAnalysisResult {
  const daily = new Map<string, Map<HourIndex, number>>();
  for (const row of dailyRows) {
    const hourlyTotals = daily.get(row.serviceDate) ?? new Map<HourIndex, number>();
    hourlyTotals.set(row.hour, (hourlyTotals.get(row.hour) ?? 0) + row.total);
    daily.set(row.serviceDate, hourlyTotals);
  }
  const validDates = new Set(daily.keys());
  const allDates = config.denominator === 'calendar'
    ? dateRange(config.filter.from, config.filter.to)
    : [...validDates].sort();
  const totals = [Array.from({ length: 24 }, () => 0), Array.from({ length: 24 }, () => 0)];
  const groupDays = [0, 0];

  for (const date of allDates) {
    const weekday = weekdayFromDate(date);
    if (weekday === null) continue;
    const group = weekday < 5 ? 0 : 1;
    groupDays[group] += 1;
    for (const [hour, total] of daily.get(date) ?? []) totals[group][hour] += total;
  }

  const averages = groupDays.map((days, group) => totals[group].map((total) => days ? total / days : 0));
  const averageSums = averages.map((groupAverages) => groupAverages.reduce((sum, value) => sum + value, 0));
  const metrics = HOURS.map((hour) => ({
    hour,
    label: `${hour}시`,
    weekdayAverage: averages[0][hour],
    weekendAverage: averages[1][hour],
    weekdayDisplayAverage: Math.round((averages[0][hour] / 1000) * 10) / 10,
    weekendDisplayAverage: Math.round((averages[1][hour] / 1000) * 10) / 10,
    weekdayPercent: averageSums[0] ? Math.round((averages[0][hour] / averageSums[0]) * 1000) / 10 : null,
    weekendPercent: averageSums[1] ? Math.round((averages[1][hour] / averageSums[1]) * 1000) / 10 : null
  }));
  const warnings: string[] = [];
  if (excludedRows) warnings.push(`${excludedRows}개 행의 시간 정보가 없어 시간대 분석에서 제외되었습니다.`);
  if (!validDates.size) warnings.push('선택한 조건에 해당하는 유효한 시간 정보가 없습니다.');

  return {
    metrics,
    weekdayDays: groupDays[0],
    weekendDays: groupDays[1],
    totalBoardings,
    selectedDays: allDates.length,
    excludedRows,
    warnings,
    config
  };
}

export function analyzeHourlyRecords(records: NormalizedRecord[], config: AnalysisConfig): HourlyAnalysisResult {
  const filtered = records.filter((record) => matchesFilter(record, config));
  const daily = new Map<string, Map<HourIndex, number>>();
  let totalBoardings = 0;
  let excludedRows = 0;

  for (const record of filtered) {
    const hour = hourFromRecord(record);
    if (hour === null) {
      excludedRows += 1;
      continue;
    }
    totalBoardings += record.boardingCount;
    const hourlyTotals = daily.get(record.serviceDate) ?? new Map<HourIndex, number>();
    hourlyTotals.set(hour, (hourlyTotals.get(hour) ?? 0) + record.boardingCount);
    daily.set(record.serviceDate, hourlyTotals);
  }

  const dailyRows = [...daily.entries()].flatMap(([serviceDate, hourlyTotals]) => [...hourlyTotals.entries()].map(([hour, total]) => ({ serviceDate, hour, total })));
  return analyzeHourlyDailyTotals(dailyRows, config, totalBoardings, excludedRows);
}

export function analyzeStationDailyTotals(
  dailyRows: Array<{ serviceDate: string; stationId: string; total: number }>,
  config: AnalysisConfig,
  totalBoardings = dailyRows.reduce((sum, row) => sum + row.total, 0),
  excludedRows = 0
): StationDemandResult {
  const validDates = new Set(dailyRows.map((row) => row.serviceDate));
  const allDates = config.denominator === 'calendar'
    ? dateRange(config.filter.from, config.filter.to)
    : [...validDates].sort();
  const selectedDays = allDates.length;
  const totals = new Map<string, number>();
  for (const row of dailyRows) totals.set(row.stationId, (totals.get(row.stationId) ?? 0) + row.total);

  const metrics = [...totals.entries()]
    .map(([stationId, total]) => ({ stationId, totalBoardings: total, dailyAverage: selectedDays ? total / selectedDays : 0, rank: 0 }))
    .sort((a, b) => b.dailyAverage - a.dailyAverage || a.stationId.localeCompare(b.stationId, 'en'))
    .map((metric, index) => ({ ...metric, rank: index + 1 }));

  const warnings: string[] = [];
  if (excludedRows) warnings.push(`${excludedRows}개 행에 정류장 ID가 없어 정류장 수요 분석에서 제외되었습니다.`);
  if (!dailyRows.length) warnings.push('선택한 조건에 해당하는 정류장 수요 데이터가 없습니다.');

  return { metrics, selectedDays, totalBoardings, excludedRows, unmatchedStationCount: 0, warnings, config };
}

export function analyzeStationRecords(records: NormalizedRecord[], config: AnalysisConfig): StationDemandResult {
  const filtered = records.filter((record) => matchesFilter(record, config));
  const daily = new Map<string, Map<string, number>>();
  let totalBoardings = 0;
  let excludedRows = 0;

  for (const record of filtered) {
    const stationId = record.stationId?.trim();
    if (!stationId) {
      excludedRows += 1;
      continue;
    }
    totalBoardings += record.boardingCount;
    const stationTotals = daily.get(record.serviceDate) ?? new Map<string, number>();
    stationTotals.set(stationId, (stationTotals.get(stationId) ?? 0) + record.boardingCount);
    daily.set(record.serviceDate, stationTotals);
  }

  const dailyRows = [...daily.entries()].flatMap(([serviceDate, stationTotals]) => [...stationTotals.entries()].map(([stationId, total]) => ({ serviceDate, stationId, total })));
  return analyzeStationDailyTotals(dailyRows, config, totalBoardings, excludedRows);
}

export function analyzeODDailyTotals(
  dailyRows: Array<{ serviceDate: string; originStationId: string; destinationStationId: string; total: number }>,
  config: AnalysisConfig,
  totalBoardings = dailyRows.reduce((sum, row) => sum + row.total, 0),
  excludedRows = 0
): ODDemandResult {
  const validDates = new Set(dailyRows.map((row) => row.serviceDate));
  const allDates = config.denominator === 'calendar'
    ? dateRange(config.filter.from, config.filter.to)
    : [...validDates].sort();
  const selectedDays = allDates.length;
  const totals = new Map<string, { originStationId: string; destinationStationId: string; total: number }>();
  for (const row of dailyRows) {
    const key = `${row.originStationId}\u001f${row.destinationStationId}`;
    const current = totals.get(key) ?? { originStationId: row.originStationId, destinationStationId: row.destinationStationId, total: 0 };
    current.total += row.total;
    totals.set(key, current);
  }

  const metrics = [...totals.values()]
    .map((row) => ({
      originStationId: row.originStationId,
      destinationStationId: row.destinationStationId,
      totalBoardings: row.total,
      dailyAverage: selectedDays ? row.total / selectedDays : 0,
      rank: 0
    }))
    .sort((a, b) => b.dailyAverage - a.dailyAverage || a.originStationId.localeCompare(b.originStationId, 'en') || a.destinationStationId.localeCompare(b.destinationStationId, 'en'))
    .map((metric, index) => ({ ...metric, rank: index + 1 }));

  const warnings: string[] = [];
  if (excludedRows) warnings.push(`${excludedRows}개 행의 승차 또는 하차 정류장 ID가 없어 OD 분석에서 제외되었습니다.`);
  if (!dailyRows.length) warnings.push('선택한 조건에 해당하는 OD 통행 데이터가 없습니다.');

  return { metrics, selectedDays, totalBoardings, excludedRows, unmatchedOriginCount: 0, unmatchedDestinationCount: 0, warnings, config };
}

export function analyzeODRecords(records: NormalizedRecord[], config: AnalysisConfig): ODDemandResult {
  const filtered = records.filter((record) => matchesFilter(record, config));
  const daily = new Map<string, Map<string, number>>();
  let totalBoardings = 0;
  let excludedRows = 0;

  for (const record of filtered) {
    const originStationId = record.stationId?.trim();
    const destinationStationId = record.destinationStationId?.trim();
    if (!originStationId || !destinationStationId || hasDataQualityError(record, DATA_QUALITY_ERROR.stopSequenceInvalid)) {
      excludedRows += 1;
      continue;
    }
    totalBoardings += record.boardingCount;
    const pairTotals = daily.get(record.serviceDate) ?? new Map<string, number>();
    const key = `${originStationId}\u001f${destinationStationId}`;
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + record.boardingCount);
    daily.set(record.serviceDate, pairTotals);
  }

  const dailyRows = [...daily.entries()].flatMap(([serviceDate, pairTotals]) => [...pairTotals.entries()].map(([key, total]) => {
    const [originStationId, destinationStationId] = key.split('\u001f');
    return { serviceDate, originStationId, destinationStationId, total };
  }));
  return analyzeODDailyTotals(dailyRows, config, totalBoardings, excludedRows);
}

export function uniqueValues(records: NormalizedRecord[], dimension: 'route' | 'station' | 'region'): string[] {
  return [...new Set(records.map((record) => record[dimension]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ko'));
}
