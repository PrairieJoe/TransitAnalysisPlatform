// Real-file UI validation. Run after packaging; --days=1 is a debug run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';

const days = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] ?? 7);
assert.ok(days === 1 || days === 7);
const root = resolve('test-artifacts', 'week-ui', new Date().toISOString().replaceAll(':', '-'));
const profile = join(root, 'profile');
await mkdir(profile, { recursive: true });
const source = process.env.TRANSIT_WEEK_SOURCE ?? 'C:/Users/User/Desktop/Study/교통카드모음/1. 여수시/2. 교통카드';
const dates = Array.from({ length: days }, (_, i) => `202404${15 + i}`);
const files = prefix => dates.map(date => resolve(source, `DATA_${date}`, `${prefix}_${date}.dat`));
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const child = spawn(resolve('release/win-unpacked/Transit Analysis Platform.exe'), [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, ELECTRON_RENDERER_URL: '' } });
const result = { days, profile, startedAt: new Date().toISOString(), checks: [], timings: [], errors: [], memory: [] };
let launchError, socket, evaluate, send;
child.on('error', e => { launchError = e; });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, timeout = 600000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (launchError) throw launchError; if (await check()) return; await pause(250); }
  throw new Error(`Timeout: ${label}`);
}
async function timed(label, fn) { const start = Date.now(); await fn(); result.timings.push({ label, ms: Date.now() - start }); console.log(`${label}: ${Date.now() - start} ms`); }
try {
  let target;
  await until(async () => { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); return target; } catch { return false; } }, 'launch', 60000);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.method === 'Runtime.exceptionThrown') result.errors.push(m.params.exceptionDetails.text); if (m.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
  send = (method, params = {}) => new Promise((r, j) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); j(new Error(`CDP timeout: ${method}`)); }, 600000); pending.set(n, m => { clearTimeout(timer); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }); socket.send(JSON.stringify({ id: n, method, params })); });
  evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
  const wait = (expression, label) => until(() => evaluate(expression), label);
  const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (!b) throw new Error('Missing button'); b.click(); })()`);
  // Read our isolated project's manifest outside the renderer. Polling listProjects
  // clones all records through IPC and would itself distort responsiveness/heap.
  const jsonCache = new Map();
  const readCachedJson = async (path, fallback) => {
    let fileStat;
    try { fileStat = await stat(path); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    const stamp = `${fileStat.mtimeMs}:${fileStat.size}`;
    const cached = jsonCache.get(path);
    if (!cached || cached.stamp !== stamp) {
      const value = JSON.parse(await readFile(path, 'utf8'));
      jsonCache.set(path, { stamp, value });
      return value;
    }
    return cached.value;
  };
  const stats = async () => {
    const [projectId] = await readdir(join(profile, 'projects'));
    const dir = join(profile, 'projects', projectId);
    const original = await readCachedJson(join(dir, 'project.json'), {});
    const state = await readCachedJson(join(dir, 'project-state.json'), {});
    const p = { ...original, ...state }; const records = original.records;
    return { count: records.length, dates: [...new Set(records.map(r => r.serviceDate))].sort(), mode: p.analysisMode, config: p.analysisConfig, routeConfig: p.routeAnalysisConfig, inferred: records.filter(r => r.inferredDestinationStationId).length, observed: records.filter(r => r.destinationStationId).length, od: p.lastODResult?.totalBoardings, route: p.lastRouteResult?.totalBoardings };
  };
  await send('Runtime.enable'); await send('Page.enable');
  await wait('Boolean(window.transitDesktop && document.querySelector(".hero"))', 'home');
  assert.equal(await evaluate('window.transitDesktop.listProjects().then(p=>p.length)'), 0);
  await evaluate(`window.__lag={max:0,count:0,over100:0,samples:[]}; let previous=performance.now(); setInterval(()=>{const now=performance.now(), lag=now-previous-50; window.__lag.max=Math.max(window.__lag.max,lag);window.__lag.count++;window.__lag.samples.push(lag);if(lag>100)window.__lag.over100++;previous=now},50);`);
  await click('새 분석 시작');
  async function upload(prefix) {
    await timed(`preview ${prefix}`, async () => {
      const { root: dom } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: dom.nodeId, selector: 'input[type=file]' });
      await send('DOM.setFileInputFiles', { nodeId, files: files(prefix) });
      await wait(`document.querySelectorAll('.file-row').length === ${days} && document.querySelectorAll('.mapping-panel select').length > 0`, `${prefix} previews`);
    });
    const mapping = await evaluate(`[...document.querySelectorAll('.mapping-panel .mapping-row select')].map(e=>({label:e.getAttribute('aria-label'),value:e.value}))`);
    assert.ok(mapping.length >= 4 && mapping.slice(0, 4).every(m => m.value), `${prefix} automatic mappings`);
    if (prefix === 'DWTCD') {
      const byLabel = Object.fromEntries(mapping.map(m => [m.label, m.value]));
      assert.equal(byLabel['날짜 또는 통합 일시'], '필드1');
      assert.equal(byLabel['시간'], '필드15');
      assert.equal(byLabel['승차인원'], '필드25');
      assert.equal(byLabel['승차 정류장 ID'], '필드18');
      assert.equal(byLabel['하차 정류장 ID'], '필드21');
      assert.equal(byLabel['노선'], '필드14');
    }
    result.checks.push({ upload: prefix, files: days, mapping });
  }
  await upload('DWTCD'); await click('다음: 정류장정보 연결');
  await upload('STTN'); await click('다음: 노선별 정류장정보');
  await upload('ROUTESTTN');
  await timed('import and persist', async () => { await click('입력 완료'); await wait('Boolean(document.querySelector("#alighting-preset"))', 'inference settings'); });
  const before = await stats(); assert.equal(before.dates.length, days); assert.ok(before.count > 1000); result.input = before;
  await timed('infer and persist', async () => { await click('이 설정으로 하차 추정 실행'); await wait('Boolean(document.querySelector(".report-gtfs-button"))', 'report'); });
  const after = await stats(); assert.equal(after.count, before.count); assert.equal(after.observed, before.observed); assert.ok(after.inferred > 0); result.inference = after;
  async function view(label, mode) { await timed(label, async () => { const active = await evaluate(`[...document.querySelectorAll('button[role=tab]')].some(b=>b.textContent===${JSON.stringify(label)} && b.getAttribute('aria-selected')==='true')`); if (!active) { await click(label); await wait(`[...document.querySelectorAll('button[role=tab]')].some(b=>b.textContent===${JSON.stringify(label)} && b.getAttribute('aria-selected')==='true')`, mode); } await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); }); }
  await view('요일별 분석', 'weekday');
  await view('OD 흐름', 'od');
  await wait('Boolean(document.querySelector(\'input[aria-label="하차 추정값 사용"]:not(:disabled)\'))', 'toggle');
  await evaluate('document.querySelector(\'input[aria-label="하차 추정값 사용"]\').click()');
  await until(async () => (await stats()).config.alightingMode === 'high-confidence', 'high confidence');
  const high = await stats();
  await evaluate('document.querySelector(\'input[aria-label="하차 추정값 사용"]\').click()');
  await until(async () => (await stats()).config.alightingMode === 'observed', 'observed');
  const observed = await stats(); assert.ok(high.od >= observed.od); result.odModes = { high: high.od, observed: observed.od };
  await view('노선 혼잡도', 'route');
  await timed('route high-confidence toggle', async () => {
    await evaluate('document.querySelector(\'input[aria-label="하차 추정값 사용"]\').click()');
    await until(async () => (await stats()).routeConfig.alightingMode === 'high-confidence', 'route inferred');
  });
  await timed('route expected-flow toggle', async () => {
    await evaluate(`(() => { const s=document.querySelector('select[aria-label="하차 추정 포함 범위"]'); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,'expected-flow'); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(async () => (await stats()).routeConfig.alightingMode === 'expected-flow', 'route expected');
  });
  result.routeExpected = await stats();
  await timed('3D ready', async () => { await click('3D 시각화'); await wait('Boolean(document.querySelector(".three-map-actions button:not(:disabled)"))', '3D'); });
  await click('2D');
  await wait('Boolean(document.querySelector(".route-visual-toggle button[aria-pressed=true]")) && !document.querySelector(".three-map-shell")', '2D restored');
  for (let cycle = 0; cycle < 3; cycle++) { await view('요일별 분석', 'weekday'); await view('OD 흐름', 'od'); await view('노선 혼잡도', 'route'); const raw = await send('Runtime.getHeapUsage'); await send('HeapProfiler.collectGarbage'); result.memory.push({ cycle, raw, afterGC: await send('Runtime.getHeapUsage') }); }
  result.responsiveness = await evaluate('(() => { const samples=[...window.__lag.samples].sort((a,b)=>a-b); return {...window.__lag, p95:samples[Math.max(0,Math.ceil(samples.length*.95)-1)] ?? 0, p99:samples[Math.max(0,Math.ceil(samples.length*.99)-1)] ?? 0, samples:undefined}; })()');
  const persisted = await stats();
  await send('Page.reload'); await wait('Boolean(document.querySelector(".project-open"))', 'reload');
  const restored = await stats(); assert.equal(restored.count, persisted.count); assert.equal(restored.inferred, persisted.inferred); assert.deepEqual(restored.config, persisted.config); assert.deepEqual(restored.routeConfig, persisted.routeConfig); assert.equal(restored.mode, persisted.mode);
  await evaluate('document.querySelector(".project-open").click()'); await wait('Boolean(document.querySelector(".route-visual-toggle"))', 'restored report');
  assert.equal(await evaluate('document.querySelectorAll(".error-box").length'), 0, 'No visible operation errors');
  assert.equal(result.errors.length, 0); result.passed = true;
} catch (e) { result.passed = false; result.failure = e.message; console.error(e.message); process.exitCode = 1; }
finally { socket?.close(); child.kill(); result.finishedAt = new Date().toISOString(); await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(`UI artifacts: ${root}`); }
