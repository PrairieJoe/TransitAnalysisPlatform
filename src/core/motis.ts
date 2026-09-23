import type { ScenarioJourneyEndpoint } from '../shared/types';

export const SYNTHETIC_GTFS_FEED_ID = 'tap-synthetic-gtfs';

export interface MotisPlanOptions {
  maxTransfers: number;
  pedestrianProfile: 'FOOT';
  maxPreTransitTimeSeconds: number;
  maxPostTransitTimeSeconds: number;
  maxMatchingDistanceMeters: number;
}

export const DEFAULT_MOTIS_PLAN_OPTIONS: MotisPlanOptions = {
  maxTransfers: 3,
  pedestrianProfile: 'FOOT',
  maxPreTransitTimeSeconds: 900,
  maxPostTransitTimeSeconds: 900,
  maxMatchingDistanceMeters: 250
};

export function toMotisSyntheticStopId(stopId: string): string {
  const trimmed = stopId.trim();
  const prefix = `${SYNTHETIC_GTFS_FEED_ID}_`;
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

function coordinateValue(value: unknown, axis: 'latitude' | 'longitude'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${axis === 'latitude' ? '위도' : '경도'}는 유한한 숫자여야 합니다.`);
  const valid = axis === 'latitude' ? value >= -90 && value <= 90 : value >= -180 && value <= 180;
  if (!valid) throw new Error(`${axis === 'latitude' ? '위도' : '경도'}가 허용 범위를 벗어났습니다.`);
  return value;
}

export function toMotisPlace(endpoint: ScenarioJourneyEndpoint | string): string {
  if (typeof endpoint === 'string') return toMotisSyntheticStopId(endpoint);
  if (endpoint.kind === 'stop') return toMotisSyntheticStopId(endpoint.stopId);
  const latitude = coordinateValue(endpoint.latitude, 'latitude');
  const longitude = coordinateValue(endpoint.longitude, 'longitude');
  return `${latitude},${longitude}`;
}

export function defaultMotisDepartureDateTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function parseMotisDepartureDateTime(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 9, Number(minute));
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isValidMotisDepartureDateTime(value: string): boolean {
  const parsed = parseMotisDepartureDateTime(value);
  return Boolean(parsed && defaultMotisDepartureDateTime(parsed) === value);
}

export function addMotisDepartureMinutes(value: string, minutes: number, now = new Date()): string {
  const base = parseMotisDepartureDateTime(value) ?? now;
  return defaultMotisDepartureDateTime(new Date(base.getTime() + minutes * 60_000));
}

export function buildMotisPlanPath(
  origin: ScenarioJourneyEndpoint | string,
  destination: ScenarioJourneyEndpoint | string,
  dateTime: string,
  secondsTimeOrOptions?: string | MotisPlanOptions
): string {
  const date = dateTime.slice(0, 10);
  const secondsTime = typeof secondsTimeOrOptions === 'string' ? secondsTimeOrOptions : undefined;
  const options = typeof secondsTimeOrOptions === 'object' ? secondsTimeOrOptions : DEFAULT_MOTIS_PLAN_OPTIONS;
  const time = secondsTime ?? `${dateTime.slice(11, 16)}:00`;
  const query = new URLSearchParams({
    fromPlace: toMotisPlace(origin),
    toPlace: toMotisPlace(destination),
    time: `${date}T${time}+09:00`,
    timetableView: 'false',
    detailedLegs: 'true',
    maxTransfers: String(options.maxTransfers),
    pedestrianProfile: options.pedestrianProfile,
    maxPreTransitTime: String(options.maxPreTransitTimeSeconds),
    maxPostTransitTime: String(options.maxPostTransitTimeSeconds),
    maxMatchingDistance: String(options.maxMatchingDistanceMeters)
  });
  return `/api/v6/plan?${query.toString()}`;
}
