import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildODDemandMapModel } from '../core/od-demand-view';
import { formatStationDemand } from '../core/report';
import type { DisplayUnit, ODDemandViewRow } from '../shared/types';

interface ODDemandMapProps {
  rows: ODDemandViewRow[];
  metricLabel: string;
  displayUnit: DisplayUnit;
  selectedFlowKey?: string;
  onSelectFlow: (flowKey: string) => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export default function ODDemandMap({ rows, metricLabel, displayUnit, selectedFlowKey, onSelectFlow }: ODDemandMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [tileError, setTileError] = useState(false);
  const model = useMemo(() => buildODDemandMapModel(rows, selectedFlowKey), [rows, selectedFlowKey]);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [`${row.originStationId}→${row.destinationStationId}`, row])), [rows]);

  useEffect(() => {
    if (!containerRef.current || !model.flows.length) return undefined;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true });
    const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    const endpointCoords = model.endpoints.map((endpoint) => [endpoint.latitude, endpoint.longitude] as [number, number]);
    const bounds = L.latLngBounds(endpointCoords);
    if (endpointCoords.length > 1) map.fitBounds(bounds.pad(0.12));
    else map.setView(endpointCoords[0], 14);
    tileLayer.on('tileerror', () => setTileError(true));

    for (const flow of model.flows) {
      const latLngs = flow.points.map((point) => [point.latitude, point.longitude] as [number, number]);
      const line = L.polyline(latLngs, { color: flow.color, weight: flow.width, opacity: flow.opacity, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      const arrow = L.polygon(flow.arrowhead.map((point) => [point.latitude, point.longitude] as [number, number]), { color: flow.color, fillColor: flow.color, fillOpacity: flow.opacity, weight: 0 }).addTo(map);
      const source = rowByKey.get(flow.key);
      const popup = source ? `<strong>${escapeHtml(source.originStationName)} → ${escapeHtml(source.destinationStationName)}</strong><br />일평균 ${formatStationDemand(source.dailyAverage, displayUnit)}${metricLabel === '통행량' ? '건' : displayUnit === 'thousand' ? '천 명' : '명'}` : flow.key;
      line.bindPopup(popup);
      arrow.bindPopup(popup);
      line.on('click', () => onSelectFlow(flow.key));
      arrow.on('click', () => onSelectFlow(flow.key));
    }

    for (const endpoint of model.endpoints) {
      const marker = L.circleMarker([endpoint.latitude, endpoint.longitude], {
        radius: endpoint.role === 'origin' ? 5 : 4,
        color: endpoint.role === 'origin' ? '#8d2020' : '#555',
        fillColor: '#fff',
        fillOpacity: 0.95,
        weight: 2
      }).addTo(map);
      marker.bindTooltip(`${escapeHtml(endpoint.stationName)} (${endpoint.role === 'origin' ? 'O' : 'D'})`, { direction: 'top', opacity: 0.9 });
    }

    const resize = () => map.invalidateSize();
    const resizeTimer = window.setTimeout(resize, 0);
    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
    };
  }, [displayUnit, metricLabel, model, onSelectFlow, retryToken, rowByKey]);

  if (!model.flows.length) return <div className="map-empty">정류장 사전에 등록된 승차·하차 좌표가 있는 OD 흐름이 없습니다.</div>;
  return <div className="od-map-shell">
    <div ref={containerRef} className="od-map" aria-label="OD 통행 흐름 지도" />
    <div className="od-map-legend"><span className="legend-line" /> 흐름선 · 선이 굵을수록 일평균 통행량이 많음 <span className="legend-arrow">▶</span> 하차 방향</div>
    {tileError && <div className="map-tile-warning" role="status">지도 배경을 불러오지 못했습니다. 흐름선은 표시됩니다. <button className="text-button" onClick={() => { setTileError(false); setRetryToken((value) => value + 1); }}>다시 시도</button></div>}
  </div>;
}
