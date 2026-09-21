import { buildMotisPlanPath, DEFAULT_MOTIS_PLAN_OPTIONS } from '../core/motis';
import { materializeScenarioNetworks, type MaterializedScenarioNetwork } from '../core/scenario-execution';
import {
  buildScenarioJourneyFingerprint,
  summarizeScenarioJourneyResult,
  type ScenarioJourneyEnvironment,
  type ScenarioJourneyExecutionManifest,
  type ScenarioJourneyResult
} from '../core/scenario-journey';
import { buildSyntheticGtfsNetwork } from '../core/synthetic-gtfs/network-builder';
import { normalizeMotisJourney, type NormalizedJourney } from '../core/transit-comparison';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import { JobCancelledError, type JobExecutionContext, type JobManager } from './job-manager';
import type { MotisSidecarOptions } from './motis-sidecar';
import type {
  CoordinateScenarioJourneyQuery,
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionTarget,
  ScenarioJourneyQuery
} from '../shared/types';
import type { JobRequest } from '../shared/job-types';

export interface ScenarioJourneyJobRequest {
  jobId: string;
  executionId: string;
  projectId: string;
  before: ScenarioExecutionTarget;
  after: ScenarioExecutionTarget;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  queries: ScenarioJourneyQuery[];
  osmPbfPath: string;
  now: string;
}

export interface ScenarioJourneySidecar {
  start(options: MotisSidecarOptions): Promise<{ state: string; message?: string }>;
  request<T = unknown>(path: string): Promise<T>;
  stop(): Promise<void>;
}

export interface ScenarioJourneyStore {
  listScenarioJourneyManifests(projectId: string): Promise<ScenarioJourneyExecutionManifest[]>;
  saveScenarioJourney(payload: { projectId: string; manifest: ScenarioJourneyExecutionManifest; result: ScenarioJourneyResult }): Promise<ScenarioJourneyExecutionManifest>;
  readScenarioJourney(payload: { projectId: string; executionId: string }): Promise<ScenarioJourneyResult>;
}

export interface ScenarioJourneyPrepareSnapshotInput {
  executionId: string;
  side: 'before' | 'after';
  network: MaterializedScenarioNetwork;
  files: GtfsFileSet;
  osmPbfPath: string;
  environment: ScenarioJourneyEnvironment;
}

export interface ScenarioJourneyJobDependencies {
  jobs: JobManager;
  store: ScenarioJourneyStore;
  resolveEnvironment: (request: ScenarioJourneyJobRequest) => Promise<ScenarioJourneyEnvironment>;
  prepareSnapshot: (input: ScenarioJourneyPrepareSnapshotInput) => Promise<MotisSidecarOptions>;
  motisFactory: (side: 'before' | 'after') => ScenarioJourneySidecar;
}

export interface ScenarioJourneyJobHandlers {
  run(request: ScenarioJourneyJobRequest): Promise<{ jobId: string }>;
  summary(projectId: string, executionId: string): Promise<ScenarioJourneyExecutionManifest>;
  result(projectId: string, executionId: string): Promise<ScenarioJourneyResult>;
  waitForIdle(jobId: string): Promise<void>;
}

function sameTarget(left: ScenarioExecutionTarget, right: ScenarioExecutionTarget): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function queryEndpoint(query: ScenarioJourneyQuery, side: 'origin' | 'destination') {
  if ('origin' in query) return query[side];
  return { kind: 'stop' as const, stopId: side === 'origin' ? query.originStopId.trim() : query.destinationStopId.trim() };
}

function normalizeQueries(queries: ScenarioJourneyQuery[]): CoordinateScenarioJourneyQuery[] {
  return queries.map((query, index) => {
    const origin = queryEndpoint(query, 'origin');
    const destination = queryEndpoint(query, 'destination');
    if (!query.departureDateTime.trim()) throw new Error(`여정 질의 ${index + 1}의 출발시각이 비어 있습니다.`);
    if (origin.kind === 'stop' && !origin.stopId.trim() || destination.kind === 'stop' && !destination.stopId.trim()) {
      throw new Error(`여정 질의 ${index + 1}의 정류장 endpoint가 비어 있습니다.`);
    }
    if (origin.kind === 'coordinate' && (!Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude))) throw new Error(`여정 질의 ${index + 1}의 출발 좌표가 유효하지 않습니다.`);
    if (destination.kind === 'coordinate' && (!Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude))) throw new Error(`여정 질의 ${index + 1}의 도착 좌표가 유효하지 않습니다.`);
    if (JSON.stringify(origin) === JSON.stringify(destination)) throw new Error(`여정 질의 ${index + 1}의 출발지와 도착지는 달라야 합니다.`);
    return { origin, destination, departureDateTime: query.departureDateTime.trim() };
  });
}

