import { createProvenance } from './provenance';
import type { SegmentTravelEstimate, SegmentTravelInput, TravelTimeParameters } from './types';

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}는 0 이상이어야 합니다.`);
}

function validateParameters(parameters: TravelTimeParameters): void {
  if (!parameters.modelVersion.trim()) throw new Error('운행시간 모델 버전이 필요합니다.');
  assertNonNegative(parameters.intersectionDelaySeconds, '교차로 지연시간');
  assertNonNegative(parameters.turnDelaySeconds, '회전 지연시간');
  assertNonNegative(parameters.minimumSegmentSeconds, '최소 구간시간');
}

export function estimateSegmentTravelTimes(segments: SegmentTravelInput[], parameters: TravelTimeParameters): SegmentTravelEstimate[] {
  validateParameters(parameters);
  return segments.map((segment) => {
    assertNonNegative(segment.distanceMeters, '구간 거리');
    assertNonNegative(segment.intersectionCount, '교차로 횟수');
    assertNonNegative(segment.turnCount, '회전 횟수');
    assertNonNegative(segment.dwellSecondsAtFromStop, '정차시간');
    const speedKph = parameters.speedsKph[segment.roadClass];
    if (!Number.isFinite(speedKph) || speedKph <= 0) throw new Error(`${segment.roadClass} 도로 유형의 기준속도가 유효하지 않습니다.`);
    const baseSeconds = segment.distanceMeters / (speedKph * 1000 / 3600);
    const adjustedSeconds = baseSeconds
      + segment.dwellSecondsAtFromStop
      + segment.intersectionCount * parameters.intersectionDelaySeconds
      + segment.turnCount * parameters.turnDelaySeconds;
    return {
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId,
      travelSeconds: Math.max(parameters.minimumSegmentSeconds, Math.round(adjustedSeconds)),
      provenance: createProvenance('MODEL_ESTIMATED', 'medium', {
        modelVersion: parameters.modelVersion,
        assumptions: [
          `도로 유형별 기준속도 ${speedKph}km/h를 사용했습니다.`,
          `교차로 지연 ${parameters.intersectionDelaySeconds}초와 회전 지연 ${parameters.turnDelaySeconds}초를 적용했습니다.`,
          `출발 정류장 정차시간 ${segment.dwellSecondsAtFromStop}초를 적용했습니다.`
        ]
      })
    };
  });
}

export function estimateFromCarDuration(carSeconds: number, busFactor: number, dwellSeconds: number): Omit<SegmentTravelEstimate, 'fromStopId' | 'toStopId'> {
  assertNonNegative(carSeconds, '자동차 예상시간');
  assertNonNegative(dwellSeconds, '정차시간');
  if (!Number.isFinite(busFactor) || busFactor <= 0) throw new Error('자동차 보정계수는 0보다 커야 합니다.');
  return {
    travelSeconds: Math.round(carSeconds * busFactor + dwellSeconds),
    provenance: createProvenance('MODEL_ESTIMATED', 'low', {
      modelVersion: 'car-duration-fallback',
      assumptions: [`자동차 예상시간에 ${busFactor} 보정계수를 적용했습니다.`, `정차시간 ${dwellSeconds}초를 추가했습니다.`]
    })
  };
}
