import type { MotisRequestInit, RouteSegmentMetric } from '../shared/types';
import { routeSegmentKey } from './route-demand-view';

export interface RouteShapePoint { latitude: number; longitude: number }
export interface RouteShapeSegment { key: string; points: RouteShapePoint[]; source: 'osm' | 'beeline'; warning?: string }
export interface RouteShapeResult {
  segments: RouteShapeSegment[];
  warnings: string[];
  quality: { totalSegments: number; routedSegments: number; fallbackSegments: number; invalidSegments: number; requestCount: number };
}
function valid(p: RouteShapePoint): boolean { return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180; }
function distance(a: RouteShapePoint, b: RouteShapePoint): number {
  const rad = Math.PI / 180;
  return Math.hypot((b.longitude - a.longitude) * Math.cos((a.latitude + b.latitude) * rad / 2), b.latitude - a.latitude) * 111195;
}
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function geometry(value: unknown, from: RouteShapePoint, to: RouteShapePoint): { points: RouteShapePoint[]; warning?: string } {
  const root = object(value);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features) || !root.features.length || root.features.length > 10000) throw new Error('BUS 도로 경로가 없습니다.');
  const points: RouteShapePoint[] = [];
  let road = false; let connector = false;
  for (const feature of root.features) {
    const item = object(feature); const line = object(item.geometry); const way = object(item.properties).way;
    if (item.type !== 'Feature' || line.type !== 'LineString' || !Array.isArray(line.coordinates) || line.coordinates.length < 2) throw new Error('도로 geometry 형식 오류');
    const part = line.coordinates.map((c: unknown) => {
      if (!Array.isArray(c) || c.length < 2) throw new Error('좌표 형식 오류');
      const p = { latitude: c[1] as number, longitude: c[0] as number };
      if (!valid(p)) throw new Error('유효하지 않은 도로 좌표');
      return p;
    });
    if (points.length && distance(points[points.length - 1], part[0]) > 2) throw new Error('연속되지 않은 도로 geometry');
    if (typeof way === 'number' && way > 0) road = true;
    else {
      if (part.reduce((sum, p, i) => sum + (i ? distance(part[i - 1], p) : 0), 0) > 100) throw new Error('긴 비도로 연결 구간');
      connector = true;
    }
    for (const p of part) if (!points.length || distance(points[points.length - 1], p) > 0.01) points.push(p);
    if (points.length > 50000) throw new Error('도로 geometry 크기 제한');
  }
  if (!road || points.length < 2 || distance(from, points[0]) > 100 || distance(to, points[points.length - 1]) > 100) throw new Error('정류장과 일치하는 OSM BUS 경로가 없습니다.');
  if (distance(from, points[0]) > .01) { points.unshift(from); connector = true; } else points[0] = from;
  if (distance(to, points[points.length - 1]) > .01) { points.push(to); connector = true; } else points[points.length - 1] = to;
  const detour = points.reduce((sum, point, index) => sum + (index ? distance(points[index - 1], point) : 0), 0) / Math.max(1, distance(from, to));
  const warnings = [connector ? '정류장과 도로 사이 짧은 직선 연결 포함' : '', detour > 1.75 ? `도로 우회비율 ${detour.toFixed(2)}가 1.75를 초과해 경로 확인이 필요합니다.` : ''].filter(Boolean);
  return { points, warning: warnings.join(' · ') || undefined };
}

/** Native MOTIS OSR BUS routing; no CAR or timetable-beeline substitution. */
export async function fetchRouteShapes(metrics: readonly RouteSegmentMetric[], request: (path: string, init?: MotisRequestInit) => Promise<unknown>): Promise<RouteShapeResult> {
  const segments: RouteShapeSegment[] = []; const warnings = new Set<string>();
  let unavailable: string | undefined; let requestCount = 0; let invalidSegments = 0;
  for (const metric of metrics) {
    const key = routeSegmentKey(metric);
    const from = { latitude: metric.fromLatitude, longitude: metric.fromLongitude }; const to = { latitude: metric.toLatitude, longitude: metric.toLongitude };
    const fallback = (warning: string, points: RouteShapePoint[] = [from, to]) => { segments.push({ key, points, source: 'beeline', warning }); warnings.add(warning); };
    if (!valid(from) || !valid(to)) { invalidSegments++; fallback('정류장 좌표가 유효하지 않아 경로를 표시할 수 없습니다.', []); continue; }
    if (unavailable) { fallback(unavailable); continue; }
    if (requestCount >= 256) { fallback('도로 조회 한도(256구간)를 초과하여 직선으로 표시합니다.'); continue; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let value: unknown;
    try {
      requestCount++;
      value = await Promise.race([
        request('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'bus', direction: 'forward', start: { lat: from.latitude, lng: from.longitude }, destination: { lat: to.latitude, lng: to.longitude }, max: 3600 }) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('BUS 경로 응답 시간 초과')), 8000); })
      ]);
    } catch (error) {
      unavailable = `MOTIS BUS 도로 조회를 사용할 수 없습니다. OSM 준비 상태를 확인하세요. (${error instanceof Error ? error.message : String(error)})`;
      fallback(unavailable); continue;
    } finally { if (timer !== undefined) clearTimeout(timer); }
    try { const shape = geometry(value, from, to); segments.push({ key, source: 'osm', ...shape }); if (shape.warning) warnings.add(shape.warning); }
    catch (error) { fallback(`${error instanceof Error ? error.message : '도로 경로 검증 실패'} 직선으로 표시합니다.`); }
  }
  const routedSegments = segments.filter(segment => segment.source === 'osm').length;
  return { segments, warnings: [...warnings], quality: { totalSegments: segments.length, routedSegments, fallbackSegments: segments.length - routedSegments, invalidSegments, requestCount } };
}
