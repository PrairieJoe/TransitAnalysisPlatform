import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { JobProgress } from '../shared/job-types';
import type { MotisProgress, MotisRequestInit, ScenarioExecutionManifest, ScenarioExecutionResult, ScenarioJourneyExecutionManifest } from '../shared/types';
import type { ScenarioJourneyResult } from '../core/scenario-journey';
import type { ReadScenarioExecutionPayload, SaveScenarioExecutionPayload } from '../main/project-store';
import type { ScenarioJourneyJobRequest } from '../main/scenario-journey-job';

contextBridge.exposeInMainWorld('transitDesktop', {
  listProjects: () => ipcRenderer.invoke('project:list'),
  openProject: (id: string) => ipcRenderer.invoke('project:open', id),
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId),
  onJobProgress: (listener: (progress: JobProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: JobProgress) => listener(progress);
    ipcRenderer.on('job:progress', wrapped);
    return () => ipcRenderer.removeListener('job:progress', wrapped);
  },
  onMotisProgress: (listener: (progress: MotisProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: MotisProgress) => listener(progress);
    ipcRenderer.on('motis:progress', wrapped);
    return () => ipcRenderer.removeListener('motis:progress', wrapped);
  },
  getFilePath: (file: Parameters<typeof webUtils.getPathForFile>[0]) => webUtils.getPathForFile(file),
  saveProject: (project: unknown) => ipcRenderer.invoke('project:save', project),
  saveProjectMetadata: (metadata: unknown) => ipcRenderer.invoke('project:save-metadata', metadata),
  saveScenarioExecution: (payload: SaveScenarioExecutionPayload): Promise<ScenarioExecutionManifest> => ipcRenderer.invoke('scenario-execution:save', payload),
  readScenarioExecution: (payload: ReadScenarioExecutionPayload): Promise<ScenarioExecutionResult> => ipcRenderer.invoke('scenario-execution:read', payload),
  listScenarioExecutionManifests: (projectId: string): Promise<ScenarioExecutionManifest[]> => ipcRenderer.invoke('scenario-execution:list', projectId),
  runScenarioJourney: (request: ScenarioJourneyJobRequest): Promise<{ jobId: string }> => ipcRenderer.invoke('scenario-journey:run', request),
  getScenarioJourneySummary: (payload: { projectId: string; executionId: string }): Promise<ScenarioJourneyExecutionManifest> => ipcRenderer.invoke('scenario-journey:summary', payload),
  getScenarioJourneyResult: (payload: { projectId: string; executionId: string }): Promise<ScenarioJourneyResult> => ipcRenderer.invoke('scenario-journey:result', payload),
  runAnalysis: (request: unknown) => ipcRenderer.invoke('analysis:run', request),
  runHourlyAnalysis: (request: unknown) => ipcRenderer.invoke('analysis:hourly-run', request),
  runStationDemand: (request: unknown) => ipcRenderer.invoke('analysis:station-run', request),
  runODDemand: (request: unknown) => ipcRenderer.invoke('analysis:od-run', request),
  runRouteCongestion: (request: unknown) => ipcRenderer.invoke('analysis:route-run', request),
  runAlightingInference: (request: unknown) => ipcRenderer.invoke('alighting:run', request),
  prepareImport: (request: { files: Array<{ file: Parameters<typeof webUtils.getPathForFile>[0]; options: unknown }>; [key: string]: unknown }) =>
    ipcRenderer.invoke('import:prepare', {
      ...request,
      files: request.files.map(({ file, options }) => ({ path: webUtils.getPathForFile(file), name: file.name, options }))
    }),
  commitImport: (request: unknown) => ipcRenderer.invoke('import:commit', request),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  exportProject: (project: unknown) => ipcRenderer.invoke('project:export', project),
  exportSyntheticGtfs: (payload: { fileName: string; files: GtfsFileSet }) => ipcRenderer.invoke('synthetic-gtfs:export', payload),
  prepareMotis: (payload: { osmPbfPath: string; files: GtfsFileSet; operationId?: string }) => ipcRenderer.invoke('motis:prepare', payload),
  startMotis: (operationId?: string) => operationId ? ipcRenderer.invoke('motis:start', operationId) : ipcRenderer.invoke('motis:start'),
  requestMotis: (path: string, init?: MotisRequestInit, operationId?: string) => operationId ? ipcRenderer.invoke('motis:request', path, init, operationId) : ipcRenderer.invoke('motis:request', path, init),
  stopMotis: () => ipcRenderer.invoke('motis:stop'),
  getMotisDefaults: () => ipcRenderer.invoke('motis:defaults'),
  openMotisOsmDownload: () => ipcRenderer.invoke('motis:open-osm-download'),
  selectMotisOsmPbf: () => ipcRenderer.invoke('motis:select-osm-pbf'),
  inspectMotisOsmPbf: (filePath: string) => ipcRenderer.invoke('motis:inspect-osm-pbf', filePath),
  resolveMotisOsmPbf: () => ipcRenderer.invoke('motis:resolve-osm-pbf', { forceRescan: false }),
  rescanMotisOsmPbf: () => ipcRenderer.invoke('motis:resolve-osm-pbf', { forceRescan: true }),
  importProject: () => ipcRenderer.invoke('project:import'),
  exportPdf: () => ipcRenderer.invoke('report:pdf')
});
