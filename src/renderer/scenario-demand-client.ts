import {
  DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG,
  estimateScenarioDemand,
  type ScenarioDemandEstimationConfig,
  type ScenarioDemandEstimationInput,
  type ScenarioDemandEstimationResult
} from '../core/scenario-demand-estimation';
import type {
  ODDemandResult,
  ScenarioExecutionManifest,
  ScenarioExecutionResult,
  ScenarioExecutionTarget
} from '../shared/types';

export interface ScenarioDemandSelection {
  target: ScenarioExecutionTarget;
  executionId: string;
  label: string;
}

export interface ScenarioDemandClientInput {
  projectId: string;
  demand: ODDemandResult;
  before: ScenarioDemandSelection;
  after: ScenarioDemandSelection;
  config?: Partial<ScenarioDemandEstimationConfig>;
}

export interface ScenarioDemandProgress {
  phase: 'loading' | 'validating' | 'estimating' | 'complete';
  completed: number;
  total: number;
  message: string;
}

type DesktopApi = NonNullable<Window['transitDesktop']>;
type Estimator = (input: ScenarioDemandEstimationInput) => ScenarioDemandEstimationResult;

function emit(
  onProgress: ((progress: ScenarioDemandProgress) => void) | undefined,
  phase: ScenarioDemandProgress['phase'],
  message: string,
  completed = 0,
  total = 0
): void {
  onProgress?.({ phase, completed, total, message });
}

function desktopApi(): DesktopApi {
  if (!window.transitDesktop) throw new Error('시나리오 수요 추정은 데스크톱 Electron 앱에서만 실행할 수 있습니다.');
  return window.transitDesktop;
}

function sameTarget(left: ScenarioExecutionTarget, right: ScenarioExecutionTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparisonTarget(selection: ScenarioDemandSelection): ScenarioDemandEstimationInput['before']['target'] {
  return { ...selection.target, executionId: selection.executionId, label: selection.label } as ScenarioDemandEstimationInput['before']['target'];
}

function validateSelection(selection: ScenarioDemandSelection, side: 'Before' | 'After'): void {
  if (!selection.executionId.trim()) throw new Error(`${side} 실행 결과 ID를 입력하세요.`);
  if (selection.target.kind === 'scenario' && !selection.target.scenarioId.trim()) {
    throw new Error(`${side} 시나리오 ID가 비어 있습니다.`);
  }
}

function validateProjectId(projectId: string): void {
  if (!projectId.trim()) throw new Error('프로젝트 ID가 비어 있어 실행 artifact를 읽을 수 없습니다.');
}

async function loadArtifact(
  api: DesktopApi,
  projectId: string,
  selection: ScenarioDemandSelection,
  manifests: ScenarioExecutionManifest[],
  side: 'Before' | 'After'
): Promise<{ manifest: ScenarioExecutionManifest; result: ScenarioExecutionResult }> {
  const manifest = manifests.find((candidate) => candidate.executionId === selection.executionId);
  if (!manifest) throw new Error(`${side} 실행 결과 ${selection.executionId}를 찾을 수 없습니다.`);
  if (manifest.executionId !== selection.executionId) throw new Error(`${side} 실행 결과 ID가 요청값과 일치하지 않습니다.`);
  if (manifest.status !== 'complete') throw new Error(`${side} 실행 결과 ${selection.executionId}가 실패 또는 미완료 상태입니다.`);
  if (!sameTarget(manifest.target, selection.target)) {
    throw new Error(`${side} 실행 결과 ${selection.executionId}의 대상 kind/scenarioId가 선택값과 일치하지 않습니다.`);
  }
  if (!manifest.inputFingerprint.trim()) {
    throw new Error(`${side} 실행 결과 ${selection.executionId}의 scenario fingerprint가 없어 stale artifact로 처리했습니다.`);
  }

  let result: ScenarioExecutionResult;
  try {
    result = await api.readScenarioExecution({ projectId, executionId: selection.executionId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${side} 실행 결과 ${selection.executionId}를 불러오지 못했습니다: ${detail}`);
  }
  if (
    result.executionSchemaVersion !== 1
    || result.executionId !== manifest.executionId
    || result.inputFingerprint !== manifest.inputFingerprint
    || !sameTarget(result.target, manifest.target)
    || result.after.status !== 'complete'
  ) {
    throw new Error(`${side} 실행 결과 ${selection.executionId}의 artifact identity가 manifest와 일치하지 않거나 stale 상태입니다.`);
  }
  return { manifest, result };
}

export async function runScenarioDemandEstimation(
  input: ScenarioDemandClientInput,
  onProgress?: (progress: ScenarioDemandProgress) => void,
  estimator: Estimator = estimateScenarioDemand
): Promise<ScenarioDemandEstimationResult> {
  validateProjectId(input.projectId);
  validateSelection(input.before, 'Before');
  validateSelection(input.after, 'After');
  if (input.before.executionId === input.after.executionId) {
    throw new Error('Before와 After에는 서로 다른 실행 artifact를 선택하세요.');
  }

  const api = desktopApi();
  emit(onProgress, 'loading', 'Before·After 실행 artifact를 불러오는 중입니다.', 0, 2);
  const manifests = await api.listScenarioExecutionManifests(input.projectId);
  const [beforeArtifact, afterArtifact] = await Promise.all([
    loadArtifact(api, input.projectId, input.before, manifests, 'Before'),
    loadArtifact(api, input.projectId, input.after, manifests, 'After')
  ]);

  emit(onProgress, 'validating', '수요 추정 대상과 실행 artifact identity를 검증하는 중입니다.', 2, 2);
  const config: ScenarioDemandEstimationConfig = {
    ...DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG,
    ...input.config,
    modelVersion: DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG.modelVersion
  };
  const estimatorInput: ScenarioDemandEstimationInput = {
    demand: input.demand,
    before: { target: comparisonTarget(input.before), result: beforeArtifact.result },
    after: { target: comparisonTarget(input.after), result: afterArtifact.result },
    config
  };

  emit(onProgress, 'estimating', '검증된 Before·After artifact로 시나리오 수요를 추정하는 중입니다.', 2, 2);
  const result = estimator(estimatorInput);
  emit(onProgress, 'complete', '시나리오 수요 추정을 완료했습니다.', 2, 2);
  return result;
}
