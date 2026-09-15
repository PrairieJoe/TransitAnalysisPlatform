import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { analyzeHourlyProjectDatabase, analyzeProjectDatabase, analyzeStationProjectDatabase, closeProjectDatabase, writeProjectDatabase } from './duckdb';
import type { AnalysisConfig } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
const projectRoot = () => join(app.getPath('userData'), 'projects');

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
