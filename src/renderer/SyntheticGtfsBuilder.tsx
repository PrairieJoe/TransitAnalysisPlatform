import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import JSZip from 'jszip';
import { buildRoutePathIndex } from '../core/route-master';
import { selectRepresentativeRouteStopIds } from '../core/scenario-editor';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import { assessShapeQuality, type ShapeQualityReport } from '../core/synthetic-gtfs/shape-quality';
import type { SyntheticGtfsBuildResult } from '../core/synthetic-gtfs/types';
import { createScenarioDelta, compareJourneys, normalizeMotisJourney, type JourneyComparison } from '../core/transit-comparison';
import { sampleDepartureTimes, summarizeJourneyWindow, type BatchSummary } from '../core/transit-batch';
import { buildMotisPlanPath, defaultMotisDepartureDateTime } from '../core/motis';
import SyntheticGenerationStep from './SyntheticGenerationStep';
import SyntheticMotisStep from './SyntheticMotisStep';
import SyntheticBatchStep from './SyntheticBatchStep';
import SyntheticScenarioStep from './SyntheticScenarioStep';
import SyntheticScenarioTools from './SyntheticScenarioTools';
import SyntheticGtfsStepper from './SyntheticGtfsStepper';
import { buildSyntheticWorkflowStatuses, canEnterSyntheticStep, type SyntheticWorkflowStep } from './synthetic-gtfs-workflow';
import type { MotisOsmPbfMetadata, MotisRuntimeDefaults, MotisStatus, ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioDelta, StationMasterRecord } from '../shared/types';

interface SyntheticGtfsBuilderProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  stationMaster?: StationMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  onBack: () => void;
  onSaveScenario?: (delta: ScenarioDelta) => Promise<void>;
  onSaveScenarioDefinition?: (definition: ScenarioDefinition) => Promise<void>;
}

const SYNTHETIC_STEP_ORDER: SyntheticWorkflowStep[] = ['scenario', 'generation', 'motis', 'batch'];

function projectTitle(project: ProjectManifest): string { return project.name.trim() || '교통카드 분석'; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '작업을 완료하지 못했습니다.'; }
function readShapeQuality(response: unknown, routeId: string, stopCount: number): ShapeQualityReport | undefined {
  const root = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const raw = root.shapeQuality ?? root.tapShapeQuality;
  if (!raw || typeof raw !== 'object') return undefined;
  const metrics = raw as Record<string, unknown>;
  const values = ['routedSegments', 'beelinedSegments', 'routeDistanceMeters', 'stopToStopDistanceMeters'];
  if (values.some((key) => typeof metrics[key] !== 'number')) return undefined;
  return assessShapeQuality({ routeId, stopCount, routedSegments: Number(metrics.routedSegments), beelinedSegments: Number(metrics.beelinedSegments), routeDistanceMeters: Number(metrics.routeDistanceMeters), stopToStopDistanceMeters: Number(metrics.stopToStopDistanceMeters) });
}

export interface ScenarioExplanationCopy {
  before: string;
  after: string;
  fleetCaution?: string;
}

