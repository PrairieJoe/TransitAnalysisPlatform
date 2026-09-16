export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const CURRENT_PROJECT_SCHEMA_VERSION = 9 as const;
export type ProjectSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | typeof CURRENT_PROJECT_SCHEMA_VERSION;
export type DenominatorMode = 'observed' | 'calendar';
export type AnalysisMode = 'weekday' | 'hourly' | 'station' | 'od' | 'route' | 'quality';
export const DATA_QUALITY_ERROR = {
  boardingMissing: '승차누락',
  alightingMissing: '하차누락',
  boardingUnmatched: '승차매칭불가',
  alightingUnmatched: '하차매칭불가',
  routeMissing: '노선누락',
  routeUnmatched: '노선매칭불가',
  routeStopUnmatched: '노선경유정류장매칭오류',
  stopSequenceInvalid: '경유정류장순번오류'
} as const;
export type DataQualityErrorType = typeof DATA_QUALITY_ERROR[keyof typeof DATA_QUALITY_ERROR];
export type DisplayUnit = 'raw' | 'thousand';
export type HourIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23;
export type RouteTimeSelection = 'all' | HourIndex;

export interface DisplayUnitConfig {
  weekday: DisplayUnit;
  hourly: DisplayUnit;
  station: DisplayUnit;
  od: DisplayUnit;
  route: DisplayUnit;
}

export const DEFAULT_DISPLAY_UNITS: DisplayUnitConfig = {
  weekday: 'raw',
  hourly: 'raw',
  station: 'raw',
  od: 'raw',
  route: 'raw'
};

export const WEEKDAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const;
export const HOURS = Array.from({ length: 24 }, (_value, hour) => hour) as HourIndex[];

export type Dimension = 'route' | 'station' | 'region';

export interface NormalizedRecord {
  serviceDate: string;
  boardingCount: number;
  boardingTime?: string;
  boardingHour?: HourIndex;
  virtualCardId?: string;
  transactionId?: string;
  transferCount?: number;
  vehicleId?: string;
  stationId?: string;
  destinationStationId?: string;
  route?: string;
  station?: string;
  region?: string;
  qualityErrors?: DataQualityErrorType[];
  sourceFile?: string;
  sourceRow?: number;
}

export interface ColumnMapping {
  dateColumn: string;
  timeColumn?: string;
  boardingCountColumn?: string;
  virtualCardIdColumn?: string;
  transactionIdColumn?: string;
  transferCountColumn?: string;
  vehicleIdColumn?: string;
  rowSemantics: 'count-column' | 'one-row-one-boarding';
  stationIdColumn?: string;
  destinationStationIdColumn?: string;
  routeColumn?: string;
  stationColumn?: string;
  regionColumn?: string;
}

export interface StationMasterMapping {
  stationIdColumn: string;
  stationNameColumn: string;
  latitudeColumn: string;
  longitudeColumn: string;
}

export interface RouteStopMasterMapping {
  serviceDateColumn?: string;
  settlementCompanyIdColumn?: string;
  settlementRegionCodeColumn?: string;
  routeIdColumn: string;
  routeNameColumn: string;
  transportModeColumn: string;
  stationSequenceColumn: string;
  stationIdColumn: string;
  stationNameColumn: string;
  latitudeColumn: string;
  longitudeColumn: string;
  arsNumberColumn?: string;
  cumulativeDistanceColumn?: string;
  stationDistanceColumn?: string;
}

export interface ParseOptions {
  encoding: 'utf-8' | 'euc-kr';
  delimiter: ',' | '\t' | ';' | '|';
  headerRow: number;
  sheetName?: string;
}

export interface FilterConfig {
  from: string;
  to: string;
  route?: string;
  station?: string;
  region?: string;
}

export interface AnalysisConfig {
  filter: FilterConfig;
  denominator: DenominatorMode;
}

export interface WeekdayMetric {
  weekday: WeekdayIndex;
  label: string;
  average: number;
  displayAverage: number;
  percent: number | null;
  observedDays: number;
}

export interface AnalysisResult {
  metrics: WeekdayMetric[];
  weekdayAverage: number;
  weekendAverage: number;
  overallAverage: number;
  totalBoardings: number;
  selectedDays: number;
  excludedRows: number;
  warnings: string[];
  config: AnalysisConfig;
}

export interface HourlyMetric {
  hour: HourIndex;
  label: string;
  weekdayAverage: number;
  weekendAverage: number;
  weekdayDisplayAverage: number;
  weekendDisplayAverage: number;
  weekdayPercent: number | null;
  weekendPercent: number | null;
}

export interface HourlyAnalysisResult {
  metrics: HourlyMetric[];
  weekdayDays: number;
  weekendDays: number;
  totalBoardings: number;
  selectedDays: number;
  excludedRows: number;
  warnings: string[];
  config: AnalysisConfig;
}

export interface StationMasterRecord {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
}

export interface RouteStopMasterRecord {
  serviceDate?: string;
  settlementCompanyId?: string;
  settlementRegionCode?: string;
  routeId: string;
  routeName: string;
  transportMode: string;
  stationSequence: number;
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  arsNumber?: string;
  cumulativeDistance?: number;
  stationDistance?: number;
  sourceRow?: number;
}

export interface RouteServiceConfig {
  routeId: string;
  vehicleCapacity: number;
  tripsByHour: Record<string, number>;
}

