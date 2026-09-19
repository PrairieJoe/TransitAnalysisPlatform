/// <reference types="vite/client" />

import type { AnalysisConfig, HourlyAnalysisResult, MotisOsmPbfMetadata, MotisRequestInit, MotisRuntimeDefaults, MotisStatus, ODDemandResult, ProjectManifest, RouteCongestionConfig, RouteCongestionResult, RouteServiceConfig, RouteStopMasterRecord, StationDemandResult } from '../shared/types';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';

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
      listProjects: () => Promise<ProjectManifest[]>;
      saveProject: (project: ProjectManifest) => Promise<ProjectManifest>;
      saveProjectMetadata: (metadata: Omit<ProjectManifest, 'records'>) => Promise<void>;
      runAnalysis: (id: string, config: AnalysisConfig) => Promise<NonNullable<ProjectManifest['lastResult']>>;
      runHourlyAnalysis: (id: string, config: AnalysisConfig) => Promise<HourlyAnalysisResult>;
      runStationDemand: (id: string, config: AnalysisConfig) => Promise<StationDemandResult>;
      runODDemand: (id: string, config: AnalysisConfig) => Promise<ODDemandResult>;
      runRouteCongestion: (id: string, config: RouteCongestionConfig, routeStops?: RouteStopMasterRecord[], serviceConfigs?: RouteServiceConfig[]) => Promise<RouteCongestionResult>;
      deleteProject: (id: string) => Promise<boolean>;
      exportProject: (project: ProjectManifest) => Promise<boolean>;
      exportSyntheticGtfs: (payload: { fileName: string; files: GtfsFileSet }) => Promise<boolean>;
      prepareMotis: (payload: { osmPbfPath: string; files: GtfsFileSet }) => Promise<{ archivePath: string; message: string }>;
      startMotis: () => Promise<MotisStatus>;
      requestMotis: <T = unknown>(path: string, init?: MotisRequestInit) => Promise<T>;
      stopMotis: () => Promise<MotisStatus>;
      getMotisDefaults: () => Promise<MotisRuntimeDefaults>;
      openMotisOsmDownload: () => Promise<string>;
      selectMotisOsmPbf: () => Promise<MotisOsmPbfMetadata | null>;
      inspectMotisOsmPbf: (filePath: string) => Promise<MotisOsmPbfMetadata>;
      importProject: () => Promise<ProjectManifest | null>;
      exportPdf: () => Promise<boolean>;
    };
  }
}

export {};
