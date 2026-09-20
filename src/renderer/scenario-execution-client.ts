import { buildScenarioInputFingerprint, createScenarioExecutionManifest, materializeScenarioNetworks, type MaterializedScenarioNetwork, type ScenarioMaterializationInput } from '../core/scenario-execution';
import { executeScenarioNetwork } from '../core/scenario-route-execution';
import { buildSyntheticGtfsNetwork } from '../core/synthetic-gtfs/network-builder';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionEnvironment,
  ScenarioExecutionManifest,
  ScenarioExecutionResult,
  ScenarioExecutionTarget,
  ScenarioNetworkSnapshot
} from '../shared/types';

export interface ScenarioExecutionClientInput {
  projectId: string;
  target: ScenarioExecutionTarget;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinition?: ScenarioDefinition;
  now: string;
}

export interface ScenarioExecutionProgress {
  phase: 'validating' | 'preparing-before' | 'routing-before' | 'preparing-after' | 'routing-after' | 'saving' | 'complete';
  completed: number;
  total: number;
  message: string;
}

function emit(onProgress: ((progress: ScenarioExecutionProgress) => void) | undefined, phase: ScenarioExecutionProgress['phase'], message: string, completed = 0, total = 0): void {
  onProgress?.({ phase, completed, total, message });
}

function desktopApi(): NonNullable<Window['transitDesktop']> {
  if (!window.transitDesktop) throw new Error('시나리오 경로 생성은 데스크톱 Electron 앱과 MOTIS에서만 실행할 수 있습니다.');
  return window.transitDesktop;
}

function targetEquals(left: ScenarioExecutionTarget, right: ScenarioExecutionTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function statusFor(before: ScenarioNetworkSnapshot, after: ScenarioNetworkSnapshot): ScenarioExecutionManifest['status'] {
  if (before.status === 'complete' && after.status === 'complete') return 'complete';
  if (before.status === 'failed' && after.status === 'failed') return 'failed';
  return 'partial';
}

async function runSnapshot(
  api: NonNullable<Window['transitDesktop']>,
  network: MaterializedScenarioNetwork,
  osmPbfPath: string,
  phase: 'before' | 'after',
  onProgress: ((progress: ScenarioExecutionProgress) => void) | undefined
): Promise<ScenarioNetworkSnapshot> {
  const files = buildSyntheticGtfsNetwork({ routes: network.routes, agencyId: 'tap-agency', agencyName: '분석용 대중교통', sourceName: `scenario-execution:${phase}` }).files;
  emit(onProgress, phase === 'before' ? 'preparing-before' : 'preparing-after', `${phase === 'before' ? 'Before' : 'After'} Synthetic GTFS를 MOTIS에 준비하는 중입니다.`);
  await api.prepareMotis({ osmPbfPath, files });
  let started = false;
  try {
    const status = await api.startMotis();
    started = true;
    if (status.state !== 'ready') throw new Error(status.message ?? 'MOTIS가 준비되지 않았습니다.');
    emit(onProgress, phase === 'before' ? 'routing-before' : 'routing-after', `${phase === 'before' ? 'Before' : 'After'} 전체 노선의 BUS geometry를 생성하는 중입니다.`, 0, network.routes.length);
    return await executeScenarioNetwork({ network, request: api.requestMotis });
  } finally {
    if (started) await api.stopMotis().catch(() => undefined);
  }
}

export async function runScenarioExecution(
  input: ScenarioExecutionClientInput,
  onProgress?: (progress: ScenarioExecutionProgress) => void
): Promise<ScenarioExecutionManifest> {
  const api = desktopApi();
  emit(onProgress, 'validating', '시나리오 실행 대상과 전체 노선 입력을 검증하는 중입니다.');
  const materializationInput: ScenarioMaterializationInput = {
    target: input.target,
    routeStops: input.routeStops,
    serviceConfigs: input.serviceConfigs,
    ...(input.scenarioDefinition ? { scenarioDefinition: input.scenarioDefinition } : {})
  };
  const networks = materializeScenarioNetworks(materializationInput);
  const pbf = await api.selectMotisOsmPbf();
  if (!pbf) throw new Error('실행할 OSM PBF 파일을 선택하지 않았습니다.');
  const travelTimeModelVersion = networks.after.routes[0]?.operation.travelTimeModel.modelVersion ?? DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS.modelVersion;
  const environment: ScenarioExecutionEnvironment = {
    motisVersion: undefined,
    osmPbfFileName: pbf.fileName,
    osmPbfSha256: pbf.sha256,
    routingProfile: 'bus',
    travelTimeModelVersion
  };
  const inputFingerprint = buildScenarioInputFingerprint({ ...materializationInput, environment });
  const existing = await api.listScenarioExecutionManifests(input.projectId);
  const reused = existing.find((manifest) => manifest.status === 'complete' && manifest.inputFingerprint === inputFingerprint && targetEquals(manifest.target, input.target));
  if (reused) {
    emit(onProgress, 'complete', '동일한 입력과 실행환경의 기존 결과를 재사용했습니다.');
    return reused;
  }

  const before = await runSnapshot(api, networks.before, pbf.path, 'before', onProgress);
  const after = await runSnapshot(api, networks.after, pbf.path, 'after', onProgress);
  const warnings = [...new Set([...networks.before.warnings, ...networks.after.warnings, ...before.warnings, ...after.warnings])];
  const executionId = globalThis.crypto?.randomUUID?.() ?? `execution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result: ScenarioExecutionResult = {
    executionSchemaVersion: 1,
    executionId,
    target: input.target,
    inputFingerprint,
    environment,
    before,
    after,
    warnings,
    createdAt: input.now,
    updatedAt: input.now
  };
  const manifest = createScenarioExecutionManifest({
    executionId,
    target: input.target,
    ...(input.scenarioDefinition ? { scenarioDefinitionUpdatedAt: input.scenarioDefinition.updatedAt } : {}),
    inputFingerprint,
    environment,
    status: statusFor(before, after),
    routeCount: after.routes.length,
    completeRouteCount: after.routes.filter((route) => route.status === 'complete').length,
    warningCount: warnings.length,
    artifactFileName: `scenario-executions/${executionId}.json`,
    now: input.now
  });
  emit(onProgress, 'saving', '실행 결과와 geometry artifact를 저장하는 중입니다.');
  const saved = await api.saveScenarioExecution({ projectId: input.projectId, manifest, result });
  emit(onProgress, 'complete', saved.status === 'complete' ? '실제 BUS 경로와 실행 결과를 저장했습니다.' : '실행 결과를 저장했지만 일부 구간은 추정 또는 실패 상태입니다.');
  return saved;
}
