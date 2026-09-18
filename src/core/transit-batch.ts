import type { JourneyComparison } from './transit-comparison';

export interface DepartureWindow {
  startTime: string;
  endTime: string;
  intervalMinutes: number;
}

export interface BatchSummary {
  sampleCount: number;
  foundBefore: number;
  foundAfter: number;
  meanTotalSecondsBefore: number | null;
  meanTotalSecondsAfter: number | null;
  medianTotalSecondsBefore: number | null;
  medianTotalSecondsAfter: number | null;
  p90TotalSecondsBefore: number | null;
  p90TotalSecondsAfter: number | null;
  warnings: string[];
}

function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function statistics(comparisons: JourneyComparison[], side: 'before' | 'after'): { found: number; mean: number | null; median: number | null; p90: number | null } {
  const foundValues = comparisons.filter((comparison) => comparison[side].found).map((comparison) => comparison[side].totalSeconds);
  const mean = foundValues.length ? foundValues.reduce((sum, value) => sum + value, 0) / foundValues.length : null;
  return { found: foundValues.length, mean, median: percentile(foundValues, 0.5), p90: percentile(foundValues, 0.9) };
}

export function sampleDepartureTimes(window: DepartureWindow): string[] {
  const start = parseTime(window.startTime);
  const end = parseTime(window.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isInteger(window.intervalMinutes) || window.intervalMinutes <= 0) return [];
  const result: string[] = [];
  for (let current = start; current <= end; current += window.intervalMinutes * 60) {
    const hour = Math.floor(current / 3600);
    const minute = Math.floor((current % 3600) / 60);
    const second = current % 60;
    result.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`);
  }
  return result;
}

export function summarizeJourneyWindow(comparisons: JourneyComparison[]): BatchSummary {
  const before = statistics(comparisons, 'before');
  const after = statistics(comparisons, 'after');
  return {
    sampleCount: comparisons.length,
    foundBefore: before.found,
    foundAfter: after.found,
    meanTotalSecondsBefore: before.mean,
    meanTotalSecondsAfter: after.mean,
    medianTotalSecondsBefore: before.median,
    medianTotalSecondsAfter: after.median,
    p90TotalSecondsBefore: before.p90,
    p90TotalSecondsAfter: after.p90,
    warnings: [...new Set(comparisons.flatMap((comparison) => comparison.warnings))]
  };
}
