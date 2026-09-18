export interface ShapeQualityInput {
  routeId: string;
  stopCount: number;
  routedSegments: number;
  beelinedSegments: number;
  routeDistanceMeters: number;
  stopToStopDistanceMeters: number;
}

export interface ShapeQualityReport {
  routeId: string;
  stopCount: number;
  routedSegments: number;
  beelinedSegments: number;
  routeDistanceMeters: number;
  stopToStopDistanceMeters: number;
  needsReview: boolean;
  warnings: string[];
  beelineRate: number;
  detourRatio: number;
}

export const SHAPE_QUALITY_THRESHOLDS = {
  maxBeelineRate: 0,
  maxDetourRatio: 1.75
} as const;

export function assessShapeQuality(input: ShapeQualityInput): ShapeQualityReport {
  const warnings: string[] = [];
  const invalid = !input.routeId.trim()
    || !Number.isInteger(input.stopCount) || input.stopCount < 2
    || !Number.isInteger(input.routedSegments) || input.routedSegments < 0
    || !Number.isInteger(input.beelinedSegments) || input.beelinedSegments < 0
    || input.routedSegments + input.beelinedSegments !== Math.max(0, input.stopCount - 1)
    || !Number.isFinite(input.routeDistanceMeters) || input.routeDistanceMeters <= 0
    || !Number.isFinite(input.stopToStopDistanceMeters) || input.stopToStopDistanceMeters <= 0;
  if (invalid) {
    warnings.push('형상 품질 지표의 원시 값이 유효하지 않습니다. 원인과 경로 결과를 확인하세요.');
  }
  const segmentCount = Math.max(1, input.routedSegments + input.beelinedSegments);
  const beelineRate = input.beelinedSegments / segmentCount;
  const detourRatio = input.routeDistanceMeters > 0 ? input.routeDistanceMeters / Math.max(input.stopToStopDistanceMeters, 1) : Number.POSITIVE_INFINITY;
  if (input.beelinedSegments > 0) warnings.push(`OSM 경로를 찾지 못해 ${input.beelinedSegments}개 구간이 직선(beeline)으로 남았습니다.`);
  if (detourRatio > SHAPE_QUALITY_THRESHOLDS.maxDetourRatio) warnings.push(`경로 우회비율 ${detourRatio.toFixed(2)}가 기준 ${SHAPE_QUALITY_THRESHOLDS.maxDetourRatio.toFixed(2)}를 초과했습니다.`);
  return {
    ...input,
    needsReview: invalid || warnings.length > 0,
    warnings: [...new Set(warnings)],
    beelineRate,
    detourRatio
  };
}
