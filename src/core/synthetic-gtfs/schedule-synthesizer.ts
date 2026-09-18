import type { ScheduleSynthesisResult, SyntheticServicePlan, SyntheticTimeBand, SynthesizedDeparture } from './types';

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return Number.isInteger(hours) && hours >= 0 && hours <= 47 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function formatClock(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function makeDeparture(plan: SyntheticServicePlan, directionId: string, departureTime: string): SynthesizedDeparture {
  return { serviceId: plan.serviceId, directionId, departureTime, sourceType: plan.sourceType };
}

function evenDepartures(start: number, end: number, count: number, includeEnd = false): number[] {
  if (count === 1) return [start];
  const denominator = includeEnd ? count - 1 : count;
  return Array.from({ length: count }, (_value, index) => start + ((end - start) * index) / denominator);
}

function headwayDepartures(start: number, end: number, headway: number): number[] {
  const result: number[] = [];
  for (let time = start; time <= end + 0.0001; time += headway) result.push(time);
  return result;
}

function bandCountByWeight(plan: SyntheticServicePlan, bands: SyntheticTimeBand[], warnings: string[]): number[] | null {
  if (bands.some((band) => band.departureCount !== undefined || band.headwayMinutes !== undefined)) return null;
  if (!bands.some((band) => band.weight !== undefined)) return null;
  if (plan.departureCount === undefined || !Number.isInteger(plan.departureCount) || plan.departureCount <= 0) {
    warnings.push('시간대 가중치를 사용하려면 전체 운행횟수를 1회 이상 입력해야 합니다.');
    return bands.map(() => 0);
  }
  const weights = bands.map((band) => Number(band.weight ?? 0));
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || weights.every((weight) => weight === 0)) {
    warnings.push('시간대 가중치는 0 이상이며 하나 이상 양수여야 합니다.');
    return bands.map(() => 0);
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (plan.departureCount! * weight) / totalWeight);
  const counts = raw.map(Math.floor);
  let remaining = plan.departureCount! - counts.reduce((sum, count) => sum + count, 0);
  const fractionalOrder = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const item of fractionalOrder) {
    if (remaining <= 0) break;
    counts[item.index] += 1;
    remaining -= 1;
  }
  return counts;
}

function timeBandWarnings(parsedBands: Array<{ start: number; end: number } | null>): string[] {
  const warnings: string[] = [];
  const ordered = parsedBands.flatMap((band, index) => band ? [{ ...band, index }] : []).sort((left, right) => left.start - right.start || left.index - right.index);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) warnings.push('시간대별 배차 구간이 겹칩니다.');
    else if (ordered[index].start > ordered[index - 1].end) warnings.push('시간대별 배차 구간 사이에 운행 공백이 있습니다.');
  }
  return [...new Set(warnings)];
}

export function synthesizeSchedule(directionId: string, plan: SyntheticServicePlan): ScheduleSynthesisResult {
  const warnings: string[] = [];
  const first = parseClock(plan.firstDeparture);
  const last = parseClock(plan.lastDeparture);
  if (first === null || last === null) return { departures: [], warnings: ['첫차와 막차 시간이 유효하지 않습니다.'] };
  if (first > last) return { departures: [], warnings: ['첫차가 막차보다 늦습니다.'] };

  const departures: SynthesizedDeparture[] = [];
  if (plan.timeBands?.length) {
    const parsedBands: Array<{ start: number; end: number } | null> = [];
    for (const band of plan.timeBands) {
      const start = parseClock(band.startTime);
      const end = parseClock(band.endTime);
      if (start === null || end === null || start >= end) {
        warnings.push(`시간대 구간이 유효하지 않습니다: ${band.startTime}-${band.endTime}`);
        parsedBands.push(null);
        continue;
      }
      parsedBands.push({ start, end });
    }
    warnings.push(...timeBandWarnings(parsedBands));
    const weightedCounts = bandCountByWeight(plan, plan.timeBands, warnings);
    plan.timeBands.forEach((band, index) => {
      const parsed = parsedBands[index];
      if (!parsed) return;
      if (band.headwayMinutes !== undefined) {
        if (!Number.isFinite(band.headwayMinutes) || band.headwayMinutes <= 0) {
          warnings.push('시간대 배차간격은 0보다 커야 합니다.');
          return;
        }
        if (!Number.isInteger(band.headwayMinutes)) {
          warnings.push('시간대 배차간격은 1분 이상의 정수여야 합니다.');
          return;
        }
      }
      const count = weightedCounts?.[index] ?? band.departureCount;
      let times: number[];
      if (count !== undefined) {
        if (!Number.isInteger(count) || count < 0) {
          warnings.push(`시간대 운행횟수가 유효하지 않습니다: ${band.startTime}-${band.endTime}`);
          return;
        }
        times = count === 0 ? [] : evenDepartures(parsed.start, parsed.end, count);
      } else if (band.headwayMinutes !== undefined) {
        times = headwayDepartures(parsed.start, parsed.end - 0.0001, band.headwayMinutes);
      } else {
        warnings.push(`시간대에 운행횟수 또는 배차간격이 없습니다: ${band.startTime}-${band.endTime}`);
        return;
      }
      departures.push(...times.map((time) => makeDeparture(plan, directionId, formatClock(time))));
    });
  } else if (plan.headwayMinutes !== undefined) {
    if (!Number.isFinite(plan.headwayMinutes) || plan.headwayMinutes <= 0) return { departures: [], warnings: ['배차간격은 0보다 커야 합니다.'] };
    if (!Number.isInteger(plan.headwayMinutes)) return { departures: [], warnings: ['배차간격은 1분 이상의 정수여야 합니다.'] };
    departures.push(...headwayDepartures(first, last, plan.headwayMinutes).map((time) => makeDeparture(plan, directionId, formatClock(time))));
  } else if (plan.departureCount !== undefined) {
    if (!Number.isInteger(plan.departureCount) || plan.departureCount < 0) return { departures: [], warnings: ['운행횟수는 0 이상의 정수여야 합니다.'] };
    if (plan.departureCount === 0) return { departures: [], warnings: ['운행횟수 또는 배차간격을 입력해야 합니다.'] };
    if (plan.departureCount === 1) {
      departures.push(makeDeparture(plan, directionId, formatClock(first)));
      if (first !== last) warnings.push('운행횟수 1회이므로 첫차 1회만 생성했습니다. 막차 값은 사용되지 않았습니다.');
    } else {
      departures.push(...evenDepartures(first, last, plan.departureCount, true).map((time) => makeDeparture(plan, directionId, formatClock(time))));
    }
  } else {
    return { departures: [], warnings: ['운행횟수 또는 배차간격을 입력해야 합니다.'] };
  }

  return { departures, warnings: [...new Set(warnings)] };
}
