import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildRouteCongestionMapModel, type RouteSegmentGeometry } from '../core/route-demand-view';
import { CONGESTION_BANDS } from '../core/route-analysis';
import type { RouteSegmentMetric } from '../shared/types';

interface RouteCongestionMapProps {
  metrics: RouteSegmentMetric[];
  geometries?: readonly RouteSegmentGeometry[];
  selectedSegmentKey?: string;
  onSelectSegment: (key: string) => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export default function RouteCongestionMap({ metrics, geometries, selectedSegmentKey, onSelectSegment }: RouteCongestionMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [tileError, setTileError] = useState(false);
  const model = useMemo(() => buildRouteCongestionMapModel(metrics, selectedSegmentKey, geometries), [metrics, selectedSegmentKey, geometries]);

  useEffect(() => {
    if (!containerRef.current || !model.segments.length) return undefined;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true });
    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    const lines = model.segments.map((segment) => {
      const line = L.polyline(segment.points.map((point) => [point.latitude, point.longitude] as [number, number]), {
        color: segment.color,
        weight: segment.width,
        opacity: segment.opacity,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      line.bindPopup(`<strong>${escapeHtml(segment.directionLabel)} · ${escapeHtml(segment.fromStationName)} → ${escapeHtml(segment.toStationName)}</strong><br />이전 재차인원: ${segment.previousOnboard.toFixed(1)}명<br />승차: ${segment.boardings.toFixed(1)}명 · 하차: ${segment.alightings.toFixed(1)}명<br />재차인원: ${segment.peakOnboardPassengers.toFixed(1)}명<br />혼잡도: ${formatPercent(segment.congestionPercent)}`);
      line.on('click', () => onSelectSegment(segment.key));
      if (segment.key === selectedSegmentKey) line.openPopup();
      return line;
    });
    for (const stop of model.stops) {
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: 5,
        color: '#fff',
        fillColor: '#2f5d8c',
        fillOpacity: .95,
        weight: 2
      }).addTo(map);
      marker.bindTooltip(`${escapeHtml(stop.stationName)} (${stop.sequence})`, { direction: 'top', opacity: .92 });
    }
    const bounds = L.latLngBounds(model.segments.flatMap((segment) => segment.points.map((point) => [point.latitude, point.longitude] as [number, number])));
    if (model.stops.length > 1) map.fitBounds(bounds.pad(0.12));
    else map.setView(bounds.getCenter(), 15);
    const handleTileError = () => setTileError(true);
    tileLayer.on('tileerror', handleTileError);
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(resizeTimer);
      tileLayer.off('tileerror', handleTileError);
      lines.forEach((line) => line.off());
      map.remove();
    };
  }, [model, onSelectSegment, retryToken]);

  if (!model.segments.length) return <div className="map-empty"><strong>표시할 노선 구간이 없습니다.</strong><span>노선정보와 승·하차 정류장 ID가 일치하는지 확인하세요.</span></div>;
  return <div className="route-map-shell">
    <div ref={containerRef} className="route-map" aria-label="노선 구간 혼잡도 지도" />
    <div className="route-map-legend" aria-label="혼잡도 범례">
      <strong>혼잡도</strong>
      {CONGESTION_BANDS.map((band) => <span key={band.label}><i style={{ backgroundColor: band.color }} />{band.label}</span>)}
      <small>회색: 혼잡도 산출에 필요한 기준 미입력</small>
    </div>
    {tileError && <div className="map-tile-warning" role="status">지도 배경을 불러오지 못했습니다. 구간선과 수치는 표시됩니다. <button className="text-button" onClick={() => { setTileError(false); setRetryToken((value) => value + 1); }}>다시 시도</button></div>}
  </div>;
}
