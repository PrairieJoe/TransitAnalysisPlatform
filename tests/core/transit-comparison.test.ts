import { describe, expect, it } from 'vitest';
import { compareJourneys, normalizeMotisJourney } from '../../src/core/transit-comparison';
import type { NormalizedJourney } from '../../src/core/transit-comparison';

function journey(overrides: Partial<NormalizedJourney> = {}): NormalizedJourney {
  return {
    found: true, totalSeconds: 1800, accessWalkSeconds: 120, egressWalkSeconds: 60, initialWaitSeconds: 300, transferWaitSeconds: 120,
    transferWalkSeconds: 90, transferCount: 1, inVehicleSeconds: 1110, walkMeters: 300, legs: [], warnings: [], ...overrides
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
    expect(normalized.walkMeters).toBe(150);
  });
});
