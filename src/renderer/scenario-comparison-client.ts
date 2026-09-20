import { compareScenarioExecutions, type ScenarioComparisonResult, type ScenarioComparisonTarget } from '../core/scenario-comparison';
import { materializeScenarioNetworks, type MaterializedScenarioNetwork } from '../core/scenario-execution';
import { buildMotisPlanPath } from '../core/motis';
import { normalizeMotisJourney, type NormalizedJourney } from '../core/transit-comparison';
import { buildSyntheticGtfsNetwork } from '../core/synthetic-gtfs/network-builder';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionEnvironment,
  ScenarioExecutionManifest,
  ScenarioExecutionResult,
  ScenarioExecutionTarget,
  LegacyScenarioJourneyQuery,
  ScenarioJourneyQuery,
  ScenarioNetworkSnapshot
} from '../shared/types';

export interface ScenarioComparisonSelection {
  target: ScenarioExecutionTarget;
  executionId: string;
  label: string;
}

export interface ScenarioComparisonClientInput {
  projectId: string;
  before: ScenarioComparisonSelection;
  after: ScenarioComparisonSelection;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  queries: ScenarioJourneyQuery[];
}

export interface ScenarioComparisonProgress {
  phase: 'loading' | 'validating' | 'routing-before' | 'routing-after' | 'complete';
  completed: number;
  total: number;
  message: string;
}

type DesktopApi = NonNullable<Window['transitDesktop']>;

function emit(onProgress: ((progress: ScenarioComparisonProgress) => void) | undefined, phase: ScenarioComparisonProgress['phase'], message: string, completed = 0, total = 0): void {
  onProgress?.({ phase, completed, total, message });
}

function desktopApi(): DesktopApi {
  if (!window.transitDesktop) throw new Error('시나리오 비교는 데스크톱 Electron 앱과 MOTIS에서만 실행할 수 있습니다.');
  return window.transitDesktop;
}

