import { useMemo, useState, type FormEvent } from 'react';
import type { JSX } from 'react';
import ScenarioNetworkMap, { type ScenarioNetworkMapStation } from './ScenarioNetworkMap';
import type { ScenarioAddedRoute, ScenarioAddedStation, ScenarioStationOverride } from '../shared/types';

export interface ScenarioNetworkOverlayState {
  selectedRouteId: string;
  selectedStationId?: string;
  scenarioStopIds: string[];
  addedStations: ScenarioAddedStation[];
  stationOverrides: ScenarioStationOverride[];
  addedRoutes: ScenarioAddedRoute[];
}

export type ScenarioNetworkMapAction =
  | { type: 'select'; stationId: string }
  | { type: 'exclude'; stationId: string }
  | { type: 'move'; stationId: string; latitude: number; longitude: number };

export function applyScenarioNetworkMapAction(state: ScenarioNetworkOverlayState, action: ScenarioNetworkMapAction): ScenarioNetworkOverlayState {
  if (action.type === 'select') return { ...state, selectedStationId: action.stationId };
  if (action.type === 'exclude') return {
    ...state,
    selectedStationId: state.selectedStationId === action.stationId ? undefined : state.selectedStationId,
    scenarioStopIds: state.scenarioStopIds.filter((stationId) => stationId !== action.stationId)
  };
  const nextOverride: ScenarioStationOverride = { stationId: action.stationId, latitude: action.latitude, longitude: action.longitude };
  const existing = state.stationOverrides.some((override) => override.stationId === action.stationId);
  return {
    ...state,
    stationOverrides: existing
      ? state.stationOverrides.map((override) => override.stationId === action.stationId ? { ...override, latitude: action.latitude, longitude: action.longitude } : { ...override })
      : [...state.stationOverrides.map((override) => ({ ...override })), nextOverride]
  };
}

export interface ScenarioNetworkOverlayEditorProps {
  state: ScenarioNetworkOverlayState;
  stations: ScenarioNetworkMapStation[];
  currentStopIds: string[];
  onChange: (state: ScenarioNetworkOverlayState) => void;
  compact?: boolean;
}

interface StationDraft {
  stationId: string;
  stationName: string;
  latitude: string;
  longitude: string;
}

function stationById(stations: ScenarioNetworkMapStation[]): Map<string, ScenarioNetworkMapStation> {
  return new Map(stations.map((station) => [station.stationId, station]));
}

