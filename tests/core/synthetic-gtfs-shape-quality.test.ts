import { describe, expect, it } from 'vitest';
import { assessShapeQuality } from '../../src/core/synthetic-gtfs/shape-quality';

describe('shape quality', () => {
  it('accepts fully routed segments with a reasonable detour', () => {
    const report = assessShapeQuality({ routeId: 'R1', stopCount: 5, routedSegments: 4, beelinedSegments: 0, routeDistanceMeters: 4400, stopToStopDistanceMeters: 4000 });
    expect(report.needsReview).toBe(false);
    expect(report.beelineRate).toBe(0);
    expect(report.detourRatio).toBe(1.1);
  });

  it('warns when a segment is beelined', () => {
    const report = assessShapeQuality({ routeId: 'R1', stopCount: 5, routedSegments: 3, beelinedSegments: 1, routeDistanceMeters: 4400, stopToStopDistanceMeters: 4000 });
    expect(report.needsReview).toBe(true);
    expect(report.beelineRate).toBe(0.25);
    expect(report.warnings.some((warning) => warning.includes('직선'))).toBe(true);
  });

  it('warns on excessive detour and invalid segment counts', () => {
    const report = assessShapeQuality({ routeId: 'R1', stopCount: 5, routedSegments: 1, beelinedSegments: 1, routeDistanceMeters: 9000, stopToStopDistanceMeters: 4000 });
    expect(report.needsReview).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('우회비율'))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('원시 값'))).toBe(true);
  });
});
