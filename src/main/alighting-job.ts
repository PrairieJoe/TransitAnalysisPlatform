import { analyzeRecords } from '../core/analysis';
import { inferAlighting } from '../core/alighting-inference';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type AlightingInferenceConfig,
  type ProjectManifest
} from '../shared/types';
import type { JobManager } from './job-manager';
import type { createProjectStore } from './project-store';

type ProjectStore = ReturnType<typeof createProjectStore>;

export interface AlightingJobRequest {
  jobId: string;
  projectId: string;
  projectRevision: string;
  config: AlightingInferenceConfig;
}

interface Dependencies {
  jobs: JobManager;
  store: ProjectStore;
  yieldControl?: () => Promise<void>;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function validateConfig(config: AlightingInferenceConfig): void {
  if (
    !Number.isFinite(config.primaryDistanceMeters)
    || !Number.isFinite(config.fallbackDistanceMeters)
    || config.primaryDistanceMeters <= 0
    || config.fallbackDistanceMeters < config.primaryDistanceMeters
  ) {
    throw new Error('고신뢰 매칭 반경은 확장 매칭 반경보다 작거나 같고 0보다 커야 합니다.');
  }
  if (!Number.isFinite(config.maxTransferMinutes) || config.maxTransferMinutes <= 0) {
    throw new Error('다음 승차 허용시간은 0보다 커야 합니다.');
  }
  if (!Number.isInteger(config.serviceDayBoundaryHour) || config.serviceDayBoundaryHour < 0 || config.serviceDayBoundaryHour > 23) {
    throw new Error('서비스일 경계 시각은 0시부터 23시 사이여야 합니다.');
  }
}

function nextProject(project: ProjectManifest, config: AlightingInferenceConfig): ProjectManifest {
  if (!project.routeStopMaster?.length) {
    throw new Error('노선별 경유정류장정보가 있어야 하차누락 추정을 실행할 수 있습니다.');
  }
  const inferred = inferAlighting(
    project.records,
    project.stationMaster ?? [],
    project.routeStopMaster,
    config
  );
  const dates = project.records.map(({ serviceDate }) => serviceDate).filter(Boolean).sort();
  const analysisConfig = {
    ...(project.analysisConfig ?? {
      filter: { from: dates[0] ?? '', to: dates.at(-1) ?? '' },
      denominator: 'observed' as const
    }),
    alightingMode: 'observed' as const
  };
  const routeAnalysisConfig = project.routeAnalysisConfig
    ? { ...project.routeAnalysisConfig, alightingMode: 'observed' as const }
    : undefined;

  return {
    ...project,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    records: inferred.records,
    alightingInferenceConfig: config,
    alightingSummary: inferred.summary,
    analysisConfig,
    routeAnalysisConfig,
    analysisMode: 'weekday',
    lastResult: analyzeRecords(inferred.records, analysisConfig)
  };
}

export function runAlightingInferenceJob(
  { jobs, store, yieldControl = defaultYield }: Dependencies,
  request: AlightingJobRequest
): Promise<ProjectManifest> {
  return jobs.start(
    { jobId: request.jobId, operation: 'alighting' },
    async (context) => {
      validateConfig(request.config);
      context.report({ phase: 'load-project', message: '프로젝트 데이터를 불러오는 중입니다.' });
      const project = await store.read(request.projectId);
      if (project.updatedAt !== request.projectRevision) {
        throw new Error('프로젝트가 변경되었습니다. 최신 프로젝트를 다시 열어 주세요.');
      }
      context.throwIfCancelled();
      await yieldControl();
      context.throwIfCancelled();

      context.report({ phase: 'infer-alighting', message: '하차 지점을 추론하는 중입니다.' });
      const next = nextProject(project, request.config);
      await yieldControl();
      context.throwIfCancelled();

      context.report({ phase: 'commit', message: '추론 결과를 저장하는 중입니다.' });
      const current = await store.readSummary(request.projectId);
      if (current.updatedAt !== request.projectRevision) {
        throw new Error('프로젝트가 변경되어 추론 결과를 저장하지 않았습니다.');
      }
      context.throwIfCancelled();
      context.beginCommit();
      await store.save(next);
      return next;
    }
  );
}
