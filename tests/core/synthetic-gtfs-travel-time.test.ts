import { describe, expect, it } from 'vitest';
import { estimateFromCarDuration, estimateSegmentTravelTimes } from '../../src/core/synthetic-gtfs/travel-time-estimator';
import type { SegmentTravelInput, TravelTimeParameters } from '../../src/core/synthetic-gtfs/types';

const parameters: TravelTimeParameters = {
  modelVersion: 'baseline-1',
  speedsKph: {
    residential: 15,
    tertiary: 20,
    secondary: 25,
    primary: 30,
    trunk: 45,
    motorway: 60,
    unknown: 15
  },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 15
};

function segment(overrides: Partial<SegmentTravelInput> = {}): SegmentTravelInput {
  return {
    fromStopId: 'A',
    toStopId: 'B',
    distanceMeters: 1000,
    roadClass: 'primary',
    intersectionCount: 2,
    turnCount: 1,
    dwellSecondsAtFromStop: 20,
    ...overrides
  };
}

describe('Synthetic GTFS travel-time estimator', () => {
  it('combines road-class speed, dwell, intersection, and turn delay', () => {
    const [result] = estimateSegmentTravelTimes([segment()], parameters);

    expect(result.travelSeconds).toBe(160);
    expect(result.provenance).toMatchObject({ sourceType: 'MODEL_ESTIMATED', modelVersion: 'baseline-1', isInferred: true });
  });

  it('uses the configured minimum segment time for very short segments', () => {
    const [result] = estimateSegmentTravelTimes([segment({ distanceMeters: 1, intersectionCount: 0, turnCount: 0, dwellSecondsAtFromStop: 0 })], parameters);

    expect(result.travelSeconds).toBe(15);
  });

  it('rejects invalid distances and negative delay inputs', () => {
    expect(() => estimateSegmentTravelTimes([segment({ distanceMeters: -1 })], parameters)).toThrow('거리는 0 이상');
    expect(() => estimateSegmentTravelTimes([segment({ turnCount: -1 })], parameters)).toThrow('회전 횟수는 0 이상');
  });

  it('keeps car-duration fallback separate and records its factor', () => {
    const result = estimateFromCarDuration(42 * 60, 1.15, 8 * 60);

    expect(result.travelSeconds).toBe(3378);
    expect(result.provenance).toMatchObject({ sourceType: 'MODEL_ESTIMATED', modelVersion: 'car-duration-fallback', isInferred: true });
    expect(result.provenance.assumptions).toContain('자동차 예상시간에 1.15 보정계수를 적용했습니다.');
  });
});
