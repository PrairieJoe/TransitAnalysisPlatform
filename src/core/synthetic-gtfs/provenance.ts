import type { SyntheticConfidence, SyntheticProvenance, SyntheticSourceType } from './types';

export function createProvenance(
  sourceType: SyntheticSourceType,
  confidence: SyntheticConfidence,
  options: { sourceName?: string; modelVersion?: string; assumptions?: string[] } = {}
): SyntheticProvenance {
  return {
    sourceType,
    ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    confidence,
    isInferred: sourceType !== 'OFFICIAL',
    ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
    assumptions: [...new Set(options.assumptions ?? [])]
  };
}

export function withAssumptions(provenance: SyntheticProvenance, ...assumptions: string[]): SyntheticProvenance {
  return { ...provenance, assumptions: [...new Set([...provenance.assumptions, ...assumptions])] };
}

export function mergeProvenance(provenances: SyntheticProvenance[]): SyntheticProvenance {
  if (!provenances.length) return createProvenance('DERIVED', 'low', { assumptions: ['출처 정보가 없는 파생값입니다.'] });
  const confidenceRank: Record<SyntheticConfidence, number> = { high: 3, medium: 2, low: 1 };
  const weakest = [...provenances].sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence])[0];
  const sourceTypes = [...new Set(provenances.map((item) => item.sourceType))];
  const sourceType: SyntheticSourceType = sourceTypes.length === 1 ? sourceTypes[0] : 'DERIVED';
  return createProvenance(sourceType, weakest.confidence, {
    sourceName: [...new Set(provenances.map((item) => item.sourceName).filter(Boolean))].join(', ') || undefined,
    modelVersion: [...new Set(provenances.map((item) => item.modelVersion).filter(Boolean))].join(', ') || undefined,
    assumptions: [...new Set(provenances.flatMap((item) => item.assumptions))]
  });
}
