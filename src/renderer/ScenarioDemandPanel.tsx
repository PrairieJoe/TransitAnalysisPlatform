import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG,
  type ScenarioDemandEstimationResult,
  type ScenarioDemandAssignment
} from '../core/scenario-demand-estimation';
import { runScenarioDemandEstimation, type ScenarioDemandProgress, type ScenarioDemandSelection } from './scenario-demand-client';
import type {
  ODDemandResult,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionManifest,
  ScenarioExecutionTarget
} from '../shared/types';

export interface ScenarioDemandPanelProps {
  projectId: string;
  demand?: ODDemandResult;
  routeStops: RouteStopMasterRecord[];
  scenarioDefinitions: ScenarioDefinition[];
  scenarioExecutionManifests: ScenarioExecutionManifest[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '시나리오 수요 추정에 실패했습니다.';
}

function targetLabel(target: ScenarioExecutionTarget, definitions: ScenarioDefinition[]): string {
  return target.kind === 'current'
    ? '현재 네트워크'
    : definitions.find((definition) => definition.scenarioId === target.scenarioId)?.label ?? `시나리오 ${target.scenarioId}`;
}

function statusLabel(status: ScenarioExecutionManifest['status']): string {
  return status === 'complete' ? '완료' : status === 'partial' ? '부분 완료' : '실패';
}

function manifestOptionLabel(manifest: ScenarioExecutionManifest, definitions: ScenarioDefinition[]): string {
  return `${targetLabel(manifest.target, definitions)} · ${statusLabel(manifest.status)} · ${manifest.updatedAt}`;
}

function latestManifest(manifests: ScenarioExecutionManifest[]): ScenarioExecutionManifest | undefined {
  return manifests.reduce<ScenarioExecutionManifest | undefined>((latest, manifest) => {
    if (!latest || manifest.updatedAt > latest.updatedAt) return manifest;
    return latest;
  }, undefined);
}

function initialSelectionIds(manifests: ScenarioExecutionManifest[]): { beforeId: string; afterId: string } {
  const eligible = manifests.filter((manifest) => manifest.status === 'complete');
  const current = eligible.find((manifest) => manifest.target.kind === 'current');
  const scenario = latestManifest(eligible.filter((manifest) => manifest.target.kind === 'scenario'));
  const before = current ?? eligible[0];
  const after = scenario ?? eligible.find((manifest) => manifest.executionId !== before?.executionId);
  return { beforeId: before?.executionId ?? '', afterId: after?.executionId ?? '' };
}

function selectionFor(manifest: ScenarioExecutionManifest, definitions: ScenarioDefinition[]): ScenarioDemandSelection {
  return {
    target: manifest.target,
    executionId: manifest.executionId,
    label: targetLabel(manifest.target, definitions)
  };
}

function formatDaily(value: number): string {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${formatDaily(value)}`;
}

function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function confidenceLabel(value: ScenarioDemandAssignment['confidence']): string {
  return value === 'high' ? '높음' : value === 'medium' ? '중간' : '낮음';
}

function warningDetails(warnings: string[]): JSX.Element | null {
  if (!warnings.length) return null;
  return <small className="scenario-demand-warnings">{warnings.join(' · ')}</small>;
}

function assignmentText(assignments: ScenarioDemandAssignment[]): string {
  if (!assignments.length) return '할당 없음';
  return assignments.map((assignment) => `${assignment.routeId} ${assignment.direction === 'forward' ? '정방향' : '역방향'} ${formatShare(assignment.share)} · ${formatDaily(assignment.dailyAverage)}`).join(', ');
}

export function ScenarioDemandResultView({ result, stationNames = {} }: { result: ScenarioDemandEstimationResult; stationNames?: Record<string, string> }): JSX.Element {
  const environmentBlocked = !result.environment.comparable;
  return <div className="scenario-demand-result" role="status">
    <div className="scenario-result-heading"><strong>수요 추정 결과</strong><span>{result.before.label} → {result.after.label}</span></div>
    {result.environment.warnings.length > 0 && <div className="warning-box" role="alert"><strong>실행 환경 주의</strong>{result.environment.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}
    {environmentBlocked
      ? <div className="scenario-demand-blocked" role="alert"><strong>수요 재배분 계산 불가</strong><span>PBF, routing profile 또는 운행시간 모델이 서로 달라 수치 결과를 비교할 수 없습니다.</span></div>
      : <>
        <div className="scenario-demand-summary-grid">
          <div><small>관측 OD 일평균</small><strong>{formatDaily(result.totals.observedDailyAverage)}</strong></div>
          <div><small>Before 운행 할당</small><strong>{formatDaily(result.totals.beforeServedDailyAverage)}</strong></div>
          <div><small>After 운행 할당</small><strong>{formatDaily(result.totals.afterServedDailyAverage)}</strong></div>
          <div><small>Before 미할당</small><strong>{formatDaily(result.totals.beforeUnservedDailyAverage)}</strong></div>
          <div><small>After 미할당</small><strong>{formatDaily(result.totals.afterUnservedDailyAverage)}</strong></div>
        </div>
        <div className="scenario-demand-section"><h4>노선별 수요 변화</h4>{result.routes.length === 0 ? <div className="warning-box" role="note">표시할 노선 수요 결과가 없습니다.</div> : <div className="scenario-demand-table-scroll"><table className="scenario-demand-table"><thead><tr><th>노선</th><th>Before 승차(일평균)</th><th>After 승차(일평균)</th><th>증감</th><th>Before 하차</th><th>After 하차</th><th>신뢰도</th></tr></thead><tbody>{result.routes.map((route) => <tr key={route.routeId}><th>{route.routeName ?? route.routeId}<small>{route.routeId}</small>{warningDetails(route.warnings)}</th><td>{formatDaily(route.beforeBoardings)}</td><td>{formatDaily(route.afterBoardings)}</td><td>{formatDelta(route.deltaBoardings)}</td><td>{formatDaily(route.beforeAlightings)}</td><td>{formatDaily(route.afterAlightings)}</td><td>{confidenceLabel(route.confidence)}</td></tr>)}</tbody></table></div>}</div>
        <div className="scenario-demand-section"><h4>정류장별 수요 변화</h4>{result.stations.length === 0 ? <div className="warning-box" role="note">표시할 정류장 수요 결과가 없습니다.</div> : <div className="scenario-demand-table-scroll"><table className="scenario-demand-table"><thead><tr><th>정류장</th><th>Before 승차(일평균)</th><th>After 승차(일평균)</th><th>승차 증감</th><th>Before 하차</th><th>After 하차</th><th>하차 증감</th></tr></thead><tbody>{result.stations.map((station) => <tr key={station.stationId}><th>{stationNames[station.stationId] ?? station.stationId}<small>{station.stationId}</small>{warningDetails(station.warnings)}</th><td>{formatDaily(station.beforeBoardings)}</td><td>{formatDaily(station.afterBoardings)}</td><td>{formatDelta(station.deltaBoardings)}</td><td>{formatDaily(station.beforeAlightings)}</td><td>{formatDaily(station.afterAlightings)}</td><td>{formatDelta(station.deltaAlightings)}</td></tr>)}</tbody></table></div>}</div>
        <div className="scenario-demand-section"><h4>OD별 수요 변화</h4>{result.od.length === 0 ? <div className="warning-box" role="note">표시할 OD 수요 결과가 없습니다.</div> : <div className="scenario-demand-table-scroll"><table className="scenario-demand-table"><thead><tr><th>출발</th><th>도착</th><th>관측 수요</th><th>Before 할당</th><th>After 할당</th><th>증감</th><th>미할당(Before→After)</th></tr></thead><tbody>{result.od.map((od) => <tr key={`${od.originStationId}-${od.destinationStationId}`}><th>{stationNames[od.originStationId] ?? od.originStationId}<small>{od.originStationId}</small></th><td>{stationNames[od.destinationStationId] ?? od.destinationStationId}<small>{od.destinationStationId}</small></td><td>{formatDaily(od.observedDailyAverage)}</td><td>{formatDaily(od.beforeDailyAverage)}<small>{assignmentText(od.beforeAssignments)}</small></td><td>{formatDaily(od.afterDailyAverage)}<small>{assignmentText(od.afterAssignments)}</small></td><td>{formatDelta(od.deltaDailyAverage)}</td><td>{formatDaily(od.unservedBeforeDailyAverage)} → {formatDaily(od.unservedAfterDailyAverage)}{warningDetails(od.warnings)}</td></tr>)}</tbody></table></div>}</div>
      </>}
    {result.warnings.length > 0 && <div className="scenario-comparison-warnings"><strong>해석 주의</strong>{result.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}
  </div>;
}

export default function ScenarioDemandPanel({ projectId, demand, routeStops, scenarioDefinitions, scenarioExecutionManifests }: ScenarioDemandPanelProps): JSX.Element {
  const eligibleManifests = useMemo(() => scenarioExecutionManifests.filter((manifest) => manifest.status === 'complete'), [scenarioExecutionManifests]);
  const initial = useMemo(() => initialSelectionIds(scenarioExecutionManifests), [scenarioExecutionManifests]);
  const [beforeId, setBeforeId] = useState(initial.beforeId);
  const [afterId, setAfterId] = useState(initial.afterId);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScenarioDemandProgress>();
  const [result, setResult] = useState<ScenarioDemandEstimationResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!eligibleManifests.some((manifest) => manifest.executionId === beforeId)) setBeforeId(initial.beforeId);
    if (!eligibleManifests.some((manifest) => manifest.executionId === afterId)) setAfterId(initial.afterId);
  }, [afterId, beforeId, eligibleManifests, initial]);

  const beforeManifest = scenarioExecutionManifests.find((manifest) => manifest.executionId === beforeId);
  const afterManifest = scenarioExecutionManifests.find((manifest) => manifest.executionId === afterId);
  const stationNames = useMemo(() => Object.fromEntries(routeStops.map((stop) => [stop.stationId, stop.stationName])), [routeStops]);
  const sameSelection = Boolean(beforeId && beforeId === afterId);
  const hasTwoArtifacts = eligibleManifests.length >= 2;
  const disabled = running || !demand || !beforeManifest || !afterManifest || !hasTwoArtifacts || sameSelection;

  async function run(): Promise<void> {
    if (!demand || !beforeManifest || !afterManifest || beforeManifest.executionId === afterManifest.executionId) return;
    setRunning(true);
    setProgress(undefined);
    setResult(undefined);
    setError(undefined);
    try {
      const nextResult = await runScenarioDemandEstimation({
        projectId,
        demand,
        before: selectionFor(beforeManifest, scenarioDefinitions),
        after: selectionFor(afterManifest, scenarioDefinitions)
      }, setProgress);
      setResult(nextResult);
    } catch (estimationError) {
      setError(errorMessage(estimationError));
    } finally {
      setRunning(false);
    }
  }

  return <section className="panel scenario-demand-panel">
    <div className="step-intro"><strong>시나리오 수요 추정</strong><span>관측 OD 수요를 저장된 Before·After 네트워크의 직접 운행 후보에 배분해 일평균 변화를 추정합니다.</span></div>
    <div className="scenario-demand-method" role="note"><strong>산정 방식</strong><span>모델 {DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG.modelVersion}</span><span>choiceSensitivity = {DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG.choiceSensitivity}</span><span>waitTimeWeight = {DEFAULT_SCENARIO_DEMAND_ESTIMATION_CONFIG.waitTimeWeight}</span><span>차내시간과 평균 대기시간으로 logit 비율을 계산합니다.</span><span>환승·운임·다중 노선 경로는 반영하지 않습니다.</span></div>
    <div className="scenario-editor-toolbar">
      <label className="field"><span>Before 대상</span><select aria-label="수요 추정 Before 대상" value={beforeId} onChange={(event) => { setBeforeId(event.target.value); setResult(undefined); setError(undefined); }}>{scenarioExecutionManifests.map((manifest) => <option key={manifest.executionId} value={manifest.executionId} disabled={manifest.status !== 'complete'}>{manifestOptionLabel(manifest, scenarioDefinitions)}</option>)}</select></label>
      <label className="field"><span>After 대상</span><select aria-label="수요 추정 After 대상" value={afterId} onChange={(event) => { setAfterId(event.target.value); setResult(undefined); setError(undefined); }}>{scenarioExecutionManifests.map((manifest) => <option key={manifest.executionId} value={manifest.executionId} disabled={manifest.status !== 'complete'}>{manifestOptionLabel(manifest, scenarioDefinitions)}</option>)}</select></label>
    </div>
    {!demand && <div className="warning-box" role="alert">OD 수요 분석을 먼저 실행하세요. 선택 요일과 일평균 기준이 수요 추정의 출처로 사용됩니다.</div>}
    {demand && scenarioExecutionManifests.length === 0 && <div className="warning-box" role="alert">수요 추정에 사용할 실행 artifact가 없습니다. 현재 네트워크와 시나리오 경로를 먼저 생성·저장하세요.</div>}
    {demand && scenarioExecutionManifests.length > 0 && !hasTwoArtifacts && <div className="warning-box" role="alert">완료된 실행 artifact 2개가 필요합니다. 실패 또는 부분 완료 결과는 수요 추정에서 제외됩니다.</div>}
    {sameSelection && <div className="warning-box" role="alert">Before와 After는 서로 다른 실행 artifact를 선택하세요.</div>}
    {demand && <div className="scenario-demand-source" role="note"><strong>수요 출처</strong><span>선택 관측일 {demand.selectedDays}일 · 일평균 기준 {demand.config.denominator === 'observed' ? '실제 관측일' : '전체 날짜'}</span><span>관측 승차 합계 {formatDaily(demand.totalBoardings)}</span>{demand.warnings.length > 0 && <span>수요 경고 {demand.warnings.length}건</span>}</div>}
    {progress && <div className="scenario-execution-progress" role="status"><strong>{progress.message}</strong><span>{progress.phase} · {progress.completed}/{progress.total || '전체'} 단계</span></div>}
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    {result && <ScenarioDemandResultView result={result} stationNames={stationNames} />}
    <button type="button" className="primary-button full" disabled={disabled} onClick={() => void run()}>{running ? '시나리오 수요 추정 중…' : '시나리오 수요 추정 실행'} <span>→</span></button>
  </section>;
}
