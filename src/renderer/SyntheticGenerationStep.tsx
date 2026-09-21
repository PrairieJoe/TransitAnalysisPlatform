import type { JSX } from 'react';
import type { SyntheticGtfsBuildResult } from '../core/synthetic-gtfs/types';
import type { ScenarioDelta } from '../shared/types';
import type { GenerationInputSnapshot, ScenarioExplanationCopy, ScenarioResultSummary } from './SyntheticGtfsBuilder';

interface RouteOption {
  routeId: string;
  routeName: string;
  transportMode: string;
}

interface ProvenancePreview {
  routeId: string;
  provenance: { sourceType: string; confidence: string; assumptions: string[] };
  directions: Array<{ directionId: string; provenance: { sourceType: string; confidence: string; assumptions: string[] } }>;
}

export interface SyntheticGenerationStepProps {
  routeOptions: RouteOption[];
  activeRouteId: string;
  activeRouteLabel: string;
  baseStopIds: string[];
  scenarioStopIds: string[];
  scenarioStopText: string;
  vehicleCount: string;
  firstDeparture: string;
  lastDeparture: string;
  headwayMinutes: string;
  agencyId?: string;
  agencyName?: string;
  startDate?: string;
  endDate?: string;
  dwellSeconds?: string;
  serviceDays?: number[];
  deriveReverseDirection?: boolean;
  result?: SyntheticGtfsBuildResult;
  baseResult?: SyntheticGtfsBuildResult;
  scenarioDelta?: ScenarioDelta;
  generationInputSnapshot?: GenerationInputSnapshot;
  resultSummary?: ScenarioResultSummary;
  explanationCopy?: ScenarioExplanationCopy;
  exported: boolean;
  onRouteChange: (routeId: string) => void;
  onScenarioStopTextChange: (value: string) => void;
  onVehicleCountChange: (value: string) => void;
  onFirstDepartureChange: (value: string) => void;
  onLastDepartureChange: (value: string) => void;
  onHeadwayMinutesChange: (value: string) => void;
  onAdvancedChange?: (field: 'agencyId' | 'agencyName' | 'startDate' | 'endDate' | 'dwellSeconds', value: string) => void;
  onToggleServiceDay?: (day: number) => void;
  onDeriveReverseDirectionChange?: (value: boolean) => void;
  onGenerate: () => void;
  onExport: () => Promise<void>;
}

const WEEKDAY_OPTIONS = [['월', 0], ['화', 1], ['수', 2], ['목', 3], ['금', 4], ['토', 5], ['일', 6]] as const;

function readProvenancePreview(result: SyntheticGtfsBuildResult): ProvenancePreview[] {
  try {
    return (JSON.parse(result.files['tap-provenance.json']) as { routes?: ProvenancePreview[] }).routes ?? [];
  } catch {
    return [];
  }
}

function projectRouteLabel(route: RouteOption): string {
  return `${route.routeName} · ${route.routeId} · ${route.transportMode}`;
}

