import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { ScenarioComparisonResult, ScenarioJourneyComparison, ScenarioRouteComparison } from '../core/scenario-comparison';
import { runScenarioComparison, type ScenarioComparisonProgress, type ScenarioComparisonSelection } from './scenario-comparison-client';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionManifest,
  ScenarioExecutionTarget,
  LegacyScenarioJourneyQuery,
  ScenarioJourneyEndpoint,
  ScenarioJourneyQuery
} from '../shared/types';

export interface ScenarioComparisonPanelProps {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  scenarioExecutionManifests: ScenarioExecutionManifest[];
  onComparisonComplete?: (result: ScenarioComparisonResult) => void;
}

const EMPTY_QUERY: LegacyScenarioJourneyQuery = { originStopId: '', destinationStopId: '', departureDateTime: '' };

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '현행·시나리오 비교에 실패했습니다.'; }

function statusLabel(status: ScenarioExecutionManifest['status']): string {
  return status === 'complete' ? '완료' : status === 'partial' ? '부분 완료' : '실패';
}

function targetLabel(target: ScenarioExecutionTarget, definitions: ScenarioDefinition[]): string {
  return target.kind === 'current' ? '현재 네트워크' : definitions.find((definition) => definition.scenarioId === target.scenarioId)?.label ?? `시나리오 ${target.scenarioId}`;
}

