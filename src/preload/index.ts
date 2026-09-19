import { contextBridge, ipcRenderer } from 'electron';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { MotisRequestInit } from '../shared/types';

contextBridge.exposeInMainWorld('transitDesktop', {
  listProjects: () => ipcRenderer.invoke('project:list'),
  saveProject: (project: unknown) => ipcRenderer.invoke('project:save', project),
  saveProjectMetadata: (metadata: unknown) => ipcRenderer.invoke('project:save-metadata', metadata),
  runAnalysis: (id: string, config: unknown) => ipcRenderer.invoke('analysis:run', id, config),
  runHourlyAnalysis: (id: string, config: unknown) => ipcRenderer.invoke('analysis:hourly-run', id, config),
  runStationDemand: (id: string, config: unknown) => ipcRenderer.invoke('analysis:station-run', id, config),
  runODDemand: (id: string, config: unknown) => ipcRenderer.invoke('analysis:od-run', id, config),
  runRouteCongestion: (id: string, config: unknown, routeStops?: unknown, serviceConfigs?: unknown) => ipcRenderer.invoke('analysis:route-run', id, config, routeStops, serviceConfigs),
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
