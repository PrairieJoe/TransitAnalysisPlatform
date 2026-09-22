import { useEffect, useRef, useState, type JSX } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RouteSearchMapModel } from '../core/route-search-map';

export interface RouteSearchMapProps {
  model: RouteSearchMapModel;
  activeEndpoint: 'origin' | 'destination';
  onMapClick: (latitude: number, longitude: number) => void;
  onSelectRoute: (routeId: string) => void;
}

function legColor(mode: string): string {
  if (/WALK|FOOT/i.test(mode)) return '#d97706';
  if (/TRANSFER/i.test(mode)) return '#667085';
  return '#1d5fa7';
}

export default function RouteSearchMap({ model, activeEndpoint, onMapClick, onSelectRoute }: RouteSearchMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    let cleanup = (): void => {};
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !containerRef.current) return;
      const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true });
      const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);
      const boundsPoints = model.boundsPoints.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
      if (boundsPoints.length > 1) map.fitBounds(L.latLngBounds(boundsPoints.map((point) => [point.latitude, point.longitude] as [number, number])).pad(0.12));
      else if (boundsPoints.length === 1) map.setView([boundsPoints[0].latitude, boundsPoints[0].longitude], 14);
      else map.setView([36.5, 127.8], 7);

      const endpointMarkers = model.endpoints.map((endpoint) => {
        const marker = L.circleMarker([endpoint.latitude, endpoint.longitude], {
          radius: 8,
          color: endpoint.role === 'origin' ? '#0f766e' : '#b42318',
          fillColor: '#fff',
          fillOpacity: 1,
          weight: 3,
          bubblingMouseEvents: false
        }).addTo(map);
        marker.bindTooltip(`${endpoint.role === 'origin' ? '출발' : '도착'} · ${endpoint.label}`, { direction: 'top', opacity: 0.95 });
        return marker;
      });
      const lines: Leaflet.Polyline[] = [];
      for (const route of model.routes) {
        for (const leg of route.legs) {
          if (leg.points.length < 2) continue;
          const line = L.polyline(leg.points.map((point) => [point.latitude, point.longitude] as [number, number]), {
            color: legColor(leg.mode),
            weight: route.id === model.selectedRouteId ? 6 : 4,
            opacity: route.id === model.selectedRouteId ? 0.95 : 0.45,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);
          line.bindTooltip(`${route.id} · ${leg.routeId ?? leg.mode}`);
          line.on('click', () => onSelectRoute(route.id));
          lines.push(line);
        }
      }
      const handleMapClick = (event: Leaflet.LeafletMouseEvent) => onMapClick(event.latlng.lat, event.latlng.lng);
      map.on('click', handleMapClick);
      const handleTileError = () => setTileError(true);
      tileLayer.on('tileerror', handleTileError);
      setTileError(false);
      const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0);
      cleanup = () => {
        window.clearTimeout(resizeTimer);
        tileLayer.off('tileerror', handleTileError);
        map.off('click', handleMapClick);
        endpointMarkers.forEach((marker) => marker.remove());
        lines.forEach((line) => line.remove());
        map.remove();
      };
    }).catch(() => setTileError(true));
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [model, onMapClick, onSelectRoute]);

  return <div className="route-search-map-shell">
    <div className="route-search-map-toolbar" role="status"><strong>경로탐색 지도</strong><span>출발지 · 도착지 · {activeEndpoint === 'origin' ? '지도를 클릭해 출발지를 선택하세요.' : '지도를 클릭해 도착지를 선택하세요.'}</span></div>
    <div ref={containerRef} className="route-search-map" aria-label="경로탐색 지도" />
    <div className="route-search-map-legend"><span><i className="route-search-legend-transit" /> 대중교통</span><span><i className="route-search-legend-walk" /> 도보·환승</span></div>
    {tileError && <div className="map-tile-error" role="status"><strong>지도 배경을 불러오지 못했습니다.</strong><span>경로 목록과 endpoint 선택은 계속 사용할 수 있습니다.</span></div>}
  </div>;
}
