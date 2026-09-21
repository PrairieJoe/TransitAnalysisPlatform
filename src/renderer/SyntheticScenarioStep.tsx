import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { buildRoutePathIndex, routeOptions } from '../core/route-master';
import { selectRepresentativeRouteStopIds } from '../core/scenario-editor';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import SyntheticRouteScenarioEditor from './SyntheticRouteScenarioEditor';
import ScenarioNewRouteEditor, { type ScenarioNewRouteDraft } from './ScenarioNewRouteEditor';
import type { ScenarioNetworkOverlayState } from './ScenarioNetworkOverlayEditor';
import { buildPrimaryScenarioDefinition } from './synthetic-scenario-definition';
import type { ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioOperationPlan, StationMasterRecord } from '../shared/types';

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
  const [localRouteId, setLocalRouteId] = useState(() => controlledRouteId ?? options[0]?.routeId ?? '');
  const [localScenarioStopIds, setLocalScenarioStopIds] = useState(() => controlledScenarioStopIds ?? (localRouteId ? selectRepresentativeRouteStopIds(routeStops, localRouteId) : []));
  const [localScenarioLabel, setLocalScenarioLabel] = useState(controlledScenarioLabel ?? '');
  const [editorMode, setEditorMode] = useState<'existing' | 'new'>('existing');
  const [overlayState, setOverlayState] = useState<ScenarioNetworkOverlayState>(() => ({ selectedRouteId: controlledRouteId ?? localRouteId, scenarioStopIds: [...(controlledScenarioStopIds ?? [])], addedStations: [], stationOverrides: [], addedRoutes: [] }));
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

  function changeRoute(routeId: string): void {
    if (onRouteChange) onRouteChange(routeId);
    if (!isControlled) {
      setLocalRouteId(routeId);
      setLocalScenarioStopIds(selectRepresentativeRouteStopIds(routeStops, routeId));
      setLocalScenarioLabel('');
    }
  }

  function changeScenarioStopIds(stopIds: string[]): void {
    if (onScenarioStopIdsChange) onScenarioStopIdsChange(stopIds);
    if (!isControlled) setLocalScenarioStopIds(stopIds);
  }

  function changeScenarioLabel(label: string): void {
    if (onScenarioLabelChange) onScenarioLabelChange(label);
    if (!isControlled) setLocalScenarioLabel(label);
  }

  async function savePrimaryScenario(): Promise<void> {
    await saveScenarioDefinition();
  }

  async function saveScenarioDefinition(addedRoute?: NonNullable<ScenarioNetworkOverlayState['addedRoutes']>[number]): Promise<void> {
    try {
      setSaveError(undefined);
      const addedRoutes = addedRoute ? [addedRoute] : overlayState.addedRoutes;
      if (editorMode === 'new' && !addedRoutes.length) throw new Error('먼저 신규 노선의 정류장 순서와 운행조건을 저장하세요.');
      const definition = buildPrimaryScenarioDefinition({ projectId: project.id, routeStops, routeId: editorMode === 'new' ? '' : selectedRouteId, label: scenarioLabel || (addedRoutes[0]?.routeName ?? ''), scenarioStopIds: editorMode === 'new' ? [] : scenarioStopIds, routeChanges: editorMode === 'new' ? [] : undefined, addedStations: overlayState.addedStations, stationOverrides: overlayState.stationOverrides, addedRoutes, beforeOperation: DEFAULT_PRIMARY_OPERATION, afterOperation: DEFAULT_PRIMARY_OPERATION });
      await onSaveScenarioDefinition(definition);
      onScenarioSaved?.(definition);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '시나리오를 저장하지 못했습니다.');
    }
  }

  return <section className="synthetic-step-panel synthetic-scenario-step">
    <div className="synthetic-step-panel-heading"><div><strong>노선 개편 시나리오</strong><span>현행 노선을 기준으로 정류장을 바꾼 개편안을 만들고, 같은 조건에서 전후 결과를 비교합니다.</span></div></div>
    <div className="scenario-primary-summary" role="note"><strong>현행 경로를 기준으로 시작합니다.</strong><span>기존 노선 개편이나 신규 노선 만들기를 선택하고, 정류장과 지도를 함께 확인하세요.</span></div>
    <div className="scenario-mode-switch" role="tablist" aria-label="시나리오 유형"><button type="button" role="tab" aria-selected={editorMode === 'existing'} className={editorMode === 'existing' ? 'is-active' : ''} onClick={() => setEditorMode('existing')}>기존 노선 개편</button><button type="button" role="tab" aria-selected={editorMode === 'new'} className={editorMode === 'new' ? 'is-active' : ''} onClick={() => setEditorMode('new')}>새 노선 만들기</button></div>
    {editorMode === 'existing' ? <SyntheticRouteScenarioEditor routeOptions={options} routeStops={routeStops} stationMaster={stationMaster} overlayState={overlayState} onOverlayStateChange={setOverlayState} selectedRouteId={selectedRouteId} scenarioStopIds={scenarioStopIds} scenarioLabel={scenarioLabel} onRouteChange={changeRoute} onScenarioStopIdsChange={changeScenarioStopIds} onScenarioLabelChange={changeScenarioLabel} onSave={savePrimaryScenario} /> : <ScenarioNewRouteEditor value={newRouteDraft} stations={stationCatalog} onChange={setNewRouteDraft} onSave={(route) => { setOverlayState((current) => ({ ...current, addedRoutes: [route] })); void saveScenarioDefinition(route); }} />}
    {saveError && <div className="error-box" role="alert">⚠ {saveError}</div>}
    <details className="scenario-operation-disclosure"><summary>운행조건 변경 <span>선택 사항 · 기본 조건을 먼저 사용합니다</span></summary><div className="scenario-operation-disclosure-body"><p>기본 운행조건으로 시나리오를 저장합니다. 세부 운행조건은 GTFS 생성 단계에서 필요할 때 조정할 수 있습니다.</p></div></details>
  </section>;
}
