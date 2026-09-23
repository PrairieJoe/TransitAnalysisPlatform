import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { buildRoutePathIndex, routeOptions } from '../core/route-master';
import { selectRepresentativeRouteStopIds } from '../core/scenario-editor';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import SyntheticRouteScenarioEditor from './SyntheticRouteScenarioEditor';
import ScenarioNewRouteEditor, { type ScenarioNewRouteDraft } from './ScenarioNewRouteEditor';
import type { ScenarioNetworkOverlayState } from './ScenarioNetworkOverlayEditor';
import { buildPrimaryScenarioDefinition, upsertScenarioAddedRoute, upsertScenarioRouteChange } from './synthetic-scenario-definition';
import type { ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioAddedRoute, ScenarioDefinition, ScenarioOperationPlan, ScenarioRouteChange, StationMasterRecord } from '../shared/types';

export interface SyntheticScenarioStepProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  stationMaster?: StationMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  onSaveScenarioDefinition: (definition: ScenarioDefinition) => Promise<void>;
  selectedRouteId?: string;
  scenarioStopIds?: string[];
  scenarioLabel?: string;
  onRouteChange?: (routeId: string) => void;
  onScenarioStopIdsChange?: (stopIds: string[]) => void;
  onScenarioLabelChange?: (label: string) => void;
  onScenarioSaved?: (definition: ScenarioDefinition) => void;
}

const DEFAULT_PRIMARY_OPERATION: ScenarioOperationPlan = {
  serviceDays: [0, 1, 2, 3, 4],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: 10,
  vehicleCount: 4,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: { ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS, speedsKph: { ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS.speedsKph } }
};

