import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface ScenarioNetworkMapStation {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
}

export interface ScenarioNetworkMapProps {
  stations: ScenarioNetworkMapStation[];
  currentStopIds: string[];
  scenarioStopIds: string[];
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
  onCreateStationDraft: (latitude: number, longitude: number) => void;
  onExcludeStation: (stationId: string) => void;
  onMoveStation: (stationId: string, latitude: number, longitude: number) => void;
}

export type ScenarioMapLayer = 'route' | 'changes' | 'all';

export interface ScenarioMapDraft {
  latitude: number;
  longitude: number;
}

export function createScenarioMapDraft(latitude: number, longitude: number): ScenarioMapDraft {
  return { latitude, longitude };
}

export function filterScenarioMapStations(stations: ScenarioNetworkMapStation[], currentStopIds: string[], scenarioStopIds: string[], layer: ScenarioMapLayer): ScenarioNetworkMapStation[] {
  if (layer === 'all') return stations;
  const currentIds = new Set(currentStopIds);
  const scenarioIds = new Set(scenarioStopIds);
  return stations.filter((station) => layer === 'route'
    ? currentIds.has(station.stationId) || scenarioIds.has(station.stationId)
    : currentIds.has(station.stationId) !== scenarioIds.has(station.stationId));
}

function markerColor(stationId: string, currentStopIds: Set<string>, scenarioStopIds: Set<string>): string {
  if (scenarioStopIds.has(stationId) && !currentStopIds.has(stationId)) return '#b35c49';
  if (scenarioStopIds.has(stationId)) return '#2f78a8';
  return '#8b9baa';
}

export default function ScenarioNetworkMap({ stations, currentStopIds, scenarioStopIds, selectedStationId, onSelectStation, onCreateStationDraft, onExcludeStation }: ScenarioNetworkMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, Leaflet.CircleMarker>>(new Map());
  const [addMode, setAddMode] = useState(false);
  const [layer, setLayer] = useState<ScenarioMapLayer>('route');
  const [tileError, setTileError] = useState(false);
  const currentIds = new Set(currentStopIds);
  const scenarioIds = new Set(scenarioStopIds);
  const visibleStations = useMemo(() => filterScenarioMapStations(stations, currentStopIds, scenarioStopIds, layer), [currentStopIds, layer, scenarioStopIds, stations]);

  useEffect(() => {
    if (!containerRef.current || !visibleStations.length) return undefined;
    let cancelled = false;
    let cleanup = (): void => {};
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !containerRef.current) return;
      const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true });
      const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);
      const markerById = new Map<string, Leaflet.CircleMarker>();
      visibleStations.forEach((station) => {
        if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) return;
        const marker = L.circleMarker([station.latitude, station.longitude], {
          radius: station.stationId === selectedStationId ? 9 : 6,
          color: station.stationId === selectedStationId ? '#123f66' : '#fff',
          weight: station.stationId === selectedStationId ? 3 : 2,
          fillColor: markerColor(station.stationId, currentIds, scenarioIds),
          fillOpacity: .9,
          bubblingMouseEvents: false
        });
        marker.bindPopup(`<strong>${station.stationName}</strong><br />정류장 ID: ${station.stationId}`);
        marker.on('click', () => onSelectStation(station.stationId));
        marker.addTo(map);
        markerById.set(station.stationId, marker);
      });
      const handleMapClick = (event: Leaflet.LeafletMouseEvent) => {
        if (addMode) onCreateStationDraft(event.latlng.lat, event.latlng.lng);
      };
      map.on('click', handleMapClick);
      markersRef.current = markerById;
      const mappableStations = visibleStations.filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude));
      if (mappableStations.length === 1) map.setView([mappableStations[0].latitude, mappableStations[0].longitude], 15);
      else if (mappableStations.length > 1) map.fitBounds(L.latLngBounds(mappableStations.map((station) => [station.latitude, station.longitude] as [number, number])), { padding: [24, 24] });
      setTileError(false);
      const resizeTimer = window.setTimeout(() => {
        if (!cancelled) map.invalidateSize();
      }, 0);
      const handleTileError = () => setTileError(true);
      tileLayer.on('tileerror', handleTileError);
      cleanup = () => {
        window.clearTimeout(resizeTimer);
        tileLayer.off('tileerror', handleTileError);
        map.off('click', handleMapClick);
        markersRef.current.clear();
        map.remove();
      };
    }).catch(() => setTileError(true));
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [addMode, currentStopIds, onCreateStationDraft, onSelectStation, scenarioStopIds, selectedStationId, visibleStations]);

  return <div className="scenario-network-map-shell">
    <div className="scenario-network-map-toolbar"><div><strong>지도 편집</strong><span>{addMode ? '지도를 클릭해 신규 정류장 위치를 정하세요.' : '선택 노선과 변경 정류장을 중심으로 표시합니다.'}</span></div><button type="button" className={addMode ? 'secondary-button is-active' : 'secondary-button'} onClick={() => setAddMode((active) => !active)}>{addMode ? '추가 모드 닫기' : '지도에서 정류장 추가'}</button></div>
    <div className="scenario-network-map-layers" role="group" aria-label="지도 표시 범위">
      <span>표시 범위</span>
      <button type="button" className={layer === 'route' ? 'is-active' : ''} aria-pressed={layer === 'route'} onClick={() => setLayer('route')}>선택 노선</button>
      <button type="button" className={layer === 'changes' ? 'is-active' : ''} aria-pressed={layer === 'changes'} onClick={() => setLayer('changes')}>변경 정류장</button>
      <button type="button" className={layer === 'all' ? 'is-active' : ''} aria-pressed={layer === 'all'} onClick={() => setLayer('all')}>전체 정류장</button>
    </div>
    <div ref={containerRef} className="scenario-network-map" aria-label="노선 시나리오 정류장 지도" />
    <ul className="scenario-network-map-station-list" aria-label="지도 정류장 목록">{visibleStations.map((station) => <li key={station.stationId} className={station.stationId === selectedStationId ? 'is-selected' : ''}><button type="button" onClick={() => onSelectStation(station.stationId)}><span className="scenario-network-map-dot" style={{ backgroundColor: markerColor(station.stationId, currentIds, scenarioIds) }} /><span><strong>{station.stationName}</strong><small>ID {station.stationId}</small></span></button>{scenarioIds.has(station.stationId) && <button type="button" className="scenario-network-map-exclude" onClick={() => onExcludeStation(station.stationId)}>개편안에서 제외</button>}</li>)}</ul>
    {tileError && <div className="map-tile-error"><strong>지도를 불러오지 못했습니다.</strong><span>네트워크 연결을 확인하세요. 목록과 좌표 편집은 계속 사용할 수 있습니다.</span></div>}
  </div>;
}
