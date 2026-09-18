import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { analyzeHourlyProjectDatabase, analyzeODProjectDatabase, analyzeProjectDatabase, analyzeRouteProjectDatabase, analyzeStationProjectDatabase, closeAllProjectDatabases, closeProjectDatabase, writeProjectDatabase } from './duckdb';
import type { AnalysisConfig, MotisRequestInit, RouteCongestionConfig, RouteServiceConfig, RouteStopMasterRecord } from '../shared/types';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import { exportSyntheticGtfsZip } from './synthetic-gtfs-export';
import { MotisSidecar, prepareMotisData } from './motis-sidecar';
import { createMotisIpcHandlers } from './motis-ipc';
import { buildMotisRuntimeDefaults, createCachedMotisRuntimeDefaultsLoader } from './motis-runtime';
import { GEOFABRIK_SOUTH_KOREA_URL, inspectOsmPbf } from './motis-osm';

let mainWindow: BrowserWindow | null = null;
const projectRoot = () => join(app.getPath('userData'), 'projects');
const motisSidecar = new MotisSidecar();
const loadMotisDefaults = createCachedMotisRuntimeDefaultsLoader(() => buildMotisRuntimeDefaults({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  projectRoot: app.getAppPath(),
  userDataPath: app.getPath('userData'),
  localAppDataPath: process.env.LOCALAPPDATA
}));
const motisIpc = createMotisIpcHandlers({
  sidecar: motisSidecar,
  prepare: prepareMotisData,
  buildDefaults: loadMotisDefaults
});

async function ensureRoot(): Promise<void> {
  await mkdir(projectRoot(), { recursive: true });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1100,
    minHeight: 760,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), contextIsolation: true, nodeIntegration: false }
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  await ensureRoot();
  ipcMain.handle('project:list', async () => {
    const folders = await readdir(projectRoot(), { withFileTypes: true });
    const projects = [];
    for (const folder of folders.filter((entry) => entry.isDirectory())) {
      const manifestPath = join(projectRoot(), folder.name, 'project.json');
      if (!existsSync(manifestPath)) continue;
      try { projects.push(JSON.parse(await readFile(manifestPath, 'utf8'))); } catch { /* ignore corrupt entries */ }
    }
    return projects;
  });
  ipcMain.handle('project:save', async (_event, project) => {
    const folder = join(projectRoot(), project.id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
    await writeProjectDatabase(join(folder, 'records.duckdb'), project.records);
    return project;
  });
  ipcMain.handle('analysis:run', async (_event, id: string, config: AnalysisConfig) => {
    const folder = join(projectRoot(), id);
    const dbPath = join(folder, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
      await writeProjectDatabase(dbPath, manifest.records ?? []);
    }
    return analyzeProjectDatabase(dbPath, config);
  });
  ipcMain.handle('analysis:hourly-run', async (_event, id: string, config: AnalysisConfig) => {
    const folder = join(projectRoot(), id);
    const dbPath = join(folder, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
      await writeProjectDatabase(dbPath, manifest.records ?? []);
    }
    return analyzeHourlyProjectDatabase(dbPath, config);
  });
  ipcMain.handle('analysis:station-run', async (_event, id: string, config: AnalysisConfig) => {
    const folder = join(projectRoot(), id);
    const dbPath = join(folder, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
      await writeProjectDatabase(dbPath, manifest.records ?? []);
    }
    return analyzeStationProjectDatabase(dbPath, config);
  });
  ipcMain.handle('analysis:od-run', async (_event, id: string, config: AnalysisConfig) => {
    const folder = join(projectRoot(), id);
    const dbPath = join(folder, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
      await writeProjectDatabase(dbPath, manifest.records ?? []);
    }
    return analyzeODProjectDatabase(dbPath, config);
  });
  ipcMain.handle('analysis:route-run', async (_event, id: string, config: RouteCongestionConfig, routeStops?: RouteStopMasterRecord[], serviceConfigs?: RouteServiceConfig[]) => {
    const folder = join(projectRoot(), id);
    const dbPath = join(folder, 'records.duckdb');
    if (!existsSync(dbPath)) {
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
      await writeProjectDatabase(dbPath, manifest.records ?? []);
    }
    const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
    return analyzeRouteProjectDatabase(dbPath, config, routeStops ?? manifest.routeStopMaster ?? [], serviceConfigs ?? manifest.routeServiceConfigs ?? []);
  });
  ipcMain.handle('project:delete', async (_event, id: string) => {
    await closeProjectDatabase(join(projectRoot(), id, 'records.duckdb'));
    await rm(join(projectRoot(), id), { recursive: true, force: true });
    return true;
  });
  ipcMain.handle('project:export', async (_event, project) => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `${project.name}.taproj`, filters: [{ name: 'Transit Project', extensions: ['taproj'] }] });
    if (result.canceled || !result.filePath) return false;
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(project, null, 2));
    await writeFile(result.filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    return true;
  });
  ipcMain.handle('synthetic-gtfs:export', async (_event, payload: { fileName: string; files: GtfsFileSet }) => {
    if (!mainWindow) throw new Error('앱 창을 찾을 수 없습니다.');
    if (!payload || typeof payload.fileName !== 'string' || !payload.files) throw new Error('Synthetic GTFS 내보내기 요청이 유효하지 않습니다.');
    return exportSyntheticGtfsZip(mainWindow, payload.fileName, payload.files);
  });
  ipcMain.handle('motis:prepare', async (_event, payload: unknown) => motisIpc.prepare(payload));
  ipcMain.handle('motis:start', async () => motisIpc.start());
  ipcMain.handle('motis:request', async (_event, path: unknown, init?: MotisRequestInit) => motisIpc.request(path, init));
  ipcMain.handle('motis:stop', async () => motisIpc.stop());
  ipcMain.handle('motis:defaults', async () => loadMotisDefaults());
  ipcMain.handle('motis:open-osm-download', async () => {
    await shell.openExternal(GEOFABRIK_SOUTH_KOREA_URL);
    return GEOFABRIK_SOUTH_KOREA_URL;
  });
  ipcMain.handle('motis:select-osm-pbf', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'OSM PBF', extensions: ['pbf'] }, { name: '모든 파일', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectOsmPbf(result.filePaths[0]);
  });
  ipcMain.handle('motis:inspect-osm-pbf', async (_event, filePath: string) => {
    if (typeof filePath !== 'string') throw new Error('OSM PBF 경로가 유효하지 않습니다.');
    return inspectOsmPbf(filePath);
  });
  ipcMain.handle('project:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Transit Project', extensions: ['taproj'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const zip = await JSZip.loadAsync(await readFile(result.filePaths[0]));
    const manifest = zip.file('project.json');
    if (!manifest) throw new Error('프로젝트 파일이 손상되었습니다.');
    return JSON.parse(await manifest.async('string'));
  });
  ipcMain.handle('report:pdf', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: 'transit-report.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath || !mainWindow) return false;
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, landscape: true, pageSize: 'A4' });
    await writeFile(result.filePath, pdf);
    return true;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void Promise.all([closeAllProjectDatabases(), motisSidecar.stop()]).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
