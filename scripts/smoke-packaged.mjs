// Run after npm run package:win. Isolated data; never opens an existing project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';

const root = resolve('test-artifacts', 'packaged-smoke', new Date().toISOString().replaceAll(':', '-'));
const profile = join(root, 'profile');
const fixtureDir = join(profile, 'projects', 'integration-smoke');
await mkdir(fixtureDir, { recursive: true });
const roadCoordinates = process.argv.includes('--road-shapes')
  ? (await readFile(resolve('fixtures/yeosu-route-station-master-sample.dat'), 'utf8')).trim().split(/\r?\n/).slice(0, 4).map((line) => { const fields = line.split('|'); return { latitude: Number(fields[9]), longitude: Number(fields[10]) }; })
  : undefined;
const expectedInferredDestination = roadCoordinates ? 'D' : 'C';
const stops = ['A', 'B', 'C', 'D'].map((stationId, stationSequence) => ({
  routeId: 'R1', routeName: '통합 검증 노선', transportMode: 'B', stationId, stationName: stationId,
  stationSequence, latitude: 37, longitude: 127 + stationSequence * 0.001, ...roadCoordinates?.[stationSequence]
}));
const config = { filter: { from: '2026-09-18', to: '2026-09-18' }, denominator: 'observed', alightingMode: 'observed' };
await writeFile(join(fixtureDir, 'project.json'), JSON.stringify({
  schemaVersion: 10, id: 'integration-smoke', name: '통합 검증', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  sourceFiles: ['integration-fixture.csv'], mapping: { dateColumn: 'date', boardingCountColumn: 'count' },
  parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 0 },
  records: [
    { serviceDate: '2026-09-18', boardingTime: '08:00:00', boardingHour: 8, boardingCount: 10, virtualCardId: 'TEST', vehicleId: 'V1', route: 'R1', stationId: 'A' },
    { serviceDate: '2026-09-18', boardingTime: '08:15:00', boardingHour: 8, boardingCount: 5, virtualCardId: 'TEST', vehicleId: 'V1', route: 'R1', stationId: 'C', destinationStationId: 'D' }
  ], stationMaster: stops, routeStopMaster: stops, routeServiceConfigs: [{ routeId: 'R1', vehicleCapacity: 20, tripsByHour: { '8': 2 } }],
  analysisMode: 'route', analysisConfig: config, routeAnalysisConfig: { ...config, hour: 8 }
}));
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const executable = resolve('release', 'win-unpacked', 'Transit Analysis Platform.exe');
const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, ELECTRON_RENDERER_URL: '' }
});
let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });
let launchError;
child.on('error', (error) => { launchError = error; });
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
async function until(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const value = await check();
    if (value) return value;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
let socket;
const result = { executable, profile, checks: [], rendererErrors: [] };
try {
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((target) => target.type === 'page'); }
    catch { return undefined; }
  }, 'debug target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') result.rendererErrors.push(message.params.exceptionDetails);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const loadProject = () => evaluate('(async () => { const [summary] = await window.transitDesktop.listProjects(); return summary ? window.transitDesktop.openProject(summary.id) : null; })()');
  const click = async (text) => {
    assert.ok(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`), `Button: ${text}`);
  };
  const waitFor = (expression, label) => until(() => evaluate(expression), label);
  await send('Runtime.enable');
  await waitFor('Boolean(window.transitDesktop && document.querySelector(".project-open"))', 'preload and fixture');
  const projects = await evaluate('window.transitDesktop.listProjects()');
  assert.deepEqual(projects.map((project) => project.id), ['integration-smoke']);
  const defaults = await evaluate('window.transitDesktop.getMotisDefaults()');
  result.motisDefaults = defaults;
  assert.ok(JSON.stringify(defaults).includes('resources\\\\motis') || JSON.stringify(defaults).includes('resources/motis'), 'packaged MOTIS path');
  result.checks.push('Packaged CJS preload, isolated project IPC, embedded MOTIS defaults');
  await evaluate('document.querySelector(".project-open").click()');
  await waitFor('Boolean(document.querySelector(".route-visual-toggle"))', 'route report');
  await click('3D 시각화');
  await waitFor('Boolean(document.querySelector(".three-map-actions button:not(:disabled)"))', 'WebGL scene ready');
  await evaluate('document.querySelector(".three-map-shell").scrollIntoView({ block: "center" })');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const screenshot = await send('Page.captureScreenshot');
  await writeFile(join(root, 'route-3d.png'), Buffer.from(screenshot.data, 'base64'));
  result.checks.push('Route report → 3D WebGL scene ready');
  await click('추정 방법 설정');
  await waitFor('document.body.innerText.includes("이 설정으로 하차 추정 실행")', 'alighting settings');
  await click('이 설정으로 하차 추정 실행');
  await waitFor('Boolean(document.querySelector(".report-workspace .analysis-mode"))', 'estimated report');
  const saved = await loadProject();
  assert.equal(saved.records[0].inferredDestinationStationId, expectedInferredDestination);
  result.checks.push(`Alighting settings → execute → inferred ${expectedInferredDestination} saved via native DuckDB IPC`);
  await click('노선 혼잡도');
  await waitFor(`Boolean(document.querySelector('input[aria-label="하차 추정값 사용"]:not(:disabled)'))`, 'inference layer control');
  if (!roadCoordinates) {
    await evaluate(`document.querySelector('input[aria-label="하차 추정값 사용"]').click()`);
    await until(async () => {
      const current = await loadProject();
      return current.lastRouteResult?.totalBoardings === 15 && current.routeAnalysisConfig?.alightingMode === 'high-confidence';
    }, 'inferred route total 15 through native IPC');
  }
  if (!roadCoordinates) result.checks.push('Inferred layer toggle → native route analysis: total boardings 5 → 15');
  if (!roadCoordinates) {
    const originalManifest = await readFile(join(fixtureDir, 'project.json'), 'utf8');
    const originalDatabaseTime = (await stat(join(fixtureDir, 'records.duckdb'))).mtimeMs;
    await click('OD 흐름');
    await until(async () => (await loadProject())?.analysisMode === 'od', 'OD report saved');
    for (const expected of [15, 5, 15]) {
      await evaluate(`document.querySelector('input[aria-label="하차 추정값 사용"]').click()`);
      await until(async () => (await loadProject())?.lastODResult?.totalBoardings === expected, `OD total ${expected}`);
    }
    assert.equal(await readFile(join(fixtureDir, 'project.json'), 'utf8'), originalManifest);
    assert.equal((await stat(join(fixtureDir, 'records.duckdb'))).mtimeMs, originalDatabaseTime);
    await send('Page.reload');
    await waitFor('Boolean(document.querySelector(".project-open"))', 'reload project list');
    const reopened = await loadProject();
    assert.equal(reopened.analysisConfig.alightingMode, 'high-confidence');
    assert.equal(reopened.lastODResult.totalBoardings, 15);
    await evaluate('document.querySelector(".project-open").click()');
    await waitFor('Boolean(document.querySelector(".report-workspace .analysis-mode"))', 'restored report');
    result.checks.push('OD 5 → 15 → 5 → 15, original JSON/DB unchanged, metadata restored after reload');
  }
  if (process.argv.includes('--road-shapes')) {
    await click('노선 혼잡도');
    await waitFor('Boolean(document.querySelector(".route-shape-controls"))', 'road geometry controls');
    await evaluate('document.querySelector(".route-shape-controls").open = true');
    const pbf = resolve('data/osm/south-korea-latest.osm.pbf');
    await evaluate(`(() => { const input = document.querySelector('input[aria-label="도로망 OSM PBF 경로"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(pbf)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await click('도로망 준비 후 형상 조회');
    await until(() => evaluate('document.querySelector(".route-shape-controls").innerText.includes("조회 완료")'), 'native road preparation and geometry', 900000);
    const shapeText = await evaluate('document.querySelector(".route-shape-controls").innerText');
    assert.match(shapeText, /OSM BUS [1-9][0-9]*구간/);
    result.roadShapeSummary = shapeText;
    await click('3D 시각화');
    await waitFor('Boolean(document.querySelector(".three-map-actions button:not(:disabled)"))', 'road shaped 3D');
    const roadScreenshot = await send('Page.captureScreenshot');
    await writeFile(join(root, 'road-shaped-3d.png'), Buffer.from(roadScreenshot.data, 'base64'));
    result.checks.push('Native PBF prepare → BUS road shape → 2D/3D geometry');
  }
  await click('계획·시나리오');
  await waitFor('Boolean(document.querySelector(".scenario-workspace-entry"))', 'planning workspace');
  await click('노선 개편 시나리오 시작');
  await waitFor('Boolean(document.querySelector(".synthetic-scenario-step"))', 'scenario workspace');
  await click('GTFS 생성 단계로');
  await waitFor('Boolean(document.querySelector(".synthetic-generation-step"))', 'GTFS view');
  await click('현행·개편안 GTFS 생성');
  await waitFor('Boolean(document.querySelector(".synthetic-summary-grid"))', 'GTFS generation');
  assert.ok(!(await evaluate('document.body.innerText')).includes('아직 생성된 결과가 없습니다'));
  await evaluate('document.querySelector(".synthetic-summary-grid").scrollIntoView({ block: "center" })');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const gtfsScreenshot = await send('Page.captureScreenshot');
  await writeFile(join(root, 'gtfs-generated.png'), Buffer.from(gtfsScreenshot.data, 'base64'));
  result.checks.push('Report → GTFS → Before/After generation');
  assert.equal(result.rendererErrors.length, 0, 'Unhandled renderer exceptions');
  console.log(JSON.stringify(result, null, 2));
} finally {
  socket?.close();
  child.kill();
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2));
  await writeFile(join(root, 'process.log'), logs);
  console.log(`Smoke artifacts: ${root}`);
}
