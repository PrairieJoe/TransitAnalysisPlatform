import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildStationDemandMapModel } from '../core/station-demand-view';
import { formatStationDemand } from '../core/report';
import type { DisplayUnit, StationDemandViewRow } from '../shared/types';

interface StationDemandMapProps {
  rows: StationDemandViewRow[];
  displayUnit: DisplayUnit;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export default function StationDemandMap({ rows, displayUnit, selectedStationId, onSelectStation }: StationDemandMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const [retryToken, setRetryToken] = useState(0);
  const [tileError, setTileError] = useState(false);
  const model = useMemo(() => buildStationDemandMapModel(rows, displayUnit), [displayUnit, rows]);
  const mappableRows = useMemo(() => rows.filter((row) => row.mapAvailable && row.latitude !== null && row.longitude !== null), [rows]);

  useEffect(() => {
    if (!containerRef.current || !mappableRows.length) return undefined;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true });
    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    const markerById = new Map<string, L.CircleMarker>();
    const rowById = new Map(mappableRows.map((row) => [row.stationId, row]));
    model.markers.forEach((marker) => {
      const row = rowById.get(marker.stationId);
      if (!row) return;
      const circle = L.circleMarker([marker.latitude, marker.longitude], {
        radius: marker.radius,
        color: '#fff',
        weight: 2,
        fillColor: marker.color,
        fillOpacity: .82,
        bubblingMouseEvents: false
      });
      circle.bindPopup(`<strong>${escapeHtml(row.stationName)}</strong><br />정류장 ID: ${escapeHtml(row.stationId)}<br />일평균 수요: ${formatStationDemand(row.dailyAverage, displayUnit)}`);
      circle.on('click', () => onSelectStation(row.stationId));
      circle.on('mouseover', () => onSelectStation(row.stationId));
      circle.addTo(map);
      markerById.set(row.stationId, circle);
    });
    markersRef.current = markerById;
    const bounds = L.latLngBounds(model.markers.map((marker) => [marker.latitude, marker.longitude] as [number, number]));
    if (model.markers.length === 1) map.setView(bounds.getCenter(), 15);
    else map.fitBounds(bounds, { padding: [24, 24] });
    setTileError(false);
    window.setTimeout(() => map.invalidateSize(), 0);

    const handleTileError = () => setTileError(true);
    tileLayer.on('tileerror', handleTileError);
    return () => {
      tileLayer.off('tileerror', handleTileError);
      markersRef.current.clear();
      map.remove();
    };
  }, [displayUnit, mappableRows, model.markers, onSelectStation, retryToken]);

  useEffect(() => {
    const selected = selectedStationId ? markersRef.current.get(selectedStationId) : undefined;
    markersRef.current.forEach((marker, stationId) => {
      const isSelected = stationId === selectedStationId;
      marker.setStyle({ weight: isSelected ? 4 : 2, color: isSelected ? '#1261b5' : '#fff', fillOpacity: isSelected ? 1 : .82 });
      if (isSelected) marker.bringToFront();
    });
    if (selected && selectedStationId) selected.openPopup();
  }, [selectedStationId]);

  if (!mappableRows.length) {
    return <div className="station-map-empty"><strong>표시할 정류장 위치가 없습니다.</strong><span>정류장 사전에 일치하는 ID와 좌표가 있는지 확인하세요.</span></div>;
  }

  return <div className="station-map-wrap">
    <div ref={containerRef} className="station-map" aria-label="정류장별 수요 지도" />
    <div className="map-legend" aria-label="정류장 수요 범례">
      <strong>일평균 수요 ({displayUnit === 'thousand' ? '천 명/일' : '인/일'})</strong>
      {model.bands.map((band) => <span key={`${band.min}-${band.max}`}><i style={{ backgroundColor: band.color }} />{band.label}</span>)}
    </div>
    {tileError && <div className="map-tile-error"><strong>지도를 불러오지 못했습니다.</strong><span>네트워크 연결을 확인하세요. 표와 수치 분석은 계속 사용할 수 있습니다.</span><button className="secondary-button" onClick={() => setRetryToken((token) => token + 1)}>지도 재시도</button></div>}
  </div>;
}