function sameTarget(left: ScenarioExecutionTarget, right: ScenarioExecutionTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparisonTarget(selection: ScenarioComparisonSelection): ScenarioComparisonTarget {
  return { ...selection.target, executionId: selection.executionId, label: selection.label } as ScenarioComparisonTarget;
}

function scenarioDefinitionFor(selection: ScenarioComparisonSelection, definitions: ScenarioDefinition[]): ScenarioDefinition | undefined {
  const target = selection.target;
  if (target.kind !== 'scenario') return undefined;
  const definition = definitions.find((candidate) => candidate.scenarioId === target.scenarioId);
  if (!definition) throw new Error(`비교 대상 시나리오 ${target.scenarioId} 정의를 찾을 수 없습니다.`);
  return definition;
}

async function loadArtifact(api: DesktopApi, projectId: string, selection: ScenarioComparisonSelection, manifests: ScenarioExecutionManifest[]): Promise<{ manifest: ScenarioExecutionManifest; result: ScenarioExecutionResult }> {
  const manifest = manifests.find((candidate) => candidate.executionId === selection.executionId);
  if (!manifest) throw new Error(`비교 실행 결과 ${selection.executionId}를 찾을 수 없습니다.`);
  if (manifest.status === 'failed') throw new Error(`비교 실행 결과 ${selection.executionId}가 실패 상태입니다.`);
  if (!sameTarget(manifest.target, selection.target)) throw new Error(`실행 결과 ${selection.executionId}의 비교 대상이 선택값과 일치하지 않습니다.`);
  const result = await api.readScenarioExecution({ projectId, executionId: selection.executionId });
  if (!result || result.executionId !== manifest.executionId || result.inputFingerprint !== manifest.inputFingerprint || !sameTarget(result.target, manifest.target)) {
    throw new Error(`실행 결과 ${selection.executionId}의 artifact identity가 manifest와 일치하지 않습니다.`);
  }
  return { manifest, result };
}

function validateQueries(queries: ScenarioJourneyQuery[]): LegacyScenarioJourneyQuery[] {
  const legacyQueries: LegacyScenarioJourneyQuery[] = [];
  for (const [index, query] of queries.entries()) {
    if (!('originStopId' in query) || !('destinationStopId' in query)) {
      throw new Error('현재 비교 실행 화면은 정류장 endpoint만 지원합니다. 좌표 A–B 비교 job 연결이 완료된 뒤 실행하세요.');
    }
    if (!query.originStopId.trim() || !query.destinationStopId.trim() || !query.departureDateTime.trim()) {
      throw new Error(`여정 질의 ${index + 1}의 출발 정류장·도착 정류장·출발시각을 입력하세요.`);
    }
    legacyQueries.push(query);
  }
  return legacyQueries;
}

function materializeTarget(selection: ScenarioComparisonSelection, input: ScenarioComparisonClientInput, definition: ScenarioDefinition | undefined): MaterializedScenarioNetwork {
  return materializeScenarioNetworks({
    target: selection.target,
    routeStops: input.routeStops,
    serviceConfigs: input.serviceConfigs,
    ...(definition ? { scenarioDefinition: definition } : {})
  }).after;
}

function environmentBlockWarning(environment: ScenarioExecutionEnvironment, pbfSha256: string): string | undefined {
  return environment.osmPbfSha256 === pbfSha256 ? undefined : `선택한 OSM PBF SHA-256(${pbfSha256})가 실행 결과의 SHA-256(${environment.osmPbfSha256})와 다릅니다.`;
}

function routeOnlyResult(result: ScenarioComparisonResult, warning: string): ScenarioComparisonResult {
  const environment = {
    ...result.environment,
    comparable: false,
    warnings: [...new Set([...result.environment.warnings, warning])]
  };
  return { ...result, environment, journeys: [], warnings: [...new Set([...result.warnings, warning])] };
}

function queryErrorJourney(query: ScenarioJourneyQuery, error: unknown): NormalizedJourney {
  const normalized = normalizeMotisJourney(undefined, query.departureDateTime);
  return {
    ...normalized,
    warnings: [...normalized.warnings, `MOTIS 여정 질의 실패: ${error instanceof Error ? error.message : String(error)}`]
  };
}

async function routeQueries(
  api: DesktopApi,
  network: MaterializedScenarioNetwork,
  pbfPath: string,
  queries: LegacyScenarioJourneyQuery[],
  phase: 'before' | 'after',
  onProgress: ((progress: ScenarioComparisonProgress) => void) | undefined
): Promise<NormalizedJourney[]> {
  const files = buildSyntheticGtfsNetwork({ routes: network.routes, agencyId: 'tap-agency', agencyName: '분석용 대중교통', sourceName: `scenario-comparison:${phase}` }).files;
  await api.prepareMotis({ osmPbfPath: pbfPath, files });
  let started = false;
  try {
    const status = await api.startMotis();
    started = true;
    if (status.state !== 'ready') throw new Error(status.message ?? 'MOTIS가 준비되지 않았습니다.');
    const journeys: NormalizedJourney[] = [];
    for (const [index, query] of queries.entries()) {
      let journey: NormalizedJourney;
      try {
        const raw = await api.requestMotis(buildMotisPlanPath(query.originStopId, query.destinationStopId, query.departureDateTime));
        journey = normalizeMotisJourney(raw, query.departureDateTime);
      } catch (error) {
        journey = queryErrorJourney(query, error);
      }
      journeys.push(journey);
      emit(onProgress, phase === 'before' ? 'routing-before' : 'routing-after', `${phase === 'before' ? 'Before' : 'After'} 여정 질의 ${index + 1}/${queries.length}을 완료했습니다.`, index + 1, queries.length);
    }
    return journeys;
  } finally {
    if (started) await api.stopMotis().catch(() => undefined);
  }
}

export async function runScenarioComparison(input: ScenarioComparisonClientInput, onProgress?: (progress: ScenarioComparisonProgress) => void): Promise<ScenarioComparisonResult> {
  const api = desktopApi();
  emit(onProgress, 'loading', '비교 실행 결과와 artifact를 불러오는 중입니다.');
  const manifests = await api.listScenarioExecutionManifests(input.projectId);
  const [beforeArtifact, afterArtifact] = await Promise.all([
    loadArtifact(api, input.projectId, input.before, manifests),
    loadArtifact(api, input.projectId, input.after, manifests)
  ]);
  const beforeDefinition = scenarioDefinitionFor(input.before, input.scenarioDefinitions);
  const afterDefinition = scenarioDefinitionFor(input.after, input.scenarioDefinitions);
  const legacyQueries = validateQueries(input.queries);
  emit(onProgress, 'validating', '비교 대상·환경·여정 질의를 검증하는 중입니다.');

  const beforeTarget = comparisonTarget(input.before);
  const afterTarget = comparisonTarget(input.after);
  const routeOnly = compareScenarioExecutions({
    before: { target: beforeTarget, result: beforeArtifact.result },
    after: { target: afterTarget, result: afterArtifact.result }
  });
  if (!legacyQueries.length || !routeOnly.environment.comparable) {
    emit(onProgress, 'complete', legacyQueries.length ? '환경이 달라 route 비교 결과만 반환했습니다.' : '노선·운행정보 비교를 완료했습니다.');
    return routeOnly;
  }

  const pbf = await api.selectMotisOsmPbf();
  if (!pbf) throw new Error('여정 비교에 사용할 OSM PBF 파일을 선택하지 않았습니다.');
  const pbfWarning = environmentBlockWarning(beforeArtifact.result.environment, pbf.sha256) ?? environmentBlockWarning(afterArtifact.result.environment, pbf.sha256);
  if (pbfWarning) {
    emit(onProgress, 'complete', '선택한 OSM PBF가 실행 결과와 달라 route 비교 결과만 반환했습니다.');
    return routeOnlyResult(routeOnly, pbfWarning);
  }

  const beforeNetwork = materializeTarget(input.before, input, beforeDefinition);
  const afterNetwork = materializeTarget(input.after, input, afterDefinition);
  const beforeJourneys = await routeQueries(api, beforeNetwork, pbf.path, legacyQueries, 'before', onProgress);
  const afterJourneys = await routeQueries(api, afterNetwork, pbf.path, legacyQueries, 'after', onProgress);
  const result = compareScenarioExecutions({
    before: { target: beforeTarget, result: beforeArtifact.result },
    after: { target: afterTarget, result: afterArtifact.result },
    journeys: legacyQueries.map((query, index) => ({ query, before: beforeJourneys[index], after: afterJourneys[index] }))
  });
  emit(onProgress, 'complete', '노선·운행정보와 X→Y 여정 비교를 완료했습니다.');
  return result;
}
