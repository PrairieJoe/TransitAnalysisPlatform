import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { compareJourneys, type JourneyComparison, type NormalizedJourney } from '../core/transit-comparison';
import type { ScenarioJourneyResult } from '../core/scenario-journey';
import type { ScenarioJourneyJobRequest } from '../main/scenario-journey-job';
import type { JobProgress } from '../shared/job-types';
import type {
  CoordinateScenarioJourneyQuery,
  MotisOsmPbfMetadata,
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioExecutionTarget,
  ScenarioJourneyEndpoint,
  ScenarioJourneyExecutionManifest,
  ScenarioJourneyQuery
} from '../shared/types';

export interface ScenarioJourneyComparisonProps {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  scenarioJourneyManifests?: ScenarioJourneyExecutionManifest[];
  onJourneySaved?: (manifest: ScenarioJourneyExecutionManifest) => void;
}

type TargetKey = 'current' | `scenario:${string}`;

function id(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function targetFromKey(key: TargetKey): ScenarioExecutionTarget {
  return key === 'current' ? { kind: 'current' } : { kind: 'scenario', scenarioId: key.slice('scenario:'.length) };
}

function keyForTarget(target: ScenarioExecutionTarget): TargetKey {
  return target.kind === 'current' ? 'current' : `scenario:${target.scenarioId}`;
}

function targetLabel(target: ScenarioExecutionTarget, definitions: ScenarioDefinition[]): string {
  return target.kind === 'current'
    ? '현재 네트워크'
    : definitions.find((definition) => definition.scenarioId === target.scenarioId)?.label ?? `시나리오 ${target.scenarioId}`;
}

function endpointLabel(endpoint: ScenarioJourneyEndpoint): string {
  return endpoint.kind === 'stop' ? endpoint.stopId : endpoint.label || `${endpoint.latitude}, ${endpoint.longitude}`;
}

function queryLabel(query: ScenarioJourneyQuery): string {
  if ('originStopId' in query) return `${query.originStopId} → ${query.destinationStopId}`;
  return `${endpointLabel(query.origin)} → ${endpointLabel(query.destination)}`;
}

function queriesForTarget(target: ScenarioExecutionTarget, definitions: ScenarioDefinition[]): ScenarioJourneyQuery[] {
  const definition = target.kind === 'scenario'
    ? definitions.find((candidate) => candidate.scenarioId === target.scenarioId)
    : definitions[0];
  return [...(definition?.journeyQueries ?? [])];
}

function statusLabel(status: ScenarioJourneyExecutionManifest['status']): string {
  return status === 'complete' ? '완료' : status === 'partial' ? '부분 결과' : '실패';
}

function resultStatus(result: ScenarioJourneyResult): ScenarioJourneyExecutionManifest['status'] {
  const hasWarnings = result.warnings.length > 0 || result.before.journeys.some((journey) => journey.warnings.length > 0) || result.after.journeys.some((journey) => journey.warnings.length > 0);
  return result.status === 'complete' && hasWarnings ? 'partial' : result.status;
}

function summaryStatus(summary: ScenarioJourneyExecutionManifest): ScenarioJourneyExecutionManifest['status'] {
  return summary.status === 'complete' && summary.warningCount > 0 ? 'partial' : summary.status;
}

function formatSeconds(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}초`;
}

function formatDelta(value: number | null): string {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${Math.round(value)}초`;
}

function formatCount(value: number | null): string {
  return value === null ? '—' : `${value}회`;
}

function emptyJourney(message: string): NormalizedJourney {
  return {
    found: false,
    totalSeconds: 0,
    accessWalkSeconds: 0,
    egressWalkSeconds: 0,
    initialWaitSeconds: 0,
    transferWaitSeconds: 0,
    transferWalkSeconds: 0,
    accessWalkMeters: 0,
    transferWalkMeters: 0,
    egressWalkMeters: 0,
    directWalkSeconds: 0,
    directWalkMeters: 0,
    transferCount: 0,
    inVehicleSeconds: 0,
    walkMeters: 0,
    legs: [],
    warnings: [message]
  };
}

function journeyComparison(before: NormalizedJourney | undefined, after: NormalizedJourney | undefined): JourneyComparison {
  return compareJourneys(before ?? emptyJourney('Before 결과가 없습니다.'), after ?? emptyJourney('After 결과가 없습니다.'));
}

