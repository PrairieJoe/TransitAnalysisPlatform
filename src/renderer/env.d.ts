import type { AnalysisConfig, HourlyAnalysisResult, ProjectManifest } from '../shared/types';

declare global {
  interface Window {
    transitDesktop?: {
      listProjects: () => Promise<ProjectManifest[]>;
      saveProject: (project: ProjectManifest) => Promise<ProjectManifest>;
      runAnalysis: (id: string, config: AnalysisConfig) => Promise<NonNullable<ProjectManifest['lastResult']>>;
      runHourlyAnalysis: (id: string, config: AnalysisConfig) => Promise<HourlyAnalysisResult>;
      deleteProject: (id: string) => Promise<boolean>;
      exportProject: (project: ProjectManifest) => Promise<boolean>;
      importProject: () => Promise<ProjectManifest | null>;
      exportPdf: () => Promise<boolean>;
    };
  }
}

export {};
