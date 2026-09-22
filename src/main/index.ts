import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { closeAllProjectDatabases, closeProjectDatabase, writeProjectDatabase } from './duckdb';
import type { AnalysisConfig, MotisRequestInit, RouteCongestionConfig, RouteServiceConfig, RouteStopMasterRecord, ScenarioExecutionManifest, ScenarioExecutionResult } from '../shared/types';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import { exportSyntheticGtfsZip } from './synthetic-gtfs-export';
import { MotisSidecar, prepareMotisData } from './motis-sidecar';
import { createMotisIpcHandlers } from './motis-ipc';
import { buildMotisRuntimeDefaults, createCachedMotisRuntimeDefaultsLoader } from './motis-runtime';
import { GEOFABRIK_SOUTH_KOREA_URL, inspectOsmPbf } from './motis-osm';
import { createProjectStore, type ProjectMetadata, type ReadScenarioExecutionPayload, type SaveScenarioExecutionPayload } from './project-store';
import { createJobManager } from './job-manager';
import { createAnalysisJobHandlers, type AnalysisJobRequest, type RouteAnalysisJobRequest } from './analysis-jobs';
import { runAlightingInferenceJob, type AlightingJobRequest } from './alighting-job';
import { createImportJobHandlers, type CommitImportRequest, type PrepareImportRequest } from './import-job';
import { createScenarioJourneyJobHandlers, type ScenarioJourneyJobRequest } from './scenario-journey-job';
import { DEFAULT_MOTIS_PLAN_OPTIONS } from '../core/motis';

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

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('프로젝트 ID가 유효하지 않습니다.');
  return value;
}

function assertSaveScenarioExecutionPayload(value: unknown): SaveScenarioExecutionPayload {
  if (!value || typeof value !== 'object') throw new Error('시나리오 실행 저장 요청이 유효하지 않습니다.');
  const payload = value as Partial<SaveScenarioExecutionPayload>;
  if (!payload.projectId || !payload.manifest || !payload.result) throw new Error('시나리오 실행 저장 요청에 필수 값이 없습니다.');
  return { projectId: assertProjectId(payload.projectId), manifest: payload.manifest as ScenarioExecutionManifest, result: payload.result as ScenarioExecutionResult };
}

function assertReadScenarioExecutionPayload(value: unknown): ReadScenarioExecutionPayload {
  if (!value || typeof value !== 'object') throw new Error('시나리오 실행 조회 요청이 유효하지 않습니다.');
  const payload = value as Partial<ReadScenarioExecutionPayload>;
  if (!payload.projectId || !payload.executionId) throw new Error('시나리오 실행 조회 요청에 필수 값이 없습니다.');
  return { projectId: assertProjectId(payload.projectId), executionId: payload.executionId };
}

function assertScenarioJourneyJobRequest(value: unknown): ScenarioJourneyJobRequest {
  if (!value || typeof value !== 'object') throw new Error('A–B 여정 실행 요청이 유효하지 않습니다.');
  const request = value as Partial<ScenarioJourneyJobRequest>;
  if (!request.jobId || !request.executionId || !request.projectId || !request.osmPbfPath || !request.before || !request.after || !Array.isArray(request.routeStops) || !Array.isArray(request.serviceConfigs) || !Array.isArray(request.scenarioDefinitions) || !Array.isArray(request.queries)) {
    throw new Error('A–B 여정 실행 요청에 필수 값이 없습니다.');
  }
  return { ...request, projectId: assertProjectId(request.projectId), jobId: String(request.jobId), executionId: String(request.executionId), osmPbfPath: String(request.osmPbfPath), now: typeof request.now === 'string' ? request.now : new Date().toISOString() } as ScenarioJourneyJobRequest;
}