function sumSeconds(value: NormalizedJourney, fields: Array<'initialWaitSeconds' | 'transferWaitSeconds'> | Array<'accessWalkSeconds' | 'transferWalkSeconds' | 'egressWalkSeconds'>): number {
  return fields.reduce((sum, field) => sum + value[field], 0);
}

function renderJourneyCell(value: NormalizedJourney, field: keyof NormalizedJourney, formatter: (value: number) => string = formatSeconds): string {
  if (!value.found) return '경로 없음';
  return formatter(value[field] as number);
}

function JourneySide({ label, journey, departureDateTime, missingLabel }: { label: string; journey: NormalizedJourney; departureDateTime: string; missingLabel?: string }): JSX.Element {
  return <div className="scenario-journey-side">
    <strong>{label}</strong>
    <span>출발시각: {departureDateTime}</span>
    {!journey.found && <span className="warning-box" role="note">{missingLabel ?? '경로 없음'}</span>}
    {journey.found && <span>이용수단: {[...new Set(journey.legs.map((leg) => leg.mode))].join(' → ') || '확인 불가'}</span>}
    {journey.warnings.map((warning) => <small key={warning}>{warning}</small>)}
  </div>;
}

function JourneyMetricTable({ comparison }: { comparison: JourneyComparison }): JSX.Element {
  const before = comparison.before;
  const after = comparison.after;
  const rows: Array<{ label: string; before: string; after: string; delta: string }> = [
    { label: '총 소요시간', before: renderJourneyCell(before, 'totalSeconds'), after: renderJourneyCell(after, 'totalSeconds'), delta: formatDelta(comparison.delta.totalSeconds) },
    { label: '접근 보행', before: renderJourneyCell(before, 'accessWalkSeconds'), after: renderJourneyCell(after, 'accessWalkSeconds'), delta: formatDelta(comparison.delta.accessWalkSeconds) },
    { label: '환승 보행', before: renderJourneyCell(before, 'transferWalkSeconds'), after: renderJourneyCell(after, 'transferWalkSeconds'), delta: formatDelta(comparison.delta.transferWalkSeconds) },
    { label: '귀가 보행', before: renderJourneyCell(before, 'egressWalkSeconds'), after: renderJourneyCell(after, 'egressWalkSeconds'), delta: formatDelta(comparison.delta.egressWalkSeconds) },
    { label: '직접 보행', before: renderJourneyCell(before, 'directWalkSeconds'), after: renderJourneyCell(after, 'directWalkSeconds'), delta: formatDelta(comparison.delta.directWalkSeconds) },
    { label: '차량 탑승', before: renderJourneyCell(before, 'inVehicleSeconds'), after: renderJourneyCell(after, 'inVehicleSeconds'), delta: formatDelta(comparison.delta.inVehicleSeconds) },
    { label: '대기', before: before.found ? formatSeconds(sumSeconds(before, ['initialWaitSeconds', 'transferWaitSeconds'])) : '경로 없음', after: after.found ? formatSeconds(sumSeconds(after, ['initialWaitSeconds', 'transferWaitSeconds'])) : '경로 없음', delta: formatDelta(comparison.delta.initialWaitSeconds === null || comparison.delta.transferWaitSeconds === null ? null : comparison.delta.initialWaitSeconds + comparison.delta.transferWaitSeconds) },
    { label: '환승 횟수', before: before.found ? formatCount(before.transferCount) : '경로 없음', after: after.found ? formatCount(after.transferCount) : '경로 없음', delta: comparison.delta.transferCount === null ? '—' : `${comparison.delta.transferCount > 0 ? '+' : ''}${comparison.delta.transferCount}회` }
  ];
  return <table className="scenario-journey-metrics"><thead><tr><th>항목</th><th>Before</th><th>After</th><th>변화</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.before}</td><td>{row.after}</td><td>{row.delta}</td></tr>)}</tbody></table>;
}

