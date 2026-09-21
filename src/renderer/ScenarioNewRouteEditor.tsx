import { type FormEvent } from 'react';
import type { JSX } from 'react';
import type { ScenarioNetworkMapStation } from './ScenarioNetworkMap';
import type { ScenarioAddedRoute, ScenarioOperationPlan } from '../shared/types';

export interface ScenarioNewRouteDraft {
  routeId: string;
  routeName: string;
  transportMode: string;
  stopIds: string[];
  operation: ScenarioOperationPlan;
}

export interface ScenarioNewRouteEditorProps {
  value: ScenarioNewRouteDraft;
  stations: ScenarioNetworkMapStation[];
  onChange: (draft: ScenarioNewRouteDraft) => void;
  onSave: (route: ScenarioAddedRoute) => void;
}

export function validateScenarioNewRouteDraft(draft: ScenarioNewRouteDraft, stationIds: string[]): string[] {
  const errors: string[] = [];
  if (!draft.routeId.trim()) errors.push('신규 노선 ID를 입력하세요.');
  if (!draft.routeName.trim()) errors.push('신규 노선명을 입력하세요.');
  if (!draft.transportMode.trim()) errors.push('교통수단을 입력하세요.');
  if (draft.stopIds.length < 2) errors.push('신규 노선은 최소 2개 정류장이 필요합니다.');
  if (new Set(draft.stopIds).size !== draft.stopIds.length) errors.push('신규 노선 정류장은 중복될 수 없습니다.');
  const available = new Set(stationIds);
  const missing = draft.stopIds.filter((stationId) => !available.has(stationId));
  if (missing.length) errors.push(`신규 노선에 없는 정류장이 있습니다: ${[...new Set(missing)].join(', ')}`);
  return errors;
}

export function buildScenarioAddedRoute(draft: ScenarioNewRouteDraft, stationIds: string[]): ScenarioAddedRoute {
  const errors = validateScenarioNewRouteDraft(draft, stationIds);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    routeId: draft.routeId.trim(),
    routeName: draft.routeName.trim(),
    transportMode: draft.transportMode.trim(),
    stopIds: [...draft.stopIds],
    afterOperation: {
      ...draft.operation,
      serviceDays: [...draft.operation.serviceDays],
      travelTimeModel: { ...draft.operation.travelTimeModel, speedsKph: { ...draft.operation.travelTimeModel.speedsKph } }
    }
  };
}

export default function ScenarioNewRouteEditor({ value, stations, onChange, onSave }: ScenarioNewRouteEditorProps): JSX.Element {
  const stationIds = stations.map((station) => station.stationId);
  function update(patch: Partial<ScenarioNewRouteDraft>): void { onChange({ ...value, ...patch }); }
  function moveStop(index: number, targetIndex: number): void {
    if (targetIndex < 0 || targetIndex >= value.stopIds.length) return;
    const next = [...value.stopIds];
    const [stationId] = next.splice(index, 1);
    next.splice(targetIndex, 0, stationId);
    update({ stopIds: next });
  }
  function removeStop(stationId: string): void { update({ stopIds: value.stopIds.filter((candidate) => candidate !== stationId) }); }
  function addStop(stationId: string): void { if (stationId && !value.stopIds.includes(stationId)) update({ stopIds: [...value.stopIds, stationId] }); }
  function submit(event: FormEvent<HTMLFormElement>): void { event.preventDefault(); onSave(buildScenarioAddedRoute(value, stationIds)); }

  return <form className="scenario-new-route-editor" onSubmit={submit}>
    <div className="scenario-new-route-heading"><div><p className="eyebrow">신규 노선</p><h3>새 노선 만들기</h3></div><span>현행 원본은 변경하지 않습니다</span></div>
    <div className="scenario-new-route-fields"><label>노선 ID<input value={value.routeId} onChange={(event) => update({ routeId: event.target.value })} placeholder="예: N-1" /></label><label>노선명<input value={value.routeName} onChange={(event) => update({ routeName: event.target.value })} placeholder="예: 신규 순환노선" /></label><label>교통수단<input value={value.transportMode} onChange={(event) => update({ transportMode: event.target.value })} placeholder="예: 버스" /></label></div>
    <div className="scenario-new-route-stop-section"><div className="scenario-new-route-section-heading"><strong>정류장 순서</strong><span>{value.stopIds.length}개</span></div><select aria-label="신규 노선 정류장 추가" value="" onChange={(event) => addStop(event.target.value)}><option value="">정류장을 선택하세요</option>{stations.filter((station) => !value.stopIds.includes(station.stationId)).map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName} · ID {station.stationId}</option>)}</select><ol>{value.stopIds.map((stationId, index) => { const station = stations.find((candidate) => candidate.stationId === stationId); return <li key={stationId}><span className="scenario-stop-sequence">{index + 1}</span><span><strong>{station?.stationName ?? stationId}</strong><small>ID {stationId}</small></span><span><button type="button" aria-label={`${station?.stationName ?? stationId} 위로 이동`} disabled={index === 0} onClick={() => moveStop(index, index - 1)}>위로</button><button type="button" aria-label={`${station?.stationName ?? stationId} 아래로 이동`} disabled={index === value.stopIds.length - 1} onClick={() => moveStop(index, index + 1)}>아래로</button><button type="button" aria-label={`${station?.stationName ?? stationId} 제거`} onClick={() => removeStop(stationId)}>제외</button></span></li>; })}</ol></div>
    <button type="submit" className="primary-button">신규 노선 저장</button>
  </form>;
}
