import {
  type AnalysisConfig,
  type AnalysisResult,
  type NormalizedRecord,
  WEEKDAYS,
  type WeekdayIndex
} from '../shared/types';

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

export function uniqueValues(records: NormalizedRecord[], dimension: 'route' | 'station' | 'region'): string[] {
  return [...new Set(records.map((record) => record[dimension]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ko'));
}
