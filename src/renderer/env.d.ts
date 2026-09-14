import type { ProjectManifest } from '../shared/types';

declare global {
  interface Window {
    transitDesktop?: {
      listProjects: () => Promise<ProjectManifest[]>;
      saveProject: (project: ProjectManifest) => Promise<ProjectManifest>;
      runAnalysis: (id: string, config: ProjectManifest['analysisConfig']) => Promise<NonNullable<ProjectManifest['lastResult']>>;
      deleteProject: (id: string) => Promise<boolean>;
      exportProject: (project: ProjectManifest) => Promise<boolean>;
      importProject: () => Promise<ProjectManifest | null>;
      exportPdf: () => Promise<boolean>;
    };
  }
}

export {};