export default function SyntheticGenerationStep({
  routeOptions,
  activeRouteId,
  activeRouteLabel,
  baseStopIds,
  scenarioStopIds,
  scenarioStopText,
  vehicleCount,
  firstDeparture,
  lastDeparture,
  headwayMinutes,
  agencyId = 'tap-agency',
  agencyName = '분석용 대중교통',
  startDate = '20260101',
  endDate = '20261231',
  dwellSeconds = '20',
  serviceDays = [0, 1, 2, 3, 4],
  deriveReverseDirection = true,
  result,
  scenarioDelta,
  resultSummary,
  explanationCopy,
  exported,
  onRouteChange,
  onScenarioStopTextChange,
  onVehicleCountChange,
  onFirstDepartureChange,
  onLastDepartureChange,
  onHeadwayMinutesChange,
  onAdvancedChange,
  onToggleServiceDay,
  onDeriveReverseDirectionChange,
  onGenerate,
  onExport
}: SyntheticGenerationStepProps): JSX.Element {
  const activeRoute = routeOptions.find((route) => route.routeId === activeRouteId);
  const effectiveExplanation = explanationCopy ?? {
    before: `현재 노선별 정류장정보(${activeRouteLabel})를 바탕으로 만든 기준 운행계획입니다.`,
    after: scenarioStopText.trim() ? '사용자가 입력한 정류장 순서를 반영한 개편 운행계획입니다.' : '입력란을 비워 현재 노선 정류장 순서를 그대로 사용하는 사용자 시나리오입니다.'
  };

  return <section className="synthetic-step-panel synthetic-generation-step">
    <div className="synthetic-step-panel-heading"><div><strong>GTFS 생성·검수</strong><span>핵심 운행 가정만 입력한 뒤 생성 결과를 확인합니다.</span></div></div>
    <div className="synthetic-input-summary"><div><small>현재 노선</small><strong>{activeRouteLabel || activeRoute?.routeName || '선택 필요'}</strong></div><div><small>Before 정류장</small><strong>{baseStopIds.length}개</strong></div><div><small>After 정류장</small><strong>{scenarioStopIds.length}개</strong></div></div>
    <div className="synthetic-form-grid">
      <label className="field"><span>분석 노선</span><select aria-label="분석 노선" value={activeRouteId} onChange={(event) => onRouteChange(event.target.value)}>{routeOptions.map((route) => <option key={route.routeId} value={route.routeId}>{projectRouteLabel(route)}</option>)}</select></label>
      <label className="field"><span>운행대수</span><input aria-label="운행대수" type="number" min="1" step="1" value={vehicleCount} onChange={(event) => onVehicleCountChange(event.target.value)} /></label>
      <label className="field"><span>첫차</span><input aria-label="첫차" type="time" value={firstDeparture} onChange={(event) => onFirstDepartureChange(event.target.value)} /></label>
      <label className="field"><span>막차</span><input aria-label="막차" type="time" value={lastDeparture} onChange={(event) => onLastDepartureChange(event.target.value)} /></label>
      <label className="field"><span>배차간격(분)</span><input aria-label="배차간격" type="number" min="1" step="1" value={headwayMinutes} onChange={(event) => onHeadwayMinutesChange(event.target.value)} /></label>
    </div>
    <label className="field"><span>After 정류장 순서(선택)</span><input aria-label="After 시나리오 정류장 ID" placeholder={baseStopIds.join(',')} value={scenarioStopText} onChange={(event) => onScenarioStopTextChange(event.target.value)} /><small>쉼표로 구분합니다. 비워 두면 현재 노선 순서를 사용합니다.</small></label>
    <details className="synthetic-advanced-settings">
      <summary>고급 생성 설정</summary>
      <div className="synthetic-form-grid">
        <label className="field"><span>기관 ID</span><input aria-label="기관 ID" value={agencyId} onChange={(event) => onAdvancedChange?.('agencyId', event.target.value)} /></label>
        <label className="field"><span>기관명</span><input aria-label="기관명" value={agencyName} onChange={(event) => onAdvancedChange?.('agencyName', event.target.value)} /></label>
        <label className="field"><span>서비스 시작일</span><input aria-label="서비스 시작일" inputMode="numeric" value={startDate} onChange={(event) => onAdvancedChange?.('startDate', event.target.value)} /></label>
        <label className="field"><span>서비스 종료일</span><input aria-label="서비스 종료일" inputMode="numeric" value={endDate} onChange={(event) => onAdvancedChange?.('endDate', event.target.value)} /></label>
        <label className="field"><span>정류장 정차시간(초)</span><input aria-label="정류장 정차시간" type="number" min="0" step="1" value={dwellSeconds} onChange={(event) => onAdvancedChange?.('dwellSeconds', event.target.value)} /></label>
      </div>
      <div className="synthetic-day-field"><strong>운행 요일</strong><div className="synthetic-day-options">{WEEKDAY_OPTIONS.map(([label, value]) => <label key={value}><input type="checkbox" checked={serviceDays.includes(value)} onChange={() => onToggleServiceDay?.(value)} /><span>{label}</span></label>)}</div></div>
      <label className="synthetic-check"><input type="checkbox" checked={deriveReverseDirection} onChange={(event) => onDeriveReverseDirectionChange?.(event.target.checked)} /><span><strong>원본 방향이 없으면 역방향을 파생</strong><small>파생 방향은 낮은 신뢰도로 표시됩니다.</small></span></label>
      <div className="synthetic-model-note"><strong>기본 시간 모델</strong><span>정류장 좌표 간 직선거리와 도로유형 미상 기준속도 15km/h를 사용합니다. 실제 OSM BUS shape와 교통시간은 MOTIS 실증 결과로 별도 확인합니다.</span></div>
    </details>
    <div className="synthetic-explanation-card" role="note"><div className="synthetic-explanation-heading"><strong>Before / After를 이렇게 읽습니다</strong><span>현재 노선과 사용자가 만든 시나리오를 같은 조건으로 비교합니다.</span></div><div className="synthetic-explanation-grid"><div><small>Before · 현재 노선</small><strong>기준 운행계획</strong><span>{effectiveExplanation.before}</span></div><div><small>After · 사용자 시나리오</small><strong>개편 운행계획</strong><span>{effectiveExplanation.after}</span></div></div></div>
    <button className="primary-button full" onClick={onGenerate}>Before/After GTFS 생성 <span>→</span></button>
    {!result ? <div className="synthetic-result-empty"><span className="empty-icon">↗</span><strong>아직 생성된 결과가 없습니다</strong><span>핵심 입력을 확인하고 생성 버튼을 눌러 주세요.</span></div> : <>
      {resultSummary && <div className="synthetic-input-summary"><div><small>운행대수</small><strong>{resultSummary.vehicleLabel}</strong></div><div><small>운행 시간대</small><strong>{resultSummary.operatingWindow}</strong></div><div><small>배차간격</small><strong>{resultSummary.headwayLabel}</strong></div><div><small>Before 정류장</small><strong>{resultSummary.beforeStopCount}개</strong></div><div><small>After 정류장</small><strong>{resultSummary.afterStopCount}개</strong></div></div>}
      {scenarioDelta && <div className="synthetic-scenario-delta"><strong>변경 요약 · {scenarioDelta.label}</strong><span>추가: {scenarioDelta.addedStopIds.join(', ') || '없음'}</span><span>제거: {scenarioDelta.removedStopIds.join(', ') || '없음'}</span></div>}
      <div className="synthetic-result-guide"><strong>결과 읽는 법</strong><span><b>Trip 수</b>는 입력한 시간대와 배차간격으로 생성된 추정 운행 횟수입니다.</span><span><b>추정 필드</b>는 원본에 없는 값을 모델로 채운 항목 수입니다.</span></div>
      <div className="synthetic-summary-grid"><div><small>생성 노선</small><strong>{result.summary.routeCount.toLocaleString('ko-KR')}개</strong></div><div><small>After 정류장</small><strong>{result.summary.stopCount.toLocaleString('ko-KR')}개</strong></div><div><small>추정 Trip</small><strong>{result.summary.tripCount.toLocaleString('ko-KR')}개</strong></div><div><small>추정 필드</small><strong>{result.summary.estimatedFieldCount.toLocaleString('ko-KR')}개</strong></div></div>
      <div className="synthetic-caution-list"><strong>주의사항</strong><span>공식 시간표가 없거나 BUS shape가 없는 값은 추정이며 실제 운행 사실을 보장하지 않습니다.</span>{resultSummary?.fleetCaution && <span>{resultSummary.fleetCaution}</span>}</div>
      <details className="synthetic-technical-details"><summary>기술 상세 펼치기 · 파일·출처·원시 진단</summary><div className="synthetic-technical-content"><div className="synthetic-file-list"><strong>After 생성 파일 {Object.keys(result.files).length}개</strong>{Object.keys(result.files).map((name) => <span key={name}>✓ {name}</span>)}</div>{readProvenancePreview(result).map((route) => <div className="synthetic-provenance-list" key={route.routeId}><strong>출처·가정 미리보기 · {route.routeId}</strong><span>노선 출처: {route.provenance.sourceType} · 신뢰도: {route.provenance.confidence}</span>{route.provenance.assumptions.map((assumption) => <span key={assumption}>• {assumption}</span>)}{route.directions.map((direction) => <span key={direction.directionId}>방향 {direction.directionId}: {direction.provenance.sourceType} · {direction.provenance.confidence}</span>)}</div>)}{result.validation.warnings.length > 0 && <div className="synthetic-warning-list"><strong>검수 경고 {result.validation.warnings.length}건</strong>{result.validation.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}<div className="synthetic-raw-diagnostics"><strong>원시 진단 · tap-validation.json</strong><pre>{result.files['tap-validation.json']}</pre></div></div></details>
      <button className="secondary-button full" onClick={() => void onExport()} disabled={!result.validation.isValid}>After Synthetic GTFS ZIP 저장</button>
      {exported && <div className="success-box" role="status">✓ ZIP 파일을 저장했습니다. 다음 MOTIS 실증 단계로 진행하세요.</div>}
    </>}
  </section>;
}
