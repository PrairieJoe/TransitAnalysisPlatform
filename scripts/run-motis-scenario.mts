import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { parseDelimited } from '../src/core/parser';
import { buildRoutePathIndex, normalizeRouteStopMasterRows, suggestRouteStopMasterMapping } from '../src/core/route-master';
import { buildMotisPlanPath, defaultMotisDepartureDateTime } from '../src/core/motis';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../src/core/synthetic-gtfs/draft-builder';
import type { GtfsFileSet } from '../src/core/synthetic-gtfs/types';
import { compareJourneys, normalizeMotisJourney } from '../src/core/transit-comparison';
import { sampleDepartureTimes, summarizeJourneyWindow } from '../src/core/transit-batch';
import { MotisSidecar, prepareMotisData } from '../src/main/motis-sidecar';
import type { MotisSidecarOptions } from '../src/main/motis-sidecar';
import type { RouteStopMasterRecord } from '../src/shared/types';

const root = resolve(process.cwd());
const execFileAsync = promisify(execFile);
const fullOsm = process.argv.includes('--full-osm');
const routeMasterPath = join(root, 'fixtures', 'yeosu-route-station-master-sample.dat');
const patchedExecutablePath = join(root, 'vendor', 'motis', 'patched-windows', 'motis.exe');
const releaseExecutablePath = join(root, 'vendor', 'motis', 'windows', 'motis.exe');
const executablePath = process.env.MOTIS_EXECUTABLE_PATH?.trim() || (existsSync(patchedExecutablePath) ? patchedExecutablePath : releaseExecutablePath);
const osmPbfPath = join(root, 'data', 'osm', 'south-korea-latest.osm.pbf');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = join(root, 'test-artifacts', 'motis-scenario', runId);
const routeId = '325000002';
const originStopId = '3250842';
const destinationStopId = '3250845';
const requestedDateTime = defaultMotisDepartureDateTime();
const requestedTime = `${requestedDateTime}:00+09:00`;
const scenarioStopIds = ['3250842', '3250843', '3250847', '3250913', '3251188', '3251189', '3251204', '3250845'];

function parseRouteStops(text: string): RouteStopMasterRecord[] {
  const headers = Array.from({ length: 14 }, (_value, index) => `필드${index + 1}`);
  const rows = parseDelimited(text, '|').map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  const mapping = suggestRouteStopMasterMapping(headers, rows);
  return normalizeRouteStopMasterRows(rows, mapping).stops;
}

