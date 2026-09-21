import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { buildRoutePathIndex } from '../core/route-master';
import {
  buildScenarioDefinitionInput,
  createEmptyJourneyQueryDraft,
  parseScenarioStopText,
  scenarioDefinitionToEditorDraft,
  selectRepresentativeRouteStopIds,
  validateScenarioEditorDraft,
  type JourneyEndpointDraft,
  type ScenarioEditorDraft,
  type ScenarioOperationDraft,
  type ScenarioRouteDraft
} from '../core/scenario-editor';
import { createScenarioDefinition } from '../core/scenario-contract';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import ScenarioComparisonPanel from './ScenarioComparisonPanel';
import ScenarioDemandPanel from './ScenarioDemandPanel';
import ScenarioExecutionPanel from './ScenarioExecutionPanel';
import ScenarioJourneyComparison from './ScenarioJourneyComparison';
import type { ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioExecutionManifest, ScenarioJourneyExecutionManifest } from '../shared/types';

export interface ScenarioDefinitionEditorProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs?: RouteServiceConfig[];
  onSaveScenarioDefinition: (definition: ScenarioDefinition) => Promise<void>;
}

type OperationSide = 'beforeOperation' | 'afterOperation';

const DEFAULT_DRAFT_OPERATION: ScenarioOperationDraft = {
  serviceDays: [0, 1, 2, 3, 4],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: '10',
  vehicleCount: '4',
  dwellSeconds: '20',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true
};

const WEEKDAY_OPTIONS = [['월', 0], ['화', 1], ['수', 2], ['목', 3], ['금', 4], ['토', 5], ['일', 6]] as const;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneOperation(operation: ScenarioOperationDraft): ScenarioOperationDraft {
  return { ...operation, serviceDays: [...operation.serviceDays] };
}

function routeOptions(routeStops: RouteStopMasterRecord[]): Array<{ routeId: string; routeName: string; transportMode: string }> {
  return [...new Map(buildRoutePathIndex(routeStops).paths.map((path) => [path.routeId, { routeId: path.routeId, routeName: path.routeName, transportMode: path.transportMode }])).values()]
    .sort((left, right) => left.routeId.localeCompare(right.routeId, 'ko'));
}

function createRouteDraft(routeStops: RouteStopMasterRecord[], route: { routeId: string; routeName: string; transportMode: string }): ScenarioRouteDraft {
  const baseStopIds = selectRepresentativeRouteStopIds(routeStops, route.routeId);
  return {
    routeId: route.routeId,
    routeName: route.routeName,
    transportMode: route.transportMode,
    baseStopIds,
    scenarioStopText: baseStopIds.join(','),
    beforeOperation: cloneOperation(DEFAULT_DRAFT_OPERATION),
    afterOperation: cloneOperation(DEFAULT_DRAFT_OPERATION)
  };
}

function createNewDraft(project: ProjectManifest, routeStops: RouteStopMasterRecord[], options: Array<{ routeId: string; routeName: string; transportMode: string }>): ScenarioEditorDraft {
  const now = new Date().toISOString();
  const firstRoute = options[0];
  return {
    scenarioId: newId(),
    label: '새 노선 개편 시나리오',
    routeChanges: firstRoute ? [createRouteDraft(routeStops, firstRoute)] : [],
    journeyQueries: [createEmptyJourneyQueryDraft()],
    source: {
      ...(project.id ? { projectId: project.id } : {}),
      ...(project.routeStopMasterSource ? { routeMasterSource: project.routeStopMasterSource } : {}),
      assumptions: [],
      warnings: [],
      modelVersions: [DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS.modelVersion]
    },
    createdAt: now,
    updatedAt: now
  };
}

function initialDraft(project: ProjectManifest, routeStops: RouteStopMasterRecord[], options: Array<{ routeId: string; routeName: string; transportMode: string }>): ScenarioEditorDraft {
  const saved = project.scenarioDefinitions?.[0];
  return saved ? scenarioDefinitionToEditorDraft(saved) : createNewDraft(project, routeStops, options);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '시나리오를 저장하지 못했습니다.';
}

