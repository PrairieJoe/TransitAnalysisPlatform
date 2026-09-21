import type { JSX } from 'react';
import type { JourneyComparison } from '../core/transit-comparison';
import type { ShapeQualityReport } from '../core/synthetic-gtfs/shape-quality';
import type { SyntheticGtfsBuildResult } from '../core/synthetic-gtfs/types';
import type { MotisOsmPbfMetadata, MotisRuntimeDefaults, MotisStatus } from '../shared/types';

export interface SyntheticMotisStepProps {
  result: SyntheticGtfsBuildResult;
  baseResult: SyntheticGtfsBuildResult;
  osmPbfPath: string;
  osmPbfMetadata?: MotisOsmPbfMetadata;
  motisDefaults?: MotisRuntimeDefaults;
  motisStatus: MotisStatus;
  motisBusy: boolean;
  availableStops?: Array<{ stationId: string; stationName: string }>;
  originStopId: string;
  destinationStopId: string;
  departureDateTime: string;
  journeyComparison?: JourneyComparison;
  shapeQuality?: ShapeQualityReport;
  onRunBeforeAfter: () => Promise<void>;
  onStopMotis: () => Promise<void>;
  onSelectOsmPbf: () => Promise<void>;
  onInspectOsmPbf: () => Promise<void>;
  onOpenOsmDownloadPage: () => Promise<void>;
  onInputChange: (field: 'osmPbfPath' | 'originStopId' | 'destinationStopId' | 'departureDateTime', value: string) => void;
}

