/// <reference types="vite/client" />

import type { AnalysisConfig, HourlyAnalysisResult, MotisOsmPbfMetadata, MotisOsmPbfResolution, MotisProgress, MotisRequestInit, MotisRuntimeDefaults, MotisStatus, ODDemandResult, ProjectManifest, ProjectSummary, RouteCongestionConfig, RouteCongestionResult, RouteServiceConfig, RouteStopMasterRecord, ScenarioExecutionManifest, ScenarioExecutionResult, ScenarioJourneyExecutionManifest, StationDemandResult } from '../shared/types';
import type { ScenarioJourneyResult } from '../core/scenario-journey';
import type { ReadScenarioExecutionPayload, SaveScenarioExecutionPayload } from '../main/project-store';
import type { ScenarioJourneyJobRequest } from '../main/scenario-journey-job';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { JobCancellationResult, JobProgress } from '../shared/job-types';
import type { CommitImportRequest, PreparedImport, PrepareImportRequest } from '../main/import-job';
import type { AnalysisJobRequest, RouteAnalysisJobRequest } from '../main/analysis-jobs';

type RendererPrepareImportRequest = Omit<PrepareImportRequest, 'files'> & {
  files: Array<{ file: File; options: import('../shared/types').ParseOptions }>;
};

declare module '*.csv?raw' {
  const content: string;
  export default content;
}

declare module '*.csv' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    transitDesktop?: {
      listProjects: () => Promise<ProjectSummary[]>;
      openProject: (id: string) => Promise<ProjectManifest>;
      cancelJob: (jobId: string) => Promise<JobCancellationResult>;
      onJobProgress: (listener: (progress: JobProgress) => void) => () => void;
      onMotisProgress: (listener: (progress: MotisProgress) => void) => () => void;
      getFilePath: (file: File) => string;
      saveProject: (project: ProjectManifest) => Promise<ProjectManifest>;
      saveProjectMetadata: (metadata: Omit<ProjectManifest, 'records'>) => Promise<void>;
      saveScenarioExecution: (payload: SaveScenarioExecutionPayload) => Promise<ScenarioExecutionManifest>;
      readScenarioExecution: (payload: ReadScenarioExecutionPayload) => Promise<ScenarioExecutionResult>;
      listScenarioExecutionManifests: (projectId: string) => Promise<ScenarioExecutionManifest[]>;
      runScenarioJourney: (request: ScenarioJourneyJobRequest) => Promise<{ jobId: string }>;
      getScenarioJourneySummary: (payload: { projectId: string; executionId: string }) => Promise<ScenarioJourneyExecutionManifest>;
      getScenarioJourneyResult: (payload: { projectId: string; executionId: string }) => Promise<ScenarioJourneyResult>;
      runAnalysis: (request: AnalysisJobRequest<AnalysisConfig>) => Promise<NonNullable<ProjectManifest['lastResult']>>;
      runHourlyAnalysis: (request: AnalysisJobRequest<AnalysisConfig>) => Promise<HourlyAnalysisResult>;
      runStationDemand: (request: AnalysisJobRequest<AnalysisConfig>) => Promise<StationDemandResult>;
      runODDemand: (request: AnalysisJobRequest<AnalysisConfig>) => Promise<ODDemandResult>;
      runRouteCongestion: (request: RouteAnalysisJobRequest) => Promise<RouteCongestionResult>;
      runAlightingInference: (request: { jobId: string; projectId: string; projectRevision: string; config: import('../shared/types').AlightingInferenceConfig }) => Promise<ProjectManifest>;
      prepareImport: (request: RendererPrepareImportRequest) => Promise<PreparedImport>;
      commitImport: (request: CommitImportRequest) => Promise<ProjectManifest>;
      deleteProject: (id: string) => Promise<boolean>;
      exportProject: (project: ProjectManifest) => Promise<boolean>;
      exportSyntheticGtfs: (payload: { fileName: string; files: GtfsFileSet }) => Promise<boolean>;
      prepareMotis: (payload: { osmPbfPath: string; files: GtfsFileSet; operationId?: string }) => Promise<{ archivePath: string; message: string }>;
      startMotis: (operationId?: string) => Promise<MotisStatus>;
      requestMotis: <T = unknown>(path: string, init?: MotisRequestInit, operationId?: string) => Promise<T>;
      stopMotis: () => Promise<MotisStatus>;
      getMotisDefaults: () => Promise<MotisRuntimeDefaults>;
      openMotisOsmDownload: () => Promise<string>;
      selectMotisOsmPbf: () => Promise<MotisOsmPbfMetadata | null>;
      inspectMotisOsmPbf: (filePath: string) => Promise<MotisOsmPbfMetadata>;
      resolveMotisOsmPbf: () => Promise<MotisOsmPbfResolution>;
      rescanMotisOsmPbf: () => Promise<MotisOsmPbfResolution>;
      importProject: () => Promise<ProjectManifest | null>;
      exportPdf: () => Promise<boolean>;
    };
  }
}

export {};
