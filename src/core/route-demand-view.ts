import { congestionColor } from './route-analysis';
import type { RouteSegmentMetric } from '../shared/types';

export interface RouteMapSegment {
  key: string;
  points: Array<{ latitude: number; longitude: number }>;
  color: string;
  width: number;
  opacity: number;
  directionLabel: string;
  fromStationName: string;
  toStationName: string;
  previousOnboard: number;
  boardings: number;
  alightings: number;
  congestionPercent: number | null;
  peakOnboardPassengers: number;
}

export interface RouteMapStop {
  stationId: string;
  stationName: string;
  sequence: number;
  latitude: number;
  longitude: number;
}

export interface RouteCongestionMapModel {
  segments: RouteMapSegment[];
  stops: RouteMapStop[];
}

export function routeSegmentKey(metric: RouteSegmentMetric): string {
  return [metric.routeId, metric.direction, metric.fromSequence, metric.toSequence, metric.fromStationId, metric.toStationId].join('\u001f');
}

export interface RouteSegmentGeometry {
  key: string;
  points: Array<{ latitude: number; longitude: number }>;
}

/** Require current endpoints so a previous route revision cannot silently supply geometry. */
export function routeGeometryPoints(metric: RouteSegmentMetric, geometry?: RouteSegmentGeometry): RouteSegmentGeometry['points'] {
  const endpoints = [{ latitude: metric.fromLatitude, longitude: metric.fromLongitude }, { latitude: metric.toLatitude, longitude: metric.toLongitude }];
  const points = geometry?.points;
  if (!points || points.length < 2 || points.some((p) => !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180)) return endpoints;
  const near = (a: typeof endpoints[number], b: typeof endpoints[number]): boolean => Math.abs(a.latitude - b.latitude) < .00001 && Math.abs(a.longitude - b.longitude) < .00001;
  return near(points[0], endpoints[0]) && near(points[points.length - 1], endpoints[1]) ? points : endpoints;
}

export function buildRouteCongestionMapModel(metrics: RouteSegmentMetric[], selectedKey?: string, geometries: readonly RouteSegmentGeometry[] = []): RouteCongestionMapModel {
  const shapes = new Map(geometries.map((geometry) => [geometry.key, geometry]));
  const maxOccupancy = Math.max(...metrics.map((metric) => metric.peakOnboardPassengers), 0);
  const stops = new Map<string, RouteMapStop>();
  const segments = metrics.map((metric) => {
    const key = routeSegmentKey(metric);
    stops.set(metric.fromStationId, { stationId: metric.fromStationId, stationName: metric.fromStationName, sequence: metric.fromSequence, latitude: metric.fromLatitude, longitude: metric.fromLongitude });
    stops.set(metric.toStationId, { stationId: metric.toStationId, stationName: metric.toStationName, sequence: metric.toSequence, latitude: metric.toLatitude, longitude: metric.toLongitude });
    const selected = key === selectedKey;
    const ratio = maxOccupancy ? metric.peakOnboardPassengers / maxOccupancy : 0;
    return {
      key,
      points: routeGeometryPoints(metric, shapes.get(key)),
      color: congestionColor(metric.congestionPercent),
      width: selected ? 8 : 3 + ratio * 5,
      opacity: selected ? 1 : .8,
      directionLabel: metric.directionLabel,
      fromStationName: metric.fromStationName,
      toStationName: metric.toStationName,
      previousOnboard: metric.previousOnboard,
      boardings: metric.boardings,
      alightings: metric.alightings,
      congestionPercent: metric.congestionPercent,
      peakOnboardPassengers: metric.peakOnboardPassengers
    };
  });
  return { segments, stops: [...stops.values()].sort((left, right) => left.sequence - right.sequence) };
}
