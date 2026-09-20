import type { MaterializedScenarioRoute } from '../scenario-execution';
import { deriveDepartureCount } from './draft-builder';
import { adaptRouteMasterToSynthetic } from './source-adapter';
import { synthesizeSchedule } from './schedule-synthesizer';
import { estimateSegmentTravelTimes } from './travel-time-estimator';
import { compileSyntheticGtfs } from './gtfs-compiler';
import type { ScheduleSynthesisResult, SegmentTravelInput, SyntheticGtfsBuildResult, SyntheticRoadClass, SyntheticRoute, SyntheticSourceAdapterOptions } from './types';

export interface ScenarioSyntheticNetworkInput {
  routes: MaterializedScenarioRoute[];
  agencyId: string;
  agencyName: string;
  sourceName: string;
}

function haversineDistanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const radius = 6371000;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const fromLatitude = from.latitude * Math.PI / 180;
  const toLatitude = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function segmentInputs(stops: MaterializedScenarioRoute['stopRecords'], dwellSeconds: number): SegmentTravelInput[] {
  return stops.slice(0, -1).map((from, index) => {
    const to = stops[index + 1];
    return {
      fromStopId: from.stationId,
      toStopId: to.stationId,
      distanceMeters: Math.max(1, haversineDistanceMeters(from, to)),
      roadClass: 'unknown' as SyntheticRoadClass,
      intersectionCount: 0,
      turnCount: 0,
      dwellSecondsAtFromStop: dwellSeconds
    };
  });
}

function formatGtfsDate(value: string): string {
  const compact = value.replaceAll('-', '');
  return /^\d{8}$/.test(compact) ? compact : '19700101';
}

function routeStopsForSynthetic(route: MaterializedScenarioRoute) {
  return route.stopRecords.map((stop, index) => ({ ...stop, stationSequence: index + 1 }));
}

function sourceOptions(route: MaterializedScenarioRoute, input: ScenarioSyntheticNetworkInput): SyntheticSourceAdapterOptions {
  return {
    agencyId: input.agencyId,
    agencyName: input.agencyName,
    serviceDays: [...route.operation.serviceDays],
    firstDeparture: route.operation.firstDeparture,
    lastDeparture: route.operation.lastDeparture,
    departureCountByRoute: { [route.routeId]: deriveDepartureCount(route.operation.firstDeparture, route.operation.lastDeparture, route.operation.headwayMinutes) },
    headwayMinutes: route.operation.headwayMinutes,
    vehicleCount: route.operation.vehicleCount,
    sourceName: input.sourceName,
    deriveReverseDirection: route.operation.deriveReverseDirection,
    routeAssumptions: [...route.warnings, 'Scenario execution은 정류장별 실제 시간표가 아닌 operation plan에서 Synthetic GTFS를 생성했습니다.'],
    routeSourceType: route.source === 'current' ? 'DERIVED' : 'USER_INPUT',
    serviceSourceType: route.source === 'current' ? 'INFERRED' : 'USER_INPUT'
  };
}

export function buildSyntheticGtfsNetwork(input: ScenarioSyntheticNetworkInput): SyntheticGtfsBuildResult {
  if (!input.routes.length) throw new Error('생성할 시나리오 노선이 없습니다.');
  const syntheticRoutes: SyntheticRoute[] = [];
  const travelTimesByDirection: Record<string, ReturnType<typeof estimateSegmentTravelTimes>> = {};
  const scheduleByDirection: Record<string, ScheduleSynthesisResult> = {};
  const startDates: string[] = [];
  const endDates: string[] = [];

  for (const route of input.routes) {
    if (route.stopRecords.length < 2) throw new Error(`${route.routeId} 노선의 정류장이 2개 미만입니다.`);
    if (route.operation.startDate) startDates.push(formatGtfsDate(route.operation.startDate));
    if (route.operation.endDate) endDates.push(formatGtfsDate(route.operation.endDate));
    const adapted = adaptRouteMasterToSynthetic(routeStopsForSynthetic(route), [], sourceOptions(route, input));
    syntheticRoutes.push(...adapted);
    for (const direction of adapted.flatMap((item) => item.directions)) {
      const orderedStops = direction.directionId.endsWith('-reverse') ? [...route.stopRecords].reverse() : route.stopRecords;
      travelTimesByDirection[direction.directionId] = estimateSegmentTravelTimes(segmentInputs(orderedStops, route.operation.dwellSeconds), route.operation.travelTimeModel);
      scheduleByDirection[direction.directionId] = synthesizeSchedule(direction.directionId, direction.servicePlans[0]);
    }
  }

  return compileSyntheticGtfs({
    agencyId: input.agencyId,
    agencyName: input.agencyName,
    routes: syntheticRoutes,
    travelTimesByDirection,
    scheduleByDirection,
    startDate: startDates.sort()[0] ?? '19700101',
    endDate: endDates.sort().at(-1) ?? '20991231',
    shapeMode: 'missing'
  });
}
