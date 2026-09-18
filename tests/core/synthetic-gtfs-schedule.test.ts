import { describe, expect, it } from 'vitest';
import { synthesizeSchedule } from '../../src/core/synthetic-gtfs/schedule-synthesizer';
import type { SyntheticServicePlan } from '../../src/core/synthetic-gtfs/types';

function plan(overrides: Partial<SyntheticServicePlan> = {}): SyntheticServicePlan {
  return {
    serviceId: 'R1-forward-service',
    serviceDays: [0, 1, 2, 3, 4],
    firstDeparture: '06:00',
    lastDeparture: '23:00',
    departureCount: 3,
    sourceType: 'USER_INPUT',
    provenance: {
      sourceType: 'USER_INPUT',
      confidence: 'medium',
      isInferred: true,
      assumptions: ['테스트 가정']
    },
    ...overrides
  };
}

describe('Synthetic GTFS schedule synthesizer', () => {
  it('creates the requested count and preserves first and last departures', () => {
    const result = synthesizeSchedule('R1-forward', plan({ departureCount: 5 }));

    expect(result.warnings).toEqual([]);
    expect(result.departures).toHaveLength(5);
    expect(result.departures[0].departureTime).toBe('06:00');
    expect(result.departures.at(-1)?.departureTime).toBe('23:00');
    expect(result.departures.every((departure) => departure.directionId === 'R1-forward')).toBe(true);
  });

  it('creates one first departure and warns when count one conflicts with last departure', () => {
    const result = synthesizeSchedule('R1-forward', plan({ departureCount: 1 }));

    expect(result.departures.map((departure) => departure.departureTime)).toEqual(['06:00']);
    expect(result.warnings).toContain('운행횟수 1회이므로 첫차 1회만 생성했습니다. 막차 값은 사용되지 않았습니다.');
  });

  it('creates fixed headway departures through the end of the service window', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: undefined,
      firstDeparture: '06:00',
      lastDeparture: '07:00',
      headwayMinutes: 30
    }));

    expect(result.departures.map((departure) => departure.departureTime)).toEqual(['06:00', '06:30', '07:00']);
  });

  it('keeps the requested minute headway when a derived count is also present', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: 3,
      firstDeparture: '06:00',
      lastDeparture: '07:00',
      headwayMinutes: 25
    }));

    expect(result.departures.map((departure) => departure.departureTime)).toEqual(['06:00', '06:25', '06:50']);
  });

  it('warns and emits no departures for a positive fractional headway', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: undefined,
      firstDeparture: '06:00',
      lastDeparture: '07:00',
      headwayMinutes: 2.5
    }));

    expect(result.departures).toEqual([]);
    expect(result.warnings).toEqual(['배차간격은 1분 이상의 정수여야 합니다.']);
  });

  it('rejects a fractional time-band headway even when a departure count is also supplied', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: undefined,
      timeBands: [{ startTime: '06:00', endTime: '07:00', departureCount: 2, headwayMinutes: 2.5 }]
    }));

    expect(result.departures).toEqual([]);
    expect(result.warnings).toEqual(['시간대 배차간격은 1분 이상의 정수여야 합니다.']);
  });

  it('allocates a weighted total count with largest remainder and preserves the total', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: 10,
      firstDeparture: '06:00',
      lastDeparture: '10:00',
      timeBands: [
        { startTime: '06:00', endTime: '08:00', weight: 1 },
        { startTime: '08:00', endTime: '10:00', weight: 2 }
      ]
    }));

    expect(result.departures).toHaveLength(10);
    expect(result.departures.filter((departure) => departure.departureTime < '08:00')).toHaveLength(3);
    expect(result.departures.filter((departure) => departure.departureTime >= '08:00')).toHaveLength(7);
  });

  it('returns a warning instead of departures for invalid count or headway', () => {
    expect(synthesizeSchedule('R1-forward', plan({ departureCount: 0, headwayMinutes: undefined })).departures).toEqual([]);
    expect(synthesizeSchedule('R1-forward', plan({ departureCount: 0, headwayMinutes: undefined })).warnings).toContain('운행횟수 또는 배차간격을 입력해야 합니다.');
    expect(synthesizeSchedule('R1-forward', plan({ departureCount: undefined, headwayMinutes: 0 })).warnings).toContain('배차간격은 0보다 커야 합니다.');
  });

  it('warns about overlapping time bands and keeps the generated departures inspectable', () => {
    const result = synthesizeSchedule('R1-forward', plan({
      departureCount: undefined,
      timeBands: [
        { startTime: '06:00', endTime: '08:00', departureCount: 2 },
        { startTime: '07:30', endTime: '10:00', departureCount: 2 }
      ]
    }));

    expect(result.departures).toHaveLength(4);
    expect(result.warnings).toContain('시간대별 배차 구간이 겹칩니다.');
  });
});
