import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import JSZip from 'jszip';
import { buildRoutePathIndex } from '../core/route-master';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import { assessShapeQuality, type ShapeQualityReport } from '../core/synthetic-gtfs/shape-quality';
import type { SyntheticGtfsBuildResult } from '../core/synthetic-gtfs/types';
import { createScenarioDelta, compareJourneys, normalizeMotisJourney, type JourneyComparison } from '../core/transit-comparison';
import { sampleDepartureTimes, summarizeJourneyWindow, type BatchSummary } from '../core/transit-batch';
import { buildMotisPlanPath, defaultMotisDepartureDateTime } from '../core/motis';
import ScenarioDefinitionEditor from './ScenarioDefinitionEditor';
import type { MotisOsmPbfMetadata, MotisRuntimeDefaults, MotisStatus, ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioDelta } from '../shared/types';

interface SyntheticGtfsBuilderProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  onBack: () => void;
  onSaveScenario?: (delta: ScenarioDelta) => Promise<void>;
  onSaveScenarioDefinition?: (definition: ScenarioDefinition) => Promise<void>;
}

const WEEKDAY_OPTIONS = [['월', 0], ['화', 1], ['수', 2], ['목', 3], ['금', 4], ['토', 5], ['일', 6]] as const;

function projectTitle(project: ProjectManifest): string { return project.name.trim() || '교통카드 분석'; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '작업을 완료하지 못했습니다.'; }
function secondsLabel(value: number | null): string { return value === null ? '계산 불가' : `${Math.round(value / 60).toLocaleString('ko-KR')}분`; }

interface ProvenancePreview {
  routeId: string;
  provenance: { sourceType: string; confidence: string; assumptions: string[] };
  directions: Array<{ directionId: string; provenance: { sourceType: string; confidence: string; assumptions: string[] } }>;
}

function readProvenancePreview(result: SyntheticGtfsBuildResult): ProvenancePreview[] {
  try { return (JSON.parse(result.files['tap-provenance.json']) as { routes?: ProvenancePreview[] }).routes ?? []; } catch { return []; }
}

function readShapeQuality(response: unknown, routeId: string, stopCount: number): ShapeQualityReport | undefined {
  const root = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const raw = root.shapeQuality ?? root.tapShapeQuality;
  if (!raw || typeof raw !== 'object') return undefined;
  const metrics = raw as Record<string, unknown>;
  const values = ['routedSegments', 'beelinedSegments', 'routeDistanceMeters', 'stopToStopDistanceMeters'];
  if (values.some((key) => typeof metrics[key] !== 'number')) return undefined;
  return assessShapeQuality({ routeId, stopCount, routedSegments: Number(metrics.routedSegments), beelinedSegments: Number(metrics.beelinedSegments), routeDistanceMeters: Number(metrics.routeDistanceMeters), stopToStopDistanceMeters: Number(metrics.stopToStopDistanceMeters) });
}