function scenarioDefinitionFor(target: ScenarioExecutionTarget, definitions: ScenarioDefinition[]): ScenarioDefinition | undefined {
  if (target.kind === 'current') return undefined;
  const definition = definitions.find((candidate) => candidate.scenarioId === target.scenarioId);
  if (!definition) throw new Error(`저장된 시나리오 ${target.scenarioId}를 찾을 수 없습니다.`);
  return definition;
}

function materializeTarget(request: ScenarioJourneyJobRequest, target: ScenarioExecutionTarget): MaterializedScenarioNetwork {
  return materializeScenarioNetworks({
    target,
    routeStops: request.routeStops,
    serviceConfigs: request.serviceConfigs,
    ...(scenarioDefinitionFor(target, request.scenarioDefinitions) ? { scenarioDefinition: scenarioDefinitionFor(target, request.scenarioDefinitions) } : {})
  }).after;
}

function queryErrorJourney(error: unknown, requestedTime: string): NormalizedJourney {
  const normalized = normalizeMotisJourney(undefined, requestedTime);
  return { ...normalized, warnings: [...normalized.warnings, `MOTIS 여정 질의 실패: ${error instanceof Error ? error.message : String(error)}`] };
}

function executionStatus(before: NormalizedJourney[], after: NormalizedJourney[]): ScenarioJourneyResult['status'] {
  if (before.length === 0 && after.length === 0) return 'complete';
  return before.every((journey) => journey.found) && after.every((journey) => journey.found) ? 'complete' : 'partial';
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function createScenarioJourneyJobHandlers(dependencies: ScenarioJourneyJobDependencies): ScenarioJourneyJobHandlers {
  const pending = new Map<string, Promise<unknown>>();

  async function execute(request: ScenarioJourneyJobRequest, context: JobExecutionContext): Promise<ScenarioJourneyExecutionManifest> {
    context.report({ phase: 'validate', message: 'Before/After A–B 비교 입력과 실행환경을 검증하는 중입니다.' });
    const queries = normalizeQueries(request.queries);
    const environment = await dependencies.resolveEnvironment(request);
    const beforeTarget = request.before;
    const afterTarget = request.after;
    const fingerprint = buildScenarioJourneyFingerprint({ environment, queries });
    const existing = await dependencies.store.listScenarioJourneyManifests(request.projectId);
    const reused = existing.find((manifest) => manifest.status === 'complete'
      && manifest.inputFingerprint === fingerprint
      && sameTarget(manifest.beforeTarget, beforeTarget)
      && sameTarget(manifest.afterTarget, afterTarget));
    if (reused) {
      context.report({ phase: 'complete', executionId: reused.executionId, message: '동일한 A–B 입력과 실행환경의 기존 결과를 재사용했습니다.' });
      return reused;
    }

    const executionId = request.executionId;
    const networks = { before: materializeTarget(request, beforeTarget), after: materializeTarget(request, afterTarget) };
    const sideResults: { before: NormalizedJourney[]; after: NormalizedJourney[] } = { before: [], after: [] };

    for (const side of ['before', 'after'] as const) {
      context.throwIfCancelled();
      context.report({ phase: `prepare-${side}`, message: `${side === 'before' ? 'Before' : 'After'} Synthetic GTFS와 MOTIS 실행환경을 준비하는 중입니다.` });
      const files = buildSyntheticGtfsNetwork({ routes: networks[side].routes, agencyId: 'tap-agency', agencyName: '분석용 대중교통', sourceName: `scenario-journey:${side}` }).files;
      const options = await dependencies.prepareSnapshot({ executionId, side, network: networks[side], files, osmPbfPath: request.osmPbfPath, environment });
      const sidecar = dependencies.motisFactory(side);
      try {
        const status = await sidecar.start(options);
        if (status.state !== 'ready') throw new Error(status.message ?? `${side === 'before' ? 'Before' : 'After'} MOTIS가 준비되지 않았습니다.`);
        context.report({ phase: `query-${side}`, completed: 0, total: queries.length, message: `${side === 'before' ? 'Before' : 'After'} A–B 여정을 질의하는 중입니다.` });
        for (const [index, query] of queries.entries()) {
          context.throwIfCancelled();
          let journey: NormalizedJourney;
          try {
            const raw = await sidecar.request(buildMotisPlanPath(query.origin, query.destination, query.departureDateTime, {
              ...DEFAULT_MOTIS_PLAN_OPTIONS,
              maxTransfers: environment.maxTransfers,
              pedestrianProfile: environment.pedestrianProfile,
              maxPreTransitTimeSeconds: environment.maxPreTransitTimeSeconds,
              maxPostTransitTimeSeconds: environment.maxPostTransitTimeSeconds,
              maxMatchingDistanceMeters: environment.maxMatchingDistanceMeters
            }));
            journey = normalizeMotisJourney(raw, query.departureDateTime);
          } catch (error) {
            journey = queryErrorJourney(error, query.departureDateTime);
          }
          sideResults[side].push(journey);
          context.report({ phase: `query-${side}`, completed: index + 1, total: queries.length, message: `${side === 'before' ? 'Before' : 'After'} 여정 질의 ${index + 1}/${queries.length}을 완료했습니다.` });
        }
      } finally {
        await sidecar.stop();
      }
      context.throwIfCancelled();
    }

    const warnings = distinct([
      ...networks.before.warnings,
      ...networks.after.warnings,
      ...sideResults.before.flatMap((journey) => journey.warnings),
      ...sideResults.after.flatMap((journey) => journey.warnings)
    ]);
    const result: ScenarioJourneyResult = {
      executionSchemaVersion: 1,
      executionId,
      inputFingerprint: fingerprint,
      before: { target: beforeTarget, journeys: sideResults.before },
      after: { target: afterTarget, journeys: sideResults.after },
      queries,
      environment,
      status: executionStatus(sideResults.before, sideResults.after),
      warnings,
      createdAt: request.now,
      updatedAt: request.now
    };
    context.throwIfCancelled();
    context.beginCommit();
    context.report({ phase: 'persist', message: 'A–B 결과 artifact를 저장하고 bounded summary를 게시하는 중입니다.' });
    const manifest = summarizeScenarioJourneyResult(result, `scenario-journeys/${executionId}.json`);
    const saved = await dependencies.store.saveScenarioJourney({ projectId: request.projectId, manifest, result });
    context.report({ phase: 'complete', executionId: saved.executionId, message: saved.status === 'complete' ? 'Before/After A–B 비교를 완료하고 저장했습니다.' : 'A–B 비교를 저장했지만 일부 질의가 부분 결과입니다.' });
    return saved;
  }

  return {
    async run(request) {
      const jobRequest: JobRequest = { jobId: request.jobId, operation: 'scenario-journey' };
      const running = dependencies.jobs.start(jobRequest, (context) => execute(request, context));
      const tracked = running.finally(() => { if (pending.get(request.jobId) === tracked) pending.delete(request.jobId); });
      pending.set(request.jobId, tracked);
      void tracked.catch((error) => { if (!(error instanceof JobCancelledError)) return; });
      return { jobId: request.jobId };
    },
    async summary(projectId, executionId) {
      const manifest = (await dependencies.store.listScenarioJourneyManifests(projectId)).find((candidate) => candidate.executionId === executionId);
      if (!manifest) throw new Error(`A–B 여정 실행 결과 ${executionId}를 찾을 수 없습니다.`);
      return manifest;
    },
    result(projectId, executionId) {
      return dependencies.store.readScenarioJourney({ projectId, executionId });
    },
    async waitForIdle(jobId) {
      await pending.get(jobId);
    }
  };
}
