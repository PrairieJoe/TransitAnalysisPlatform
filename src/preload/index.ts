import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('transitDesktop', {
  listProjects: () => ipcRenderer.invoke('project:list'),
  saveProject: (project: unknown) => ipcRenderer.invoke('project:save', project),
  runAnalysis: (id: string, config: unknown) => ipcRenderer.invoke('analysis:run', id, config),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  exportProject: (project: unknown) => ipcRenderer.invoke('project:export', project),
  importProject: () => ipcRenderer.invoke('project:import'),
  exportPdf: () => ipcRenderer.invoke('report:pdf')
});
