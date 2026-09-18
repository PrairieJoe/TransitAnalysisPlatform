import type { RouteServiceConfig, RouteStopMasterRecord } from '../../shared/types';
import { buildRoutePathIndex } from '../route-master';
import { adaptRouteMasterToSynthetic } from './source-adapter';
import { synthesizeSchedule } from './schedule-synthesizer';
import { estimateSegmentTravelTimes } from './travel-time-estimator';
import { compileSyntheticGtfs } from './gtfs-compiler';
import type { ScheduleSynthesisResult, SegmentTravelInput, SyntheticGtfsBuildResult, SyntheticRoadClass, SyntheticSourceAdapterOptions, TravelTimeParameters } from './types';

export interface SyntheticGtfsDraftOptions {
  agencyId: string;
  agencyName: string;
  routeId: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  vehicleCount: number;
  headwayMinutes: number;
  startDate: string;
  endDate: string;
  sourceName: string;
  deriveReverseDirection: boolean;
  dwellSeconds: number;
  travelTimeParameters: TravelTimeParameters;
}

export const DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS: TravelTimeParameters = {
  modelVersion: 'baseline-stop-distance-1',
  speedsKph: {
    residential: 15,
    tertiary: 20,
    secondary: 25,
    primary: 30,
    trunk: 45,
    motorway: 60,
    unknown: 15
  },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 30
};

function parseClockMinutes(value: string, label: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || !Number.isInteger(hours) || hours < 0 || hours > 47 || minutes < 0 || minutes > 59) {
    throw new Error(`${label} 시간이 유효하지 않습니다: ${value}`);
  }
  return hours * 60 + minutes;
}

export function deriveDepartureCount(firstDeparture: string, lastDeparture: string, headwayMinutes: number): number {
  if (!Number.isFinite(headwayMinutes) || headwayMinutes <= 0) throw new Error('배차간격은 0보다 커야 합니다.');
  if (!Number.isInteger(headwayMinutes)) throw new Error('배차간격은 1분 이상의 정수여야 합니다.');
  const first = parseClockMinutes(firstDeparture, '첫차');
  const last = parseClockMinutes(lastDeparture, '막차');
  if (first > last) throw new Error('첫차가 막차보다 늦습니다.');
  return Math.floor((last - first) / headwayMinutes) + 1;
}

function assertVehicleCount(vehicleCount: number): void {
  if (!Number.isInteger(vehicleCount) || vehicleCount <= 0) throw new Error('운행대수는 1 이상의 정수여야 합니다.');
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

function segmentInputs(directionStops: Array<{ stopId: string; latitude: number; longitude: number }>, dwellSeconds: number): SegmentTravelInput[] {
  return directionStops.slice(0, -1).map((from, index) => {
    const to = directionStops[index + 1];
    return {
      fromStopId: from.stopId,
      toStopId: to.stopId,
      distanceMeters: Math.max(1, haversineDistanceMeters(from, to)),
      roadClass: 'unknown' as SyntheticRoadClass,
      intersectionCount: 0,
      turnCount: 0,
      dwellSecondsAtFromStop: dwellSeconds
    };
  });
}

export function buildSyntheticGtfsDraft(routeStops: RouteStopMasterRecord[], serviceConfigs: RouteServiceConfig[], options: SyntheticGtfsDraftOptions): SyntheticGtfsBuildResult {
  assertVehicleCount(options.vehicleCount);
  const derivedDepartureCount = deriveDepartureCount(options.firstDeparture, options.lastDeparture, options.headwayMinutes);
  if (!routeStops.some((stop) => stop.routeId === options.routeId)) throw new Error('생성할 노선이 없습니다.');
  const selectedPaths = buildRoutePathIndex(routeStops).paths.filter((path) => path.routeId === options.routeId);
  if (!selectedPaths.length) throw new Error(`${options.routeId} 노선의 유효한 경로가 없습니다.`);
  const staticPath = selectedPaths.find((path) => !path.serviceDate);
  const selectedPath = staticPath ?? [...selectedPaths].sort((left, right) => (right.serviceDate ?? '').localeCompare(left.serviceDate ?? ''))[0];
  const routeAssumptions = selectedPaths.length > 1 && selectedPath.serviceDate
    ? [`동일 노선의 운행일자별 경로 ${selectedPaths.length}개 중 ${selectedPath.serviceDate} 경로를 대표 경로로 선택했습니다.`]
    : [];
  const selectedStops = selectedPath.stops;
  const adapterOptions: SyntheticSourceAdapterOptions = {
    agencyId: options.agencyId,
    agencyName: options.agencyName,
    serviceDays: options.serviceDays,
    firstDeparture: options.firstDeparture,
    lastDeparture: options.lastDeparture,
    departureCountByRoute: { [options.routeId]: derivedDepartureCount },
    headwayMinutes: options.headwayMinutes,
    vehicleCount: options.vehicleCount,
    sourceName: options.sourceName,
    deriveReverseDirection: options.deriveReverseDirection,
    routeAssumptions,
    serviceSourceType: 'USER_INPUT'
  };
  const routes = adaptRouteMasterToSynthetic(selectedStops, serviceConfigs, adapterOptions);
  const travelTimesByDirection: Record<string, ReturnType<typeof estimateSegmentTravelTimes>> = {};
  const scheduleByDirection: Record<string, ScheduleSynthesisResult> = {};
  for (const route of routes) for (const direction of route.directions) {
    travelTimesByDirection[direction.directionId] = estimateSegmentTravelTimes(segmentInputs(direction.stops, options.dwellSeconds), options.travelTimeParameters);
    const servicePlan = direction.servicePlans[0];
    scheduleByDirection[direction.directionId] = synthesizeSchedule(direction.directionId, servicePlan);
  }
  return compileSyntheticGtfs({
    agencyId: options.agencyId,
    agencyName: options.agencyName,
    routes,
    travelTimesByDirection,
    scheduleByDirection,
    startDate: options.startDate,
    endDate: options.endDate,
    shapeMode: 'missing'
  });
}
