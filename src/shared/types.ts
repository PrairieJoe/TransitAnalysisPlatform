export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DenominatorMode = 'observed' | 'calendar';
export type AnalysisMode = 'weekday' | 'hourly' | 'station' | 'od';
export type DisplayUnit = 'raw' | 'thousand';
export type HourIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23;

export interface DisplayUnitConfig {
  weekday: DisplayUnit;
  hourly: DisplayUnit;
  station: DisplayUnit;
  od: DisplayUnit;
}

export const DEFAULT_DISPLAY_UNITS: DisplayUnitConfig = {
  weekday: 'raw',
  hourly: 'raw',
  station: 'raw',
  od: 'raw'
};

export const WEEKDAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const;
export const HOURS = Array.from({ length: 24 }, (_value, hour) => hour) as HourIndex[];

export type Dimension = 'route' | 'station' | 'region';

export interface NormalizedRecord {
  serviceDate: string;
  boardingCount: number;
  boardingTime?: string;
  boardingHour?: HourIndex;
  stationId?: string;
  destinationStationId?: string;
  route?: string;
  station?: string;
  region?: string;
  sourceFile?: string;
  sourceRow?: number;
}

export interface ColumnMapping {
  dateColumn: string;
  timeColumn?: string;
  boardingCountColumn?: string;
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

export interface ProjectManifest {
  schemaVersion: 1 | 2 | 3 | 4;
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
  analysisConfig?: AnalysisConfig;
  analysisMode?: AnalysisMode;
  displayUnits?: DisplayUnitConfig;
  lastResult?: AnalysisResult;
  lastHourlyResult?: HourlyAnalysisResult;
  lastStationResult?: StationDemandResult;
  lastODResult?: ODDemandResult;
}

export interface FilePreview {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  options: ParseOptions;
  encoding: ParseOptions['encoding'];
  delimiter: ParseOptions['delimiter'];
}
