import { useEffect, useMemo, useState, type JSX } from 'react';
import { buildCurrentRouteSearchGtfs } from '../core/route-search';
import { buildMotisPlanPath, defaultMotisDepartureDateTime } from '../core/motis';
import { normalizeMotisJourney, type NormalizedJourney } from '../core/transit-comparison';
import type { MotisOsmPbfMetadata, MotisRuntimeDefaults, MotisStatus, RouteServiceConfig, RouteStopMasterRecord } from '../shared/types';
import ScenarioSearchPicker, { type ScenarioSearchOption } from './ScenarioSearchPicker';

export interface RouteSearchWorkspaceProps {
  routeStops: RouteStopMasterRecord[];
  stationMaster?: Array<{ stationId: string; stationName: string; latitude: number; longitude: number }>;
  serviceConfigs: RouteServiceConfig[];
}

function secondsLabel(value: number): string {
  if (!value) return '0분';
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function journeySummary(journey: NormalizedJourney): string {
  return journey.found ? `총 ${secondsLabel(journey.totalSeconds)} · 대중교통 ${secondsLabel(journey.inVehicleSeconds)} · 환승 ${journey.transferCount}회` : '해당 OD의 경로를 찾지 못했습니다.';
}

export default function RouteSearchWorkspace({ routeStops, stationMaster = [], serviceConfigs }: RouteSearchWorkspaceProps): JSX.Element {
  const [osmPbfPath, setOsmPbfPath] = useState('');
  const [osmPbfMetadata, setOsmPbfMetadata] = useState<MotisOsmPbfMetadata>();
  const [motisDefaults, setMotisDefaults] = useState<MotisRuntimeDefaults>();
  const [motisStatus, setMotisStatus] = useState<MotisStatus>({ state: 'stopped' });
  const [originStopId, setOriginStopId] = useState(routeStops[0]?.stationId ?? '');
  const [destinationStopId, setDestinationStopId] = useState(routeStops[1]?.stationId ?? routeStops[0]?.stationId ?? '');
  const [departureDateTime, setDepartureDateTime] = useState(defaultMotisDepartureDateTime());
  const [journey, setJourney] = useState<NormalizedJourney>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const stationOptions = useMemo<ScenarioSearchOption[]>(() => [...new Map(routeStops.map((stop) => [stop.stationId, { value: stop.stationId, label: stop.stationName, meta: `ID ${stop.stationId}` }])).values()], [routeStops]);
  const currentFeedState = useMemo(() => {
    try { return { feed: buildCurrentRouteSearchGtfs({ routeStops, stationMaster, serviceConfigs }) }; }
    catch (error) { return { feed: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [routeStops, serviceConfigs, stationMaster]);
  const currentFeed = currentFeedState.feed;
  const feedError = currentFeedState.error;

  useEffect(() => {
    if (!window.transitDesktop) return;
    void window.transitDesktop.getMotisDefaults().then(setMotisDefaults).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  async function selectOsmPbf(): Promise<void> {
    if (!window.transitDesktop) { setMessage('MOTIS 경로탐색은 Electron 앱에서 사용할 수 있습니다.'); return; }
    try {
      const metadata = await window.transitDesktop.selectMotisOsmPbf();
      if (metadata) { setOsmPbfPath(metadata.path); setOsmPbfMetadata(metadata); setMessage(undefined); }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function inspectOsmPbf(): Promise<void> {
    if (!window.transitDesktop || !osmPbfPath.trim()) return;
    try { setOsmPbfMetadata(await window.transitDesktop.inspectMotisOsmPbf(osmPbfPath)); setMessage(undefined); }
    catch (error) { setOsmPbfMetadata(undefined); setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function stopMotis(): Promise<void> {
    if (!window.transitDesktop) return;
    try { setMotisStatus(await window.transitDesktop.stopMotis()); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function search(): Promise<void> {
    if (!window.transitDesktop) { setMessage('MOTIS 경로탐색은 Electron 앱에서 사용할 수 있습니다.'); return; }
    if (!currentFeed) { setMessage(feedError ?? '현행 노선정보로 경로탐색 네트워크를 만들 수 없습니다.'); return; }
    if (!osmPbfPath.trim()) { setMessage('먼저 지역 OSM PBF 파일을 선택하세요.'); return; }
    if (!originStopId || !destinationStopId || originStopId === destinationStopId) { setMessage('출발·도착 정류장을 서로 다르게 선택하세요.'); return; }
    setBusy(true); setJourney(undefined); setMessage('현행 네트워크로 MOTIS를 준비하는 중입니다.');
    try {
      await window.transitDesktop.stopMotis();
      await window.transitDesktop.prepareMotis({ osmPbfPath, files: currentFeed.files });
      const status = await window.transitDesktop.startMotis();
      setMotisStatus(status);
      if (status.state !== 'ready') throw new Error(status.message ?? 'MOTIS가 준비되지 않았습니다.');
      const raw = await window.transitDesktop.requestMotis(buildMotisPlanPath(originStopId, destinationStopId, departureDateTime));
      setJourney(normalizeMotisJourney(raw, `${departureDateTime}:00+09:00`));
      setMessage('현행 네트워크 경로탐색이 완료되었습니다.');
    } catch (error) {
      setMotisStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return <section className="panel route-search-workspace">
    <div className="synthetic-step-panel-heading"><div><strong>MOTIS 경로탐색</strong><span>시나리오 분석과 분리된 현행 네트워크 기준 경로조회입니다.</span></div><span className="motis-managed-status">현행 네트워크 기준</span></div>
    <div className="route-search-intro" role="note"><strong>현재 노선 기준으로 바로 찾아보기</strong><span>개편안 저장이나 Before/After 비교 없이, 현재 정류장 간 대중교통 경로만 조회합니다.</span></div>
    <div className="synthetic-form-grid">
      <label className="field"><span>지역 OSM PBF</span><div className="synthetic-path-picker"><input value={osmPbfPath} onChange={(event) => setOsmPbfPath(event.target.value)} placeholder="Geofabrik PBF 파일 경로" /><button type="button" className="secondary-button" onClick={() => void selectOsmPbf()}>파일 선택</button></div><small>현행 노선 GTFS와 함께 MOTIS 도로망을 준비합니다.</small></label>
    </div>
    <div className="route-search-actions"><button type="button" className="secondary-button" disabled={busy || !osmPbfPath.trim()} onClick={() => void inspectOsmPbf()}>PBF 파일 검증</button>{osmPbfMetadata && <span role="status">{osmPbfMetadata.fileName} · {formatFileSize(osmPbfMetadata.sizeBytes)}</span>}<span>{motisDefaults ? `내장 MOTIS · 포트 ${motisDefaults.port}` : '내장 MOTIS 설정을 불러오는 중…'}</span></div>
    <div className="route-search-query">
      <ScenarioSearchPicker id="route-search-origin" label="출발 정류장" options={stationOptions} selectedValue={originStopId} onSelect={setOriginStopId} placeholder="정류장명 또는 ID로 검색" />
      <ScenarioSearchPicker id="route-search-destination" label="도착 정류장" options={stationOptions} selectedValue={destinationStopId} onSelect={setDestinationStopId} placeholder="정류장명 또는 ID로 검색" />
      <label className="field"><span>출발 일시(KST)</span><input type="datetime-local" value={departureDateTime} onChange={(event) => setDepartureDateTime(event.target.value)} /></label>
    </div>
    {feedError && <div className="error-box" role="alert">⚠ {feedError}</div>}
    <div className="synthetic-action-row"><button type="button" className="primary-button" disabled={busy || !currentFeed || !routeStops.length} onClick={() => void search()}>경로탐색 실행 <span>→</span></button><button type="button" className="secondary-button" disabled={busy} onClick={() => void stopMotis()}>MOTIS 중지</button></div>
    <div className={`motis-status motis-status-${motisStatus.state}`} role="status"><strong>MOTIS 상태: {motisStatus.state}</strong><span>{motisStatus.message ?? '아직 실행하지 않았습니다.'}</span></div>
    {message && <div className="route-search-message" role="status">{message}</div>}
    {journey && <div className="route-search-result" role="region" aria-label="경로탐색 결과"><div className="route-search-result-heading"><strong>현행 경로탐색 결과</strong><span>{journeySummary(journey)}</span></div>{journey.found ? <ol>{journey.legs.map((leg, index) => <li key={`${leg.routeId ?? leg.mode}-${index}`}><strong>{leg.routeId ?? leg.mode}</strong><span>{leg.boardStopId ?? '출발'} → {leg.alightStopId ?? '도착'}</span><small>{leg.mode} · {secondsLabel(leg.rideSeconds || leg.walkSeconds)}</small></li>)}</ol> : <p>다른 출발 시각이나 정류장을 선택해 다시 조회해 보세요.</p>}{journey.warnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
  </section>;
}