export function ScenarioJourneyResultView({ result, scenarioDefinitions = [] }: { result: ScenarioJourneyResult; scenarioDefinitions?: ScenarioDefinition[] }): JSX.Element {
  const displayedStatus = resultStatus(result);
  return <div className={`scenario-comparison-result scenario-journey-result-${displayedStatus}`} role="status">
    <div className="scenario-result-heading"><strong>A–B 비교 결과 · {statusLabel(displayedStatus)}</strong><span>{targetLabel(result.before.target, scenarioDefinitions)} → {targetLabel(result.after.target, scenarioDefinitions)}</span></div>
    {result.warnings.length > 0 && <div className="warning-box" role="alert"><strong>해석 주의</strong>{result.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}
    <div className="scenario-comparison-section"><h4>X→Y 여정 결과</h4>{result.queries.map((query, index) => {
      const comparison = journeyComparison(result.before.journeys[index], result.after.journeys[index]);
      const afterOnly = !comparison.before.found && comparison.after.found;
      return <article className="scenario-journey-comparison" key={`${queryLabel(query)}-${index}`}>
        <strong>{queryLabel(query)} · {query.departureDateTime}</strong>
        <div className="scenario-journey-grid"><JourneySide label="Before" journey={comparison.before} departureDateTime={query.departureDateTime} missingLabel={afterOnly ? '현행 대응 없음' : undefined} /><JourneySide label="After" journey={comparison.after} departureDateTime={query.departureDateTime} /></div>
        {afterOnly && <div className="synthetic-after-only-note" role="note"><strong>개편안 신규 경로</strong><span>현행 대응 없음 · 동일한 OD의 개편안 경로만 확인되었습니다.</span></div>}
        <JourneyMetricTable comparison={comparison} />
      </article>;
    })}</div>
    <div className="info-box" role="note">운임 계산 불가: 운임 규칙과 교통카드 환승 정책이 연결되지 않았습니다.</div>
  </div>;
}

function manifestLabel(manifest: ScenarioJourneyExecutionManifest, definitions: ScenarioDefinition[]): string {
  return `${targetLabel(manifest.beforeTarget, definitions)} → ${targetLabel(manifest.afterTarget, definitions)} · ${statusLabel(summaryStatus(manifest))} · ${manifest.updatedAt}`;
}

export default function ScenarioJourneyComparison({ projectId, routeStops, serviceConfigs, scenarioDefinitions, scenarioJourneyManifests = [], onJourneySaved }: ScenarioJourneyComparisonProps): JSX.Element {
  const initialAfterKey: TargetKey = scenarioDefinitions[0] ? `scenario:${scenarioDefinitions[0].scenarioId}` : 'current';
  const [beforeKey, setBeforeKey] = useState<TargetKey>('current');
  const [afterKey, setAfterKey] = useState<TargetKey>(initialAfterKey);
  const [pbf, setPbf] = useState<MotisOsmPbfMetadata>();
  const [queries, setQueries] = useState<ScenarioJourneyQuery[]>(() => queriesForTarget(targetFromKey(initialAfterKey), scenarioDefinitions));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<JobProgress>();
  const [result, setResult] = useState<ScenarioJourneyResult>();
  const [summary, setSummary] = useState<ScenarioJourneyExecutionManifest>();
  const [error, setError] = useState<string>();
  const activeJobRef = useRef<string | undefined>(undefined);
  const activeExecutionRef = useRef<string | undefined>(undefined);

  const beforeTarget = targetFromKey(beforeKey);
  const afterTarget = targetFromKey(afterKey);
  const querySource = afterTarget.kind === 'scenario' ? afterTarget.scenarioId : scenarioDefinitions[0]?.scenarioId;
  const availableTargets = useMemo(() => [{ key: 'current' as const, target: { kind: 'current' as const } }, ...scenarioDefinitions.map((definition) => ({ key: `scenario:${definition.scenarioId}` as TargetKey, target: { kind: 'scenario' as const, scenarioId: definition.scenarioId }, label: definition.label }))], [scenarioDefinitions]);

  useEffect(() => {
    if (!availableTargets.some((item) => item.key === afterKey)) setAfterKey(availableTargets.find((item) => item.key !== beforeKey)?.key ?? 'current');
    if (!availableTargets.some((item) => item.key === beforeKey)) setBeforeKey('current');
  }, [afterKey, availableTargets, beforeKey]);

  useEffect(() => {
    const nextTarget = afterTarget.kind === 'scenario' ? afterTarget : scenarioDefinitions[0] ? { kind: 'scenario' as const, scenarioId: scenarioDefinitions[0].scenarioId } : afterTarget;
    setQueries(queriesForTarget(nextTarget, scenarioDefinitions));
    setResult(undefined);
    setSummary(undefined);
    setError(undefined);
  }, [querySource, scenarioDefinitions]);

  useEffect(() => {
    const api = window.transitDesktop;
    if (!api) return undefined;
    return api.onJobProgress((nextProgress) => {
      if (nextProgress.operation !== 'scenario-journey' || nextProgress.jobId !== activeJobRef.current) return;
      setProgress(nextProgress);
      if (nextProgress.status === 'completed') {
        const executionId = nextProgress.executionId ?? activeExecutionRef.current;
        if (!executionId) return;
        void Promise.all([
          api.getScenarioJourneySummary({ projectId, executionId }),
          api.getScenarioJourneyResult({ projectId, executionId })
        ]).then(([nextSummary, nextResult]) => {
          setSummary(nextSummary);
          setResult(nextResult);
          onJourneySaved?.(nextSummary);
          setRunning(false);
        }).catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : 'A–B 결과를 다시 읽지 못했습니다.');
          setRunning(false);
        });
      } else if (nextProgress.status === 'cancelled' || nextProgress.status === 'failed') {
        setRunning(false);
        if (nextProgress.status === 'failed') setError(nextProgress.message ?? 'A–B 비교 job이 실패했습니다.');
      }
    });
  }, [onJourneySaved, projectId]);

  async function selectPbf(): Promise<void> {
    if (!window.transitDesktop) return;
    try {
      const selected = await window.transitDesktop.selectMotisOsmPbf();
      setPbf(selected ?? undefined);
      setError(undefined);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'OSM PBF를 선택하지 못했습니다.');
    }
  }

  async function run(): Promise<void> {
    const api = window.transitDesktop;
    if (!api) { setError('데스크톱 실행 환경에서만 A–B 비교를 실행할 수 있습니다.'); return; }
    if (!pbf) { setError('먼저 OSM PBF 파일을 선택하세요.'); return; }
    if (!queries.length) { setError('저장된 좌표 A–B 질의가 없습니다. 시나리오 정의에서 질의를 추가하고 저장하세요.'); return; }
    if (keyForTarget(beforeTarget) === keyForTarget(afterTarget)) { setError('Before와 After는 서로 다른 대상을 선택하세요.'); return; }
    const jobId = id('scenario-journey-job');
    const executionId = id('scenario-journey-execution');
    activeJobRef.current = jobId;
    activeExecutionRef.current = executionId;
    setRunning(true);
    setProgress(undefined);
    setSummary(undefined);
    setResult(undefined);
    setError(undefined);
    const request: ScenarioJourneyJobRequest = {
      jobId,
      executionId,
      projectId,
      before: beforeTarget,
      after: afterTarget,
      routeStops,
      serviceConfigs,
      scenarioDefinitions,
      queries,
      osmPbfPath: pbf.path,
      now: new Date().toISOString()
    };
    try {
      await api.runScenarioJourney(request);
    } catch (runError) {
      setRunning(false);
      setError(runError instanceof Error ? runError.message : 'A–B 비교를 시작하지 못했습니다.');
    }
  }

  async function cancel(): Promise<void> {
    const api = window.transitDesktop;
    const jobId = activeJobRef.current;
    if (!api || !jobId) return;
    const cancellation = await api.cancelJob(jobId);
    if (cancellation.accepted) setProgress((current) => current ? { ...current, status: 'cancelling' } : current);
  }

  async function reopen(executionId: string): Promise<void> {
    const api = window.transitDesktop;
    if (!api) return;
    try {
      const [nextSummary, nextResult] = await Promise.all([
        api.getScenarioJourneySummary({ projectId, executionId }),
        api.getScenarioJourneyResult({ projectId, executionId })
      ]);
      setSummary(nextSummary);
      setResult(nextResult);
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '저장된 A–B 결과를 열지 못했습니다.');
    }
  }

  const disabled = running || routeStops.length < 2 || !pbf || beforeKey === afterKey;

  return <section className="panel scenario-journey-comparison-panel">
    <div className="step-intro"><strong>좌표 A–B 여정 비교</strong><span>저장된 좌표 질의를 메인 프로세스에서 Before·After에 동일하게 실행하고, 취소 가능한 bounded 결과 artifact로 저장합니다.</span></div>
    <div className="info-box" role="note">이 비교는 선택한 OSM PBF·MOTIS binary fingerprint가 같은 환경에서만 재사용됩니다. 운임은 계산하지 않습니다.</div>
    <div className="scenario-editor-toolbar">
      <label className="field"><span>Before 대상</span><select aria-label="A–B Before 대상" value={beforeKey} onChange={(event) => { setBeforeKey(event.target.value as TargetKey); setResult(undefined); }}><option value="current">현재 네트워크</option>{scenarioDefinitions.map((definition) => <option key={definition.scenarioId} value={`scenario:${definition.scenarioId}`}>{definition.label}</option>)}</select></label>
      <label className="field"><span>After 대상</span><select aria-label="A–B After 대상" value={afterKey} onChange={(event) => { setAfterKey(event.target.value as TargetKey); setResult(undefined); }}><option value="current">현재 네트워크</option>{scenarioDefinitions.map((definition) => <option key={definition.scenarioId} value={`scenario:${definition.scenarioId}`}>{definition.label}</option>)}</select></label>
    </div>
    <div className="scenario-execution-environment" role="note"><strong>OSM PBF</strong><span>{pbf ? `${pbf.fileName} · SHA-256 ${pbf.sha256}` : '선택되지 않음'}</span><button type="button" className="secondary-button" onClick={() => void selectPbf()} disabled={running}>PBF 선택</button></div>
    {scenarioDefinitions.length === 0 && <div className="warning-box" role="alert">After 시나리오가 없습니다. 좌표 질의를 포함한 시나리오를 먼저 저장하세요.</div>}
    {beforeKey === afterKey && <div className="warning-box" role="alert">Before와 After는 서로 다른 대상을 선택하세요.</div>}
    {!queries.length && <div className="warning-box" role="alert">선택한 After 기준으로 저장된 좌표 A–B 질의가 없습니다.</div>}
    {queries.length > 0 && <div className="scenario-journey-queries"><div className="scenario-route-heading"><div><strong>실행 질의</strong><span>시나리오 정의에 저장된 {queries.length}개 질의를 사용합니다.</span></div></div>{queries.map((query, index) => <div className="scenario-query-row" key={`${queryLabel(query)}-${index}`}><span>{index + 1}. {queryLabel(query)}</span><span>{query.departureDateTime}</span></div>)}</div>}
    {progress && <div className="scenario-execution-progress" role="status"><strong>{progress.message}</strong><span>{progress.phase} · {progress.completed ?? 0}/{progress.total || '전체'} 단계 · {progress.status}</span></div>}
    {error && <div className="error-box" role="alert">⚠ {error}</div>}
    {summary && <div className={`scenario-execution-result scenario-execution-${summaryStatus(summary)}`} role="status"><strong>저장 상태: {statusLabel(summaryStatus(summary))}</strong><span>질의 {summary.queryCount}개 · Before 경로 {summary.foundBeforeCount}개 · After 경로 {summary.foundAfterCount}개 · 경고 {summary.warningCount}건</span><span>평균 시간 변화: {formatDelta(summary.meanDeltaSeconds)} · 중앙값: {formatDelta(summary.medianDeltaSeconds)} · P90: {formatDelta(summary.p90DeltaSeconds)}</span></div>}
    {result && <ScenarioJourneyResultView result={result} scenarioDefinitions={scenarioDefinitions} />}
    {scenarioJourneyManifests.length > 0 && <div className="scenario-comparison-section"><h4>저장된 A–B 결과 다시 열기</h4>{scenarioJourneyManifests.map((manifest) => <div className="scenario-query-row" key={manifest.executionId}><span>{manifestLabel(manifest, scenarioDefinitions)}</span><button type="button" className="secondary-button" onClick={() => void reopen(manifest.executionId)} disabled={running}>열기</button></div>)}</div>}
    <div className="scenario-editor-toolbar"><button type="button" className="primary-button" disabled={disabled} onClick={() => void run()}>{running ? 'A–B 비교 진행 중…' : 'A–B 비교 실행'} <span>→</span></button>{running && <button type="button" className="secondary-button" onClick={() => void cancel()}>취소</button>}</div>
  </section>;
}