function apiPath(): string {
  return buildMotisPlanPath(originStopId, destinationStopId, requestedDateTime);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function draftOptions() {
  return {
    agencyId: 'tap-agency',
    agencyName: '분석용 대중교통',
    routeId,
    serviceDays: [0, 1, 2, 3, 4],
    firstDeparture: '06:00',
    lastDeparture: '23:00',
    vehicleCount: 8,
    headwayMinutes: 20,
    startDate: '20260101',
    endDate: '20261231',
    sourceName: 'yeosu-route-station-master-sample.dat',
    deriveReverseDirection: true,
    dwellSeconds: 20,
    travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
  } as const;
}

async function createArchive(dataDirectory: string, files: GtfsFileSet): Promise<string> {
  const archivePath = join(dataDirectory, 'tap-synthetic-gtfs.zip');
  const zip = new JSZip();
  Object.entries(files).forEach(([name, content]) => zip.file(name, content));
  await writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return archivePath;
}

async function importTimetableOnly(dataDirectory: string, archivePath: string): Promise<string> {
  await execFileAsync(executablePath, ['config', archivePath], { cwd: dataDirectory, windowsHide: true, maxBuffer: 1024 * 1024 * 16 });
  const preparedDataDirectory = join(dataDirectory, 'data');
  await execFileAsync(executablePath, ['import', '-c', join(dataDirectory, 'config.yml'), '-d', preparedDataDirectory, '--filter', 'tt'], { cwd: dirname(executablePath), windowsHide: true, maxBuffer: 1024 * 1024 * 16 });
  return preparedDataDirectory;
}

async function runPackage(label: string, files: GtfsFileSet): Promise<ReturnType<typeof normalizeMotisJourney> & { rawResponse: unknown; archivePath: string; dataDirectory: string; batchJourneys: Array<ReturnType<typeof normalizeMotisJourney>> }> {
  const dataDirectory = join(outputRoot, label);
  await mkdir(dataDirectory, { recursive: true });
  const archivePath = await createArchive(dataDirectory, files);
  const preparedDataDirectory = fullOsm ? join(dataDirectory, 'data') : await importTimetableOnly(dataDirectory, archivePath);
  const options: MotisSidecarOptions = {
    executablePath,
    dataDirectory,
    osmPbfPath,
    port: 8080,
    args: fullOsm ? ['server'] : ['server', '-d', preparedDataDirectory],
    environment: fullOsm ? { TBB_NUM_THREADS: '1' } : undefined,
    disableTiles: fullOsm,
    healthPath: '/api/v1/health',
    startupTimeoutMs: 120000
  };
  process.stdout.write(`[${label}] ${fullOsm ? 'OSM 포함 config/import' : 'timetable-only import'} 시작\n`);
  const prepared = fullOsm ? await prepareMotisData(options, files) : { archivePath, message: 'timetable-only import' };
  process.stdout.write(`[${label}] import 완료: ${prepared.archivePath}\n`);
  const sidecar = new MotisSidecar();
  const status = await sidecar.start(options);
  if (status.state !== 'ready') throw new Error(`[${label}] MOTIS readiness 실패: ${status.message ?? '알 수 없는 오류'}`);
  process.stdout.write(`[${label}] server ready: ${status.baseUrl}\n`);
  try {
    const rawResponse = await sidecar.request<unknown>(apiPath());
    await writeFile(join(dataDirectory, 'plan-response.json'), JSON.stringify(rawResponse, null, 2), 'utf8');
    const journey = normalizeMotisJourney(rawResponse, requestedTime);
    const batchTimes = sampleDepartureTimes({ startTime: '06:00', endTime: '09:00', intervalMinutes: 5 });
    const batchJourneys = [] as Array<ReturnType<typeof normalizeMotisJourney>>;
    for (const time of batchTimes) {
      const rawBatchResponse = await sidecar.request<unknown>(buildMotisPlanPath(originStopId, destinationStopId, requestedDateTime, time));
      batchJourneys.push(normalizeMotisJourney(rawBatchResponse, `${requestedDateTime.slice(0, 10)}T${time}+09:00`));
    }
    await writeFile(join(dataDirectory, 'batch-journeys.json'), JSON.stringify(batchJourneys, null, 2), 'utf8');
    return { ...journey, rawResponse, archivePath: prepared.archivePath, dataDirectory, batchJourneys };
  } finally {
    await sidecar.stop();
  }
}

function journeyOnly(result: Awaited<ReturnType<typeof runPackage>>): ReturnType<typeof normalizeMotisJourney> {
  const { rawResponse: _rawResponse, archivePath: _archivePath, dataDirectory: _dataDirectory, batchJourneys: _batchJourneys, ...journey } = result;
  return journey;
}

const sourceStops = parseRouteStops(await readFile(routeMasterPath, 'utf8'));
const baseStops = sourceStops.filter((stop) => stop.routeId === routeId);
if (!baseStops.length) throw new Error(`기준 노선을 찾을 수 없습니다: ${routeId}`);
const basePath = buildRoutePathIndex(baseStops).paths[0];
if (!basePath) throw new Error(`기준 노선 경로를 만들 수 없습니다: ${routeId}`);
const scenarioStops = scenarioStopIds.map((stationId, index) => {
  const source = baseStops.find((stop) => stop.stationId === stationId);
  if (!source) throw new Error(`시나리오 정류장을 찾을 수 없습니다: ${stationId}`);
  return { ...source, serviceDate: undefined, stationSequence: index + 1 };
});

const baseResult = buildSyntheticGtfsDraft(baseStops, [], draftOptions());
const scenarioResult = buildSyntheticGtfsDraft(scenarioStops, [], draftOptions());
if (!baseResult.validation.isValid || !scenarioResult.validation.isValid) throw new Error('Synthetic GTFS 검증이 통과되지 않았습니다.');
await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, 'scenario-input.json'), JSON.stringify({ routeId, baseStopIds: basePath.stops.map((stop) => stop.stationId), scenarioStopIds, originStopId, destinationStopId, requestedTime, baseSummary: baseResult.summary, scenarioSummary: scenarioResult.summary }, null, 2), 'utf8');

const before = await runPackage('base', baseResult.files);
const after = await runPackage('scenario', scenarioResult.files);
const comparison = compareJourneys(journeyOnly(before), journeyOnly(after));
const batchComparisons = before.batchJourneys.map((journey, index) => compareJourneys(journey, after.batchJourneys[index]));
const batchSummary = summarizeJourneyWindow(batchComparisons);
const report = {
  runId,
  mode: fullOsm ? 'full-osm' : 'timetable-only',
  executablePath,
  osmPbfPath,
  osmPbfSha256: digest(await readFile(osmPbfPath)),
  routeId,
  baseStopIds: basePath.stops.map((stop) => stop.stationId),
  scenarioStopIds,
  removedStopIds: basePath.stops.map((stop) => stop.stationId).filter((stopId) => !scenarioStopIds.includes(stopId)),
  originStopId,
  destinationStopId,
  requestedDateTime,
  requestedTime,
  base: { dataDirectory: before.dataDirectory, archivePath: before.archivePath, summary: baseResult.summary, journey: journeyOnly(before) },
  scenario: { dataDirectory: after.dataDirectory, archivePath: after.archivePath, summary: scenarioResult.summary, journey: journeyOnly(after) },
  comparison,
  batch: { startTime: '06:00', endTime: '09:00', intervalMinutes: 5, summary: batchSummary },
  rawResponseFiles: [join(before.dataDirectory, 'plan-response.json'), join(after.dataDirectory, 'plan-response.json')]
};
await writeFile(join(outputRoot, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ outputRoot, base: report.base.journey, scenario: report.scenario.journey, delta: comparison.delta, batch: report.batch, warnings: comparison.warnings }, null, 2) + '\n');
