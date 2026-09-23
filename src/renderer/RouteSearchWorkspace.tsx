import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { buildCurrentRouteSearchGtfs } from '../core/route-search';
import { buildRouteSearchMapModel, validateRouteSearchEndpoints } from '../core/route-search-map';
import { buildMotisPlanPath, defaultMotisDepartureDateTime, isValidMotisDepartureDateTime } from '../core/motis';
import { normalizeMotisJourneys, type NormalizedJourney } from '../core/transit-comparison';
import type { MotisOsmPbfMetadata, MotisOsmPbfResolution, MotisProgress, MotisRuntimeDefaults, MotisStatus, RouteServiceConfig, RouteStopMasterRecord, ScenarioJourneyEndpoint } from '../shared/types';
import RouteSearchMap from './RouteSearchMap';
import RouteSearchTimeControls, { type RouteSearchTimeMode } from './RouteSearchTimeControls';
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

function endpointText(endpoint: ScenarioJourneyEndpoint | undefined, fallback: string): string {
  if (!endpoint) return fallback;
  return endpoint.kind === 'stop' ? endpoint.label ?? endpoint.stopId : endpoint.label ?? `${endpoint.latitude.toFixed(5)}, ${endpoint.longitude.toFixed(5)}`;
}

export default function RouteSearchWorkspace({ routeStops, stationMaster = [], serviceConfigs }: RouteSearchWorkspaceProps): JSX.Element {
  const [pbfResolution, setPbfResolution] = useState<MotisOsmPbfResolution>();
  const [manualPbfPath, setManualPbfPath] = useState('');
  const [manualPbfMetadata, setManualPbfMetadata] = useState<MotisOsmPbfMetadata>();
  const [motisDefaults, setMotisDefaults] = useState<MotisRuntimeDefaults>();
  const [motisStatus, setMotisStatus] = useState<MotisStatus>({ state: 'stopped' });
  const [origin, setOrigin] = useState<ScenarioJourneyEndpoint>();
  const [destination, setDestination] = useState<ScenarioJourneyEndpoint>();
  const [activeEndpoint, setActiveEndpoint] = useState<'origin' | 'destination'>('origin');
  const [departureDateTime, setDepartureDateTime] = useState(defaultMotisDepartureDateTime);
  const [timeMode, setTimeMode] = useState<RouteSearchTimeMode>('now');
  const [journeys, setJourneys] = useState<NormalizedJourney[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const activeOperationId = useRef<string | undefined>(undefined);

  const stationRecords = useMemo(() => {
    const records = new Map<string, { stationId: string; stationName: string; latitude: number; longitude: number }>();
    for (const stop of routeStops) records.set(stop.stationId, { stationId: stop.stationId, stationName: stop.stationName, latitude: stop.latitude, longitude: stop.longitude });
    for (const station of stationMaster) if (!records.has(station.stationId)) records.set(station.stationId, station);
    return [...records.values()];
  }, [routeStops, stationMaster]);
  const stationById = useMemo(() => new Map(stationRecords.map((station) => [station.stationId, station])), [stationRecords]);
  const stationOptions = useMemo<ScenarioSearchOption[]>(() => {
    const options = new Map<string, ScenarioSearchOption>();
    for (const stop of routeStops) if (!options.has(stop.stationId)) options.set(stop.stationId, { value: stop.stationId, label: stop.stationName, meta: `ID ${stop.stationId}` });
    return [...options.values()];
  }, [routeStops]);
  const stopCoordinates = useMemo(() => new Map(stationRecords.filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude)).map((station) => [station.stationId, { latitude: station.latitude, longitude: station.longitude }])), [stationRecords]);
  const mapModel = useMemo(() => buildRouteSearchMapModel({ journeys, origin, destination, stopCoordinates, selectedRouteId }), [destination, journeys, origin, selectedRouteId, stopCoordinates]);
  const activePbfMetadata = pbfResolution?.status === 'ready' ? pbfResolution.metadata : manualPbfMetadata;
  const activePbfPath = activePbfMetadata?.path ?? manualPbfPath.trim();
  const currentFeedState = useMemo(() => {
    try { return { feed: buildCurrentRouteSearchGtfs({ routeStops, stationMaster, serviceConfigs }) }; }
    catch (error) { return { feed: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [routeStops, serviceConfigs, stationMaster]);
  const currentFeed = currentFeedState.feed;
  const feedError = currentFeedState.error;

  useEffect(() => {
    if (!window.transitDesktop) return;
    void Promise.all([
      window.transitDesktop.getMotisDefaults().then(setMotisDefaults),
      window.transitDesktop.resolveMotisOsmPbf().then((resolution) => {
        setPbfResolution(resolution);
        if (resolution.status === 'ready') setManualPbfMetadata(undefined);
      })
    ]).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!window.transitDesktop) return undefined;
    return window.transitDesktop.onMotisProgress((progress: MotisProgress) => {
      if (progress.operationId !== activeOperationId.current) return;
      setMessage(progress.message);
      if (progress.phase === 'failed') setMotisStatus({ state: 'failed', preparationFingerprint: progress.fingerprint, message: progress.message });
    });
  }, []);

  const selectEndpoint = useCallback((role: 'origin' | 'destination', endpoint: ScenarioJourneyEndpoint): void => {
    if (busy) return;
    if (role === 'origin') setOrigin(endpoint);
    else setDestination(endpoint);
    setActiveEndpoint(role === 'origin' ? 'destination' : 'destination');
    setJourneys([]);
    setSelectedRouteId(undefined);
    setHasSearched(false);
  }, [busy]);

  const selectStation = useCallback((role: 'origin' | 'destination', stationId: string): void => {
    const station = stationById.get(stationId);
    if (!station) return;
    selectEndpoint(role, { kind: 'stop', stopId: station.stationId, label: station.stationName });
  }, [selectEndpoint, stationById]);

  const handleMapClick = useCallback((latitude: number, longitude: number): void => {
    if (busy) return;
    selectEndpoint(activeEndpoint, { kind: 'coordinate', latitude, longitude, label: '지도에서 선택한 지점' });
  }, [activeEndpoint, busy, selectEndpoint]);

  async function rescanOsmPbf(): Promise<void> {
    if (busy) return;
    if (!window.transitDesktop) return;
    try {
      const resolution = await window.transitDesktop.rescanMotisOsmPbf();
      setPbfResolution(resolution);
      setManualPbfMetadata(undefined);
      if (resolution.status === 'ready') setMessage('OSM PBF를 자동으로 확인했습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function selectOsmPbf(): Promise<void> {
    if (busy) return;
    if (!window.transitDesktop) { setMessage('MOTIS 경로탐색은 Electron 앱에서 사용할 수 있습니다.'); return; }
    try {
      const metadata = await window.transitDesktop.selectMotisOsmPbf();
      if (metadata) { setManualPbfPath(metadata.path); setManualPbfMetadata(metadata); setPbfResolution(undefined); setMessage('고급 설정으로 선택한 PBF를 사용합니다.'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function openOsmDownloadPage(): Promise<void> {
    if (busy) return;
    try { await window.transitDesktop?.openMotisOsmDownload(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function stopMotis(): Promise<void> {
    if (busy) return;
    if (!window.transitDesktop) return;
    try { setMotisStatus(await window.transitDesktop.stopMotis()); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function search(): Promise<void> {
    if (busy) return;
    if (!window.transitDesktop) { setMessage('MOTIS 경로탐색은 Electron 앱에서 사용할 수 있습니다.'); return; }
    const endpointError = validateRouteSearchEndpoints(origin, destination);
    if (endpointError) { setMessage(endpointError); return; }
    if (!isValidMotisDepartureDateTime(departureDateTime)) { setMessage('출발 날짜와 시각을 확인하세요.'); return; }
    if (!currentFeed) { setMessage(feedError ?? '현행 노선정보로 경로탐색 네트워크를 만들 수 없습니다.'); return; }
    if (!activePbfPath) { setMessage('PBF 자동 준비가 필요합니다. Geofabrik 안내를 확인하거나 고급 설정에서 다른 PBF를 선택하세요.'); return; }
    const operationId = `route-search-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeOperationId.current = operationId;
    setBusy(true); setJourneys([]); setSelectedRouteId(undefined); setHasSearched(false); setMessage('현행 노선 네트워크를 구성하는 중입니다.');
    try {
      await window.transitDesktop.prepareMotis({ osmPbfPath: activePbfPath, files: currentFeed.files, operationId });
      const status = await window.transitDesktop.startMotis(operationId);
      setMotisStatus(status);
      if (status.state !== 'ready') throw new Error(status.message ?? 'MOTIS가 준비되지 않았습니다.');
      const raw = await window.transitDesktop.requestMotis(buildMotisPlanPath(origin!, destination!, departureDateTime), undefined, operationId);
      const normalized = normalizeMotisJourneys(raw, `${departureDateTime}:00+09:00`);
      setJourneys(normalized);
      setHasSearched(true);
      setMessage(normalized.some((journey) => journey.found) ? '현행 네트워크 경로탐색이 완료되었습니다.' : '해당 조건에서 경로를 찾지 못했습니다.');
    } catch (error) {
      setMotisStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeOperationId.current === operationId) activeOperationId.current = undefined;
      setBusy(false);
    }
  }

  function resetEndpoint(role: 'origin' | 'destination'): void {
    if (busy) return;
    if (role === 'origin') setOrigin(undefined);
    else setDestination(undefined);
    setActiveEndpoint(role);
    setJourneys([]);
    setSelectedRouteId(undefined);
    setHasSearched(false);
  }

  function resetEndpoints(): void {
    if (busy) return;
    setOrigin(undefined); setDestination(undefined); setActiveEndpoint('origin'); setJourneys([]); setSelectedRouteId(undefined); setHasSearched(false);
  }

  return <section className="panel route-search-workspace">
    <div className="synthetic-step-panel-heading"><div><strong>MOTIS 경로탐색</strong><span>시나리오 분석과 분리된 현행 네트워크 기준 경로조회입니다.</span></div><span className="motis-managed-status">현행 네트워크 기준</span></div>
    <div className="route-search-intro" role="note"><strong>지도에서 출발지와 도착지를 선택하세요</strong><span>지도를 클릭하거나 정류장 검색을 사용하면 같은 endpoint 상태가 동기화됩니다.</span></div>
    <div className="route-search-layout">
      <RouteSearchMap model={mapModel} activeEndpoint={activeEndpoint} onMapClick={handleMapClick} onSelectRoute={(routeId) => { if (!busy) setSelectedRouteId(routeId); }} />
      <div className="route-search-query-panel">
        <div className="route-search-endpoints" role="group" aria-label="경로탐색 endpoint">
          <div className={activeEndpoint === 'origin' ? 'route-search-endpoint is-active' : 'route-search-endpoint'}><strong>출발지</strong><span>{endpointText(origin, '지도에서 선택하세요')}</span><button type="button" className="text-button" disabled={busy} onClick={() => resetEndpoint('origin')}>출발지 다시 선택</button></div>
          <div className={activeEndpoint === 'destination' ? 'route-search-endpoint is-active' : 'route-search-endpoint'}><strong>도착지</strong><span>{endpointText(destination, '지도에서 선택하세요')}</span><button type="button" className="text-button" disabled={busy} onClick={() => resetEndpoint('destination')}>도착지 다시 선택</button></div>
          <button type="button" className="secondary-button" disabled={busy} onClick={resetEndpoints}>선택 초기화</button>
        </div>
        <div className="route-search-query">
          <ScenarioSearchPicker id="route-search-origin" label="출발 정류장 검색" options={stationOptions} selectedValue={origin?.kind === 'stop' ? origin.stopId : ''} onSelect={(value) => selectStation('origin', value)} placeholder="정류장명 또는 ID로 검색" disabled={busy} />
          <ScenarioSearchPicker id="route-search-destination" label="도착 정류장 검색" options={stationOptions} selectedValue={destination?.kind === 'stop' ? destination.stopId : ''} onSelect={(value) => selectStation('destination', value)} placeholder="정류장명 또는 ID로 검색" disabled={busy} />
          <RouteSearchTimeControls mode={timeMode} value={departureDateTime} onChange={setDepartureDateTime} onModeChange={setTimeMode} disabled={busy} />
        </div>
        {feedError && <div className="error-box" role="alert">⚠ {feedError}</div>}
        {!pbfResolution && !manualPbfMetadata && <div className="route-search-pbf-status" role="status"><strong>PBF 자동 준비</strong><span>앱과 다운로드 폴더에서 사용 가능한 지역 PBF를 확인하는 중입니다.</span></div>}
        {pbfResolution?.status === 'ready' && pbfResolution.metadata && <div className="route-search-pbf-status is-ready" role="status"><strong>PBF 자동 준비 완료</strong><span>{pbfResolution.metadata.fileName} · {formatFileSize(pbfResolution.metadata.sizeBytes)}</span><small>SHA-256: {pbfResolution.metadata.sha256}</small></div>}
        {pbfResolution?.status === 'missing' && <div className="route-search-pbf-status is-missing" role="alert"><strong>경로탐색용 지도 데이터가 없습니다.</strong><span>{pbfResolution.message}</span><div><button type="button" className="secondary-button" disabled={busy} onClick={() => void openOsmDownloadPage()}>Geofabrik 다운로드 안내</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void rescanOsmPbf()}>다시 찾기</button></div><small>권장 위치: {pbfResolution.recommendedPath}</small></div>}
        {pbfResolution?.status === 'stale' && <div className="route-search-pbf-status is-missing" role="alert"><strong>저장된 PBF가 변경되었습니다.</strong><span>{pbfResolution.message}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => void rescanOsmPbf()}>새 fingerprint 확인</button></div>}
        <details className="route-search-advanced"><summary>다른 PBF 직접 선택 · 고급 설정</summary><label className="field"><span>OSM PBF 경로</span><div className="synthetic-path-picker"><input disabled={busy} value={manualPbfPath} onChange={(event) => { setManualPbfPath(event.target.value); setManualPbfMetadata(undefined); }} placeholder="특수 저장 위치의 .osm.pbf 경로" /><button type="button" className="secondary-button" disabled={busy} onClick={() => void selectOsmPbf()}>파일 선택</button></div></label><small>정상적인 경우에는 파일 선택 없이 자동 준비됩니다.</small></details>
        <div className="route-search-actions"><span>{motisDefaults ? `내장 MOTIS · 포트 ${motisDefaults.port}` : '내장 MOTIS 설정을 불러오는 중…'}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => void stopMotis()}>MOTIS 중지</button></div>
        <button type="button" className="primary-button route-search-submit" disabled={busy || !currentFeed || !routeStops.length} onClick={() => void search()}>경로 찾기</button>
        <div className={`motis-status motis-status-${motisStatus.state}`} role="status"><strong>MOTIS 상태: {motisStatus.state}</strong><span>{motisStatus.message ?? '아직 실행하지 않았습니다.'}</span></div>
        {message && <div className="route-search-message" role="status">{message}</div>}
      </div>
    </div>
    {hasSearched && <div className="route-search-result" role="region" aria-label="경로탐색 결과"><div className="route-search-result-heading"><strong>현행 경로탐색 결과</strong><span>{journeys.filter((journey) => journey.found).length}개 경로</span></div>{journeys.length === 0 && <p>해당 조건에서 경로를 찾지 못했습니다. 출발·도착지 또는 출발 시각을 바꿔 다시 검색해 보세요.</p>}{mapModel.routes.length > 0 && <div className="route-search-route-cards" role="list" aria-label="대안 경로 목록">{mapModel.routes.map((route, index) => <button key={route.id} type="button" role="listitem" className={route.id === mapModel.selectedRouteId ? 'is-selected' : ''} onClick={() => setSelectedRouteId(route.id)}><strong>{index === 0 ? '추천 경로' : `대안 ${index}`}</strong><span>{secondsLabel(route.totalSeconds)} · 환승 {route.transferCount}회</span></button>)}</div>}{journeys.some((journey) => !journey.found) && <p>해당 조건에서 경로를 찾지 못한 대안이 있습니다.</p>}{mapModel.routes.find((route) => route.id === mapModel.selectedRouteId)?.legs.map((leg, index) => <div className="route-search-leg" key={`${leg.routeId ?? leg.mode}-${index}`}><strong>{leg.routeId ?? leg.mode}</strong><span>{leg.mode} · {leg.geometrySource === 'motis' ? 'MOTIS geometry' : leg.qualityMessage ?? '지도 표시 정보 없음'}</span></div>)}{journeys.flatMap((journey) => journey.warnings).map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}</div>}
  </section>;
}
