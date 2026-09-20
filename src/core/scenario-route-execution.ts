import { calculatePolylineDistanceMeters, fetchRouteShapesForStops, type RouteShapePoint, type ScenarioRouteShapeRequest } from './route-shape';
import { estimateSegmentTravelTimes } from './synthetic-gtfs/travel-time-estimator';
import type {
  MotisRequestInit,
  ScenarioDirectionExecution,
  ScenarioNetworkSnapshot,
  ScenarioPathProvenance,
  ScenarioRouteExecution,
  ScenarioSegmentExecution
} from '../shared/types';
import type { MaterializedScenarioNetwork, MaterializedScenarioRoute } from './scenario-execution';

export interface ExecuteScenarioNetworkInput {
  network: MaterializedScenarioNetwork;
  request: (path: string, init?: MotisRequestInit) => Promise<unknown>;
}

function stopPoint(stop: MaterializedScenarioRoute['stopRecords'][number]): RouteShapePoint {
  return { latitude: stop.latitude, longitude: stop.longitude };
}

function segmentRequests(route: MaterializedScenarioRoute, direction: 'forward' | 'reverse'): ScenarioRouteShapeRequest[] {
  const stops = direction === 'forward' ? route.stopRecords : [...route.stopRecords].reverse();
  return stops.slice(0, -1).map((from, index) => {
    const to = stops[index + 1];
    return {
      key: `${route.routeId}:${direction}:${from.stationId}:${to.stationId}:${index}`,
      fromStopId: from.stationId,
      toStopId: to.stationId,
      from: stopPoint(from),
      to: stopPoint(to)
    };
  });
}

function provenance(source: 'osm' | 'beeline', operationModelVersion: string): ScenarioPathProvenance {
  return source === 'osm'
    ? { sourceType: 'OSM_ROUTED', confidence: 'high', modelVersion: operationModelVersion, assumptions: ['MOTIS BUS geometry를 사용했고 운행시간은 geometry 거리 기반 모델 추정값입니다.'] }
    : { sourceType: 'BEELINE_FALLBACK', confidence: 'low', modelVersion: operationModelVersion, assumptions: ['MOTIS BUS geometry를 사용할 수 없어 정류장 간 직선 fallback을 저장했습니다.', 'fallback 구간은 실제 도로 경로가 아닙니다.'] };
}

async function executeDirection(route: MaterializedScenarioRoute, direction: 'forward' | 'reverse', request: ExecuteScenarioNetworkInput['request']): Promise<ScenarioDirectionExecution> {
  const requests = segmentRequests(route, direction);
  const shapes = await fetchRouteShapesForStops({ requests, request });
  const segments: ScenarioSegmentExecution[] = requests.map((item) => {
    const shape = shapes.get(item.key);
    const points = shape?.points ?? [];
    const distanceMeters = points.length >= 2 ? Math.max(1, calculatePolylineDistanceMeters(points)) : null;
    const travelSeconds = distanceMeters === null ? null : estimateSegmentTravelTimes([{
      fromStopId: item.fromStopId,
      toStopId: item.toStopId,
      distanceMeters,
      roadClass: 'unknown',
      intersectionCount: 0,
      turnCount: 0,
      dwellSecondsAtFromStop: route.operation.dwellSeconds
    }], route.operation.travelTimeModel)[0].travelSeconds;
    return {
      fromStopId: item.fromStopId,
      toStopId: item.toStopId,
      points,
      distanceMeters,
      travelSeconds,
      source: shape?.source ?? 'beeline',
      provenance: provenance(shape?.source ?? 'beeline', route.operation.travelTimeModel.modelVersion),
      ...(shape?.warning ? { warning: shape.warning } : {})
    };
  });
  const usableSegments = segments.filter((segment) => segment.distanceMeters !== null && segment.travelSeconds !== null);
  const hasFallback = segments.some((segment) => segment.source === 'beeline');
  return {
    direction,
    segments,
    routeDistanceMeters: usableSegments.length ? usableSegments.reduce((sum, segment) => sum + segment.distanceMeters!, 0) : null,
    runtimeSeconds: usableSegments.length ? usableSegments.reduce((sum, segment) => sum + segment.travelSeconds!, 0) : null,
    status: !segments.length || !usableSegments.length ? 'failed' : hasFallback ? 'partial' : 'complete'
  };
}

async function executeRoute(route: MaterializedScenarioRoute, request: ExecuteScenarioNetworkInput['request']): Promise<ScenarioRouteExecution> {
  const directions = [await executeDirection(route, 'forward', request)];
  if (route.operation.deriveReverseDirection) directions.push(await executeDirection(route, 'reverse', request));
  const failed = directions.every((direction) => direction.status === 'failed');
  const partial = directions.some((direction) => direction.status === 'partial' || direction.status === 'failed');
  const warnings = [...route.warnings];
  if (partial) warnings.push(`${route.routeId} 노선의 일부 구간은 실제 도로 경로가 아닌 fallback 또는 실패 결과입니다.`);
  return {
    routeId: route.routeId,
    routeName: route.routeName,
    transportMode: route.transportMode,
    source: route.source,
    stopIds: route.stopRecords.map((stop) => stop.stationId),
    operation: route.operation,
    directions,
    totalDistanceMeters: directions.some((direction) => direction.routeDistanceMeters !== null)
      ? directions.reduce((sum, direction) => sum + (direction.routeDistanceMeters ?? 0), 0)
      : null,
    totalRuntimeSeconds: directions.some((direction) => direction.runtimeSeconds !== null)
      ? directions.reduce((sum, direction) => sum + (direction.runtimeSeconds ?? 0), 0)
      : null,
    status: failed ? 'failed' : partial ? 'partial' : 'complete',
    warnings: [...new Set(warnings)]
  };
}

export async function executeScenarioNetwork(input: ExecuteScenarioNetworkInput): Promise<ScenarioNetworkSnapshot> {
  const routes: ScenarioRouteExecution[] = [];
  for (const route of input.network.routes) routes.push(await executeRoute(route, input.request));
  const warnings = [...input.network.warnings, ...routes.flatMap((route) => route.warnings)];
  const status = routes.length === 0 || routes.every((route) => route.status === 'failed')
    ? 'failed'
    : routes.every((route) => route.status === 'complete')
      ? 'complete'
      : 'partial';
  return { routes, status, warnings: [...new Set(warnings)] };
}
