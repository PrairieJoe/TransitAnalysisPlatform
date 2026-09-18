import { describe, expect, it } from 'vitest';
import { sampleDepartureTimes, summarizeJourneyWindow } from '../../src/core/transit-batch';
import type { NormalizedJourney } from '../../src/core/transit-comparison';
import { compareJourneys } from '../../src/core/transit-comparison';

function found(totalSeconds: number): NormalizedJourney {
  return { found: true, totalSeconds, accessWalkSeconds: 0, egressWalkSeconds: 0, initialWaitSeconds: 0, transferWaitSeconds: 0, transferWalkSeconds: 0, transferCount: 0, inVehicleSeconds: totalSeconds, walkMeters: 0, legs: [], warnings: [] };
}

describe('transit batch', () => {
  it('samples an inclusive departure window', () => {
    expect(sampleDepartureTimes({ startTime: '06:00', endTime: '06:10', intervalMinutes: 5 })).toEqual(['06:00:00', '06:05:00', '06:10:00']);
  });

  it('summarizes only found journeys and aggregates warnings', () => {
    const missing: NormalizedJourney = { ...found(0), found: false, warnings: ['missing'] };
    const summary = summarizeJourneyWindow([
      compareJourneys(found(100), found(80)),
      compareJourneys(found(200), missing),
      compareJourneys(missing, found(120))
    ]);
    expect(summary.sampleCount).toBe(3);
    expect(summary.foundBefore).toBe(2);
    expect(summary.foundAfter).toBe(2);
    expect(summary.meanTotalSecondsBefore).toBe(150);
    expect(summary.medianTotalSecondsAfter).toBe(100);
    expect(summary.p90TotalSecondsAfter).toBe(116);
    expect(summary.warnings).toContain('missing');
  });
});