function secondsLabel(value: number | null): string { return value === null ? '계산 불가' : `${Math.round(value / 60).toLocaleString('ko-KR')}분`; }
function displayDelta(value: number | null): string { return value === null ? '—' : `${value > 0 ? '+' : ''}${Math.round(value / 60)}분`; }
function formatFileSize(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export default function SyntheticMotisStep({
  result,
  baseResult,
  osmPbfPath,
  osmPbfMetadata,
  motisDefaults,
  motisStatus,
  motisBusy,
  availableStops = [],
  originStopId,
  destinationStopId,
  departureDateTime,
  journeyComparison,
  shapeQuality,
  onRunBeforeAfter,
  onStopMotis,
  onSelectOsmPbf,
  onInspectOsmPbf,
  onOpenOsmDownloadPage,
  onInputChange
}: SyntheticMotisStepProps): JSX.Element {
  const packagesReady = Boolean(result && baseResult);
  const pathReady = Boolean(osmPbfPath.trim());

  return <section className="panel synthetic-motis-panel synthetic-step-panel">
    <div className="synthetic-step-panel-heading"><div><strong>MOTIS 로컬 실증</strong><span>생성한 Before·After 패키지를 같은 OSM 환경에서 비교합니다.</span></div></div>
    <div className="synthetic-form-grid">
      <label className="field"><span>지역 OSM PBF</span><div className="synthetic-path-picker"><input value={osmPbfPath} onChange={(event) => onInputChange('osmPbfPath', event.target.value)} placeholder="Geofabrik PBF 파일 경로" /><button type="button" className="secondary-button" onClick={() => void onSelectOsmPbf()}>파일 선택</button></div><small>Geofabrik에서 받은 `.osm.pbf` 파일을 선택한 뒤 검증하세요.</small></label>
    </div>
    {!pathReady && <div className="synthetic-step-lock" role="note">먼저 OSM PBF 파일을 선택하거나 경로를 입력하세요.</div>}
    {pathReady && !osmPbfMetadata && <div className="synthetic-step-hint" role="note">PBF 파일 검증을 실행하면 선택한 파일의 크기와 SHA-256을 확인할 수 있습니다.</div>}
    <div className="motis-managed-status" role="note">앱 내장 MOTIS · 로컬 데이터 자동 관리 · 타일 지도 제외</div>
    <details className="synthetic-technical-details">
      <summary>기술 상세 · MOTIS 실행 환경</summary>
      <div className="synthetic-technical-content"><div className="synthetic-form-grid">
        <label className="field"><span>내장 MOTIS 실행 파일</span><input value={motisDefaults?.executablePath ?? '불러오는 중…'} readOnly /></label>
        <label className="field"><span>관리 데이터 디렉터리</span><input value={motisDefaults?.dataDirectory ?? '불러오는 중…'} readOnly /></label>
        <label className="field"><span>로컬 포트</span><input value={motisDefaults?.port ?? '불러오는 중…'} readOnly /></label>
      </div><div className="synthetic-shape-quality"><strong>BUS shape 원시 진단</strong><span>{shapeQuality ? `beeline ${(shapeQuality.beelineRate * 100).toFixed(1)}% · 우회비율 ${shapeQuality.detourRatio.toFixed(2)} · routed ${shapeQuality.routedSegments} · beelined ${shapeQuality.beelinedSegments}` : 'MOTIS 응답에 shape 품질 지표가 포함될 때 표시합니다.'}</span>{shapeQuality?.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div></div>
    </details>
    <div className="synthetic-osm-actions"><button type="button" className="secondary-button" onClick={() => void onOpenOsmDownloadPage()}>Geofabrik 다운로드 페이지 열기 ↗</button><button type="button" className="secondary-button" onClick={() => void onInspectOsmPbf()}>PBF 파일 검증</button></div>
    {osmPbfMetadata && <div className="synthetic-osm-metadata" role="status"><strong>OSM PBF 확인 완료</strong><span>{osmPbfMetadata.fileName} · {formatFileSize(osmPbfMetadata.sizeBytes)}</span><small>SHA-256: {osmPbfMetadata.sha256}</small></div>}
    <small>대한민국 전체 PBF도 앱 내장 MOTIS가 사용됩니다. Windows 호환성을 위한 worker 제한과 지도 타일 제외는 앱이 자동으로 적용합니다.</small>
    <div className={`motis-status motis-status-${motisStatus.state}`} role="status"><strong>MOTIS 상태: {motisStatus.state}</strong><span>{motisStatus.message ?? '아직 실행하지 않았습니다.'}</span></div>
    <div className="synthetic-action-row"><button className="primary-button" disabled={motisBusy || !packagesReady || !pathReady} onClick={() => void onRunBeforeAfter()}>MOTIS 준비·실행 + Before/After OD</button><button className="secondary-button" disabled={motisBusy} onClick={() => void onStopMotis()}>MOTIS 중지</button></div>
    <div className="synthetic-form-grid synthetic-od-grid">
      <label className="field"><span>출발 정류장 ID</span><input list="synthetic-stop-options" value={originStopId} onChange={(event) => onInputChange('originStopId', event.target.value)} /></label>
      <label className="field"><span>도착 정류장 ID</span><input list="synthetic-stop-options" value={destinationStopId} onChange={(event) => onInputChange('destinationStopId', event.target.value)} /></label>
      <label className="field"><span>출발 일시(KST)</span><input type="datetime-local" value={departureDateTime} onChange={(event) => onInputChange('departureDateTime', event.target.value)} /></label>
      <datalist id="synthetic-stop-options">{availableStops.map((stop) => <option key={stop.stationId} value={stop.stationId}>{stop.stationName}</option>)}</datalist>
    </div>
    {journeyComparison && <div className="synthetic-comparison"><strong>Before / After 여정 비교</strong><div className="synthetic-comparison-grid"><div><small>총 소요시간</small><strong>{secondsLabel(journeyComparison.before.totalSeconds)} → {secondsLabel(journeyComparison.after.totalSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.totalSeconds)}</span></div><div><small>차량 탑승시간</small><strong>{secondsLabel(journeyComparison.before.inVehicleSeconds)} → {secondsLabel(journeyComparison.after.inVehicleSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.inVehicleSeconds)}</span></div><div><small>초기 대기</small><strong>{secondsLabel(journeyComparison.before.initialWaitSeconds)} → {secondsLabel(journeyComparison.after.initialWaitSeconds)}</strong><span>델타 {displayDelta(journeyComparison.delta.initialWaitSeconds)}</span></div><div><small>환승 대기·보행</small><strong>{secondsLabel(journeyComparison.before.transferWaitSeconds + journeyComparison.before.transferWalkSeconds)} → {secondsLabel(journeyComparison.after.transferWaitSeconds + journeyComparison.after.transferWalkSeconds)}</strong><span>델타 {displayDelta((journeyComparison.delta.transferWaitSeconds ?? 0) + (journeyComparison.delta.transferWalkSeconds ?? 0))}</span></div><div><small>접근·귀가 보행</small><strong>{secondsLabel(journeyComparison.before.accessWalkSeconds + journeyComparison.before.egressWalkSeconds)} → {secondsLabel(journeyComparison.after.accessWalkSeconds + journeyComparison.after.egressWalkSeconds)}</strong><span>델타 {displayDelta((journeyComparison.delta.accessWalkSeconds ?? 0) + (journeyComparison.delta.egressWalkSeconds ?? 0))}</span></div><div><small>환승 횟수</small><strong>{journeyComparison.before.transferCount}회 → {journeyComparison.after.transferCount}회</strong><span>델타 {journeyComparison.delta.transferCount === null ? '—' : `${journeyComparison.delta.transferCount > 0 ? '+' : ''}${journeyComparison.delta.transferCount}회`}</span></div></div>{journeyComparison.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
  </section>;
}