export default function SyntheticScenarioStep({ project, routeStops, stationMaster = project.stationMaster ?? [], onSaveScenarioDefinition, selectedRouteId: controlledRouteId, scenarioStopIds: controlledScenarioStopIds, scenarioLabel: controlledScenarioLabel, onRouteChange, onScenarioStopIdsChange, onScenarioLabelChange, onScenarioSaved }: SyntheticScenarioStepProps): JSX.Element {
  const options = useMemo(() => routeOptions(buildRoutePathIndex(routeStops)), [routeStops]);
  const initialDefinition = useMemo(() => project.scenarioDefinitions?.find((definition) => definition.routeChanges.some((change) => options.some((option) => option.routeId === change.routeId)) || Boolean(definition.addedRoutes?.length)), [options, project.scenarioDefinitions]);
  const initialSavedRoute = initialDefinition?.routeChanges.find((change) => options.some((option) => option.routeId === change.routeId));
  const initialRouteId = controlledRouteId ?? initialSavedRoute?.routeId ?? options[0]?.routeId ?? '';
  const initialScenarioStopIds = controlledScenarioStopIds ?? initialSavedRoute?.scenarioStopIds ?? (initialRouteId ? selectRepresentativeRouteStopIds(routeStops, initialRouteId) : []);
  const [localRouteId, setLocalRouteId] = useState(initialRouteId);
  const [localScenarioStopIds, setLocalScenarioStopIds] = useState(initialScenarioStopIds);
  const [localScenarioLabel, setLocalScenarioLabel] = useState(controlledScenarioLabel ?? initialDefinition?.label ?? '');
  const [editorMode, setEditorMode] = useState<'existing' | 'new'>('existing');
  const [routeChanges, setRouteChanges] = useState<ScenarioRouteChange[]>(() => initialDefinition?.routeChanges.map((change) => ({ ...change, baseStopIds: [...change.baseStopIds], scenarioStopIds: [...change.scenarioStopIds] })) ?? []);
  const [overlayState, setOverlayState] = useState<ScenarioNetworkOverlayState>(() => ({ selectedRouteId: initialRouteId, scenarioStopIds: [...initialScenarioStopIds], addedStations: initialDefinition?.addedStations?.map((station) => ({ ...station })) ?? [], stationOverrides: initialDefinition?.stationOverrides?.map((override) => ({ ...override })) ?? [], addedRoutes: initialDefinition?.addedRoutes?.map((route) => ({ ...route, stopIds: [...route.stopIds] })) ?? [] }));
  const [newRouteDraft, setNewRouteDraft] = useState<ScenarioNewRouteDraft>(() => ({ routeId: '', routeName: '', transportMode: '버스', stopIds: [], operation: DEFAULT_PRIMARY_OPERATION }));
  const [saveError, setSaveError] = useState<string>();
  const isControlled = controlledRouteId !== undefined && controlledScenarioStopIds !== undefined && controlledScenarioLabel !== undefined;
  const selectedRouteId = controlledRouteId ?? localRouteId;
  const scenarioStopIds = controlledScenarioStopIds ?? localScenarioStopIds;
  const scenarioLabel = controlledScenarioLabel ?? localScenarioLabel;
  const stationCatalog = useMemo(() => {
    const catalog = new Map<string, { stationId: string; stationName: string; latitude: number; longitude: number }>();
    routeStops.forEach((stop) => { if (!catalog.has(stop.stationId)) catalog.set(stop.stationId, { stationId: stop.stationId, stationName: stop.stationName, latitude: stop.latitude, longitude: stop.longitude }); });
    stationMaster.forEach((station) => { if (!catalog.has(station.stationId)) catalog.set(station.stationId, { stationId: station.stationId, stationName: station.stationName, latitude: station.latitude, longitude: station.longitude }); });
    overlayState.addedStations.forEach((station) => catalog.set(station.stationId, { stationId: station.stationId, stationName: station.stationName, latitude: station.latitude, longitude: station.longitude }));
    return [...catalog.values()];
  }, [overlayState.addedStations, routeStops, stationMaster]);

  function createRouteChange(routeId: string, stopIds: string[], existing?: ScenarioRouteChange): ScenarioRouteChange {
    const selectedRoute = options.find((option) => option.routeId === routeId);
    return {
      routeId,
      ...(selectedRoute?.routeName ? { routeName: selectedRoute.routeName } : {}),
      ...(selectedRoute?.transportMode ? { transportMode: selectedRoute.transportMode } : {}),
      baseStopIds: existing?.baseStopIds?.length ? [...existing.baseStopIds] : selectRepresentativeRouteStopIds(routeStops, routeId),
      scenarioStopIds: [...stopIds],
      beforeOperation: existing?.beforeOperation ?? DEFAULT_PRIMARY_OPERATION,
      afterOperation: existing?.afterOperation ?? DEFAULT_PRIMARY_OPERATION
    };
  }

  function changeRoute(routeId: string): void {
    if (onRouteChange) onRouteChange(routeId);
    const savedRoute = routeChanges.find((change) => change.routeId === routeId);
    const nextStopIds = savedRoute?.scenarioStopIds ?? selectRepresentativeRouteStopIds(routeStops, routeId);
    if (!isControlled) {
      setLocalRouteId(routeId);
      setLocalScenarioStopIds(nextStopIds);
    }
    setOverlayState((current) => ({ ...current, selectedRouteId: routeId, scenarioStopIds: [...nextStopIds] }));
  }

  function changeScenarioStopIds(stopIds: string[]): void {
    if (onScenarioStopIdsChange) onScenarioStopIdsChange(stopIds);
    if (!isControlled) setLocalScenarioStopIds(stopIds);
    if (selectedRouteId) setRouteChanges((current) => upsertScenarioRouteChange(current, createRouteChange(selectedRouteId, stopIds, current.find((change) => change.routeId === selectedRouteId))));
    setOverlayState((current) => ({ ...current, scenarioStopIds: [...stopIds] }));
  }

  function changeScenarioLabel(label: string): void {
    if (onScenarioLabelChange) onScenarioLabelChange(label);
    if (!isControlled) setLocalScenarioLabel(label);
  }

  async function savePrimaryScenario(): Promise<void> {
    await saveScenarioDefinition();
  }

  async function saveScenarioDefinition(): Promise<void> {
    try {
      setSaveError(undefined);
      const activeRouteChange = editorMode === 'existing' && selectedRouteId ? createRouteChange(selectedRouteId, scenarioStopIds, routeChanges.find((change) => change.routeId === selectedRouteId)) : undefined;
      const nextRouteChanges = activeRouteChange ? upsertScenarioRouteChange(routeChanges, activeRouteChange) : routeChanges;
      const addedRoutes = overlayState.addedRoutes;
      if (!nextRouteChanges.length && !addedRoutes.length) throw new Error('기존 노선 변경안 또는 신규 노선을 하나 이상 추가하세요.');
      setRouteChanges(nextRouteChanges);
      const definition = buildPrimaryScenarioDefinition({ projectId: project.id, routeStops, routeId: selectedRouteId, label: scenarioLabel || (addedRoutes[0]?.routeName ?? ''), scenarioStopIds, routeChanges: nextRouteChanges, addedStations: overlayState.addedStations, stationOverrides: overlayState.stationOverrides, addedRoutes, beforeOperation: DEFAULT_PRIMARY_OPERATION, afterOperation: DEFAULT_PRIMARY_OPERATION });
      await onSaveScenarioDefinition(definition);
      onScenarioSaved?.(definition);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '시나리오를 저장하지 못했습니다.');
    }
  }

  function addNewRoute(route: ScenarioAddedRoute): void {
    setOverlayState((current) => ({ ...current, addedRoutes: upsertScenarioAddedRoute(current.addedRoutes, route) }));
    setNewRouteDraft({ routeId: '', routeName: '', transportMode: '버스', stopIds: [], operation: DEFAULT_PRIMARY_OPERATION });
    setSaveError(undefined);
  }

  function removeNewRoute(routeId: string): void {
    setOverlayState((current) => ({ ...current, addedRoutes: current.addedRoutes.filter((route) => route.routeId !== routeId) }));
  }

  return <section className="synthetic-step-panel synthetic-scenario-step">
    <div className="synthetic-step-panel-heading"><div><strong>노선 개편 시나리오</strong><span>현행 노선을 기준으로 정류장을 바꾼 개편안을 만들고, 같은 조건에서 전후 결과를 비교합니다.</span></div></div>
    <div className="scenario-primary-summary" role="note"><strong>현행 경로를 기준으로 시작합니다.</strong><span>기존 노선 개편이나 신규 노선 만들기를 선택하고, 정류장과 지도를 함께 확인하세요.</span></div>
    <div className="scenario-draft-summary" role="status"><div><strong>시나리오에 포함된 변경</strong><span>기존 노선 {routeChanges.length}개 · 신규 노선 {overlayState.addedRoutes.length}개</span></div>{Boolean(routeChanges.length || overlayState.addedRoutes.length) && <ul>{routeChanges.map((change) => <li key={`change-${change.routeId}`}>기존 노선 <strong>{change.routeName ?? change.routeId}</strong><span>{change.scenarioStopIds.length}개 정류장</span></li>)}{overlayState.addedRoutes.map((route) => <li key={`added-${route.routeId}`}>신규 노선 <strong>{route.routeName}</strong><span>{route.stopIds.length}개 정류장</span><button type="button" aria-label={`${route.routeName} 신규 노선 제거`} onClick={() => removeNewRoute(route.routeId)}>제거</button></li>)}</ul>}</div>
    <div className="scenario-mode-switch" role="tablist" aria-label="시나리오 유형"><button type="button" role="tab" aria-selected={editorMode === 'existing'} className={editorMode === 'existing' ? 'is-active' : ''} onClick={() => setEditorMode('existing')}>기존 노선 개편</button><button type="button" role="tab" aria-selected={editorMode === 'new'} className={editorMode === 'new' ? 'is-active' : ''} onClick={() => setEditorMode('new')}>새 노선 만들기</button></div>
    {editorMode === 'existing' ? <SyntheticRouteScenarioEditor routeOptions={options} routeStops={routeStops} stationMaster={stationMaster} overlayState={overlayState} onOverlayStateChange={setOverlayState} selectedRouteId={selectedRouteId} scenarioStopIds={scenarioStopIds} scenarioLabel={scenarioLabel} onRouteChange={changeRoute} onScenarioStopIdsChange={changeScenarioStopIds} onScenarioLabelChange={changeScenarioLabel} onSave={savePrimaryScenario} /> : <><ScenarioNewRouteEditor value={newRouteDraft} stations={stationCatalog} onChange={setNewRouteDraft} onSave={addNewRoute} /><div className="scenario-editor-footer scenario-save-actions"><span>여러 신규 노선을 추가한 뒤 한 번에 저장할 수 있습니다.</span><button type="button" className="primary-button" onClick={() => void saveScenarioDefinition()}>전체 시나리오 저장 <span>→</span></button></div></>}
    {saveError && <div className="error-box" role="alert">⚠ {saveError}</div>}
    <details className="scenario-operation-disclosure"><summary>운행조건 변경 <span>선택 사항 · 기본 조건을 먼저 사용합니다</span></summary><div className="scenario-operation-disclosure-body"><p>기본 운행조건으로 시나리오를 저장합니다. 세부 운행조건은 GTFS 생성 단계에서 필요할 때 조정할 수 있습니다.</p></div></details>
  </section>;
}
