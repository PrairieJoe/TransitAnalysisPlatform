import type { RouteServiceConfig, RouteStopMasterRecord } from '../../shared/types';

export type SyntheticSourceType = 'OFFICIAL' | 'USER_INPUT' | 'OSM_INFERRED' | 'MODEL_ESTIMATED' | 'DERIVED';
export type SyntheticConfidence = 'high' | 'medium' | 'low';
export type SyntheticServiceSourceType = 'OFFICIAL' | 'USER_INPUT' | 'INFERRED';

export interface SyntheticProvenance {
  sourceType: SyntheticSourceType;
  sourceName?: string;
  confidence: SyntheticConfidence;
  isInferred: boolean;
  modelVersion?: string;
  assumptions: string[];
}

export interface SyntheticStop {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  stopSequence: number;
  timepoint: boolean;
  provenance: SyntheticProvenance;
}

export interface SyntheticTimeBand {
  startTime: string;
  endTime: string;
  departureCount?: number;
  headwayMinutes?: number;
  weight?: number;
}

export interface SyntheticServicePlan {
  serviceId: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  departureCount?: number;
  headwayMinutes?: number;
  timeBands?: SyntheticTimeBand[];
  sourceType: SyntheticServiceSourceType;
  provenance: SyntheticProvenance;
}

export interface SyntheticDirection {
  directionId: string;
  directionLabel: string;
  stops: SyntheticStop[];
  servicePlans: SyntheticServicePlan[];
  provenance: SyntheticProvenance;
}

export interface SyntheticRoute {
  routeId: string;
  routeName: string;
  transportMode: 'BUS' | 'COACH';
  directions: SyntheticDirection[];
  provenance: SyntheticProvenance;
}

export interface SyntheticSourceAdapterOptions {
  agencyId: string;
  agencyName: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  departureCountByRoute: Record<string, number>;
  headwayMinutes?: number;
  vehicleCount?: number;
  sourceName: string;
  deriveReverseDirection: boolean;
  routeAssumptions?: string[];
  routeSourceType?: 'OFFICIAL' | 'USER_INPUT' | 'DERIVED';
  serviceSourceType?: SyntheticServiceSourceType;
}

export type SyntheticRoadClass = 'residential' | 'tertiary' | 'secondary' | 'primary' | 'trunk' | 'motorway' | 'unknown';

export interface SegmentTravelInput {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  roadClass: SyntheticRoadClass;
  intersectionCount: number;
  turnCount: number;
  dwellSecondsAtFromStop: number;
}

export interface TravelTimeParameters {
  modelVersion: string;
  speedsKph: Record<SyntheticRoadClass, number>;
  intersectionDelaySeconds: number;
  turnDelaySeconds: number;
  minimumSegmentSeconds: number;
}

export interface SegmentTravelEstimate {
  fromStopId: string;
  toStopId: string;
  travelSeconds: number;
  provenance: SyntheticProvenance;
}

export interface SynthesizedDeparture {
  serviceId: string;
  directionId: string;
  departureTime: string;
  sourceType: SyntheticServiceSourceType;
}

export interface ScheduleSynthesisResult {
  departures: SynthesizedDeparture[];
  warnings: string[];
}

export interface SyntheticGtfsBuildInput {
  agencyId: string;
  agencyName: string;
  routes: SyntheticRoute[];
  travelTimesByDirection: Record<string, SegmentTravelEstimate[]>;
  scheduleByDirection: Record<string, ScheduleSynthesisResult>;
  startDate: string;
  endDate: string;
  shapeMode: 'missing';
}

export interface GtfsFileSet {
  'agency.txt': string;
  'stops.txt': string;
  'routes.txt': string;
  'trips.txt': string;
  'stop_times.txt': string;
  'calendar.txt': string;
  'tap-motis-config.json': string;
  'tap-provenance.json': string;
  'tap-validation.json': string;
}

export interface ValidationReport {
  blockingErrors: string[];
  warnings: string[];
  isValid: boolean;
}

export interface SyntheticGtfsBuildResult {
  files: GtfsFileSet;
  validation: ValidationReport;
  summary: {
    routeCount: number;
    stopCount: number;
    tripCount: number;
    estimatedFieldCount: number;
  };
}

export type SyntheticSourceRecords = {
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
};
