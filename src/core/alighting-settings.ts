import { DEFAULT_ALIGHTING_INFERENCE_CONFIG, type AlightingAnalysisMode, type AlightingInferenceConfig } from '../shared/types';

export type AlightingPreset = 'recommended' | 'strict' | 'expanded' | 'custom';
export type ConfiguredAlightingPreset = Exclude<AlightingPreset, 'custom'>;

export const ALIGHTING_PRESET_OPTIONS: ReadonlyArray<{ value: AlightingPreset; label: string; description: string }> = [
  { value: 'recommended', label: '권장 설정', description: '고신뢰 500m · 확장 1km · 다음 승차 30분 이내' },
  { value: 'strict', label: '엄격한 설정', description: '고신뢰 300m · 확장 600m · 다음 승차 20분 이내' },
  { value: 'expanded', label: '확장 탐색', description: '고신뢰 500m · 확장 1.5km · 다음 승차 60분 이내' },
  { value: 'custom', label: '사용자 설정', description: '세부 조건을 직접 조정합니다.' }
];

const PRESET_CONFIGS: Record<ConfiguredAlightingPreset, AlightingInferenceConfig> = {
  recommended: { ...DEFAULT_ALIGHTING_INFERENCE_CONFIG },
  strict: { primaryDistanceMeters: 300, fallbackDistanceMeters: 600, maxTransferMinutes: 20, serviceDayBoundaryHour: 4 },
  expanded: { primaryDistanceMeters: 500, fallbackDistanceMeters: 1500, maxTransferMinutes: 60, serviceDayBoundaryHour: 4 }
};

export function alightingConfigForPreset(preset: ConfiguredAlightingPreset): AlightingInferenceConfig {
  return { ...PRESET_CONFIGS[preset] };
}

export function identifyAlightingPreset(config: AlightingInferenceConfig): AlightingPreset {
  const preset = (Object.keys(PRESET_CONFIGS) as ConfiguredAlightingPreset[]).find((candidate) => {
    const candidateConfig = PRESET_CONFIGS[candidate];
    return candidateConfig.primaryDistanceMeters === config.primaryDistanceMeters
      && candidateConfig.fallbackDistanceMeters === config.fallbackDistanceMeters
      && candidateConfig.maxTransferMinutes === config.maxTransferMinutes
      && candidateConfig.serviceDayBoundaryHour === config.serviceDayBoundaryHour;
  });
  return preset ?? 'custom';
}

export function canEnterAlightingEstimation(coreMappingReady: boolean, routeStopMasterCount: number): boolean {
  return coreMappingReady && routeStopMasterCount > 0;
}

export function alightingModeFromControls(useInferred: boolean, includeExpected: boolean): AlightingAnalysisMode {
  if (!useInferred) return 'observed';
  return includeExpected ? 'expected-flow' : 'high-confidence';
}