export default function ScenarioNetworkOverlayEditor({ state, stations, currentStopIds, onChange, compact = false }: ScenarioNetworkOverlayEditorProps): JSX.Element {
  const [draft, setDraft] = useState<StationDraft>();
  const [error, setError] = useState<string>();
  const allStations = useMemo(() => {
    const byId = stationById(stations);
    state.addedStations.forEach((station) => byId.set(station.stationId, station));
    return [...byId.values()];
  }, [state.addedStations, stations]);
  const stationsById = stationById(allStations);
  const currentIds = new Set(currentStopIds);

  function change(nextState: ScenarioNetworkOverlayState): void {
    onChange({
      ...nextState,
      scenarioStopIds: [...nextState.scenarioStopIds],
      addedStations: nextState.addedStations.map((station) => ({ ...station })),
      stationOverrides: nextState.stationOverrides.map((override) => ({ ...override })),
      addedRoutes: nextState.addedRoutes.map((route) => ({ ...route, stopIds: [...route.stopIds] }))
    });
  }

  function handleMapAction(action: ScenarioNetworkMapAction): void {
    change(applyScenarioNetworkMapAction(state, action));
  }

  function createDraft(latitude: number, longitude: number): void {
    setError(undefined);
    setDraft({ stationId: '', stationName: '', latitude: String(latitude), longitude: String(longitude) });
  }

  function saveDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft) return;
    const stationId = draft.stationId.trim();
    const stationName = draft.stationName.trim();
    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    if (!stationId || !stationName) { setError('신규 정류장 ID와 정류장명을 입력하세요.'); return; }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) { setError('위도는 -90~90, 경도는 -180~180 범위의 숫자여야 합니다.'); return; }
    if (stationsById.has(stationId)) { setError(`정류장 ID ${stationId}가 이미 존재합니다.`); return; }
    const addedStation: ScenarioAddedStation = { stationId, stationName, latitude, longitude };
    change({ ...state, selectedStationId: stationId, scenarioStopIds: state.scenarioStopIds.includes(stationId) ? [...state.scenarioStopIds] : [...state.scenarioStopIds, stationId], addedStations: [...state.addedStations, addedStation] });
    setDraft(undefined);
  }

  function updateSelectedCoordinates(latitude: string, longitude: string): void {
    if (!state.selectedStationId) return;
    const next = applyScenarioNetworkMapAction(state, { type: 'move', stationId: state.selectedStationId, latitude: Number(latitude), longitude: Number(longitude) });
    change(next);
  }

  return <section className={`scenario-network-overlay-editor${compact ? ' is-compact' : ''}`}>
    {!compact && <div className="scenario-network-overlay-heading"><div><p className="eyebrow">네트워크 overlay</p><h3>현행·개편안 지도 편집</h3></div><span>원본은 변경하지 않습니다</span></div>}
    <div className="scenario-network-overlay-columns">
      {!compact && <div className="scenario-network-overlay-lists">
        <div className="scenario-network-station-panel"><div className="scenario-network-station-heading"><strong>현행 정류장</strong><span>{currentStopIds.length}개</span></div><ul>{currentStopIds.map((stationId) => { const station = stationsById.get(stationId); return <li key={stationId} className={state.selectedStationId === stationId ? 'is-selected' : ''}><button type="button" onClick={() => handleMapAction({ type: 'select', stationId })}>{station?.stationName ?? stationId}<small>ID {stationId}</small></button></li>; })}</ul></div>
        <div className="scenario-network-station-panel"><div className="scenario-network-station-heading"><strong>개편안 정류장</strong><span>{state.scenarioStopIds.length}개</span></div><ul>{state.scenarioStopIds.map((stationId) => { const station = stationsById.get(stationId); return <li key={stationId} className={state.selectedStationId === stationId ? 'is-selected' : ''}><button type="button" onClick={() => handleMapAction({ type: 'select', stationId })}>{station?.stationName ?? stationId}<small>ID {stationId}</small></button><button type="button" className="scenario-network-exclude-button" onClick={() => handleMapAction({ type: 'exclude', stationId })}>개편안에서 제외</button></li>; })}</ul></div>
      </div>}
      <div className="scenario-network-overlay-map-panel">
        <ScenarioNetworkMap stations={allStations} currentStopIds={currentStopIds} scenarioStopIds={state.scenarioStopIds} selectedStationId={state.selectedStationId} onSelectStation={(stationId) => handleMapAction({ type: 'select', stationId })} onCreateStationDraft={createDraft} onExcludeStation={(stationId) => handleMapAction({ type: 'exclude', stationId })} onMoveStation={(stationId, latitude, longitude) => handleMapAction({ type: 'move', stationId, latitude, longitude })} />
        {state.selectedStationId && stationsById.has(state.selectedStationId) && <div className="scenario-network-selected-detail"><strong>선택 정류장</strong><span>{stationsById.get(state.selectedStationId)?.stationName} · ID {state.selectedStationId}</span><div><label>위도<input type="number" step="any" defaultValue={stationsById.get(state.selectedStationId)?.latitude} onBlur={(event) => updateSelectedCoordinates(event.target.value, String(stationsById.get(state.selectedStationId)?.longitude ?? ''))} /></label><label>경도<input type="number" step="any" defaultValue={stationsById.get(state.selectedStationId)?.longitude} onBlur={(event) => updateSelectedCoordinates(String(stationsById.get(state.selectedStationId)?.latitude ?? ''), event.target.value)} /></label></div></div>}
        {draft && <form className="scenario-network-station-draft" onSubmit={saveDraft}><div><strong>신규 정류장 저장</strong><span>{draft.latitude}, {draft.longitude}</span></div><label>정류장 ID<input value={draft.stationId} onChange={(event) => setDraft({ ...draft, stationId: event.target.value })} required /></label><label>정류장명<input value={draft.stationName} onChange={(event) => setDraft({ ...draft, stationName: event.target.value })} required /></label><div className="scenario-network-draft-actions"><button type="button" className="secondary-button" onClick={() => setDraft(undefined)}>취소</button><button type="submit" className="primary-button">정류장 저장</button></div></form>}
        {error && <div className="error-box" role="alert">⚠ {error}</div>}
      </div>
    </div>
  </section>;
}
