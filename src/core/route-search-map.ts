import type { NormalizedJourney } from './transit-comparison';
import type { ScenarioJourneyEndpoint } from '../shared/types';

export interface RouteSearchMapPoint {
  latitude: number;
  longitude: number;
}

export type RouteSearchGeometrySource = 'motis' | 'stop-coordinates' | 'none';

export interface RouteSearchMapEndpoint extends RouteSearchMapPoint {
  role: 'origin' | 'destination';
  label: string;
}

export interface RouteSearchMapLeg {
  mode: string;
  routeId?: string;
  points: RouteSearchMapPoint[];
  geometrySource: RouteSearchGeometrySource;
  qualityMessage?: string;
}

export interface RouteSearchMapRoute {
  id: string;
  totalSeconds: number;
  transferCount: number;
  legs: RouteSearchMapLeg[];
  warnings: string[];
}

export interface RouteSearchMapModel {
  endpoints: RouteSearchMapEndpoint[];
  routes: RouteSearchMapRoute[];
  selectedRouteId?: string;
  boundsPoints: RouteSearchMapPoint[];
}

export interface BuildRouteSearchMapModelInput {
  journeys: NormalizedJourney[];
  origin?: ScenarioJourneyEndpoint;
  destination?: ScenarioJourneyEndpoint;
  stopCoordinates: Map<string, RouteSearchMapPoint>;
  selectedRouteId?: string;
}

function endpointPoint(endpoint: ScenarioJourneyEndpoint | undefined, stopCoordinates: Map<string, RouteSearchMapPoint>): RouteSearchMapPoint | undefined {
  if (!endpoint) return undefined;
  if (endpoint.kind === 'coordinate') return { latitude: endpoint.latitude, longitude: endpoint.longitude };
  return stopCoordinates.get(endpoint.stopId);
}

function endpointLabel(endpoint: ScenarioJourneyEndpoint | undefined, role: 'origin' | 'destination'): string {
  if (!endpoint) return role === 'origin' ? '출발지 미선택' : '도착지 미선택';
  return endpoint.kind === 'stop' ? endpoint.label ?? endpoint.stopId : endpoint.label ?? `${endpoint.latitude.toFixed(5)}, ${endpoint.longitude.toFixed(5)}`;
}

function samePoint(left: RouteSearchMapPoint, right: RouteSearchMapPoint): boolean {
  return Math.abs(left.latitude - right.latitude) < 1e-9 && Math.abs(left.longitude - right.longitude) < 1e-9;
}

function endpointKey(endpoint: ScenarioJourneyEndpoint): string {
  return endpoint.kind === 'stop' ? `stop:${endpoint.stopId}` : `coordinate:${endpoint.latitude}:${endpoint.longitude}`;
}

export function validateRouteSearchEndpoints(origin?: ScenarioJourneyEndpoint, destination?: ScenarioJourneyEndpoint): string | undefined {
  if (!origin) return '출발지를 지도에서 선택하거나 검색하세요.';
  if (!destination) return '도착지를 지도에서 선택하거나 검색하세요.';
  if (endpointKey(origin) === endpointKey(destination)) return '출발지와 도착지는 달라야 합니다.';
  if (origin.kind === 'coordinate' && destination.kind === 'coordinate' && samePoint(origin, destination)) return '출발지와 도착지는 달라야 합니다.';
  return undefined;
}

function legPoints(leg: NormalizedJourney['legs'][number], stopCoordinates: Map<string, RouteSearchMapPoint>): Pick<RouteSearchMapLeg, 'points' | 'geometrySource' | 'qualityMessage'> {
  if (leg.geometry && leg.geometry.length >= 2) return { points: leg.geometry, geometrySource: 'motis' };
  const from = leg.boardStopId ? stopCoordinates.get(leg.boardStopId) : undefined;
  const to = leg.alightStopId ? stopCoordinates.get(leg.alightStopId) : undefined;
  if (from && to) return { points: [from, to], geometrySource: 'stop-coordinates', qualityMessage: '실제 도로 geometry가 없어 정류장 좌표 연결선으로 표시합니다.' };
  return { points: [], geometrySource: 'none', qualityMessage: '이 구간의 좌표를 확인할 수 없어 지도에 선을 표시하지 못했습니다.' };
}

export function buildRouteSearchMapModel(input: BuildRouteSearchMapModelInput): RouteSearchMapModel {
  const originPoint = endpointPoint(input.origin, input.stopCoordinates);
  const destinationPoint = endpointPoint(input.destination, input.stopCoordinates);
  const endpoints: RouteSearchMapEndpoint[] = [
    ...(originPoint ? [{ ...originPoint, role: 'origin' as const, label: endpointLabel(input.origin, 'origin') }] : []),
    ...(destinationPoint ? [{ ...destinationPoint, role: 'destination' as const, label: endpointLabel(input.destination, 'destination') }] : [])
  ];
  const routes = input.journeys.filter((journey) => journey.found).map((journey, index) => ({
    id: `route-${index + 1}`,
    totalSeconds: journey.totalSeconds,
    transferCount: journey.transferCount,
    legs: journey.legs.map((leg) => ({ mode: leg.mode, routeId: leg.routeId, ...legPoints(leg, input.stopCoordinates) })),
    warnings: journey.warnings
  }));
  const selectedRouteId = input.selectedRouteId && routes.some((route) => route.id === input.selectedRouteId)
    ? input.selectedRouteId
    : routes[0]?.id;
  const boundsPoints = [...endpoints, ...routes.flatMap((route) => route.legs.flatMap((leg) => leg.points))];
  return { endpoints, routes, selectedRouteId, boundsPoints };
}
