import { congestionColor } from '../../core/route-analysis';
import { routeSegmentKey } from '../../core/route-demand-view';
import type { RouteSegmentMetric } from '../../shared/types';
import { createLocalMeterProjection, isValidGeoPoint, type GeoPoint, type ProjectionBounds } from './projection';

export interface Transit3DPoint {
  x: number;
  y: number;
  z: number;
}

export interface Transit3DSegment {
  key: string;
  fromStationId: string;
  toStationId: string;
  fromStationName: string;
  toStationName: string;
  directionLabel: string;
  from: Transit3DPoint;
  to: Transit3DPoint;
  color: string;
  width: number;
  opacity: number;
  height: number;
  congestionPercent: number | null;
  previousOnboard: number;
  boardings: number;
  alightings: number;
  peakOnboardPassengers: number;
}

export interface Transit3DStop {
  key: string;
  stationId: string;
  stationName: string;
  sequence: number;
  position: Transit3DPoint;
}

export interface Transit3DModel {
  segments: Transit3DSegment[];
  stops: Transit3DStop[];
  bounds: ProjectionBounds & { minZ: number; maxZ: number };
  origin: GeoPoint;
  omittedCoordinateCount: number;
}

const STATION_KEY_SEPARATOR = '\u001f';
const MIN_HEIGHT = 0.75;
const MAX_HEIGHT = 5;

function stationKey(metric: RouteSegmentMetric, stationId: string, sequence: number): string {
  return [metric.routeId, metric.direction, stationId, sequence].join(STATION_KEY_SEPARATOR);
}

function pointFor(latitude: number, longitude: number): GeoPoint {
  return { latitude, longitude };
}

function finitePeak(metric: RouteSegmentMetric): number {
  return Number.isFinite(metric.peakOnboardPassengers) && metric.peakOnboardPassengers > 0 ? metric.peakOnboardPassengers : 0;
}

export function buildTransit3DModel(metrics: readonly RouteSegmentMetric[]): Transit3DModel {
  const geoPoints = metrics.flatMap((metric) => [
    pointFor(metric.fromLatitude, metric.fromLongitude),
    pointFor(metric.toLatitude, metric.toLongitude)
  ]).filter(isValidGeoPoint);
  const projection = createLocalMeterProjection(geoPoints);
  const maxPeak = Math.max(...metrics.map(finitePeak), 0);
  const stops = new Map<string, Transit3DStop>();
  let omittedCoordinateCount = 0;

  const addStop = (metric: RouteSegmentMetric, stationId: string, stationName: string, sequence: number, geoPoint: GeoPoint): void => {
    if (!isValidGeoPoint(geoPoint)) return;
    const projected = projection.project(geoPoint);
    const key = stationKey(metric, stationId, sequence);
    if (!stops.has(key)) stops.set(key, { key, stationId, stationName, sequence, position: { ...projected, z: 0 } });
  };

  const segments = metrics.flatMap((metric): Transit3DSegment[] => {
    const fromGeo = pointFor(metric.fromLatitude, metric.fromLongitude);
    const toGeo = pointFor(metric.toLatitude, metric.toLongitude);
    addStop(metric, metric.fromStationId, metric.fromStationName, metric.fromSequence, fromGeo);
    addStop(metric, metric.toStationId, metric.toStationName, metric.toSequence, toGeo);
    if (!isValidGeoPoint(fromGeo) || !isValidGeoPoint(toGeo)) {
      omittedCoordinateCount += 1;
      return [];
    }
    const from = projection.project(fromGeo);
    const to = projection.project(toGeo);
    const ratio = maxPeak > 0 ? finitePeak(metric) / maxPeak : 0;
    const height = MIN_HEIGHT + ratio * (MAX_HEIGHT - MIN_HEIGHT);
    return [{
      key: routeSegmentKey(metric),
      fromStationId: metric.fromStationId,
      toStationId: metric.toStationId,
      fromStationName: metric.fromStationName,
      toStationName: metric.toStationName,
      directionLabel: metric.directionLabel,
      from: { ...from, z: height },
      to: { ...to, z: height },
      color: congestionColor(metric.congestionPercent),
      width: 2 + ratio * 4,
      opacity: 0.82,
      height,
      congestionPercent: metric.congestionPercent,
      previousOnboard: metric.previousOnboard,
      boardings: metric.boardings,
      alightings: metric.alightings,
      peakOnboardPassengers: metric.peakOnboardPassengers
    }];
  });
  const sortedStops = [...stops.values()].sort((left, right) => left.sequence - right.sequence || left.key.localeCompare(right.key, 'en'));
  const maxZ = segments.reduce((current, segment) => Math.max(current, segment.height), 0);

  return {
    segments,
    stops: sortedStops,
    bounds: { ...projection.bounds, minZ: 0, maxZ },
    origin: projection.origin,
    omittedCoordinateCount
  };
}
