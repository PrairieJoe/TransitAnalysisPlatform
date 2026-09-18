const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocalMeterPoint {
  x: number;
  y: number;
}

export interface ProjectionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface LocalMeterProjection {
  origin: GeoPoint;
  bounds: ProjectionBounds;
  project: (point: GeoPoint) => LocalMeterPoint;
}

export function isValidGeoPoint(point: GeoPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

export function createLocalMeterProjection(points: readonly GeoPoint[]): LocalMeterProjection {
  const validPoints = points.filter(isValidGeoPoint);
  const origin = validPoints.length
    ? {
        latitude: validPoints.reduce((sum, point) => sum + point.latitude, 0) / validPoints.length,
        longitude: validPoints.reduce((sum, point) => sum + point.longitude, 0) / validPoints.length
      }
    : { latitude: 0, longitude: 0 };
  const originLatitudeRadians = origin.latitude * DEGREES_TO_RADIANS;
  const longitudeScale = EARTH_RADIUS_METERS * Math.cos(originLatitudeRadians) * DEGREES_TO_RADIANS;
  const latitudeScale = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;

  const project = (point: GeoPoint): LocalMeterPoint => ({
    x: (point.longitude - origin.longitude) * longitudeScale,
    y: (point.latitude - origin.latitude) * latitudeScale
  });
  const projected = validPoints.map(project);
  const bounds = projected.length
    ? {
        minX: Math.min(...projected.map((point) => point.x)),
        maxX: Math.max(...projected.map((point) => point.x)),
        minY: Math.min(...projected.map((point) => point.y)),
        maxY: Math.max(...projected.map((point) => point.y))
      }
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  return { origin, bounds, project };
}
