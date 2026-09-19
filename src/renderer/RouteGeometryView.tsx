import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { fetchRouteShapes, type RouteShapeResult } from '../core/route-shape';
import { routeSegmentKey } from '../core/route-demand-view';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import type { RouteSegmentMetric, RouteStopMasterRecord } from '../shared/types';
import RouteCongestionMap from './RouteCongestionMap';
import RouteCongestion3DView from './RouteCongestion3DView';

interface Props {
  metrics: RouteSegmentMetric[];
  routeStops: RouteStopMasterRecord[];
  mode: '2d' | '3d';
  selectedSegmentKey?: string;
  onSelectSegment: (key: string) => void;
  onFallback: () => void;
}

export default function RouteGeometryView({ metrics, routeStops, mode, selectedSegmentKey, onSelectSegment, onFallback }: Props): JSX.Element {
  const [result, setResult] = useState<RouteShapeResult>();
  const [resultKey, setResultKey] = useState('');
  const [pbfPath, setPbfPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showRoads, setShowRoads] = useState(true);
  const generation = useRef(0);
  const key = useMemo(() => JSON.stringify(metrics.map((m) => [routeSegmentKey(m), m.fromLatitude, m.fromLongitude, m.toLatitude, m.toLongitude])), [metrics]);
  useEffect(() => { generation.current++; setMessage(''); }, [key]);
  useEffect(() => () => { generation.current++; }, []);
  const current = resultKey === key ? result : undefined;

  async function load(prepare: boolean): Promise<void> {
    const desktop = window.transitDesktop;
    if (!desktop || !metrics.length) return;
    const token = ++generation.current;
    setBusy(true);
    setMessage(prepare ? '지역 도로망을 준비합니다. 큰 PBF는 처음 준비할 때 수 분이 걸릴 수 있습니다.' : '선택 노선의 BUS 도로망 형상을 조회합니다.');
    try {
      if (prepare) {
        if (!pbfPath.trim()) throw new Error('먼저 지역 OSM PBF를 선택하세요.');
        const year = new Date().getFullYear();
        const draft = buildSyntheticGtfsDraft(routeStops, [], {
          agencyId: 'tap-shape', agencyName: '분석용 도로망', routeId: metrics[0].routeId,
          serviceDays: [0, 1, 2, 3, 4, 5, 6], firstDeparture: '06:00', lastDeparture: '23:00', vehicleCount: 1, headwayMinutes: 60,
          startDate: `${year}0101`, endDate: `${year}1231`, sourceName: '노선별 정류장정보', deriveReverseDirection: false,
          dwellSeconds: 20, travelTimeParameters: DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS
        });
        if (!draft.validation.isValid) throw new Error(draft.validation.blockingErrors.join(' '));
        await desktop.stopMotis();
        await desktop.prepareMotis({ osmPbfPath: pbfPath, files: draft.files });
        if (generation.current !== token) return;
        const status = await desktop.startMotis();
        if (status.state !== 'ready') throw new Error(status.message ?? '도로망 서버가 준비되지 않았습니다.');
      }
      const next = await fetchRouteShapes(metrics, (path, init) => desktop.requestMotis(path, init));
      if (generation.current !== token) return;
      setResult(next);
      setResultKey(key);
      setShowRoads(true);
      setMessage('조회 완료. OSM BUS 경로는 추정 형상이며 실제 버스 운행 경로를 보증하지 않습니다.');
    } catch (error) {
      if (generation.current === token) setMessage(`${error instanceof Error ? error.message : String(error)} 기존 정류장 연결선은 계속 사용할 수 있습니다.`);
    } finally { setBusy(false); }
  }

  async function choosePbf(): Promise<void> {
    try {
      const file = await window.transitDesktop?.selectMotisOsmPbf();
      if (file) setPbfPath(file.path);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  const routed = current?.segments.filter((segment) => segment.source === 'osm').length ?? 0;
  const shapes = showRoads ? current?.segments : undefined;
  return <>
    <details className="route-shape-controls">
      <summary>도로망 형상 · {current && showRoads ? `OSM ${routed} / ${current.segments.length}구간` : '정류장 연결선'}</summary>
      <p>도로망은 선택 노선의 형상만 바꿉니다. 재차인원·혼잡도는 기존 분석값을 유지합니다. 실패 구간은 정류장 직선으로 표시합니다.</p>
      <div className="route-shape-actions">
        <button className="secondary-button" type="button" disabled={busy || !window.transitDesktop} onClick={() => void load(false)}>현재 도로망으로 형상 조회</button>
        <label><input type="checkbox" checked={showRoads} disabled={!current || busy} onChange={(e) => setShowRoads(e.target.checked)} />도로망 형상 표시</label>
      </div>
      <label className="field"><span>지역 OSM PBF</span><input aria-label="도로망 OSM PBF 경로" value={pbfPath} disabled={busy} onChange={(e) => setPbfPath(e.target.value)} placeholder="지역 .osm.pbf 파일 경로" /></label>
      <div className="route-shape-actions">
        <button className="secondary-button" type="button" disabled={busy || !window.transitDesktop} onClick={() => void choosePbf()}>도로망 PBF 파일 선택</button>
        <button className="secondary-button" type="button" disabled={busy || !pbfPath.trim() || !window.transitDesktop} onClick={() => void load(true)}>도로망 준비 후 형상 조회</button>
      </div>
      <small>GTFS 구축에서 이미 준비한 도로망이 실행 중이면 바로 조회할 수 있습니다. 새 PBF 준비는 실행 중인 비교 서버를 교체합니다.</small>
      {message && <p role="status">{message}</p>}
      {current && <p>OSM BUS {routed}구간 · 직선 대체 {current.segments.length - routed}구간</p>}
      {Boolean(current?.warnings.length) && <details><summary>형상 품질 안내 {current!.warnings.length}건</summary><ul>{current!.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {Boolean(current?.segments.some((segment) => segment.source === 'beeline')) && <details><summary>직선으로 표시한 구간 보기</summary><ul>{current!.segments.filter((segment) => segment.source === 'beeline').map((segment) => {
        const metric = metrics.find((candidate) => routeSegmentKey(candidate) === segment.key);
        return <li key={segment.key}>{metric?.fromStationName} → {metric?.toStationName}: {segment.warning}</li>;
      })}</ul></details>}
    </details>
    {mode === '3d'
      ? <RouteCongestion3DView metrics={metrics} geometries={shapes} routeLabel={metrics[0]?.routeId ?? 'route'} selectedSegmentKey={selectedSegmentKey} onSelectSegment={onSelectSegment} onFallback={onFallback} />
      : <RouteCongestionMap metrics={metrics} geometries={shapes} selectedSegmentKey={selectedSegmentKey} onSelectSegment={onSelectSegment} />}
  </>;
}
