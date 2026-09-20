import { describe, expect, it } from 'vitest';
import { compareJourneys, normalizeMotisJourney } from '../../src/core/transit-comparison';
import type { NormalizedJourney } from '../../src/core/transit-comparison';

function journey(overrides: Partial<NormalizedJourney> = {}): NormalizedJourney {
  return {
    found: true, totalSeconds: 1800, accessWalkSeconds: 120, egressWalkSeconds: 60, initialWaitSeconds: 300, transferWaitSeconds: 120,
    transferWalkSeconds: 90, accessWalkMeters: 100, transferWalkMeters: 140, egressWalkMeters: 60, directWalkSeconds: 0, directWalkMeters: 0,
    transferCount: 1, inVehicleSeconds: 1110, walkMeters: 300, legs: [], warnings: [], ...overrides
  };
}

describe('transit comparison', () => {
  it('calculates decomposed Before/After deltas', () => {
    const result = compareJourneys(journey(), journey({ totalSeconds: 1500, inVehicleSeconds: 900, transferCount: 0, transferWaitSeconds: 0 }));
    expect(result.delta.totalSeconds).toBe(-300);
    expect(result.causeBreakdown.inVehicleSeconds).toBe(-210);
    expect(result.causeBreakdown.transferCount).toBe(-1);
  });

  it('does not turn a missing journey into a zero-minute improvement', () => {
    const result = compareJourneys(journey(), journey({ found: false, totalSeconds: 0, legs: [], warnings: ['no route'] }));
    expect(result.delta.totalSeconds).toBeNull();
    expect(result.warnings).toContain('Before/After 중 한쪽에 여정이 없어 개선·악화 델타를 계산하지 않았습니다.');
  });

  it('normalizes the official MOTIS itinerary shape', () => {
    const normalized = normalizeMotisJourney({ itineraries: [{ duration: 900, transfers: 0, legs: [
      { mode: 'WALK', duration: 120, distance: 150, from: { stopId: 'A' }, to: { stopId: 'B' } },
      { mode: 'BUS', routeId: 'R1', duration: 780, from: { stopId: 'B' }, to: { stopId: 'C' } }
    ] }] });
    expect(normalized.found).toBe(true);
    expect(normalized.totalSeconds).toBe(900);
    expect(normalized.inVehicleSeconds).toBe(780);
    expect(normalized.accessWalkSeconds).toBe(120);
    expect(normalized.egressWalkSeconds).toBe(0);
    expect(normalized.walkMeters).toBe(150);
  });

  it('classifies access, transfer, and egress walking by its position around transit legs', () => {
    const normalized = normalizeMotisJourney({ itineraries: [{ duration: 1500, transfers: 1, legs: [
      { mode: 'WALK', duration: 120, distance: 100 },
      { mode: 'BUS', duration: 600, from: { stopId: 'A' }, to: { stopId: 'B' } },
      { mode: 'WALK', duration: 90, distance: 80 },
      { mode: 'BUS', duration: 450, from: { stopId: 'C' }, to: { stopId: 'D' } },
      { mode: 'WALK', duration: 240, distance: 200 }
    ] }] });
    expect(normalized.accessWalkSeconds).toBe(120);
    expect(normalized.accessWalkMeters).toBe(100);
    expect(normalized.transferWalkSeconds).toBe(90);
    expect(normalized.transferWalkMeters).toBe(80);
    expect(normalized.egressWalkSeconds).toBe(240);
    expect(normalized.egressWalkMeters).toBe(200);
    expect(normalized.directWalkSeconds).toBe(0);
  });

  it('keeps a direct walking itinerary separate from transit access and egress', () => {
    const normalized = normalizeMotisJourney({ itineraries: [{ duration: 600, transfers: 0, legs: [
      { mode: 'WALK', duration: 600, distance: 700 }
    ] }] });
    expect(normalized.directWalkSeconds).toBe(600);
    expect(normalized.directWalkMeters).toBe(700);
    expect(normalized.accessWalkSeconds).toBe(0);
    expect(normalized.egressWalkSeconds).toBe(0);
    expect(normalized.warnings).toContain('MOTIS 여정에 대중교통 구간이 없어 직접 보행 결과로 분류했습니다.');
  });

  it('does not create negative timing values when leg timestamps are malformed', () => {
    const normalized = normalizeMotisJourney({ itineraries: [{ legs: [
      { mode: 'WALK', startTime: 'not-a-time', endTime: 'also-not-a-time', distance: 0 },
      { mode: 'BUS', startTime: 'not-a-time', endTime: 'also-not-a-time' }
    ] }] }, '2026-09-20T08:00:00+09:00');
    expect(normalized.found).toBe(true);
    expect(normalized.totalSeconds).toBe(0);
    expect(normalized.initialWaitSeconds).toBe(0);
    expect(normalized.warnings).toContain('MOTIS 응답의 일부 구간 시간값을 해석하지 못했습니다.');
  });
});
