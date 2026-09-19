import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, totalmem } from 'node:os';
import assert from 'node:assert/strict';
import { parseFileRows, normalizeRows, suggestTransactionMapping } from '../src/core/parser';
import { normalizeStationMasterRows, suggestStationMasterMapping, mergeStationMasterRecords } from '../src/core/station-master';
import { normalizeRouteStopMasterRows, suggestRouteStopMasterMapping } from '../src/core/route-master';
import { classifyDataQuality } from '../src/core/data-quality';
import { inferAlighting } from '../src/core/alighting-inference';
import { analyzeODRecords } from '../src/core/analysis';
import { createODAnalysisCache } from '../src/core/od-cache';
import { createProjectStore } from '../src/main/project-store';
import { analyzeODProjectDatabase, closeAllProjectDatabases, writeProjectDatabase } from '../src/main/duckdb';
import { DEFAULT_ALIGHTING_INFERENCE_CONFIG, type NormalizedRecord, type RouteStopMasterRecord, type StationMasterRecord, type ColumnMapping, type AnalysisConfig, type ProjectManifest } from '../src/shared/types';

// Explicit input root; only aggregate counts/timings are written to report.json.
const inputRoot = process.argv[2];
const days = Number(process.argv[3] ?? 7);
if (!inputRoot || ![1, 7].includes(days)) throw new Error('Usage: npm run benchmark:analysis -- <DATA_YYYYMMDD parent directory> <1|7>');
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string };
const outputRoot = resolve('test-artifacts', 'analysis-benchmark', new Date().toISOString().replaceAll(':', '-'));
await mkdir(outputRoot, { recursive: true });
const timings: Record<string, number> = {};
async function timed<T>(name: string, task: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await task();
  timings[name] = Math.round((performance.now() - start) * 100) / 100;
  console.log(`${name}: ${timings[name]}ms`);
  return result;
}
async function parse(prefix: string, date: string) {
  const name = `${prefix}_${date}.dat`;
  const bytes = await readFile(join(inputRoot, `DATA_${date}`, name));
  return parseFileRows(new File([bytes], name), { headerRow: -1 });
}
let records: NormalizedRecord[] = [];
let stations: StationMasterRecord[] = [];
const stops: RouteStopMasterRecord[] = [];
let mapping: ColumnMapping = { dateColumn: '', rowSemantics: 'count-column' };
let rejected = 0;
try {
  await timed('parseNormalize', async () => {
    for (let day = 15; day < 15 + days; day++) {
      const date = `202404${day}`;
      const transactions = await parse('DWTCD', date);
      mapping = { ...mapping, ...suggestTransactionMapping(transactions.headers, transactions.rows.slice(0, 20)) };
      const normalized = normalizeRows(transactions.rows, mapping);
      records = records.concat(normalized.records);
      rejected += normalized.excludedRows;
      const station = await parse('STTN', date);
      stations = mergeStationMasterRecords(stations, normalizeStationMasterRows(station.rows, suggestStationMasterMapping(station.headers, station.rows.slice(0, 20))).stations).stations;
      const route = await parse('ROUTESTTN', date);
      const parsedStops = normalizeRouteStopMasterRows(route.rows, suggestRouteStopMasterMapping(route.headers, route.rows.slice(0, 20))).stops;
      for (const stop of parsedStops) stops.push(stop);
    }
  });
  records = await timed('classify', () => classifyDataQuality(records, stations, stops));
  const inferred = await timed('infer', () => inferAlighting(records, stations, stops, DEFAULT_ALIGHTING_INFERENCE_CONFIG));
  records = inferred.records;
  const config: AnalysisConfig = { filter: { from: '2024-04-15', to: `2024-04-${14 + days}` }, denominator: 'observed' };
  const cache = createODAnalysisCache();
  const totals: Record<string, number> = {};
  for (const mode of ['observed', 'high-confidence', 'expected-flow'] as const) {
    const c = { ...config, alightingMode: mode };
    const first = await timed(`od.${mode}.cold`, () => cache(records, c, async (requested) => analyzeODRecords(records, requested)));
    const hit = await timed(`od.${mode}.cached`, () => cache(records, c, async () => { throw new Error('cache miss'); }));
    assert.equal(hit, first);
    totals[mode] = first.totalBoardings;
  }
  const store = createProjectStore(join(outputRoot, 'projects'), writeProjectDatabase);
  const project: ProjectManifest = { id: 'benchmark', schemaVersion: 10, name: 'benchmark', createdAt: '', updatedAt: '', sourceFiles: [], records, mapping, parseOptions: { encoding: 'euc-kr', delimiter: '|', headerRow: -1 }, analysisConfig: config };
  await timed('save.full', () => store.save(project));
  const db = join(outputRoot, 'projects', 'benchmark', 'records.duckdb');
  const before = await stat(db);
  const { records: _records, ...metadata } = project;
  await timed('save.metadata', () => store.saveMetadata({ ...metadata, analysisConfig: { ...config, alightingMode: 'expected-flow' } }));
  assert.equal((await stat(db)).mtimeMs, before.mtimeMs);
  for (const mode of ['observed', 'high-confidence', 'expected-flow'] as const) {
    const native = await timed(`duckdb.${mode}`, () => analyzeODProjectDatabase(db, { ...config, alightingMode: mode }));
    assert.equal(native.totalBoardings, totals[mode]);
  }
  const report = { version, days, recordCount: records.length, rejected, stationCount: stations.length, routeStopCount: stops.length, totals, timingsMs: timings, memory: process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS, cpu: cpus()[0]?.model, totalMemoryBytes: totalmem(), node: process.version, checks: ['three-mode cache identity', 'metadata save DB mtime unchanged', 'JS/DuckDB totals equal'], note: 'Node core pipeline measurement; not Electron UI latency. Local project contains source records; do not publish it.' };
  await writeFile(join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${outputRoot}`);
} finally { await closeAllProjectDatabases(); }
