import React, { type JSX } from 'react';
import type { RouteStopMasterRecord, StationMasterRecord } from '../shared/types';
import { applyScenarioStopEdit, buildScenarioStopRows, defaultScenarioLabel, type ScenarioRouteEditState, type ScenarioStopChange } from './synthetic-route-scenario';

export interface SyntheticRouteScenarioEditorProps {
  routeOptions: Array<{ routeId: string; routeName: string; transportMode: string }>;
  routeStops: RouteStopMasterRecord[];
  stationMaster: StationMasterRecord[];
  selectedRouteId: string;
  scenarioStopIds: string[];
  scenarioLabel: string;
  onRouteChange: (routeId: string) => void;
  onScenarioStopIdsChange: (stopIds: string[]) => void;
  onScenarioLabelChange: (label: string) => void;
  onSave: () => Promise<void>;
}

function sortedRouteStops(routeStops: RouteStopMasterRecord[], routeId: string): RouteStopMasterRecord[] {
  return routeStops
    .filter((stop) => stop.routeId === routeId)
    .sort((left, right) => left.stationSequence - right.stationSequence || left.stationId.localeCompare(right.stationId, 'ko'));
}

function statusLabel(change: ScenarioStopChange): string {
  return change === 'added' ? '추가' : change === 'removed' ? '제외' : change === 'moved' ? '순서 변경' : '현행 유지';
}

export default function SyntheticRouteScenarioEditor({ routeOptions, routeStops, stationMaster, selectedRouteId, scenarioStopIds, scenarioLabel, onRouteChange, onScenarioStopIdsChange, onScenarioLabelChange, onSave }: SyntheticRouteScenarioEditorProps): JSX.Element {
  const currentStops = sortedRouteStops(routeStops, selectedRouteId);
  const baseStopIds = currentStops.map((stop) => stop.stationId);
  const selectedRoute = routeOptions.find((option) => option.routeId === selectedRouteId);
  const scenarioOnlyMasterStops = stationMaster
    .filter((station) => !routeStops.some((stop) => stop.routeId === selectedRouteId && stop.stationId === station.stationId))
    .map((station, index) => ({
      ...station,
      routeId: selectedRouteId,
      routeName: selectedRoute?.routeName ?? currentStops[0]?.routeName ?? selectedRouteId,
      transportMode: selectedRoute?.transportMode ?? currentStops[0]?.transportMode ?? '',
      stationSequence: currentStops.length + index + 1
    }));
  const scenarioRouteStops = [...routeStops, ...scenarioOnlyMasterStops];
  const rows = buildScenarioStopRows(scenarioRouteStops, selectedRouteId, baseStopIds, scenarioStopIds);
  const editState: ScenarioRouteEditState = { routeId: selectedRouteId, routeName: selectedRoute?.routeName ?? currentStops[0]?.routeName ?? '', transportMode: selectedRoute?.transportMode ?? currentStops[0]?.transportMode ?? '', baseStopIds, scenarioStopIds, label: scenarioLabel };
  const automaticLabel = defaultScenarioLabel(editState.routeName, scenarioStopIds, baseStopIds);
  const availableStops = [...new Map([...currentStops, ...scenarioOnlyMasterStops].map((stop) => [stop.stationId, stop])).values()]
    .filter((stop) => !scenarioStopIds.includes(stop.stationId));

  function updateStopIds(action: { type: 'add' | 'remove' | 'move'; stationId: string; targetIndex?: number }): void {
    onScenarioStopIdsChange(applyScenarioStopEdit(editState, action).scenarioStopIds);
  }

  return <section className="synthetic-route-scenario-editor scenario-route-editor">
    <div className="scenario-editor-route-field field">
      <label htmlFor="scenario-route-select">현행 노선</label>
      <select id="scenario-route-select" value={selectedRouteId} onChange={(event) => onRouteChange(event.target.value)}>
        {routeOptions.map((option) => <option key={option.routeId} value={option.routeId}>{option.routeName} · {option.transportMode} · ID {option.routeId}</option>)}
      </select>
    </div>
    <div className="scenario-editor-columns">
      <div className="scenario-stop-panel">
        <div className="scenario-stop-panel-heading"><div><p className="eyebrow">현행</p><h3>현행 정류장 목록</h3></div><span>{currentStops.length}개</span></div>
        <ol className="scenario-stop-list scenario-stop-list-current">{currentStops.map((stop, index) => <li key={`${stop.stationId}-${index}`} tabIndex={0}><span className="scenario-stop-sequence">{index + 1}</span><span><strong>{stop.stationName}</strong><small>ID {stop.stationId}</small></span></li>)}</ol>
      </div>
      <div className="scenario-stop-panel scenario-stop-panel-scenario">
        <div className="scenario-stop-panel-heading"><div><p className="eyebrow">개편안</p><h3>개편안 정류장 목록</h3></div><span>{scenarioStopIds.length}개</span></div>
        <div className="scenario-stop-add"><label htmlFor="scenario-stop-add-select">기존 정류장 추가</label><select id="scenario-stop-add-select" aria-label="기존 정류장 추가" value="" onChange={(event) => { if (event.target.value) updateStopIds({ type: 'add', stationId: event.target.value }); }}><option value="">정류장을 선택하세요</option>{availableStops.map((stop) => <option key={stop.stationId} value={stop.stationId}>{stop.stationName} · ID {stop.stationId}</option>)}</select></div>
        <ol className="scenario-stop-list scenario-stop-list-scenario">{rows.map((row, index) => {
          const scenarioIndex = scenarioStopIds.indexOf(row.stationId);
          const isActive = scenarioIndex >= 0;
          return <li key={`${row.stationId}-${row.change}`} className={`scenario-stop-row is-${row.change}`} tabIndex={0}>
            <span className="scenario-stop-sequence">{isActive ? scenarioIndex + 1 : '—'}</span>
            <span className="scenario-stop-content"><strong>{row.stationName}</strong><small>ID {row.stationId}</small></span>
            <span className={`scenario-stop-status is-${row.change}`}>{statusLabel(row.change)}</span>
            {isActive && <span className="scenario-stop-actions"><button type="button" aria-label={`${row.stationName} 위로 이동`} disabled={scenarioIndex === 0} onClick={() => updateStopIds({ type: 'move', stationId: row.stationId, targetIndex: scenarioIndex - 1 })}>위로 이동</button><button type="button" aria-label={`${row.stationName} 아래로 이동`} disabled={scenarioIndex === scenarioStopIds.length - 1} onClick={() => updateStopIds({ type: 'move', stationId: row.stationId, targetIndex: scenarioIndex + 1 })}>아래로 이동</button><button type="button" aria-label={`${row.stationName} 정류장 제거`} onClick={() => updateStopIds({ type: 'remove', stationId: row.stationId })}>정류장 제거</button></span>}
            {!isActive && <span className="scenario-stop-removed-note">현행 목록에만 있음</span>}
          </li>;
        })}</ol>
      </div>
    </div>
    <div className="scenario-diff-summary" role="note"><strong>변경 상태</strong><span>현행 유지 · 순서 변경 · 추가 · 제외</span></div>
    <div className="scenario-editor-footer scenario-save-actions"><label htmlFor="scenario-label">시나리오 이름<input id="scenario-label" value={scenarioLabel || automaticLabel} onChange={(event) => onScenarioLabelChange(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => void onSave()}>시나리오 저장 <span>→</span></button></div>
  </section>;
}
