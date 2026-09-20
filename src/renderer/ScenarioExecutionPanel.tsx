import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { runScenarioExecution, type ScenarioExecutionProgress } from './scenario-execution-client';
import type { RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioExecutionManifest, ScenarioExecutionResult } from '../shared/types';

export interface ScenarioExecutionPanelProps {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  onExecutionSaved?: (manifest: ScenarioExecutionManifest) => void;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '시나리오 경로 실행에 실패했습니다.'; }

function statusLabel(status: ScenarioExecutionManifest['status']): string {
  return status === 'complete' ? '완료' : status === 'partial' ? '부분 완료' : '실패';
}

function formatMeters(value: number | null): string {
  return value === null ? '계산 불가' : value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value).toLocaleString('ko-KR')} m`;
}

function formatSeconds(value: number | null): string { return value === null ? '계산 불가' : `${Math.round(value / 60).toLocaleString('ko-KR')}분`; }

function resultSummary(result: ScenarioExecutionResult) {
  const routes = result.after.routes;
  const segments = routes.flatMap((route) => route.directions.flatMap((direction) => direction.segments));
  return {
    routeCount: routes.length,
    completeRouteCount: routes.filter((route) => route.status === 'complete').length,
    partialRouteCount: routes.filter((route) => route.status === 'partial').length,
    failedRouteCount: routes.filter((route) => route.status === 'failed').length,
    routedSegmentCount: segments.filter((segment) => segment.source === 'osm').length,
    fallbackSegmentCount: segments.filter((segment) => segment.source === 'beeline').length,
    distanceMeters: routes.reduce((sum, route) => sum + (route.totalDistanceMeters ?? 0), 0) || null,
    runtimeSeconds: routes.reduce((sum, route) => sum + (route.totalRuntimeSeconds ?? 0), 0) || null
  };
}

export default function ScenarioExecutionPanel({ projectId, routeStops, serviceConfigs, scenarioDefinitions, onExecutionSaved }: ScenarioExecutionPanelProps): JSX.Element {
  const [targetId, setTargetId] = useState('current');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScenarioExecutionProgress>();
  const [manifest, setManifest] = useState<ScenarioExecutionManifest>();
  const [result, setResult] = useState<ScenarioExecutionResult>();
  const [error, setError] = useState<string>();
  const selectedScenario = scenarioDefinitions.find((definition) => definition.scenarioId === targetId);
  const target = targetId === 'current' ? { kind: 'current' as const } : { kind: 'scenario' as const, scenarioId: targetId };
  const summary = useMemo(() => result ? resultSummary(result) : undefined, [result]);
  const disabled = routeStops.length < 2 || running || (target.kind === 'scenario' && !selectedScenario);

  async function execute(): Promise<void> {
    setRunning(true);
    setError(undefined);
    setManifest(undefined);
    setResult(undefined);
    try {
      const saved = await runScenarioExecution({
        projectId,
        target,
        routeStops,
        serviceConfigs,
        ...(selectedScenario ? { scenarioDefinition: selectedScenario } : {}),
        now: new Date().toISOString()
      }, setProgress);
      setManifest(saved);
      if (window.transitDesktop) setResult(await window.transitDesktop.readScenarioExecution({ projectId, executionId: saved.executionId }));
      onExecutionSaved?.(saved);
    } catch (executionError) {
      setError(errorMessage(executionError));
    } finally {
      setRunning(false);
    }
  }

  return <section className="panel scenario-execution-panel">
    <div className="step-intro"><strong>시나리오 경로 생성·저장</strong><span>다수 노선의 Before/After 도로 경로와 운행정보를 하나의 실행 결과로 저장합니다.</span></div>
    <div className="info-box" role="note">실행 결과는 이후 현행↔시나리오 또는 시나리오↔시나리오 비교에서 읽습니다. 이번 화면에서는 수요 변화·이용요금·여정 비교를 계산하지 않습니다.</div>
    <div className="scenario-editor-toolbar">
      <label className="field"><span>실행 대상</span><select aria-label="실행 대상" value={targetId} onChange={(event) => { setTargetId(event.target.value); setManifest(undefined); setResult(undefined); setError(undefined); }}><option value="current">현재 네트워크</option>{scenarioDefinitions.map((definition) => <option key={definition.scenarioId} value={definition.scenarioId}>{definition.label} · {definition.scenarioId}</option>)}</select></label>
    </div>
    <div className="scenario-execution-environment" role="note"><strong>실행 환경</strong><span>MOTIS BUS routing · 선택한 OSM PBF SHA-256을 fingerprint에 포함 · 운행시간은 geometry 기반 모델 추정</span></div>
    {routeStops.length < 2 && <div className="warning-box" role="alert">실행할 노선 master가 없습니다. 노선별 정류장정보를 먼저 준비하세요.</div>}
    {target.kind === 'scenario' && !selectedScenario && <div className="error-box" role="alert">선택한 시나리오 정의를 찾을 수 없습니다.</div>}
    {progress && <div className="scenario-execution-progress" role="status"><strong>{progress.message}</strong><span>{progress.phase} · {progress.completed}/{progress.total || '전체'} 단계</span></div>}
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    {manifest && <div className={`scenario-execution-result scenario-execution-${manifest.status}`} role="status"><strong>실행 상태: {statusLabel(manifest.status)}</strong><span>노선 {manifest.routeCount}개 · 완전 경로 {manifest.completeRouteCount}개 · 경고 {manifest.warningCount}건</span>{manifest.status !== 'complete' && <span>일부 구간은 추정 또는 실패 상태이며 실제 도로 경로 완료로 해석하지 않습니다.</span>}{summary && <div className="synthetic-summary-grid"><div><small>전체 노선</small><strong>{summary.routeCount}개</strong></div><div><small>실제 BUS 경로</small><strong>{summary.routedSegmentCount}구간</strong></div><div><small>fallback</small><strong>{summary.fallbackSegmentCount}구간</strong></div><div><small>총 연장</small><strong>{formatMeters(summary.distanceMeters)}</strong></div><div><small>추정 운행시간 합계</small><strong>{formatSeconds(summary.runtimeSeconds)}</strong></div><div><small>부분·실패 노선</small><strong>{summary.partialRouteCount + summary.failedRouteCount}개</strong></div></div>}</div>}
    <p className="scenario-execution-quality-note">MOTIS BUS geometry가 없으면 fallback 직선 geometry를 저장할 수 있지만, fallback 구간은 실제 도로 경로가 아닙니다. 운행시간은 선택한 모델의 추정값입니다.</p>
    <button type="button" className="primary-button full" disabled={disabled} onClick={() => void execute()}>{running ? '시나리오 경로 생성 중…' : '전체 네트워크 경로 생성·저장'} <span>→</span></button>
  </section>;
}
