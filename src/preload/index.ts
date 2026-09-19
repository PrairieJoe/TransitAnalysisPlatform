import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { JobProgress } from '../shared/job-types';
import type { MotisRequestInit } from '../shared/types';

contextBridge.exposeInMainWorld('transitDesktop', {
  listProjects: () => ipcRenderer.invoke('project:list'),
  openProject: (id: string) => ipcRenderer.invoke('project:open', id),
  cancelJob: (jobId: string) => ipcRenderer.invoke('job:cancel', jobId),
  onJobProgress: (listener: (progress: JobProgress) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: JobProgress) => listener(progress);
    ipcRenderer.on('job:progress', wrapped);
    return () => ipcRenderer.removeListener('job:progress', wrapped);
  },
  getFilePath: (file: Parameters<typeof webUtils.getPathForFile>[0]) => webUtils.getPathForFile(file),
  saveProject: (project: unknown) => ipcRenderer.invoke('project:save', project),
  saveProjectMetadata: (metadata: unknown) => ipcRenderer.invoke('project:save-metadata', metadata),
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
  prepareMotis: (payload: { osmPbfPath: string; files: GtfsFileSet }) => ipcRenderer.invoke('motis:prepare', payload),
  startMotis: () => ipcRenderer.invoke('motis:start'),
  requestMotis: (path: string, init?: MotisRequestInit) => ipcRenderer.invoke('motis:request', path, init),
  stopMotis: () => ipcRenderer.invoke('motis:stop'),
  getMotisDefaults: () => ipcRenderer.invoke('motis:defaults'),
  openMotisOsmDownload: () => ipcRenderer.invoke('motis:open-osm-download'),
  selectMotisOsmPbf: () => ipcRenderer.invoke('motis:select-osm-pbf'),
  inspectMotisOsmPbf: (filePath: string) => ipcRenderer.invoke('motis:inspect-osm-pbf', filePath),
  importProject: () => ipcRenderer.invoke('project:import'),
  exportPdf: () => ipcRenderer.invoke('report:pdf')
});
