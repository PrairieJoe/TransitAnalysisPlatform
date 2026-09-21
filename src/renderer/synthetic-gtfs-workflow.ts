export type SyntheticWorkflowStep = 'scenario' | 'generation' | 'motis' | 'batch';

export interface SyntheticWorkflowSnapshot {
  hasRouteOptions: boolean;
  hasScenarioDefinition: boolean;
  hasGenerationResult: boolean;
  generationResultValid: boolean;
  generationInputStale: boolean;
  hasJourneyComparison: boolean;
  journeyInputStale: boolean;
  hasBatchSummary: boolean;
  batchInputStale: boolean;
}

export interface SyntheticWorkflowStepStatus {
  step: SyntheticWorkflowStep;
  label: string;
  description: string;
  isAvailable: boolean;
  isComplete: boolean;
  isStale: boolean;
}

const STEP_COPY: Record<SyntheticWorkflowStep, Pick<SyntheticWorkflowStepStatus, 'label' | 'description'>> = {
  scenario: { label: '시나리오 설정', description: '노선과 Before/After 경로를 정합니다.' },
  generation: { label: 'GTFS 생성·검수', description: '운행 가정으로 GTFS를 만들고 결과를 확인합니다.' },
  motis: { label: 'MOTIS 여정 검증', description: '같은 OD의 Before/After 여정을 비교합니다.' },
  batch: { label: '반복 검증', description: '시간창을 반복 실행해 변화를 요약합니다.' }
};

export function buildSyntheticWorkflowStatuses(snapshot: SyntheticWorkflowSnapshot): Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus> {
  const generationStale = snapshot.generationInputStale;
  const generationComplete = snapshot.hasGenerationResult && snapshot.generationResultValid && !generationStale;
  const motisStale = generationStale || snapshot.journeyInputStale;
  const motisComplete = snapshot.hasJourneyComparison && generationComplete && !motisStale;
  const batchStale = motisStale || snapshot.batchInputStale;

  const statuses: Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus> = {
    scenario: {
      step: 'scenario',
      ...STEP_COPY.scenario,
      isAvailable: snapshot.hasRouteOptions,
      isComplete: snapshot.hasRouteOptions && snapshot.hasScenarioDefinition,
      isStale: false
    },
    generation: {
      step: 'generation',
      ...STEP_COPY.generation,
      isAvailable: snapshot.hasRouteOptions,
      isComplete: snapshot.hasRouteOptions && generationComplete,
      isStale: generationStale
    },
    motis: {
      step: 'motis',
      ...STEP_COPY.motis,
      isAvailable: snapshot.hasRouteOptions && snapshot.hasGenerationResult,
      isComplete: snapshot.hasRouteOptions && motisComplete,
      isStale: motisStale
    },
    batch: {
      step: 'batch',
      ...STEP_COPY.batch,
      isAvailable: snapshot.hasRouteOptions && snapshot.hasJourneyComparison && generationComplete && !snapshot.journeyInputStale,
      isComplete: snapshot.hasRouteOptions && snapshot.hasBatchSummary && motisComplete && !snapshot.batchInputStale,
      isStale: batchStale
    }
  };

  if (!snapshot.hasRouteOptions) {
    return Object.fromEntries(Object.entries(statuses).map(([step, status]) => [step, { ...status, isAvailable: false, isComplete: false }])) as Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus>;
  }
  return statuses;
}

export function canEnterSyntheticStep(step: SyntheticWorkflowStep, statuses: Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus>): boolean {
  return statuses[step].isAvailable;
}