export interface RouteDemandRow {
  serviceDate: string;
  routeId: string;
  originStationId: string;
  destinationStationId: string;
  hour?: HourIndex;
  vehicleId?: string;
  total: number;
  /** Number of source transaction rows represented by this pre-aggregated row. */
  rowCount?: number;
}

export type RouteDirection = 'forward' | 'reverse';
export type RouteLoadBasis = 'vehicle' | 'estimated-average' | 'mixed';

export interface RouteCongestionConfig {
  filter: FilterConfig;
  denominator: DenominatorMode;
  hour: RouteTimeSelection;
}

export interface RouteSegmentMetric {
  routeId: string;
  routeName: string;
  transportMode: string;
  direction: RouteDirection;
  directionLabel: string;
  fromSequence: number;
  toSequence: number;
  fromStationId: string;
  toStationId: string;
  fromStationName: string;
  toStationName: string;
  fromLatitude: number;
  fromLongitude: number;
  toLatitude: number;
  toLongitude: number;
  segmentDistance?: number;
  previousOnboard: number;
  boardings: number;
  alightings: number;
  onboardPassengers: number;
  peakOnboardPassengers: number;
  averageOnboardPassengers: number;
  totalBoardings: number;
  totalAlightings: number;
  vehicleCapacity: number | null;
  dailyTrips: number | null;
  congestionPercent: number | null;
  rank: number;
}

export interface RouteSummaryMetric {
  routeId: string;
  routeName: string;
  transportMode: string;
  direction: RouteDirection;
  directionLabel: string;
  stationLabel: string;
  peakOnboardPassengers: number;
  averageOnboardPassengers: number;
  congestionPercent: number | null;
  hour: RouteTimeSelection;
}

export interface RouteStopLoadMetric {
  routeId: string;
  routeName: string;
  transportMode: string;
  direction: RouteDirection;
  directionLabel: string;
  stationSequence: number;
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  segmentDistance?: number;
  previousOnboard: number;
  boardings: number;
  alightings: number;
  onboardPassengers: number;
  peakOnboardPassengers: number;
  averageOnboardPassengers: number;
  totalBoardings: number;
  totalAlightings: number;
  vehicleCapacity: number | null;
  dailyTrips: number | null;
  congestionPercent: number | null;
  rank: number;
}

export interface RouteCongestionResult {
  metrics: RouteSegmentMetric[];
  stopMetrics: RouteStopLoadMetric[];
  summaries: RouteSummaryMetric[];
  selectedDays: number;
  totalBoardings: number;
  excludedRows: number;
  loadBasis: RouteLoadBasis;
  warnings: string[];
  config: RouteCongestionConfig;
}

export interface StationDemandMetric {
  stationId: string;
  totalBoardings: number;
  dailyAverage: number;
  rank: number;
}

export interface StationDemandResult {
  metrics: StationDemandMetric[];
  selectedDays: number;
  totalBoardings: number;
  excludedRows: number;
  unmatchedStationCount: number;
  warnings: string[];
  config: AnalysisConfig;
}

export interface StationDemandViewRow extends StationDemandMetric {
  stationName: string;
  latitude: number | null;
  longitude: number | null;
  mapAvailable: boolean;
}

export interface ODDemandMetric {
  originStationId: string;
  destinationStationId: string;
  totalBoardings: number;
  dailyAverage: number;
  rank: number;
}

export interface ODDemandResult {
  metrics: ODDemandMetric[];
  selectedDays: number;
  totalBoardings: number;
  excludedRows: number;
  unmatchedOriginCount: number;
  unmatchedDestinationCount: number;
  warnings: string[];
  config: AnalysisConfig;
}

export interface ODDemandViewRow extends ODDemandMetric {
  originStationName: string;
  destinationStationName: string;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  mapAvailable: boolean;
}

export interface DataQualityMetric {
  type: DataQualityErrorType;
  transactionCount: number;
  boardingCount: number;
}

export interface DataQualityAnalysisResult {
  metrics: DataQualityMetric[];
  totalTransactions: number;
  totalBoardings: number;
  uniqueErrorTransactions: number;
  uniqueErrorBoardings: number;
  warnings: string[];
  config: AnalysisConfig;
}

export interface ProjectManifest {
  schemaVersion: ProjectSchemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceFiles: string[];
  records: NormalizedRecord[];
  mapping: ColumnMapping;
  parseOptions: ParseOptions;
  stationMaster?: StationMasterRecord[];
  stationMasterSource?: string;
  stationMasterMapping?: StationMasterMapping;
  stationMasterWarnings?: string[];
  routeStopMaster?: RouteStopMasterRecord[];
  routeStopMasterSource?: string;
  routeStopMasterMapping?: RouteStopMasterMapping;
  routeStopMasterWarnings?: string[];
  routeServiceConfigs?: RouteServiceConfig[];
  analysisConfig?: AnalysisConfig;
  routeAnalysisConfig?: RouteCongestionConfig;
  analysisMode?: AnalysisMode;
  displayUnits?: DisplayUnitConfig;
  lastResult?: AnalysisResult;
  lastHourlyResult?: HourlyAnalysisResult;
  lastStationResult?: StationDemandResult;
  lastODResult?: ODDemandResult;
  lastRouteResult?: RouteCongestionResult;
  lastQualityResult?: DataQualityAnalysisResult;
  qualityWarnings?: string[];
}

export interface FilePreview {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  options: ParseOptions;
  encoding: ParseOptions['encoding'];
  delimiter: ParseOptions['delimiter'];
}
