import type { MotisRequestInit, RouteSegmentMetric } from '../shared/types';
import { routeSegmentKey } from './route-demand-view';

export interface RouteShapePoint { latitude: number; longitude: number }
export interface RouteShapeSegment { key: string; points: RouteShapePoint[]; source: 'osm' | 'beeline'; warning?: string }
export interface RouteShapeResult {
  segments: RouteShapeSegment[];
  warnings: string[];
  quality: { totalSegments: number; routedSegments: number; fallbackSegments: number; invalidSegments: number; requestCount: number };
}

export interface ScenarioRouteShapeRequest {
  key: string;
  fromStopId: string;
  toStopId: string;
  from: RouteShapePoint;
  to: RouteShapePoint;
}

export interface ScenarioRouteShapeFetchInput {
  requests: readonly ScenarioRouteShapeRequest[];
  request: (path: string, init?: MotisRequestInit) => Promise<unknown>;
}

function valid(point: RouteShapePoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

function distance(a: RouteShapePoint, b: RouteShapePoint): number {
  const rad = Math.PI / 180;
  return Math.hypot((b.longitude - a.longitude) * Math.cos((a.latitude + b.latitude) * rad / 2), b.latitude - a.latitude) * 111195;
}

export function calculatePolylineDistanceMeters(points: ReadonlyArray<RouteShapePoint>): number {
  return points.reduce((sum, point, index) => sum + (index ? distance(points[index - 1], point) : 0), 0);
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
    const part = line.coordinates.map((coordinate: unknown) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error('좌표 형식 오류');
      const point = { latitude: coordinate[1] as number, longitude: coordinate[0] as number };
      if (!valid(point)) throw new Error('유효하지 않은 도로 좌표');
      return point;
    });
    if (points.length && distance(points[points.length - 1], part[0]) > 2) throw new Error('연속되지 않은 도로 geometry');
    if (typeof way === 'number' && way > 0) road = true;
    else {
      if (calculatePolylineDistanceMeters(part) > 100) throw new Error('긴 비도로 연결 구간');
      connector = true;
    }
    for (const point of part) if (!points.length || distance(points[points.length - 1], point) > 0.01) points.push(point);
    if (points.length > 50000) throw new Error('도로 geometry 크기 제한');
  }
  if (!road || points.length < 2 || distance(from, points[0]) > 100 || distance(to, points[points.length - 1]) > 100) throw new Error('정류장과 일치하는 OSM BUS 경로가 없습니다.');
  if (distance(from, points[0]) > .01) { points.unshift(from); connector = true; } else points[0] = from;
  if (distance(to, points[points.length - 1]) > .01) { points.push(to); connector = true; } else points[points.length - 1] = to;
  const detour = calculatePolylineDistanceMeters(points) / Math.max(1, distance(from, to));
  const warnings = [connector ? '정류장과 도로 사이 짧은 직선 연결 포함' : '', detour > 1.75 ? `도로 우회비율 ${detour.toFixed(2)}가 1.75를 초과해 경로 확인이 필요합니다.` : ''].filter(Boolean);
  return { points, warning: warnings.join(' · ') || undefined };
}

interface RouteShapeFetchSummary {
  segments: RouteShapeSegment[];
  warnings: string[];
  invalidSegments: number;
  requestCount: number;
}

async function fetchRouteShapeSegments(input: ScenarioRouteShapeFetchInput): Promise<RouteShapeFetchSummary> {
  const segments: RouteShapeSegment[] = [];
  const warnings = new Set<string>();
  let unavailable: string | undefined;
  let requestCount = 0;
  let invalidSegments = 0;
  for (const item of input.requests) {
    const fallback = (warning: string, points: RouteShapePoint[] = [item.from, item.to]) => {
      segments.push({ key: item.key, points, source: 'beeline', warning });
      warnings.add(warning);
    };
    if (!valid(item.from) || !valid(item.to)) {
      invalidSegments += 1;
      fallback('정류장 좌표가 유효하지 않아 경로를 표시할 수 없습니다.', []);
      continue;
    }
    if (unavailable) { fallback(unavailable); continue; }
    if (requestCount >= 256) { fallback('도로 조회 한도(256구간)를 초과하여 직선으로 표시합니다.'); continue; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let value: unknown;
    try {
      requestCount += 1;
      value = await Promise.race([
        input.request('/api/route', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profile: 'bus', direction: 'forward', start: { lat: item.from.latitude, lng: item.from.longitude }, destination: { lat: item.to.latitude, lng: item.to.longitude }, max: 3600 })
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('BUS 경로 응답 시간 초과')), 8000); })
      ]);
    } catch (error) {
      unavailable = `MOTIS BUS 도로 조회를 사용할 수 없습니다. OSM 준비 상태를 확인하세요. (${error instanceof Error ? error.message : String(error)})`;
      fallback(unavailable);
      continue;
    } finally { if (timer !== undefined) clearTimeout(timer); }
    try {
      const shape = geometry(value, item.from, item.to);
      segments.push({ key: item.key, source: 'osm', ...shape });
      if (shape.warning) warnings.add(shape.warning);
    } catch (error) {
      fallback(`${error instanceof Error ? error.message : '도로 경로 검증 실패'} 직선으로 표시합니다.`);
    }
  }
  return { segments, warnings: [...warnings], invalidSegments, requestCount };
}

/** Fetches one keyed BUS shape per stop pair and preserves whether it was routed or fallback. */
export async function fetchRouteShapesForStops(input: ScenarioRouteShapeFetchInput): Promise<Map<string, RouteShapeSegment>> {
  const summary = await fetchRouteShapeSegments(input);
  return new Map(summary.segments.map((segment) => [segment.key, segment]));
}

/** Native MOTIS OSR BUS routing; no CAR or timetable-beeline substitution. */
export async function fetchRouteShapes(metrics: readonly RouteSegmentMetric[], request: (path: string, init?: MotisRequestInit) => Promise<unknown>): Promise<RouteShapeResult> {
  const summary = await fetchRouteShapeSegments({
    requests: metrics.map((metric) => ({
      key: routeSegmentKey(metric),
      fromStopId: metric.fromStationId,
      toStopId: metric.toStationId,
      from: { latitude: metric.fromLatitude, longitude: metric.fromLongitude },
      to: { latitude: metric.toLatitude, longitude: metric.toLongitude }
    })),
    request
  });
  const routedSegments = summary.segments.filter((segment) => segment.source === 'osm').length;
  return {
    segments: summary.segments,
    warnings: summary.warnings,
    quality: {
      totalSegments: summary.segments.length,
      routedSegments,
      fallbackSegments: summary.segments.length - routedSegments,
      invalidSegments: summary.invalidSegments,
      requestCount: summary.requestCount
    }
  };
}