export function buildScenarioExplanationCopy(routeLabel: string, vehicleCount: string, scenarioStopText: string): ScenarioExplanationCopy {
  const normalizedVehicleCount = vehicleCount.trim();
  return {
    before: `현행 노선별 정류장정보(${routeLabel})를 바탕으로 만든 기준 운행계획입니다.`,
    after: scenarioStopText.trim()
      ? '개편안 정류장 순서를 반영한 개편 운행계획입니다.'
      : '현행 노선 정류장 순서를 그대로 사용하는 개편안입니다.',
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
  scenarioLabel?: string;
  baseStopIds: string[];
  scenarioStopIds: string[];
  agencyId?: string;
  agencyName?: string;
  startDate?: string;
  endDate?: string;
  dwellSeconds?: string;
  serviceDays?: number[];
  deriveReverseDirection?: boolean;
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

export function hasGenerationInputChanged(snapshot: GenerationInputSnapshot, current: GenerationInputSnapshot): boolean {
  return JSON.stringify(snapshot) !== JSON.stringify(current);
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

export default function SyntheticGtfsBuilder({ project, routeStops, stationMaster = project.stationMaster ?? [], serviceConfigs, onBack, onSaveScenario, onSaveScenarioDefinition }: SyntheticGtfsBuilderProps): JSX.Element {
  const routeOptions = useMemo(() => [...new Map(routeStops.map((stop) => [stop.routeId, { routeId: stop.routeId, routeName: stop.routeName, transportMode: stop.transportMode }])).values()].sort((left, right) => left.routeId.localeCompare(right.routeId, 'en')), [routeStops]);
  const savedScenarioRoute = project.scenarioDefinitions?.flatMap((definition) => definition.routeChanges).find((change) => routeOptions.some((route) => route.routeId === change.routeId));
  const initialRouteId = savedScenarioRoute?.routeId ?? routeOptions[0]?.routeId ?? '';
  const [selectedRouteId, setSelectedRouteId] = useState(initialRouteId);
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
  const [scenarioStopIds, setScenarioStopIds] = useState<string[]>(() => savedScenarioRoute?.scenarioStopIds ?? (initialRouteId ? selectRepresentativeRouteStopIds(routeStops, initialRouteId) : []));
  const [scenarioLabel, setScenarioLabel] = useState(savedScenarioRoute ? project.scenarioDefinitions?.find((definition) => definition.routeChanges.some((change) => change.routeId === savedScenarioRoute.routeId))?.label ?? '' : '');
  const [scenarioDefinitionSaved, setScenarioDefinitionSaved] = useState(Boolean(savedScenarioRoute));
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
  const [activeStep, setActiveStep] = useState<SyntheticWorkflowStep>('scenario');
  const [journeyInputSnapshot, setJourneyInputSnapshot] = useState<string>();
  const [batchInputSnapshot, setBatchInputSnapshot] = useState<string>();
  const activeRouteId = selectedRouteId || routeOptions[0]?.routeId || '';
  const basePath = useMemo(() => buildRoutePathIndex(routeStops).paths.filter((path) => path.routeId === activeRouteId).sort((left, right) => (left.serviceDate ?? '').localeCompare(right.serviceDate ?? ''))[0], [activeRouteId, routeStops]);
  const baseStopIds = useMemo(() => basePath?.stops.map((stop) => stop.stationId) ?? [], [basePath]);
  const availableStops = useMemo(() => [...new Map(routeStops.map((stop) => [stop.stationId, stop])).values()].sort((left, right) => left.stationId.localeCompare(right.stationId, 'en')), [routeStops]);
  const activeRoute = routeOptions.find((route) => route.routeId === activeRouteId);
  const activeRouteLabel = activeRoute ? `${activeRoute.routeName} · ${activeRoute.routeId}` : activeRouteId;
  const scenarioStopText = scenarioStopIds.join(',');
  const explanationCopy = buildScenarioExplanationCopy(activeRouteLabel, vehicleCount, scenarioStopText);
  const resultSummary = generationInputSnapshot ? buildScenarioResultSummary(generationInputSnapshot) : undefined;
  const currentGenerationInput = buildGenerationInputSnapshot({ routeId: activeRouteId, routeLabel: activeRouteLabel, vehicleCount, firstDeparture, lastDeparture, headwayMinutes, scenarioStopText, scenarioLabel, baseStopIds, scenarioStopIds, agencyId, agencyName, startDate, endDate, dwellSeconds, serviceDays, deriveReverseDirection });
  const generationInputKey = JSON.stringify(currentGenerationInput);
  const journeyInputKey = JSON.stringify({ generationInput: generationInputKey, osmPbfPath, originStopId, destinationStopId, departureDateTime });
  const batchInputKey = JSON.stringify({ journeyInput: journeyInputKey, batchStartTime, batchEndTime, batchInterval });
  const generationInputStale = Boolean(result && generationInputSnapshot && hasGenerationInputChanged(generationInputSnapshot, currentGenerationInput));
  const journeyInputStale = Boolean(journeyComparison && journeyInputSnapshot && journeyInputSnapshot !== journeyInputKey);
  const batchInputStale = Boolean(batchSummary && batchInputSnapshot && batchInputSnapshot !== batchInputKey);
  const workflowStatuses = buildSyntheticWorkflowStatuses({
    hasRouteOptions: routeOptions.length > 0,
    hasScenarioDefinition: scenarioDefinitionSaved || Boolean(project.scenarioDefinitions?.length),
    hasGenerationResult: Boolean(result && baseResult),
    generationResultValid: Boolean(result?.validation.isValid && baseResult?.validation.isValid),
    generationInputStale,
    hasJourneyComparison: Boolean(journeyComparison),
    journeyInputStale,
    hasBatchSummary: Boolean(batchSummary),
    batchInputStale
  });
  const activeStepStatus = workflowStatuses[activeStep];
  const activeStepIndex = SYNTHETIC_STEP_ORDER.indexOf(activeStep);

  function selectWorkflowStep(step: SyntheticWorkflowStep): void {
    if (canEnterSyntheticStep(step, workflowStatuses)) setActiveStep(step);
  }

  function moveToAdjacentStep(offset: number): void {
    const nextIndex = activeStepIndex + offset;
    const nextStep = SYNTHETIC_STEP_ORDER[nextIndex];
    if (nextStep && canEnterSyntheticStep(nextStep, workflowStatuses)) setActiveStep(nextStep);
  }

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
    const recordsById = new Map(routeStops.filter((stop) => stop.routeId === activeRouteId).map((stop) => [stop.stationId, stop]));
    const selectedRoute = routeOptions.find((route) => route.routeId === activeRouteId);
    return ids.map((stationId, index) => {
      const source = recordsById.get(stationId);
      if (!source) throw new Error(`시나리오 정류장 ID를 자료에서 찾을 수 없습니다: ${stationId}`);
      return { ...source, routeId: activeRouteId, routeName: selectedRoute?.routeName ?? source.routeName, stationSequence: index + 1, serviceDate: undefined };
    });
  }

  function clearDownstreamResults(): void {
    setResult(undefined);
    setBaseResult(undefined);
    setScenarioDelta(undefined);
    setGenerationInputSnapshot(undefined);
    setJourneyComparison(undefined);
    setJourneyInputSnapshot(undefined);
    setBatchSummary(undefined);
    setBatchInputSnapshot(undefined);
    setShapeQuality(undefined);
    setExported(false);
    setOriginStopId('');
    setDestinationStopId('');
  }

  function handleScenarioRouteChange(routeId: string): void {
    setSelectedRouteId(routeId);
    setScenarioStopIds(selectRepresentativeRouteStopIds(routeStops, routeId));
    setScenarioLabel('');
    setScenarioDefinitionSaved(false);
    clearDownstreamResults();
  }

  function handleScenarioStopIdsChange(stopIds: string[]): void {
    setScenarioStopIds([...stopIds]);
  }

  function handleScenarioLabelChange(label: string): void {
    setScenarioLabel(label);
  }

  function generate(): void {
    setError(undefined); setExported(false); setJourneyComparison(undefined); setJourneyInputSnapshot(undefined); setShapeQuality(undefined); setBatchSummary(undefined); setBatchInputSnapshot(undefined);
    try {
      const options = draftOptions();
      const base = buildSyntheticGtfsDraft(routeStops, serviceConfigs, options);
      const ids = scenarioStopIds.length ? scenarioStopIds : baseStopIds;
      if (ids.length < 2) throw new Error('Before/After 경로는 최소 2개 정류장이 필요합니다.');
      const scenario = ids.join(',') === baseStopIds.join(',') ? base : buildSyntheticGtfsDraft(routeStopsForScenario(ids), serviceConfigs, options);
      const delta = createScenarioDelta(activeRouteId, baseStopIds, ids, ids.join(',') === baseStopIds.join(',') ? '동일 노선 기준선' : '사용자 노선개편 시나리오');
      const inputSnapshot = buildGenerationInputSnapshot({ routeId: activeRouteId, routeLabel: activeRouteLabel, vehicleCount, firstDeparture, lastDeparture, headwayMinutes, scenarioStopText: ids.join(','), scenarioLabel, baseStopIds, scenarioStopIds: ids, agencyId, agencyName, startDate, endDate, dwellSeconds, serviceDays: [...serviceDays], deriveReverseDirection });
      setBaseResult(base); setResult(scenario); setScenarioDelta(delta); setGenerationInputSnapshot(inputSnapshot); setOriginStopId((current) => current || ids[0]); setDestinationStopId((current) => current || ids[ids.length - 1]);
      if (onSaveScenario) void onSaveScenario(delta).catch((saveError) => setError(`시나리오 저장 실패: ${errorMessage(saveError)}`));
    } catch (generationError) { setResult(undefined); setBaseResult(undefined); setScenarioDelta(undefined); setGenerationInputSnapshot(undefined); setJourneyInputSnapshot(undefined); setBatchInputSnapshot(undefined); setError(errorMessage(generationError)); }
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
    const raw = await window.transitDesktop.requestMotis(buildMotisPlanPath({ kind: 'stop', stopId: originStopId }, { kind: 'stop', stopId: destinationStopId }, departureDateTime));
    const normalized = normalizeMotisJourney(raw, `${departureDateTime}:00+09:00`);
    setShapeQuality(readShapeQuality(raw, activeRouteId, scenarioStopIds.length));
    return normalized;
  }

  async function runBeforeAfter(): Promise<void> {
    if (!result || !baseResult) return;
    setError(undefined); setMotisBusy(true); setJourneyComparison(undefined); setBatchSummary(undefined);
    try {
      await prepareAndStart(baseResult.files); const before = await requestJourney(); await window.transitDesktop?.stopMotis();
      await prepareAndStart(result.files); const after = await requestJourney(); const comparison = compareJourneys(before, after); setJourneyComparison(comparison); setJourneyInputSnapshot(journeyInputKey); setBatchSummary(undefined); setBatchInputSnapshot(undefined);
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
      for (let index = 0; index < times.length; index += 1) { const raw = await window.transitDesktop!.requestMotis(buildMotisPlanPath({ kind: 'stop', stopId: originStopId }, { kind: 'stop', stopId: destinationStopId }, departureDateTime, times[index])); beforeJourneys.push(normalizeMotisJourney(raw, `${departureDateTime.slice(0, 10)}T${times[index]}:00+09:00`)); setBatchProgress(`${index + 1}/${times.length * 2}개 질의`); }
      await window.transitDesktop?.stopMotis(); await prepareAndStart(result.files); const comparisons: JourneyComparison[] = [];
      for (let index = 0; index < times.length; index += 1) { const raw = await window.transitDesktop!.requestMotis(buildMotisPlanPath({ kind: 'stop', stopId: originStopId }, { kind: 'stop', stopId: destinationStopId }, departureDateTime, times[index])); comparisons.push(compareJourneys(beforeJourneys[index], normalizeMotisJourney(raw, `${departureDateTime.slice(0, 10)}T${times[index]}:00+09:00`))); setBatchProgress(`${times.length + index + 1}/${times.length * 2}개 질의`); }
      setBatchSummary(summarizeJourneyWindow(comparisons)); setBatchInputSnapshot(batchInputKey);
    } catch (batchError) { setMotisStatus({ state: 'failed', message: errorMessage(batchError) }); setError(errorMessage(batchError)); }
    finally { setMotisBusy(false); setBatchProgress(undefined); }
  }

  async function stopMotis(): Promise<void> { try { const status = await window.transitDesktop?.stopMotis(); if (status) setMotisStatus(status); } catch (stopError) { setError(errorMessage(stopError)); } }

  if (!routeOptions.length) return <main className="workspace"><div className="page-header"><div><button className="back-button" onClick={onBack}>← 분석 결과로 돌아가기</button><p className="eyebrow">Synthetic GTFS</p><h1>분석용 GTFS 만들기</h1></div></div><section className="panel synthetic-empty"><strong>노선별 정류장정보가 없습니다.</strong><span>먼저 새 분석 가져오기에서 노선별 정류장정보를 연결하면 Synthetic GTFS를 만들 수 있습니다.</span></section></main>;

  return <main className="workspace synthetic-workspace">
    <div className="page-header synthetic-page-header"><div><button className="back-button" onClick={onBack}>← 분석 결과로 돌아가기</button><p className="eyebrow">Synthetic GTFS · MOTIS Scenario Lab</p><h1>분석용 GTFS와 노선개편 실증</h1><p>기준 노선과 Scenario Delta를 각각 MOTIS에 import해 같은 OD·출발시각의 Before/After 여정을 비교합니다.</p></div></div>
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    <div className="synthetic-workflow">
      <SyntheticGtfsStepper activeStep={activeStep} statuses={workflowStatuses} onSelectStep={selectWorkflowStep} />
      <div className="synthetic-step-summary"><strong>{activeStepStatus.label}</strong><span>{activeStepStatus.description}</span></div>

      {activeStep === 'scenario' && (onSaveScenarioDefinition
        ? <SyntheticScenarioStep project={project} routeStops={routeStops} stationMaster={stationMaster} serviceConfigs={serviceConfigs} selectedRouteId={activeRouteId} scenarioStopIds={scenarioStopIds} scenarioLabel={scenarioLabel} onRouteChange={handleScenarioRouteChange} onScenarioStopIdsChange={handleScenarioStopIdsChange} onScenarioLabelChange={handleScenarioLabelChange} onScenarioSaved={(definition) => { setScenarioLabel(definition.label); setScenarioDefinitionSaved(true); }} onSaveScenarioDefinition={onSaveScenarioDefinition} />
        : <div className="synthetic-locked-step"><strong>시나리오 설정을 불러올 수 없습니다.</strong><span>저장 동작을 사용할 수 있는 분석 화면에서 다시 시도하세요.</span></div>)}

      {activeStep === 'generation' && <SyntheticGenerationStep
        routeOptions={routeOptions}
        activeRouteId={activeRouteId}
        activeRouteLabel={activeRouteLabel}
        baseStopIds={baseStopIds}
        scenarioStopIds={scenarioStopIds}
        scenarioStopText={scenarioStopText}
        scenarioLabel={scenarioLabel}
        vehicleCount={vehicleCount}
        firstDeparture={firstDeparture}
        lastDeparture={lastDeparture}
        headwayMinutes={headwayMinutes}
        agencyId={agencyId}
        agencyName={agencyName}
        startDate={startDate}
        endDate={endDate}
        dwellSeconds={dwellSeconds}
        serviceDays={serviceDays}
        deriveReverseDirection={deriveReverseDirection}
        result={result}
        baseResult={baseResult}
        isStale={generationInputStale}
        scenarioDelta={scenarioDelta}
        generationInputSnapshot={generationInputSnapshot}
        resultSummary={resultSummary}
        explanationCopy={explanationCopy}
        exported={exported}
        onRouteChange={handleScenarioRouteChange}
        onVehicleCountChange={setVehicleCount}
        onFirstDepartureChange={setFirstDeparture}
        onLastDepartureChange={setLastDeparture}
        onHeadwayMinutesChange={setHeadwayMinutes}
        onAdvancedChange={(field, value) => {
          if (field === 'agencyId') setAgencyId(value);
          if (field === 'agencyName') setAgencyName(value);
          if (field === 'startDate') setStartDate(value);
          if (field === 'endDate') setEndDate(value);
          if (field === 'dwellSeconds') setDwellSeconds(value);
        }}
        onToggleServiceDay={toggleServiceDay}
        onDeriveReverseDirectionChange={setDeriveReverseDirection}
        onGenerate={generate}
        onExport={exportZip}
      />}

      {activeStep === 'motis' && result && baseResult && <SyntheticMotisStep
        result={result}
        baseResult={baseResult}
        osmPbfPath={osmPbfPath}
        osmPbfMetadata={osmPbfMetadata}
        motisDefaults={motisDefaults}
        motisStatus={motisStatus}
        motisBusy={motisBusy}
        availableStops={availableStops}
        originStopId={originStopId}
        destinationStopId={destinationStopId}
        departureDateTime={departureDateTime}
        journeyComparison={journeyComparison}
        isStale={journeyInputStale}
        shapeQuality={shapeQuality}
        onRunBeforeAfter={runBeforeAfter}
        onStopMotis={stopMotis}
        onSelectOsmPbf={selectOsmPbf}
        onInspectOsmPbf={inspectSelectedOsmPbf}
        onOpenOsmDownloadPage={openOsmDownloadPage}
        onInputChange={(field, value) => {
          if (field === 'osmPbfPath') { setOsmPbfPath(value); setOsmPbfMetadata(undefined); }
          if (field === 'originStopId') setOriginStopId(value);
          if (field === 'destinationStopId') setDestinationStopId(value);
          if (field === 'departureDateTime') setDepartureDateTime(value);
        }}
      />}

      {activeStep === 'batch' && result && baseResult && <SyntheticBatchStep
        result={result}
        baseResult={baseResult}
        comparisonReady={Boolean(journeyComparison && !journeyInputStale)}
        isStale={batchInputStale}
        motisBusy={motisBusy}
        batchStartTime={batchStartTime}
        batchEndTime={batchEndTime}
        batchInterval={batchInterval}
        batchProgress={batchProgress}
        batchSummary={batchSummary}
        onRunBatch={runBatch}
        onInputChange={(field, value) => {
          if (field === 'batchStartTime') setBatchStartTime(value);
          if (field === 'batchEndTime') setBatchEndTime(value);
          if (field === 'batchInterval') setBatchInterval(value);
        }}
      />}

      {(activeStep === 'motis' || activeStep === 'batch') && <SyntheticScenarioTools projectId={project.id} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={project.scenarioDefinitions ?? []} activeStep={activeStep} />}

      <div className="synthetic-step-actions">
        {activeStepIndex > 0 && <button type="button" className="secondary-button" onClick={() => moveToAdjacentStep(-1)}>이전 단계</button>}
        {activeStep === 'scenario' && <button type="button" className="primary-button" onClick={() => moveToAdjacentStep(1)}>GTFS 생성 단계로 <span>→</span></button>}
        {activeStep === 'generation' && <button type="button" className="primary-button" disabled={!workflowStatuses.generation.isComplete} onClick={() => moveToAdjacentStep(1)}>MOTIS 여정 검증으로 <span>→</span></button>}
        {activeStep === 'motis' && <button type="button" className="primary-button" disabled={!workflowStatuses.motis.isComplete} onClick={() => moveToAdjacentStep(1)}>반복 검증으로 <span>→</span></button>}
      </div>
    </div>
  </main>;
}