function newestManifests(manifests: ScenarioExecutionManifest[]): ScenarioExecutionManifest[] {
  return [...manifests].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function initialSelectionIds(manifests: ScenarioExecutionManifest[]): { beforeId: string; afterId: string } {
  const newest = newestManifests(manifests);
  const current = newest.find((manifest) => manifest.target.kind === 'current');
  const scenario = newest.find((manifest) => manifest.target.kind === 'scenario' && manifest.executionId !== current?.executionId);
  const before = current ?? newest[0];
  const after = scenario ?? newest.find((manifest) => manifest.executionId !== before?.executionId);
  return { beforeId: before?.executionId ?? '', afterId: after?.executionId ?? '' };
}

function manifestOptionLabel(manifest: ScenarioExecutionManifest, definitions: ScenarioDefinition[]): string {
  return `${targetLabel(manifest.target, definitions)} · ${manifest.executionId} · ${statusLabel(manifest.status)} · 실행 시각 ${manifest.updatedAt}`;
}

function formatMeters(value: number | null): string {
  return value === null ? '계산 불가' : value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value).toLocaleString('ko-KR')} m`;
}

function formatSeconds(value: number | null): string {
  return value === null ? '계산 불가' : `${Math.round(value / 60).toLocaleString('ko-KR')}분`;
}

function formatDelta(value: number | null, formatter: (value: number) => string): string {
  if (value === null) return '변화 계산 불가';
  return `${value > 0 ? '+' : ''}${formatter(value)}`;
}

function sumNullable(...values: Array<number | null>): number | null {
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
}

function operationText(route: ScenarioRouteComparison): string {
  const values: string[] = [];
  const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const days = (value: number[] | null): string => value === null ? '—' : value.map((day) => dayLabels[day] ?? String(day)).join('·') || '없음';
  if (route.operation.headwayMinutes.changed) values.push(`배차간격 ${route.operation.headwayMinutes.before ?? '—'}→${route.operation.headwayMinutes.after ?? '—'}분`);
  if (route.operation.vehicleCount.changed) values.push(`운행대수 ${route.operation.vehicleCount.before ?? '—'}→${route.operation.vehicleCount.after ?? '—'}대`);
  if (route.operation.firstDeparture.changed || route.operation.lastDeparture.changed) values.push(`운행시간 ${route.operation.firstDeparture.before ?? '—'}~${route.operation.lastDeparture.before ?? '—'}→${route.operation.firstDeparture.after ?? '—'}~${route.operation.lastDeparture.after ?? '—'}`);
  if (route.operation.serviceDays.changed) values.push(`운행요일 ${days(route.operation.serviceDays.before)}→${days(route.operation.serviceDays.after)}`);
  if (route.operation.dwellSeconds.changed) values.push(`정차시간 ${route.operation.dwellSeconds.before ?? '—'}→${route.operation.dwellSeconds.after ?? '—'}초`);
  if (route.operation.deriveReverseDirection.changed) values.push(`역방향 파생 ${route.operation.deriveReverseDirection.before === null ? '—' : route.operation.deriveReverseDirection.before ? '사용' : '미사용'}→${route.operation.deriveReverseDirection.after === null ? '—' : route.operation.deriveReverseDirection.after ? '사용' : '미사용'}`);
  return values.length ? values.join(' · ') : '운행정보 변경 없음';
}

function routeStatusLabel(status: ScenarioRouteComparison['status']): string {
  if (status === 'new') return '신규 노선';
  if (status === 'missing') return '개편안 대응 없음';
  return status === 'partial' ? '부분 결과' : '비교 완료';
}

function journeyModes(journey: ScenarioJourneyComparison['after']): string {
  return [...new Set(journey.legs.map((leg) => leg.mode).filter(Boolean))].join(' → ') || '이용수단 없음';
}

function journeySummary(journey: ScenarioJourneyComparison, side: 'before' | 'after', label: string): JSX.Element {
  const value = journey[side];
  const delta = journey.journey.delta;
  const waitSeconds = value.found ? value.initialWaitSeconds + value.transferWaitSeconds : null;
  const walkSeconds = value.found ? value.accessWalkSeconds + value.egressWalkSeconds + value.transferWalkSeconds : null;
  return <div className="scenario-journey-side">
    <strong>{label}</strong>
    {!value.found && <span>여정 없음</span>}
    <span>소요시간: {formatSeconds(value.found ? value.totalSeconds : null)}{side === 'after' && value.found && <small> ({formatDelta(delta.totalSeconds, formatSeconds)})</small>}</span>
    <span>차량 탑승시간: {formatSeconds(value.found ? value.inVehicleSeconds : null)}{side === 'after' && value.found && <small> ({formatDelta(delta.inVehicleSeconds, formatSeconds)})</small>}</span>
    <span>대기시간: {formatSeconds(waitSeconds)}{side === 'after' && value.found && <small> ({formatDelta(sumNullable(delta.initialWaitSeconds, delta.transferWaitSeconds), formatSeconds)})</small>}</span>
    <span>보행시간: {formatSeconds(walkSeconds)}{side === 'after' && value.found && <small> ({formatDelta(sumNullable(delta.accessWalkSeconds, delta.egressWalkSeconds, delta.transferWalkSeconds), formatSeconds)})</small>}</span>
    <span>이용수단: {journeyModes(value)}</span>
    <span>환승횟수: {value.found ? `${value.transferCount}회` : '계산 불가'}{side === 'after' && value.found && <small> ({formatDelta(delta.transferCount, (number) => `${number}회`)})</small>}</span>
    <span>요금 계산 불가</span>
  </div>;
}

function legacyQuery(query: ScenarioJourneyQuery): LegacyScenarioJourneyQuery | undefined {
  if ('originStopId' in query) return { ...query };
  if (query.origin.kind === 'stop' && query.destination.kind === 'stop') {
    return { originStopId: query.origin.stopId, destinationStopId: query.destination.stopId, departureDateTime: query.departureDateTime };
  }
  return undefined;
}

function queryLabel(query: ScenarioJourneyQuery): string {
  if ('originStopId' in query) return `${query.originStopId} → ${query.destinationStopId}`;
  const endpointLabel = (endpoint: ScenarioJourneyEndpoint): string => endpoint.kind === 'stop' ? endpoint.stopId : endpoint.label ?? `${endpoint.latitude},${endpoint.longitude}`;
  return `${endpointLabel(query.origin)} → ${endpointLabel(query.destination)}`;
}

function initialQueries(after: ScenarioExecutionManifest | undefined, definitions: ScenarioDefinition[]): LegacyScenarioJourneyQuery[] {
  if (after?.target.kind === 'scenario') {
    const target = after.target;
    const saved = definitions.find((definition) => definition.scenarioId === target.scenarioId)?.journeyQueries ?? [];
    const legacy = saved.map(legacyQuery).filter((query): query is LegacyScenarioJourneyQuery => Boolean(query));
    if (legacy.length > 0) return legacy;
  }
  return [{ ...EMPTY_QUERY }];
}

function queryValidationError(queries: LegacyScenarioJourneyQuery[]): string | undefined {
  for (const [index, query] of queries.entries()) {
    if (!query.originStopId.trim() || !query.destinationStopId.trim() || !query.departureDateTime.trim()) {
      return `여정 질의 ${index + 1}의 출발 정류장·도착 정류장·출발시각을 모두 입력하세요.`;
    }
  }
  return undefined;
}

function selectionFor(manifest: ScenarioExecutionManifest, definitions: ScenarioDefinition[]): ScenarioComparisonSelection {
  return { target: manifest.target, executionId: manifest.executionId, label: targetLabel(manifest.target, definitions) };
}

export default function ScenarioComparisonPanel({ projectId, routeStops, serviceConfigs, scenarioDefinitions, scenarioExecutionManifests, onComparisonComplete }: ScenarioComparisonPanelProps): JSX.Element {
  const eligibleManifests = useMemo(() => scenarioExecutionManifests.filter((manifest) => manifest.status !== 'failed'), [scenarioExecutionManifests]);
  const defaultSelection = initialSelectionIds(eligibleManifests);
  const [beforeId, setBeforeId] = useState(() => defaultSelection.beforeId);
  const [afterId, setAfterId] = useState(() => defaultSelection.afterId);
  const [queries, setQueries] = useState<LegacyScenarioJourneyQuery[]>(() => initialQueries(eligibleManifests.find((manifest) => manifest.executionId === defaultSelection.afterId), scenarioDefinitions));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScenarioComparisonProgress>();
  const [result, setResult] = useState<ScenarioComparisonResult>();
  const [error, setError] = useState<string>();

  const beforeManifest = scenarioExecutionManifests.find((manifest) => manifest.executionId === beforeId);
  const afterManifest = scenarioExecutionManifests.find((manifest) => manifest.executionId === afterId);
  const hasTwoArtifacts = Boolean(beforeManifest && afterManifest && beforeManifest.executionId !== afterManifest.executionId && eligibleManifests.length >= 2);
  const disabled = running || routeStops.length < 2 || !hasTwoArtifacts;

  useEffect(() => {
    if (eligibleManifests.some((manifest) => manifest.executionId === beforeId)) return;
    setBeforeId(eligibleManifests[0]?.executionId ?? '');
  }, [beforeId, eligibleManifests]);

  useEffect(() => {
    if (eligibleManifests.some((manifest) => manifest.executionId === afterId)) return;
    const next = eligibleManifests.find((manifest) => manifest.executionId !== beforeId);
    setAfterId(next?.executionId ?? '');
  }, [afterId, beforeId, eligibleManifests]);

  useEffect(() => {
    if (!afterManifest) return;
    setQueries(initialQueries(afterManifest, scenarioDefinitions));
    setResult(undefined);
    setError(undefined);
  }, [afterManifest?.executionId, scenarioDefinitions]);

  function updateQuery(index: number, patch: Partial<LegacyScenarioJourneyQuery>): void {
    setQueries((current) => current.map((query, queryIndex) => queryIndex === index ? { ...query, ...patch } : query));
    setResult(undefined);
    setError(undefined);
  }

  function changeAfter(executionId: string): void {
    setAfterId(executionId);
    setResult(undefined);
    setError(undefined);
  }

  async function compare(): Promise<void> {
    if (!beforeManifest || !afterManifest || beforeManifest.executionId === afterManifest.executionId) return;
    const validationError = queryValidationError(queries);
    if (validationError) {
      setError(validationError);
      return;
    }
    setRunning(true);
    setProgress(undefined);
    setResult(undefined);
    setError(undefined);
    try {
      const comparison = await runScenarioComparison({
        projectId,
        before: selectionFor(beforeManifest, scenarioDefinitions),
        after: selectionFor(afterManifest, scenarioDefinitions),
        routeStops,
        serviceConfigs,
        scenarioDefinitions,
        queries
      }, setProgress);
      setResult(comparison);
      onComparisonComplete?.(comparison);
    } catch (comparisonError) {
      setError(errorMessage(comparisonError));
    } finally {
      setRunning(false);
    }
  }

  return <section className="panel scenario-comparison-panel">
    <div className="step-intro"><strong>현행·시나리오 비교</strong><span>현행↔시나리오 또는 시나리오↔시나리오의 노선·운행정보와 X→Y 여정을 비교합니다.</span></div>
    <div className="info-box" role="note">비교는 저장된 실행 결과의 After 네트워크를 기준으로 합니다. 수요 변화 추정과 이용요금 계산은 연결된 모델·운임 규칙이 없어 이 단계에서 제공하지 않습니다.</div>
    <div className="scenario-comparison-scope" role="note"><strong>비교 범위</strong><span>노선·운행정보 비교</span><span>X→Y 여정 비교</span><span>요금 계산 불가</span></div>
    <div className="scenario-editor-toolbar">
      <label className="field"><span>Before 대상</span><select aria-label="Before 대상" value={beforeId} onChange={(event) => { setBeforeId(event.target.value); setResult(undefined); setError(undefined); }}>{scenarioExecutionManifests.map((manifest) => <option key={manifest.executionId} value={manifest.executionId} disabled={manifest.status === 'failed'}>{manifestOptionLabel(manifest, scenarioDefinitions)}</option>)}</select></label>
      <label className="field"><span>After 대상</span><select aria-label="After 대상" value={afterId} onChange={(event) => changeAfter(event.target.value)}>{scenarioExecutionManifests.map((manifest) => <option key={manifest.executionId} value={manifest.executionId} disabled={manifest.status === 'failed'}>{manifestOptionLabel(manifest, scenarioDefinitions)}</option>)}</select></label>
    </div>
    {scenarioExecutionManifests.length === 0 ? <div className="warning-box" role="alert">비교할 실행 결과가 없습니다. 먼저 현재 네트워크 또는 시나리오의 경로를 생성·저장하세요.</div> : scenarioExecutionManifests.length < 2 || eligibleManifests.length < 2 ? <div className="warning-box" role="alert">완료된 실행 결과 2개가 필요합니다. 실패한 실행 결과는 비교 대상에서 제외됩니다.</div> : null}
    {routeStops.length < 2 && <div className="warning-box" role="alert">비교할 노선 master가 없습니다. 노선별 정류장정보를 먼저 준비하세요.</div>}
    {beforeManifest && afterManifest && beforeManifest.executionId === afterManifest.executionId && <div className="warning-box" role="alert">Before와 After는 서로 다른 실행 결과를 선택하세요.</div>}
    {beforeManifest && afterManifest && <div className="scenario-comparison-selection-note" role="note">실행 시각 · Before {beforeManifest.updatedAt} · After {afterManifest.updatedAt}</div>}
    <div className="scenario-journey-queries"><div className="scenario-route-heading"><div><strong>X→Y 여정 비교 입력</strong><span>출발 정류장·도착 정류장·출발시각을 입력하면 같은 질의를 두 대상에 보냅니다. 질의를 모두 제거하면 노선·운행정보만 비교합니다.</span></div><button type="button" className="secondary-button" onClick={() => setQueries((current) => [...current, { ...EMPTY_QUERY }])} disabled={running}>질의 추가</button></div>{queries.map((query, index) => <div className="scenario-query-row" key={index}><label className="field"><span>출발 정류장 ID</span><input aria-label={`비교 출발 정류장 ID ${index + 1}`} value={query.originStopId} onChange={(event) => updateQuery(index, { originStopId: event.target.value })} /></label><label className="field"><span>도착 정류장 ID</span><input aria-label={`비교 도착 정류장 ID ${index + 1}`} value={query.destinationStopId} onChange={(event) => updateQuery(index, { destinationStopId: event.target.value })} /></label><label className="field"><span>출발일시</span><input aria-label={`비교 출발일시 ${index + 1}`} type="datetime-local" value={query.departureDateTime} onChange={(event) => updateQuery(index, { departureDateTime: event.target.value })} /></label><button type="button" className="secondary-button" onClick={() => setQueries((current) => current.filter((_, queryIndex) => queryIndex !== index))} disabled={running}>질의 제거</button></div>)}</div>
    {progress && <div className="scenario-execution-progress" role="status"><strong>{progress.message}</strong><span>{progress.phase} · {progress.completed}/{progress.total || '전체'} 단계</span></div>}
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    {result && <ComparisonResultView result={result} />}
    <button type="button" className="primary-button full" disabled={disabled} onClick={() => void compare()}>{running ? '현행·시나리오 비교 중…' : '비교 실행'} <span>→</span></button>
  </section>;
}

export function ComparisonResultView({ result }: { result: ScenarioComparisonResult }): JSX.Element {
  return <div className="scenario-comparison-result" role="status">
    <div className="scenario-result-heading"><strong>비교 결과</strong><span>{result.before.label} → {result.after.label}</span></div>
    {result.environment.warnings.length > 0 && <div className="warning-box" role="alert"><strong>실행 환경 주의</strong>{result.environment.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}
    <div className="scenario-comparison-section"><h4>노선·운행정보 비교</h4>{result.routes.length === 0 ? <div className="warning-box" role="note">비교 대상에 저장된 노선이 없습니다.</div> : <table><thead><tr><th>노선</th><th>정류장 변경</th><th>연장</th><th>운행시간</th><th>운행정보</th></tr></thead><tbody>{result.routes.map((route) => <tr key={route.routeId}><th>{route.routeName.after ?? route.routeName.before ?? route.routeId}<small>{route.routeId} · {routeStatusLabel(route.status)}</small></th><td>{route.status === 'new' ? <><strong>개편안 신규 경로</strong><small>현행 대응 없음</small></> : <>{route.reordered ? '순서 변경' : '순서 동일'}{route.addedStopIds.length > 0 && <small>추가: {route.addedStopIds.join(', ')}</small>}{route.removedStopIds.length > 0 && <small>삭제: {route.removedStopIds.join(', ')}</small>}</>}</td><td>{formatMeters(route.distanceMeters.before)} → {formatMeters(route.distanceMeters.after)}<small>{formatDelta(route.distanceMeters.delta, formatMeters)}</small></td><td>{formatSeconds(route.runtimeSeconds.before)} → {formatSeconds(route.runtimeSeconds.after)}<small>{formatDelta(route.runtimeSeconds.delta, formatSeconds)}</small></td><td>{route.status === 'new' ? '개편안 신규 노선 운행정보' : operationText(route)}{route.warnings.map((warning) => <small key={warning}>{warning}</small>)}</td></tr>)}</tbody></table>}</div>
    <div className="scenario-comparison-section"><h4>X→Y 여정 비교</h4>{result.journeys.length === 0 ? <div className="warning-box" role="note">환경 불일치 또는 질의 없음으로 여정 비교 결과가 없습니다.</div> : result.journeys.map((journey, index) => <article className="scenario-journey-comparison" key={`${queryLabel(journey.query)}-${index}`}><strong>{queryLabel(journey.query)} · {journey.query.departureDateTime}</strong><div className="scenario-journey-grid">{journeySummary(journey, 'before', result.before.label)}{journeySummary(journey, 'after', result.after.label)}</div><div className="info-box" role="note">요금 계산 불가: {journey.fare.reason}</div>{journey.journey.warnings.map((warning) => <small key={warning}>{warning}</small>)}</article>)}</div>
    {result.warnings.length > 0 && <div className="scenario-comparison-warnings"><strong>해석 주의</strong>{result.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}
  </div>;
}
