import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisConfig, RouteCongestionConfig, RouteServiceConfig, RouteStopMasterRecord } from '../shared/types';
import type { JobExecutionContext, JobManager } from './job-manager';
import type { createProjectStore } from './project-store';
import {
  analyzeHourlyProjectDatabase,
  analyzeODProjectDatabase,
  analyzeProjectDatabase,
  analyzeRouteProjectDatabase,
  analyzeStationProjectDatabase,
  writeProjectDatabase
} from './duckdb';

type ProjectStore = ReturnType<typeof createProjectStore>;

export interface AnalysisJobRequest<TConfig extends AnalysisConfig | RouteCongestionConfig> {
  jobId: string;
  projectId: string;
  projectRevision: string;
  config: TConfig;
}

export interface RouteAnalysisJobRequest extends AnalysisJobRequest<RouteCongestionConfig> {
  serviceConfigs?: RouteServiceConfig[];
}

interface Dependencies {
  jobs: JobManager;
  projectRoot: string;
  store: ProjectStore;
}

function assertProjectId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('프로젝트 ID가 유효하지 않습니다.');
}

export function createAnalysisJobHandlers({ jobs, projectRoot, store }: Dependencies) {
  async function prepareDatabase(
    request: AnalysisJobRequest<AnalysisConfig | RouteCongestionConfig>,
    context: JobExecutionContext
  ): Promise<string> {
    assertProjectId(request.projectId);
    context.report({ phase: 'open-database', message: '프로젝트 데이터베이스를 여는 중입니다.' });
    context.throwIfCancelled();

    const summary = await store.readSummary(request.projectId);
    if (request.projectRevision && summary.updatedAt !== request.projectRevision) {
      throw new Error('프로젝트가 변경되었습니다. 최신 프로젝트를 다시 열어 주세요.');
    }

    const dbPath = join(projectRoot, request.projectId, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const project = await store.read(request.projectId);
      context.throwIfCancelled();
      await writeProjectDatabase(dbPath, project.records);
    }
    context.throwIfCancelled();
    context.report({ phase: 'analyze', message: '데이터를 집계하는 중입니다.' });
    return dbPath;
  }

  const run = <TConfig extends AnalysisConfig | RouteCongestionConfig, TResult>(
    request: AnalysisJobRequest<TConfig>,
    analyze: (dbPath: string, config: TConfig, context: JobExecutionContext) => Promise<TResult>
  ) => jobs.start(
    { jobId: request.jobId, operation: 'analysis' },
    async (context) => {
      const dbPath = await prepareDatabase(request, context);
      context.throwIfCancelled();
      const result = await analyze(dbPath, request.config, context);
      context.throwIfCancelled();
      return result;
    }
  );

  return {
    weekday: (request: AnalysisJobRequest<AnalysisConfig>) =>
      run(request, (dbPath, config) => analyzeProjectDatabase(dbPath, config)),
    hourly: (request: AnalysisJobRequest<AnalysisConfig>) =>
      run(request, (dbPath, config) => analyzeHourlyProjectDatabase(dbPath, config)),
    station: (request: AnalysisJobRequest<AnalysisConfig>) =>
      run(request, (dbPath, config) => analyzeStationProjectDatabase(dbPath, config)),
    od: (request: AnalysisJobRequest<AnalysisConfig>) =>
      run(request, (dbPath, config) => analyzeODProjectDatabase(dbPath, config)),
    route: (request: RouteAnalysisJobRequest) => run(request, async (dbPath, config) => {
      const project = await store.readMetadata(request.projectId);
      return analyzeRouteProjectDatabase(
        dbPath,
        config,
        project.routeStopMaster ?? [],
        request.serviceConfigs ?? project.routeServiceConfigs ?? []
      );
    })
  };
}