async function ensureRoot(): Promise<void> {
  await mkdir(projectRoot(), { recursive: true });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1100,
    minHeight: 760,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  await ensureRoot();
  const projectStore = createProjectStore(projectRoot(), writeProjectDatabase);
  const jobs = createJobManager({
    emit: (progress) => mainWindow?.webContents.send('job:progress', progress)
  });
  const analysisJobs = createAnalysisJobHandlers({ jobs, projectRoot: projectRoot(), store: projectStore });
  const importJobs = createImportJobHandlers({ jobs, store: projectStore });
  const scenarioJourneyJobs = createScenarioJourneyJobHandlers({
    jobs,
    store: projectStore,
    resolveEnvironment: async (request) => {
      const pbf = await inspectOsmPbf(request.osmPbfPath);
      const defaults = await loadMotisDefaults();
      const manifestPath = join(dirname(defaults.executablePath), 'motis-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { schemaVersion?: number; binary?: { sha256?: string } };
      if (manifest.schemaVersion !== 2 || !manifest.binary?.sha256) throw new Error('검증된 MOTIS manifest에서 binary SHA-256을 확인하지 못했습니다.');
      return {
        osmPbfSha256: pbf.sha256,
        motisBinarySha256: manifest.binary.sha256,
        motisManifestSchemaVersion: 2,
        pedestrianProfile: DEFAULT_MOTIS_PLAN_OPTIONS.pedestrianProfile,
        maxTransfers: DEFAULT_MOTIS_PLAN_OPTIONS.maxTransfers,
        maxPreTransitTimeSeconds: DEFAULT_MOTIS_PLAN_OPTIONS.maxPreTransitTimeSeconds,
        maxPostTransitTimeSeconds: DEFAULT_MOTIS_PLAN_OPTIONS.maxPostTransitTimeSeconds,
        maxMatchingDistanceMeters: DEFAULT_MOTIS_PLAN_OPTIONS.maxMatchingDistanceMeters
      };
    },
    prepareSnapshot: async ({ executionId, side, files, osmPbfPath }) => {
      const defaults = await loadMotisDefaults();
      const options = {
        ...defaults,
        dataDirectory: join(defaults.dataDirectory, 'scenario-journeys', executionId, side),
        osmPbfPath,
        args: ['server'] as string[],
        environment: { TBB_NUM_THREADS: '1' },
        disableTiles: true,
        healthPath: '/api/v1/health',
        startupTimeoutMs: 30000
      };
      await prepareMotisData(options, files);
      return options;
    },
    motisFactory: () => new MotisSidecar()
  });
  async function analysisRequest<T extends AnalysisConfig | RouteCongestionConfig>(
    requestOrId: AnalysisJobRequest<T> | string,
    config?: T
  ): Promise<AnalysisJobRequest<T>> {
    if (typeof requestOrId !== 'string') return requestOrId;
    if (!config) throw new Error('분석 설정이 필요합니다.');
    const summary = await projectStore.readSummary(requestOrId);
    return { jobId: randomUUID(), projectId: requestOrId, projectRevision: summary.updatedAt, config };
  }
  ipcMain.handle('project:list', async () => {
    const folders = await readdir(projectRoot(), { withFileTypes: true });
    const projects = [];
    for (const folder of folders.filter((entry) => entry.isDirectory())) {
      const manifestPath = join(projectRoot(), folder.name, 'project.json');
      if (!existsSync(manifestPath)) continue;
      try { projects.push(await projectStore.readSummary(folder.name)); } catch { /* ignore corrupt entries */ }
    }
    return projects;
  });
  ipcMain.handle('project:open', async (_event, id: string) => projectStore.read(id));
  ipcMain.handle('job:cancel', async (_event, jobId: string) => jobs.cancel(jobId));
  ipcMain.handle('project:save', async (_event, project) => {
    return projectStore.save(project);
  });
  ipcMain.handle('project:save-metadata', async (_event, metadata: ProjectMetadata) => {
    await projectStore.saveMetadata(metadata);
  });
  ipcMain.handle('scenario-execution:save', async (_event, payload: unknown) => projectStore.saveScenarioExecution(assertSaveScenarioExecutionPayload(payload)));
  ipcMain.handle('scenario-execution:read', async (_event, payload: unknown) => projectStore.readScenarioExecution(assertReadScenarioExecutionPayload(payload)));
  ipcMain.handle('scenario-execution:list', async (_event, projectId: unknown) => projectStore.listScenarioExecutionManifests(assertProjectId(projectId)));
  ipcMain.handle('scenario-journey:run', async (_event, request: unknown) => scenarioJourneyJobs.run(assertScenarioJourneyJobRequest(request)));
  ipcMain.handle('scenario-journey:summary', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('A–B 여정 summary 요청이 유효하지 않습니다.');
    const value = payload as { projectId?: unknown; executionId?: unknown };
    if (typeof value.projectId !== 'string' || typeof value.executionId !== 'string') throw new Error('A–B 여정 summary 요청이 유효하지 않습니다.');
    return scenarioJourneyJobs.summary(assertProjectId(value.projectId), value.executionId);
  });
  ipcMain.handle('scenario-journey:result', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('A–B 여정 결과 요청이 유효하지 않습니다.');
    const value = payload as { projectId?: unknown; executionId?: unknown };
    if (typeof value.projectId !== 'string' || typeof value.executionId !== 'string') throw new Error('A–B 여정 결과 요청이 유효하지 않습니다.');
    return scenarioJourneyJobs.result(assertProjectId(value.projectId), value.executionId);
  });
  ipcMain.handle('analysis:run', async (_event, requestOrId: AnalysisJobRequest<AnalysisConfig> | string, config?: AnalysisConfig) =>
    analysisJobs.weekday(await analysisRequest(requestOrId, config)));
  ipcMain.handle('analysis:hourly-run', async (_event, requestOrId: AnalysisJobRequest<AnalysisConfig> | string, config?: AnalysisConfig) =>
    analysisJobs.hourly(await analysisRequest(requestOrId, config)));
  ipcMain.handle('analysis:station-run', async (_event, requestOrId: AnalysisJobRequest<AnalysisConfig> | string, config?: AnalysisConfig) =>
    analysisJobs.station(await analysisRequest(requestOrId, config)));
  ipcMain.handle('analysis:od-run', async (_event, requestOrId: AnalysisJobRequest<AnalysisConfig> | string, config?: AnalysisConfig) =>
    analysisJobs.od(await analysisRequest(requestOrId, config)));
  ipcMain.handle('analysis:route-run', async (_event, requestOrId: RouteAnalysisJobRequest | string, config?: RouteCongestionConfig, _legacyRouteStops?: RouteStopMasterRecord[], serviceConfigs?: RouteServiceConfig[]) => {
    if (typeof requestOrId !== 'string') return analysisJobs.route(requestOrId);
    const request = await analysisRequest(requestOrId, config);
    return analysisJobs.route({ ...request, serviceConfigs });
  });
  ipcMain.handle('alighting:run', async (_event, request: AlightingJobRequest) =>
    runAlightingInferenceJob({ jobs, store: projectStore }, request));
  ipcMain.handle('import:prepare', async (_event, request: PrepareImportRequest) => importJobs.prepare(request));
  ipcMain.handle('import:commit', async (_event, request: CommitImportRequest) => importJobs.commit(request));
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