function displayDelta(value: number | null): string { return value === null ? '—' : `${value > 0 ? '+' : ''}${Math.round(value / 60)}분`; }
function formatFileSize(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export interface ScenarioExplanationCopy {
  before: string;
  after: string;
  fleetCaution?: string;
}

export function buildScenarioExplanationCopy(routeLabel: string, vehicleCount: string, scenarioStopText: string): ScenarioExplanationCopy {
  const normalizedVehicleCount = vehicleCount.trim();
  return {
    before: `현재 노선별 정류장정보(${routeLabel})를 바탕으로 만든 기준 운행계획입니다.`,
    after: scenarioStopText.trim()
      ? '사용자가 입력한 정류장 순서를 반영한 개편 운행계획입니다.'
      : '입력란을 비워 현재 노선 정류장 순서를 그대로 사용하는 사용자 시나리오입니다.',
    fleetCaution: normalizedVehicleCount
      ? `운행대수 ${normalizedVehicleCount}대는 사용자 입력 가정이며 실제 차량별 배차·회차는 검증하지 않았습니다.`
      : undefined
  };
}

export interface GenerationInputSnapshot {
  routeId: string;
  routeLabel: string;
  vehicleCount: string;
  firstDeparture: string;
  lastDeparture: string;
  headwayMinutes: string;
  scenarioStopText: string;
  baseStopIds: string[];
  scenarioStopIds: string[];
}

export interface ScenarioResultSummary {
  routeLabel: string;
  vehicleLabel: string;
  operatingWindow: string;
  headwayLabel: string;
  beforeStopCount: number;
  afterStopCount: number;
  fleetCaution?: string;
}

export function buildGenerationInputSnapshot(input: GenerationInputSnapshot): GenerationInputSnapshot {
  return { ...input, baseStopIds: [...input.baseStopIds], scenarioStopIds: [...input.scenarioStopIds] };
}

export function buildScenarioResultSummary(snapshot: GenerationInputSnapshot): ScenarioResultSummary {
  return {
    routeLabel: snapshot.routeLabel,
    vehicleLabel: `${snapshot.vehicleCount.trim() || '미입력'}대`,
    operatingWindow: `${snapshot.firstDeparture}–${snapshot.lastDeparture}`,
    headwayLabel: `${snapshot.headwayMinutes.trim() || '미입력'}분`,
    beforeStopCount: snapshot.baseStopIds.length,
    afterStopCount: snapshot.scenarioStopIds.length,
    fleetCaution: buildScenarioExplanationCopy(snapshot.routeLabel, snapshot.vehicleCount, snapshot.scenarioStopText).fleetCaution
  };
}

export default function SyntheticGtfsBuilder({ project, routeStops, serviceConfigs, onBack, onSaveScenario, onSaveScenarioDefinition }: SyntheticGtfsBuilderProps): JSX.Element {
  const routeOptions = useMemo(() => [...new Map(routeStops.map((stop) => [stop.routeId, { routeId: stop.routeId, routeName: stop.routeName, transportMode: stop.transportMode }])).values()].sort((left, right) => left.routeId.localeCompare(right.routeId, 'en')), [routeStops]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [agencyId, setAgencyId] = useState('tap-agency');
  const [agencyName, setAgencyName] = useState('분석용 대중교통');
  const [serviceDays, setServiceDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [firstDeparture, setFirstDeparture] = useState('06:00');
  const [lastDeparture, setLastDeparture] = useState('23:00');
  const [vehicleCount, setVehicleCount] = useState('8');
  const [headwayMinutes, setHeadwayMinutes] = useState('20');
  const [startDate, setStartDate] = useState('20260101');
  const [endDate, setEndDate] = useState('20261231');
  const [dwellSeconds, setDwellSeconds] = useState('20');
  const [deriveReverseDirection, setDeriveReverseDirection] = useState(true);
  const [scenarioStopText, setScenarioStopText] = useState('');
  const [result, setResult] = useState<SyntheticGtfsBuildResult>();
  const [baseResult, setBaseResult] = useState<SyntheticGtfsBuildResult>();
  const [scenarioDelta, setScenarioDelta] = useState<ScenarioDelta>();
  const [generationInputSnapshot, setGenerationInputSnapshot] = useState<GenerationInputSnapshot>();
  const [error, setError] = useState<string>();
  const [exported, setExported] = useState(false);
  const [motisDefaults, setMotisDefaults] = useState<MotisRuntimeDefaults>();
  const [osmPbfPath, setOsmPbfPath] = useState('');
  const [osmPbfMetadata, setOsmPbfMetadata] = useState<MotisOsmPbfMetadata>();
  const [motisStatus, setMotisStatus] = useState<MotisStatus>({ state: 'stopped' });
  const [motisBusy, setMotisBusy] = useState(false);
  const [journeyComparison, setJourneyComparison] = useState<JourneyComparison>();
  const [shapeQuality, setShapeQuality] = useState<ShapeQualityReport>();
  const [originStopId, setOriginStopId] = useState('');
  const [destinationStopId, setDestinationStopId] = useState('');
  const [departureDateTime, setDepartureDateTime] = useState(defaultMotisDepartureDateTime);
  const [batchStartTime, setBatchStartTime] = useState('06:00');
  const [batchEndTime, setBatchEndTime] = useState('09:00');
  const [batchInterval, setBatchInterval] = useState('5');
  const [batchProgress, setBatchProgress] = useState<string>();
  const [batchSummary, setBatchSummary] = useState<BatchSummary>();
  const activeRouteId = selectedRouteId || routeOptions[0]?.routeId || '';
  const basePath = useMemo(() => buildRoutePathIndex(routeStops).paths.filter((path) => path.routeId === activeRouteId).sort((left, right) => (left.serviceDate ?? '').localeCompare(right.serviceDate ?? ''))[0], [activeRouteId, routeStops]);
  const baseStopIds = useMemo(() => basePath?.stops.map((stop) => stop.stationId) ?? [], [basePath]);
  const availableStops = useMemo(() => [...new Map(routeStops.map((stop) => [stop.stationId, stop])).values()].sort((left, right) => left.stationId.localeCompare(right.stationId, 'en')), [routeStops]);
  const scenarioStopIds = useMemo(() => (scenarioStopText.trim() ? scenarioStopText.split(',').map((value) => value.trim()).filter(Boolean) : baseStopIds), [baseStopIds, scenarioStopText]);
  const activeRoute = routeOptions.find((route) => route.routeId === activeRouteId);
  const activeRouteLabel = activeRoute ? `${activeRoute.routeName} · ${activeRoute.routeId}` : activeRouteId;
  const explanationCopy = buildScenarioExplanationCopy(activeRouteLabel, vehicleCount, scenarioStopText);
  const resultSummary = generationInputSnapshot ? buildScenarioResultSummary(generationInputSnapshot) : undefined;

  useEffect(() => {
    if (!window.transitDesktop) return;
    void window.transitDesktop.getMotisDefaults().then(setMotisDefaults).catch((defaultsError) => {
      setError(`MOTIS 기본 설정을 불러오지 못했습니다: ${errorMessage(defaultsError)}`);
    });
  }, []);

  function toggleServiceDay(day: number): void { setServiceDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((left, right) => left - right)); }

  function draftOptions(): Parameters<typeof buildSyntheticGtfsDraft>[2] {
    return { agencyId, agencyName, routeId: activeRouteId, serviceDays, firstDeparture, lastDeparture, vehicleCount: Number(vehicleCount), headwayMinutes: Number(headwayMinutes), startDate, endDate, sourceName: project.routeStopMasterSource ?? '프로젝트 노선정류장정보', deriveReverseDirection, dwellSeconds: Number(dwellSeconds), travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS };
  }

  function routeStopsForScenario(ids: string[]): RouteStopMasterRecord[] {
    const recordsById = new Map(routeStops.map((stop) => [stop.stationId, stop]));
    const selectedRoute = routeOptions.find((route) => route.routeId === activeRouteId);
    return ids.map((stationId, index) => {
      const source = recordsById.get(stationId);
      if (!source) throw new Error(`시나리오 정류장 ID를 자료에서 찾을 수 없습니다: ${stationId}`);
      return { ...source, routeId: activeRouteId, routeName: selectedRoute?.routeName ?? source.routeName, stationSequence: index + 1, serviceDate: undefined };
    });
  }

  function generate(): void {
    setError(undefined); setExported(false); setJourneyComparison(undefined); setShapeQuality(undefined); setBatchSummary(undefined);
    try {
      const options = draftOptions();
      const base = buildSyntheticGtfsDraft(routeStops, serviceConfigs, options);
      const ids = scenarioStopIds.length ? scenarioStopIds : baseStopIds;
      if (ids.length < 2) throw new Error('Before/After 경로는 최소 2개 정류장이 필요합니다.');
      const scenario = ids.join(',') === baseStopIds.join(',') ? base : buildSyntheticGtfsDraft(routeStopsForScenario(ids), serviceConfigs, options);
      const delta = createScenarioDelta(activeRouteId, baseStopIds, ids, ids.join(',') === baseStopIds.join(',') ? '동일 노선 기준선' : '사용자 노선개편 시나리오');
      const inputSnapshot = buildGenerationInputSnapshot({ routeId: activeRouteId, routeLabel: activeRouteLabel, vehicleCount, firstDeparture, lastDeparture, headwayMinutes, scenarioStopText, baseStopIds, scenarioStopIds: ids });
      setBaseResult(base); setResult(scenario); setScenarioDelta(delta); setGenerationInputSnapshot(inputSnapshot); setOriginStopId((current) => current || ids[0]); setDestinationStopId((current) => current || ids[ids.length - 1]);
      if (onSaveScenario) void onSaveScenario(delta).catch((saveError) => setError(`시나리오 저장 실패: ${errorMessage(saveError)}`));
    } catch (generationError) { setResult(undefined); setBaseResult(undefined); setScenarioDelta(undefined); setGenerationInputSnapshot(undefined); setError(errorMessage(generationError)); }
  }

  async function exportZip(): Promise<void> {
    if (!result || !result.validation.isValid) return;
    setError(undefined); setExported(false);
    try {
      if (window.transitDesktop) { setExported(await window.transitDesktop.exportSyntheticGtfs({ fileName: `${projectTitle(project)}-synthetic-gtfs.zip`, files: result.files })); return; }
      const zip = new JSZip(); Object.entries(result.files).forEach(([name, content]) => zip.file(name, content)); const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${projectTitle(project)}-synthetic-gtfs.zip`; anchor.click(); URL.revokeObjectURL(anchor.href); setExported(true);
    } catch (exportError) { setError(errorMessage(exportError)); }
  }

  async function prepareAndStart(files: SyntheticGtfsBuildResult['files']): Promise<void> {
    if (!window.transitDesktop) throw new Error('MOTIS sidecar는 Electron 앱에서만 실행할 수 있습니다.');
    if (!osmPbfPath.trim()) throw new Error('먼저 OSM PBF 파일을 선택하거나 경로를 입력하세요.');
    setMotisStatus({ state: 'starting', message: 'Synthetic GTFS를 MOTIS에 import하고 서버를 시작하는 중입니다.' });
    const prepared = await window.transitDesktop.prepareMotis({ osmPbfPath, files });
    setMotisStatus({ state: 'starting', message: prepared.message });
    const nextStatus = await window.transitDesktop.startMotis();
    setMotisStatus(nextStatus);
    if (nextStatus.state !== 'ready') throw new Error(nextStatus.message ?? 'MOTIS가 준비되지 않았습니다.');
  }

  async function openOsmDownloadPage(): Promise<void> {
    try { await window.transitDesktop?.openMotisOsmDownload(); } catch (openError) { setError(errorMessage(openError)); }
  }

  async function selectOsmPbf(): Promise<void> {
    try {
      const metadata = await window.transitDesktop?.selectMotisOsmPbf();
      if (metadata) { setOsmPbfPath(metadata.path); setOsmPbfMetadata(metadata); setError(undefined); }
    } catch (selectError) { setOsmPbfMetadata(undefined); setError(errorMessage(selectError)); }
  }

  async function inspectSelectedOsmPbf(): Promise<void> {
    if (!osmPbfPath.trim()) { setError('먼저 OSM PBF 파일을 선택하거나 경로를 입력하세요.'); return; }
    try { const metadata = await window.transitDesktop?.inspectMotisOsmPbf(osmPbfPath); if (metadata) { setOsmPbfMetadata(metadata); setError(undefined); } }
    catch (inspectError) { setOsmPbfMetadata(undefined); setError(errorMessage(inspectError)); }
  }

  async function requestJourney(): Promise<ReturnType<typeof normalizeMotisJourney>> {
    if (!window.transitDesktop) throw new Error('MOTIS sidecar는 Electron 앱에서만 실행할 수 있습니다.');
    if (!originStopId || !destinationStopId) throw new Error('출발·도착 정류장 ID를 입력하세요.');
    const raw = await window.transitDesktop.requestMotis(buildMotisPlanPath(originStopId, destinationStopId, departureDateTime));
    const normalized = normalizeMotisJourney(raw, `${departureDateTime}:00+09:00`);
    setShapeQuality(readShapeQuality(raw, activeRouteId, scenarioStopIds.length));
    return normalized;
  }

  async function runBeforeAfter(): Promise<void> {
    if (!result || !baseResult) return;
    setError(undefined); setMotisBusy(true); setJourneyComparison(undefined); setBatchSummary(undefined);
    try {
      await prepareAndStart(baseResult.files); const before = await requestJourney(); await window.transitDesktop?.stopMotis();
      await prepareAndStart(result.files); const after = await requestJourney(); const comparison = compareJourneys(before, after); setJourneyComparison(comparison);
    } catch (motisError) { setMotisStatus({ state: 'failed', message: errorMessage(motisError) }); setError(errorMessage(motisError)); }
    finally { setMotisBusy(false); }
  }

  async function runBatch(): Promise<void> {
    if (!result || !baseResult) return;
    const times = sampleDepartureTimes({ startTime: batchStartTime, endTime: batchEndTime, intervalMinutes: Number(batchInterval) });
    if (!times.length) { setError('시간창 또는 간격이 유효하지 않습니다.'); return; }
    setError(undefined); setMotisBusy(true); setBatchSummary(undefined); setBatchProgress(`0/${times.length * 2}개 질의`);
    try {
      await prepareAndStart(baseResult.files); const beforeJourneys = [] as ReturnType<typeof normalizeMotisJourney>[];
      for (let index = 0; index < times.length; index += 1) { const raw = await window.transitDesktop!.requestMotis(buildMotisPlanPath(originStopId, destinationStopId, departureDateTime, times[index])); beforeJourneys.push(normalizeMotisJourney(raw, `${departureDateTime.slice(0, 10)}T${times[index]}:00+09:00`)); setBatchProgress(`${index + 1}/${times.length * 2}개 질의`); }
      await window.transitDesktop?.stopMotis(); await prepareAndStart(result.files); const comparisons: JourneyComparison[] = [];
      for (let index = 0; index < times.length; index += 1) { const raw = await window.transitDesktop!.requestMotis(buildMotisPlanPath(originStopId, destinationStopId, departureDateTime, times[index])); comparisons.push(compareJourneys(beforeJourneys[index], normalizeMotisJourney(raw, `${departureDateTime.slice(0, 10)}T${times[index]}:00+09:00`))); setBatchProgress(`${times.length + index + 1}/${times.length * 2}개 질의`); }
      setBatchSummary(summarizeJourneyWindow(comparisons));
    } catch (batchError) { setMotisStatus({ state: 'failed', message: errorMessage(batchError) }); setError(errorMessage(batchError)); }
    finally { setMotisBusy(false); setBatchProgress(undefined); }
  }

  async function stopMotis(): Promise<void> { try { const status = await window.transitDesktop?.stopMotis(); if (status) setMotisStatus(status); } catch (stopError) { setError(errorMessage(stopError)); } }

  if (!routeOptions.length) return <main className="workspace"><div className="page-header"><div><button className="back-button" onClick={onBack}>← 분석 결과로 돌아가기</button><p className="eyebrow">Synthetic GTFS</p><h1>분석용 GTFS 만들기</h1></div></div><section className="panel synthetic-empty"><strong>노선별 정류장정보가 없습니다.</strong><span>먼저 새 분석 가져오기에서 노선별 정류장정보를 연결하면 Synthetic GTFS를 만들 수 있습니다.</span></section></main>;

  return <main className="workspace synthetic-workspace">
    <div className="page-header synthetic-page-header"><div><button className="back-button" onClick={onBack}>← 분석 결과로 돌아가기</button><p className="eyebrow">Synthetic GTFS · MOTIS Scenario Lab</p><h1>분석용 GTFS와 노선개편 실증</h1><p>기준 노선과 Scenario Delta를 각각 MOTIS에 import해 같은 OD·출발시각의 Before/After 여정을 비교합니다.</p></div></div>
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    {onSaveScenarioDefinition && <ScenarioDefinitionEditor project={project} routeStops={routeStops} serviceConfigs={serviceConfigs} onSaveScenarioDefinition={onSaveScenarioDefinition} />}
    <div className="synthetic-builder-grid">
      <section className="panel synthetic-input-panel">
        <div className="step-intro"><strong>1. 기준·시나리오 입력</strong><span>모든 가정은 Synthetic provenance에 기록됩니다.</span></div>
        <div className="synthetic-form-grid">
          <label className="field"><span>분석 노선</span><select aria-label="분석 노선" value={activeRouteId} onChange={(event) => { setSelectedRouteId(event.target.value); setScenarioStopText(''); }}>{routeOptions.map((route) => <option key={route.routeId} value={route.routeId}>{route.routeName} · {route.routeId} · {route.transportMode}</option>)}</select></label>
          <label className="field"><span>운행대수</span><input aria-label="운행대수" type="number" min="1" step="1" value={vehicleCount} onChange={(event) => setVehicleCount(event.target.value)} /></label>
          <label className="field"><span>첫차</span><input aria-label="첫차" type="time" value={firstDeparture} onChange={(event) => setFirstDeparture(event.target.value)} /></label>
          <label className="field"><span>막차</span><input aria-label="막차" type="time" value={lastDeparture} onChange={(event) => setLastDeparture(event.target.value)} /></label>
          <label className="field"><span>배차간격(분)</span><input aria-label="배차간격" type="number" min="1" step="1" value={headwayMinutes} onChange={(event) => setHeadwayMinutes(event.target.value)} /></label>
        </div>
        <label className="field"><span>After 시나리오 정류장 ID(쉼표 구분)</span><input aria-label="After 시나리오 정류장 ID" placeholder={baseStopIds.join(',')} value={scenarioStopText} onChange={(event) => setScenarioStopText(event.target.value)} /><small>예: A,B,X,Y,E. 비워 두면 기준 경로를 그대로 사용합니다.</small></label>
        <details className="synthetic-advanced-settings"><summary>고급 설정</summary><div className="synthetic-form-grid"><label className="field"><span>기관 ID</span><input aria-label="기관 ID" value={agencyId} onChange={(event) => setAgencyId(event.target.value)} /></label><label className="field"><span>기관명</span><input aria-label="기관명" value={agencyName} onChange={(event) => setAgencyName(event.target.value)} /></label><label className="field"><span>서비스 시작일</span><input aria-label="서비스 시작일" inputMode="numeric" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="field"><span>서비스 종료일</span><input aria-label="서비스 종료일" inputMode="numeric" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label className="field"><span>정류장 정차시간(초)</span><input aria-label="정류장 정차시간" type="number" min="0" step="1" value={dwellSeconds} onChange={(event) => setDwellSeconds(event.target.value)} /></label></div><div className="synthetic-day-field"><strong>운행 요일</strong><div className="synthetic-day-options">{WEEKDAY_OPTIONS.map(([label, value]) => <label key={value}><input type="checkbox" checked={serviceDays.includes(value)} onChange={() => toggleServiceDay(value)} /><span>{label}</span></label>)}</div></div><label className="synthetic-check"><input type="checkbox" checked={deriveReverseDirection} onChange={(event) => setDeriveReverseDirection(event.target.checked)} /><span><strong>원본 방향이 없으면 역방향을 파생</strong><small>파생 방향은 낮은 신뢰도로 표시됩니다.</small></span></label><div className="synthetic-model-note"><strong>기본 시간 모델</strong><span>정류장 좌표 간 직선거리와 도로유형 미상 기준속도 15km/h를 사용합니다. 실제 OSM BUS shape와 교통시간은 MOTIS 실증 결과로 별도 확인합니다.</span></div></details>
        <div className="synthetic-explanation-card" role="note">
          <div className="synthetic-explanation-heading"><strong>Before / After를 이렇게 읽습니다</strong><span>두 결과는 같은 노선을 무조건 비교하는 것이 아니라, 현재 노선과 사용자가 만든 시나리오를 비교합니다.</span></div>
          <div className="synthetic-explanation-grid">
            <div><small>Before · 현재 노선</small><strong>기준 운행계획</strong><span>{explanationCopy.before}</span></div>
            <div><small>After · 사용자 시나리오</small><strong>개편 운행계획</strong><span>{explanationCopy.after}</span></div>
          </div>
          <p>정류장 순서·정류장 수·추정 운행시간·같은 OD와 출발시각의 여정 결과가 어떻게 달라지는지 확인합니다.</p>
        </div>
        <button className="primary-button full" onClick={generate}>Before/After GTFS 생성 <span>→</span></button>
      </section>
      <section className="panel synthetic-result-panel">
        <div className="step-intro"><strong>2. 생성 결과·출처 확인</strong><span>기준과 After 패키지의 차이를 저장하기 전에 검수하세요.</span></div>
        {!result ? <div className="synthetic-result-empty"><span className="empty-icon">↗</span><strong>아직 생성된 결과가 없습니다</strong><span>왼쪽 입력을 확인하고 생성 버튼을 눌러 주세요.</span></div> : <>
          {resultSummary && <div className="synthetic-input-summary">
            <div><small>분석 노선</small><strong>{resultSummary.routeLabel}</strong></div>
            <div><small>운행대수</small><strong>{resultSummary.vehicleLabel}</strong></div>
            <div><small>운행 시간대</small><strong>{resultSummary.operatingWindow}</strong></div>
            <div><small>배차간격</small><strong>{resultSummary.headwayLabel}</strong></div>
            <div><small>Before 정류장</small><strong>{resultSummary.beforeStopCount}개</strong><span>현재 노선</span></div>
            <div><small>After 정류장</small><strong>{resultSummary.afterStopCount}개</strong><span>사용자 시나리오</span></div>
          </div>}
          {scenarioDelta && <div className="synthetic-scenario-delta"><strong>Scenario Delta · {scenarioDelta.label}</strong><span>추가: {scenarioDelta.addedStopIds.join(', ') || '없음'}</span><span>제거: {scenarioDelta.removedStopIds.join(', ') || '없음'}</span><span>유지: {scenarioDelta.baseStopIds.filter((stopId) => scenarioDelta.scenarioStopIds.includes(stopId)).join(', ') || '없음'}</span><span>Before · 현재 노선: {scenarioDelta.baseStopIds.join(' → ')}</span><span>After · 사용자 시나리오: {scenarioDelta.scenarioStopIds.join(' → ')}</span></div>}
          <div className="synthetic-result-guide">
            <strong>결과 읽는 법</strong>
            <span><b>Trip 수</b>는 입력한 운행 시간대와 배차간격으로 생성된 추정 운행 횟수입니다. 실제 운행 실적이 아닙니다.</span>
            <span><b>추정 필드</b>는 공식 시간표·도로유형 등 원본에 없는 값을 모델로 채운 항목 수입니다.</span>
            <span><b>Before / After 여정</b>은 같은 OD와 출발시각에서 현재 노선과 사용자 시나리오를 비교하며, 델타가 음수면 After가 더 짧다는 뜻입니다.</span>
          </div>
          <div className="synthetic-summary-grid"><div><small>생성 노선</small><strong>{result.summary.routeCount.toLocaleString('ko-KR')}개</strong></div><div><small>After 정류장</small><strong>{result.summary.stopCount.toLocaleString('ko-KR')}개</strong></div><div><small>추정 Trip</small><strong>{result.summary.tripCount.toLocaleString('ko-KR')}개</strong></div><div><small>추정 필드</small><strong>{result.summary.estimatedFieldCount.toLocaleString('ko-KR')}개</strong></div></div>
          <div className="synthetic-caution-list">
            <strong>주의사항</strong>
            <span>공식 시간표가 없거나 BUS shape가 없는 값은 추정이며 실제 운행 사실을 보장하지 않습니다.</span>
            <span>OSM routing 결과는 선택한 지역 PBF와 MOTIS 설정에 따라 달라질 수 있습니다.</span>
            {resultSummary?.fleetCaution && <span>{resultSummary.fleetCaution}</span>}
          </div>
          <details className="synthetic-technical-details">
            <summary>기술 상세 펼치기 · 파일·출처·원시 진단</summary>
            <div className="synthetic-technical-content">
              <div className="synthetic-file-list"><strong>After 생성 파일 {Object.keys(result.files).length}개</strong>{Object.keys(result.files).map((name) => <span key={name}>✓ {name}</span>)}</div>
              {readProvenancePreview(result).map((route) => <div className="synthetic-provenance-list" key={route.routeId}><strong>출처·가정 미리보기 · {route.routeId}</strong><span>노선 출처: {route.provenance.sourceType} · 신뢰도: {route.provenance.confidence}</span>{route.provenance.assumptions.map((assumption) => <span key={assumption}>• {assumption}</span>)}{route.directions.map((direction) => <span key={direction.directionId}>방향 {direction.directionId}: {direction.provenance.sourceType} · {direction.provenance.confidence} · {direction.provenance.assumptions.join(' · ')}</span>)}</div>)}
              {result.validation.warnings.length > 0 && <div className="synthetic-warning-list"><strong>검수 경고 {result.validation.warnings.length}건</strong>{result.validation.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
              <div className="synthetic-raw-diagnostics"><strong>원시 진단 · tap-validation.json</strong><pre>{result.files['tap-validation.json']}</pre></div>
            </div>
          </details>
          <button className="secondary-button full" onClick={() => void exportZip()} disabled={!result.validation.isValid}>After Synthetic GTFS ZIP 저장</button>
          {exported && <div className="success-box" role="status">✓ ZIP 파일을 저장했습니다. 아래 MOTIS 실증 단계로 진행하세요.</div>}
        </>}
      </section>
    </div>

    {result && <section className="panel synthetic-motis-panel">
      <div className="step-intro"><strong>3. MOTIS 로컬 sidecar</strong><span>공식 실행 흐름에 맞춰 OSM PBF와 두 GTFS 패키지를 순서대로 import합니다.</span></div>
      <div className="synthetic-form-grid">
        <label className="field"><span>지역 OSM PBF</span><div className="synthetic-path-picker"><input value={osmPbfPath} onChange={(event) => { setOsmPbfPath(event.target.value); setOsmPbfMetadata(undefined); }} placeholder="Geofabrik PBF 파일 경로" /><button type="button" className="secondary-button" onClick={() => void selectOsmPbf()}>파일 선택</button></div><small>Geofabrik에서 별도로 받은 `.osm.pbf` 파일을 선택하세요.</small></label>
      </div>
      <div className="motis-managed-status" role="note">앱 내장 MOTIS · 로컬 데이터 자동 관리 · 타일 지도 제외</div>
      <details className="motis-diagnostics">
        <summary>고급 진단</summary>
        <div className="synthetic-form-grid">
          <label className="field"><span>내장 MOTIS 실행 파일</span><input value={motisDefaults?.executablePath ?? '불러오는 중…'} readOnly /></label>
          <label className="field"><span>관리 데이터 디렉터리</span><input value={motisDefaults?.dataDirectory ?? '불러오는 중…'} readOnly /></label>
          <label className="field"><span>로컬 포트</span><input value={motisDefaults?.port ?? '불러오는 중…'} readOnly /></label>
        </div>
      </details>
      <div className="synthetic-osm-actions"><button type="button" className="secondary-button" onClick={() => void openOsmDownloadPage()}>Geofabrik 다운로드 페이지 열기 ↗</button><button type="button" className="secondary-button" onClick={() => void inspectSelectedOsmPbf()}>PBF 파일 검증</button></div>
      {osmPbfMetadata && <div className="synthetic-osm-metadata" role="status"><strong>OSM PBF 확인 완료</strong><span>{osmPbfMetadata.fileName} · {formatFileSize(osmPbfMetadata.sizeBytes)}</span><small>SHA-256: {osmPbfMetadata.sha256}</small></div>}
      <small>대한민국 전체 PBF도 앱 내장 MOTIS가 사용됩니다. Windows 호환성을 위한 TBB worker 제한과 지도 타일 제외는 앱이 자동으로 적용합니다.</small>
      <div className={`motis-status motis-status-${motisStatus.state}`} role="status"><strong>MOTIS 상태: {motisStatus.state}</strong><span>{motisStatus.message ?? '아직 실행하지 않았습니다.'}</span></div>
      <div className="synthetic-action-row"><button className="secondary-button" disabled={motisBusy} onClick={() => void runBeforeAfter()}>MOTIS 준비·실행 + Before/After OD</button><button className="secondary-button" disabled={motisBusy} onClick={() => void stopMotis()}>MOTIS 중지</button></div>
      <div className="synthetic-form-grid synthetic-od-grid">
        <label className="field"><span>출발 정류장 ID</span><input list="synthetic-stop-options" value={originStopId} onChange={(event) => setOriginStopId(event.target.value)} /></label>
        <label className="field"><span>도착 정류장 ID</span><input list="synthetic-stop-options" value={destinationStopId} onChange={(event) => setDestinationStopId(event.target.value)} /></label>
        <label className="field"><span>출발 일시(KST)</span><input type="datetime-local" value={departureDateTime} onChange={(event) => setDepartureDateTime(event.target.value)} /></label>
        <datalist id="synthetic-stop-options">{availableStops.map((stop) => <option key={stop.stationId} value={stop.stationId}>{stop.stationName}</option>)}</datalist>
      </div>
      {journeyComparison && <div className="synthetic-comparison"><strong>Before / After 여정 비교</strong><div className="synthetic-comparison-grid"><div><small>총 소요시간</small><strong>{secondsLabel(journeyComparison.before.totalSeconds)} → {secondsLabel(journeyComparison.after.totalSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.totalSeconds)}</span></div><div><small>차량 탑승시간</small><strong>{secondsLabel(journeyComparison.before.inVehicleSeconds)} → {secondsLabel(journeyComparison.after.inVehicleSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.inVehicleSeconds)}</span></div><div><small>초기 대기</small><strong>{secondsLabel(journeyComparison.before.initialWaitSeconds)} → {secondsLabel(journeyComparison.after.initialWaitSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.initialWaitSeconds)}</span></div><div><small>환승 대기·보행</small><strong>{secondsLabel(journeyComparison.before.transferWaitSeconds + journeyComparison.before.transferWalkSeconds)} → {secondsLabel(journeyComparison.after.transferWaitSeconds + journeyComparison.after.transferWalkSeconds)}</strong><span>델타 {displayDelta((journeyComparison.delta.transferWaitSeconds ?? 0) + (journeyComparison.delta.transferWalkSeconds ?? 0))}</span></div><div><small>접근·귀가 보행</small><strong>{secondsLabel(journeyComparison.before.accessWalkSeconds + journeyComparison.before.egressWalkSeconds)} → {secondsLabel(journeyComparison.after.accessWalkSeconds + journeyComparison.after.egressWalkSeconds)}</strong><span>델타 {displayDelta((journeyComparison.delta.accessWalkSeconds ?? 0) + (journeyComparison.delta.egressWalkSeconds ?? 0))}</span></div><div><small>환승 횟수</small><strong>{journeyComparison.before.transferCount}회 → {journeyComparison.after.transferCount}회</strong><span>델타 {journeyComparison.delta.transferCount === null ? '—' : `${journeyComparison.delta.transferCount > 0 ? '+' : ''}${journeyComparison.delta.transferCount}회`}</span></div></div>{journeyComparison.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
      <div className="synthetic-shape-quality"><strong>BUS shape 품질</strong><span>{shapeQuality ? `beeline ${(shapeQuality.beelineRate * 100).toFixed(1)}% · 우회비율 ${shapeQuality.detourRatio.toFixed(2)}` : 'MOTIS 응답에 원시 shape 품질 지표가 포함될 때 표시합니다.'}</span>{shapeQuality?.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>
    </section>}

    {result && <section className="panel synthetic-motis-panel">
      <div className="step-intro"><strong>4. 시간창 반복·스케일 실증</strong><span>동일 OD를 여러 출발시각에 반복해 평균·중앙값·P90을 계산합니다. Before/After 각 패키지를 한 번씩 import합니다.</span></div>
      <div className="synthetic-form-grid synthetic-od-grid"><label className="field"><span>시작 시각</span><input type="time" value={batchStartTime} onChange={(event) => setBatchStartTime(event.target.value)} /></label><label className="field"><span>종료 시각</span><input type="time" value={batchEndTime} onChange={(event) => setBatchEndTime(event.target.value)} /></label><label className="field"><span>간격(분)</span><input type="number" min="1" value={batchInterval} onChange={(event) => setBatchInterval(event.target.value)} /></label></div>
      <button className="secondary-button" disabled={motisBusy} onClick={() => void runBatch()}>시간창 배치 실행</button>{batchProgress && <div className="motis-status motis-status-starting">{batchProgress}</div>}
      {batchSummary && <div className="synthetic-comparison"><strong>배치 요약 · {batchSummary.sampleCount}개 시점</strong><div className="synthetic-comparison-grid"><div><small>평균</small><strong>{secondsLabel(batchSummary.meanTotalSecondsBefore)} → {secondsLabel(batchSummary.meanTotalSecondsAfter)}</strong></div><div><small>중앙값</small><strong>{secondsLabel(batchSummary.medianTotalSecondsBefore)} → {secondsLabel(batchSummary.medianTotalSecondsAfter)}</strong></div><div><small>P90</small><strong>{secondsLabel(batchSummary.p90TotalSecondsBefore)} → {secondsLabel(batchSummary.p90TotalSecondsAfter)}</strong></div><div><small>여정 발견</small><strong>{batchSummary.foundBefore}/{batchSummary.sampleCount} → {batchSummary.foundAfter}/{batchSummary.sampleCount}</strong></div></div>{batchSummary.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
    </section>}
  </main>;
}