export default function ScenarioDefinitionEditor({ project, routeStops, serviceConfigs = [], onSaveScenarioDefinition }: ScenarioDefinitionEditorProps): JSX.Element {
  const options = useMemo(() => routeOptions(routeStops), [routeStops]);
  const [draft, setDraft] = useState(() => initialDraft(project, routeStops, options));
  const [selectedScenarioId, setSelectedScenarioId] = useState(() => project.scenarioDefinitions?.[0]?.scenarioId ?? draft.scenarioId);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [executionManifests, setExecutionManifests] = useState<ScenarioExecutionManifest[]>(() => project.scenarioExecutionManifests ?? []);
  const [journeyManifests, setJourneyManifests] = useState<ScenarioJourneyExecutionManifest[]>(() => project.scenarioJourneyManifests ?? []);

  useEffect(() => {
    if (!project.scenarioDefinitions?.length) return;
    if (project.scenarioDefinitions.some((definition) => definition.scenarioId === selectedScenarioId)) return;
    const first = project.scenarioDefinitions[0];
    setSelectedScenarioId(first.scenarioId);
    setDraft(scenarioDefinitionToEditorDraft(first));
  }, [project.scenarioDefinitions, selectedScenarioId]);

  useEffect(() => {
    setExecutionManifests(project.scenarioExecutionManifests ?? []);
  }, [project.scenarioExecutionManifests]);

  useEffect(() => {
    setJourneyManifests(project.scenarioJourneyManifests ?? []);
  }, [project.scenarioJourneyManifests]);

  function selectSavedScenario(scenarioId: string): void {
    if (!scenarioId) return;
    const definition = project.scenarioDefinitions?.find((candidate) => candidate.scenarioId === scenarioId);
    if (!definition) return;
    setSelectedScenarioId(scenarioId);
    setDraft(scenarioDefinitionToEditorDraft(definition));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function startNewScenario(): void {
    const next = createNewDraft(project, routeStops, options);
    setSelectedScenarioId(next.scenarioId);
    setDraft(next);
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function updateRoute(index: number, patch: Partial<ScenarioRouteDraft>): void {
    setDraft((current) => ({ ...current, routeChanges: current.routeChanges.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route) }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function updateOperation(index: number, side: OperationSide, patch: Partial<ScenarioOperationDraft>): void {
    setDraft((current) => ({
      ...current,
      routeChanges: current.routeChanges.map((route, routeIndex) => routeIndex === index ? { ...route, [side]: { ...route[side], ...patch } } : route)
    }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function toggleOperationDay(index: number, side: OperationSide, day: number): void {
    const operation = draft.routeChanges[index]?.[side];
    if (!operation) return;
    updateOperation(index, side, { serviceDays: operation.serviceDays.includes(day) ? operation.serviceDays.filter((value) => value !== day) : [...operation.serviceDays, day].sort((left, right) => left - right) });
  }

  function addRoute(): void {
    const used = new Set(draft.routeChanges.map((route) => route.routeId));
    const nextRoute = options.find((route) => !used.has(route.routeId));
    if (!nextRoute) return;
    setDraft((current) => ({ ...current, routeChanges: [...current.routeChanges, createRouteDraft(routeStops, nextRoute)] }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function removeRoute(index: number): void {
    setDraft((current) => ({ ...current, routeChanges: current.routeChanges.filter((_, routeIndex) => routeIndex !== index) }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function changeRoute(index: number, routeId: string): void {
    const route = options.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    updateRoute(index, createRouteDraft(routeStops, route));
  }

  function addJourneyQuery(): void {
    setDraft((current) => ({ ...current, journeyQueries: [...current.journeyQueries, createEmptyJourneyQueryDraft()] }));
  }

  function updateJourneyQuery(index: number, patch: Partial<ScenarioEditorDraft['journeyQueries'][number]>): void {
    setDraft((current) => ({ ...current, journeyQueries: current.journeyQueries.map((query, queryIndex) => queryIndex === index ? { ...query, ...patch } : query) }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function removeJourneyQuery(index: number): void {
    setDraft((current) => ({ ...current, journeyQueries: current.journeyQueries.filter((_, queryIndex) => queryIndex !== index) }));
  }

  function replaceJourneyEndpoint(index: number, side: 'origin' | 'destination', endpoint: JourneyEndpointDraft): void {
    setDraft((current) => ({
      ...current,
      journeyQueries: current.journeyQueries.map((query, queryIndex) => queryIndex === index ? { ...query, [side]: endpoint } : query)
    }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function updateJourneyEndpoint(index: number, side: 'origin' | 'destination', patch: Partial<JourneyEndpointDraft>): void {
    setDraft((current) => ({
      ...current,
      journeyQueries: current.journeyQueries.map((query, queryIndex) => queryIndex === index
        ? { ...query, [side]: { ...query[side], ...patch } as JourneyEndpointDraft }
        : query)
    }));
    setValidationErrors([]);
    setSaveMessage(undefined);
  }

  function renderJourneyEndpoint(index: number, side: 'origin' | 'destination', endpoint: JourneyEndpointDraft, label: string): JSX.Element {
    const prefix = side === 'origin' ? '출발' : '도착';
    return <div className="scenario-query-endpoint">
      <label className="field"><span>{label} 유형</span><select aria-label={`${label} 유형 ${index + 1}`} value={endpoint.kind} onChange={(event) => replaceJourneyEndpoint(index, side, event.target.value === 'stop' ? { kind: 'stop', stopId: '' } : { kind: 'coordinate', latitudeText: '', longitudeText: '', label: '' })}><option value="coordinate">지도 좌표</option><option value="stop">정류장 ID</option></select></label>
      {endpoint.kind === 'coordinate'
        ? <>
          <label className="field"><span>{prefix}지 위도</span><input aria-label={`${prefix}지 위도 ${index + 1}`} inputMode="decimal" value={endpoint.latitudeText} onChange={(event) => updateJourneyEndpoint(index, side, { latitudeText: event.target.value })} /></label>
          <label className="field"><span>{prefix}지 경도</span><input aria-label={`${prefix}지 경도 ${index + 1}`} inputMode="decimal" value={endpoint.longitudeText} onChange={(event) => updateJourneyEndpoint(index, side, { longitudeText: event.target.value })} /></label>
          <label className="field"><span>{label} 라벨</span><input aria-label={`${label} 라벨 ${index + 1}`} value={endpoint.label} onChange={(event) => updateJourneyEndpoint(index, side, { label: event.target.value })} /></label>
        </>
        : <label className="field"><span>{prefix} 정류장 ID</span><input aria-label={`${prefix} 정류장 ID ${index + 1}`} value={endpoint.stopId} onChange={(event) => updateJourneyEndpoint(index, side, { stopId: event.target.value })} /></label>}
    </div>;
  }

  async function saveScenario(): Promise<void> {
    const errors = validateScenarioEditorDraft(draft, routeStops);
    if (errors.length) {
      setValidationErrors(errors);
      setSaveMessage(undefined);
      return;
    }
    setSaving(true);
    setValidationErrors([]);
    setSaveMessage(undefined);
    try {
      const saved = createScenarioDefinition(buildScenarioDefinitionInput({ ...draft, updatedAt: new Date().toISOString() }));
      await onSaveScenarioDefinition(saved);
      setSelectedScenarioId(saved.scenarioId);
      setDraft(scenarioDefinitionToEditorDraft(saved));
      setSaveMessage('시나리오 정의를 저장했습니다.');
    } catch (error) {
      setSaveMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function renderOperation(index: number, side: OperationSide): JSX.Element {
    const operation = draft.routeChanges[index][side];
    const prefix = side === 'beforeOperation' ? 'Before' : 'After';
    return <div className="scenario-operation-panel">
      <strong>{prefix} 운행조건</strong>
      <div className="synthetic-form-grid">
        <label className="field"><span>{prefix} 첫차</span><input aria-label={`${prefix} 첫차`} type="time" value={operation.firstDeparture} onChange={(event) => updateOperation(index, side, { firstDeparture: event.target.value })} /></label>
        <label className="field"><span>{prefix} 막차</span><input aria-label={`${prefix} 막차`} type="time" value={operation.lastDeparture} onChange={(event) => updateOperation(index, side, { lastDeparture: event.target.value })} /></label>
        <label className="field"><span>{prefix} 배차간격</span><input aria-label={`${prefix} 배차간격`} type="number" min="1" step="1" value={operation.headwayMinutes} onChange={(event) => updateOperation(index, side, { headwayMinutes: event.target.value })} /></label>
        <label className="field"><span>{prefix} 운행대수</span><input aria-label={`${prefix} 운행대수`} type="number" min="1" step="1" value={operation.vehicleCount} onChange={(event) => updateOperation(index, side, { vehicleCount: event.target.value })} /></label>
        <label className="field"><span>{prefix} 정차시간(초)</span><input aria-label={`${prefix} 정차시간`} type="number" min="0" step="1" value={operation.dwellSeconds} onChange={(event) => updateOperation(index, side, { dwellSeconds: event.target.value })} /></label>
        <label className="field"><span>{prefix} 서비스 시작일</span><input aria-label={`${prefix} 서비스 시작일`} type="date" value={operation.startDate} onChange={(event) => updateOperation(index, side, { startDate: event.target.value })} /></label>
        <label className="field"><span>{prefix} 서비스 종료일</span><input aria-label={`${prefix} 서비스 종료일`} type="date" value={operation.endDate} onChange={(event) => updateOperation(index, side, { endDate: event.target.value })} /></label>
      </div>
      <div className="synthetic-day-field"><strong>{prefix} 운행요일</strong><div className="synthetic-day-options">{WEEKDAY_OPTIONS.map(([label, day]) => <label key={day}><input type="checkbox" checked={operation.serviceDays.includes(day)} onChange={() => toggleOperationDay(index, side, day)} /><span>{label}</span></label>)}</div></div>
      <label className="synthetic-check"><input type="checkbox" checked={operation.deriveReverseDirection} onChange={(event) => updateOperation(index, side, { deriveReverseDirection: event.target.checked })} /><span>{prefix} 역방향 파생</span></label>
    </div>;
  }

  const savedDefinitions = project.scenarioDefinitions ?? [];
  const selectedSavedId = savedDefinitions.some((definition) => definition.scenarioId === selectedScenarioId) ? selectedScenarioId : '';

  return <section className="panel scenario-definition-editor">
    <div className="step-intro"><strong>시나리오 입력·저장</strong><span>여러 노선과 여러 여정 질의를 하나의 시나리오 정의로 저장합니다.</span></div>
    <div className="info-box" role="note">정류장 순서는 시나리오 경로 정의로 저장됩니다. 실제 도로 경로는 다음 단계에서 계산하며, 이번 단계에서는 geometry·연장·운행시간을 계산하지 않습니다.</div>
    <div className="scenario-editor-toolbar">
      <label className="field"><span>저장된 시나리오</span><select aria-label="저장된 시나리오" value={selectedSavedId} onChange={(event) => selectSavedScenario(event.target.value)}><option value="">새 입력</option>{savedDefinitions.map((definition) => <option key={definition.scenarioId} value={definition.scenarioId}>{definition.label} · {definition.updatedAt}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={startNewScenario}>새 시나리오</button>
    </div>
    <label className="field"><span>시나리오 라벨</span><input aria-label="시나리오 라벨" value={draft.label} onChange={(event) => { setDraft((current) => ({ ...current, label: event.target.value })); setValidationErrors([]); setSaveMessage(undefined); }} /></label>
    <div className="scenario-definition-list">
      {draft.routeChanges.map((change, index) => <article className="scenario-route-card" key={`${change.routeId}-${index}`}>
        <div className="scenario-route-heading"><div><strong>노선 변경 {index + 1}</strong><span>{change.routeName} · {change.transportMode}</span></div><button type="button" className="secondary-button" onClick={() => removeRoute(index)}>노선 변경 제거</button></div>
        <label className="field"><span>노선 선택</span><select aria-label={`노선 선택 ${index + 1}`} value={change.routeId} onChange={(event) => changeRoute(index, event.target.value)}>{options.map((route) => <option key={route.routeId} value={route.routeId}>{route.routeName} · {route.routeId} · {route.transportMode}</option>)}</select></label>
        <div className="scenario-route-paths">
          <div><strong>Before 정류장 경로</strong><output aria-label="Before 정류장 경로">{change.baseStopIds.join(' → ') || '대표 경로 없음'}</output></div>
          <label className="field"><span>After 정류장 순서</span><input aria-label="After 정류장 순서" value={change.scenarioStopText} onChange={(event) => updateRoute(index, { scenarioStopText: event.target.value })} /><small>쉼표로 구분하며 입력 순서를 보존합니다. {parseScenarioStopText(change.scenarioStopText).length}개 정류장</small></label>
        </div>
        <div className="scenario-operation-grid">{renderOperation(index, 'beforeOperation')}{renderOperation(index, 'afterOperation')}</div>
      </article>)}
    </div>
    <button type="button" className="secondary-button" onClick={addRoute} disabled={options.length <= draft.routeChanges.length}>노선 추가</button>
    <div className="scenario-journey-queries"><div className="scenario-route-heading"><div><strong>후속 여정 질의</strong><span>좌표를 기본으로 하며, 필요한 경우 정류장 ID를 명시할 수 있습니다.</span></div><button type="button" className="secondary-button" onClick={addJourneyQuery}>질의 추가</button></div>{draft.journeyQueries.map((query, index) => <div className="scenario-query-row" key={index}><div className="scenario-query-endpoints">{renderJourneyEndpoint(index, 'origin', query.origin, '출발지')}{renderJourneyEndpoint(index, 'destination', query.destination, '도착지')}</div><label className="field"><span>출발일시</span><input aria-label={`출발일시 ${index + 1}`} type="datetime-local" value={query.departureDateTime} onChange={(event) => updateJourneyQuery(index, { departureDateTime: event.target.value })} /></label><button type="button" className="secondary-button" onClick={() => removeJourneyQuery(index)}>질의 제거</button></div>)}</div>
    {validationErrors.length > 0 && <div className="error-box" role="alert">{validationErrors.map((error) => <div key={error}>⚠ {error}</div>)}</div>}
    {saveMessage && <div className={saveMessage.endsWith('저장했습니다.') ? 'success-box' : 'error-box'} role="status">{saveMessage}</div>}
    <button type="button" className="primary-button full" disabled={saving} onClick={() => void saveScenario()}>{saving ? '시나리오 저장 중…' : '시나리오 정의를 저장'} <span>→</span></button>
    <ScenarioExecutionPanel projectId={project.id} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={savedDefinitions} onExecutionSaved={(manifest) => setExecutionManifests((current) => [...current.filter((item) => item.executionId !== manifest.executionId), manifest])} />
    <ScenarioJourneyComparison projectId={project.id} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={savedDefinitions} scenarioJourneyManifests={journeyManifests} onJourneySaved={(manifest) => setJourneyManifests((current) => [...current.filter((item) => item.executionId !== manifest.executionId), manifest])} />
    <ScenarioComparisonPanel projectId={project.id} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={savedDefinitions} scenarioExecutionManifests={executionManifests} />
    <ScenarioDemandPanel projectId={project.id} demand={project.lastODResult} routeStops={routeStops} scenarioDefinitions={savedDefinitions} scenarioExecutionManifests={executionManifests} />
  </section>;
}
