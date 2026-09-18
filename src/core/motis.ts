export const SYNTHETIC_GTFS_FEED_ID = 'tap-synthetic-gtfs';

export function toMotisSyntheticStopId(stopId: string): string {
  const trimmed = stopId.trim();
  const prefix = `${SYNTHETIC_GTFS_FEED_ID}_`;
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

export function defaultMotisDepartureDateTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T08:00`;
}

export function buildMotisPlanPath(originStopId: string, destinationStopId: string, dateTime: string, secondsTime?: string): string {
  const date = dateTime.slice(0, 10);
  const time = secondsTime ?? `${dateTime.slice(11, 16)}:00`;
  const query = new URLSearchParams({
    fromPlace: toMotisSyntheticStopId(originStopId),
    toPlace: toMotisSyntheticStopId(destinationStopId),
    time: `${date}T${time}+09:00`,
    timetableView: 'false',
    detailedLegs: 'true',
    maxTransfers: '3'
  });
  return `/api/v6/plan?${query.toString()}`;
}
