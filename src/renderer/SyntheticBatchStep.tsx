import type { JSX } from 'react';
import type { BatchSummary } from '../core/transit-batch';
import type { SyntheticGtfsBuildResult } from '../core/synthetic-gtfs/types';

export interface SyntheticBatchStepProps {
  result: SyntheticGtfsBuildResult;
  baseResult: SyntheticGtfsBuildResult;
  comparisonReady?: boolean;
  motisBusy: boolean;
  batchStartTime: string;
  batchEndTime: string;
  batchInterval: string;
  batchProgress?: string;
  batchSummary?: BatchSummary;
  isStale?: boolean;
  onRunBatch: () => Promise<void>;
  onInputChange: (field: 'batchStartTime' | 'batchEndTime' | 'batchInterval', value: string) => void;
}

function secondsLabel(value: number | null): string { return value === null ? '계산 불가' : `${Math.round(value / 60).toLocaleString('ko-KR')}분`; }

export default function SyntheticBatchStep({
  result,
  baseResult,
  comparisonReady = false,
  motisBusy,
  batchStartTime,
  batchEndTime,
  batchInterval,
  batchProgress,
  batchSummary,
  isStale = false,
  onRunBatch,
  onInputChange
}: SyntheticBatchStepProps): JSX.Element {
  const packagesReady = Boolean(result && baseResult);

  return <section className="panel synthetic-motis-panel synthetic-step-panel">
    <div className="synthetic-step-panel-heading"><div><strong>시간창 반복·스케일 실증</strong><span>동일 OD를 여러 출발시각에 반복해 Before·After 분포를 확인합니다.</span></div></div>
    {!comparisonReady && <div className="synthetic-step-lock" role="note">먼저 단일 OD Before/After 비교를 완료하세요.</div>}
    <div className="synthetic-form-grid synthetic-od-grid"><label className="field"><span>시작 시각</span><input type="time" value={batchStartTime} onChange={(event) => onInputChange('batchStartTime', event.target.value)} /></label><label className="field"><span>종료 시각</span><input type="time" value={batchEndTime} onChange={(event) => onInputChange('batchEndTime', event.target.value)} /></label><label className="field"><span>간격(분)</span><input type="number" min="1" value={batchInterval} onChange={(event) => onInputChange('batchInterval', event.target.value)} /></label></div>
    <button className="primary-button" disabled={motisBusy || !packagesReady || !comparisonReady} onClick={() => void onRunBatch()}>시간창 배치 실행</button>
    {batchProgress && <div className="motis-status motis-status-starting" role="status">{batchProgress}</div>}
    {isStale && batchSummary && <div className="synthetic-stale-note" role="status">입력이 변경되어 다시 실행해야 합니다.</div>}
    {batchSummary && <div className="synthetic-comparison"><strong>배치 요약 · {batchSummary.sampleCount}개 시점</strong><div className="synthetic-comparison-grid"><div><small>평균</small><strong>{secondsLabel(batchSummary.meanTotalSecondsBefore)} → {secondsLabel(batchSummary.meanTotalSecondsAfter)}</strong></div><div><small>중앙값</small><strong>{secondsLabel(batchSummary.medianTotalSecondsBefore)} → {secondsLabel(batchSummary.medianTotalSecondsAfter)}</strong></div><div><small>P90</small><strong>{secondsLabel(batchSummary.p90TotalSecondsBefore)} → {secondsLabel(batchSummary.p90TotalSecondsAfter)}</strong></div><div><small>여정 발견</small><strong>{batchSummary.foundBefore}/{batchSummary.sampleCount} → {batchSummary.foundAfter}/{batchSummary.sampleCount}</strong></div></div>{batchSummary.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
  </section>;
}
