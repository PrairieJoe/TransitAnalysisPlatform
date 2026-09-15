/// <reference types="vite/client" />

import type { AnalysisConfig, HourlyAnalysisResult, ODDemandResult, ProjectManifest, RouteCongestionConfig, RouteCongestionResult, RouteServiceConfig, RouteStopMasterRecord, StationDemandResult } from '../shared/types';

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
      runAnalysis: (id: string, config: AnalysisConfig) => Promise<NonNullable<ProjectManifest['lastResult']>>;
      runHourlyAnalysis: (id: string, config: AnalysisConfig) => Promise<HourlyAnalysisResult>;
      runStationDemand: (id: string, config: AnalysisConfig) => Promise<StationDemandResult>;
      runODDemand: (id: string, config: AnalysisConfig) => Promise<ODDemandResult>;
      runRouteCongestion: (id: string, config: RouteCongestionConfig, routeStops?: RouteStopMasterRecord[], serviceConfigs?: RouteServiceConfig[]) => Promise<RouteCongestionResult>;
      deleteProject: (id: string) => Promise<boolean>;
      exportProject: (project: ProjectManifest) => Promise<boolean>;
      importProject: () => Promise<ProjectManifest | null>;
      exportPdf: () => Promise<boolean>;
    };
  }
}

export {};
