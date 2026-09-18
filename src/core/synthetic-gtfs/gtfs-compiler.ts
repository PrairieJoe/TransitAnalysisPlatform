import { validateSyntheticGtfs } from './validator';
import type { GtfsFileSet, ScheduleSynthesisResult, SegmentTravelEstimate, SyntheticDirection, SyntheticGtfsBuildInput, SyntheticGtfsBuildResult, SyntheticRoute, SyntheticStop, ValidationReport } from './types';

const CRLF = '\r\n';

function csvValue(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Array<string | number>>): string {
  return [headers, ...rows].map((row) => row.map(csvValue).join(',')).join(CRLF) + CRLF;
}

function clockSeconds(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`GTFS 시간이 유효하지 않습니다: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function gtfsTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function serviceCalendarRows(routes: SyntheticRoute[], startDate: string, endDate: string): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];
  const seen = new Set<string>();
  for (const route of routes) for (const direction of route.directions) for (const plan of direction.servicePlans) {
    if (seen.has(plan.serviceId)) continue;
    seen.add(plan.serviceId);
    rows.push([
      plan.serviceId,
      Number(plan.serviceDays.includes(0)),
      Number(plan.serviceDays.includes(1)),
      Number(plan.serviceDays.includes(2)),
      Number(plan.serviceDays.includes(3)),
      Number(plan.serviceDays.includes(4)),
      Number(plan.serviceDays.includes(5)),
      Number(plan.serviceDays.includes(6)),
      startDate,
      endDate
    ]);
  }
  return rows;
}

function uniqueStops(routes: SyntheticRoute[]): SyntheticStop[] {
  const stops = new Map<string, SyntheticStop>();
  for (const route of routes) for (const direction of route.directions) for (const stop of direction.stops) {
    if (!stops.has(stop.stopId)) stops.set(stop.stopId, stop);
  }
  return [...stops.values()].sort((left, right) => left.stopId.localeCompare(right.stopId, 'en'));
}

function directionEntries(routes: SyntheticRoute[]): Array<{ route: SyntheticRoute; direction: SyntheticDirection; directionIndex: number; schedule: ScheduleSynthesisResult; segments: SegmentTravelEstimate[] }> {
  return routes.flatMap((route) => route.directions.map((direction, directionIndex) => ({
    route,
    direction,
    directionIndex,
    schedule: undefined as unknown as ScheduleSynthesisResult,
    segments: [] as SegmentTravelEstimate[]
  })));
}

function estimateCount(input: SyntheticGtfsBuildInput): number {
  let count = 0;
  for (const route of input.routes) {
    count += Number(route.provenance.isInferred);
    for (const direction of route.directions) {
      count += Number(direction.provenance.isInferred);
      count += direction.stops.filter((stop) => stop.provenance.isInferred).length;
      count += direction.servicePlans.filter((plan) => plan.provenance.isInferred).length;
    }
  }
  count += Object.values(input.travelTimesByDirection).flat().filter((segment) => segment.provenance.isInferred).length;
  return count;
}

function buildFiles(input: SyntheticGtfsBuildInput, validation: ValidationReport): { files: GtfsFileSet; summary: SyntheticGtfsBuildResult['summary'] } {
  const entries = directionEntries(input.routes).map((entry) => ({
    ...entry,
    schedule: input.scheduleByDirection[entry.direction.directionId],
    segments: input.travelTimesByDirection[entry.direction.directionId] ?? []
  }));
  const stops = uniqueStops(input.routes);
  const tripRows: Array<Array<string | number>> = [];
  const stopTimeRows: Array<Array<string | number>> = [];
  let tripCount = 0;
  for (const entry of entries) {
    entry.schedule.departures.forEach((departure, departureIndex) => {
      tripCount += 1;
      const tripId = `${entry.route.routeId}-${entry.direction.directionId}-${departureIndex + 1}`;
      tripRows.push([entry.route.routeId, departure.serviceId, tripId, entry.directionIndex]);
      let currentSeconds = clockSeconds(departure.departureTime);
      entry.direction.stops.forEach((stop, stopIndex) => {
        if (stopIndex > 0) currentSeconds += entry.segments[stopIndex - 1].travelSeconds;
        const time = gtfsTime(currentSeconds);
        stopTimeRows.push([tripId, time, time, stop.stopId, stop.stopSequence, Number(stop.timepoint)]);
      });
    });
  }
  const routeRows = input.routes.map((route) => [route.routeId, input.agencyId, route.routeId, route.routeName, 3]);
  const provenance = {
    datasetType: 'SYNTHETIC',
    generatedBy: 'Transit Analysis Platform',
    routeCount: input.routes.length,
    routes: input.routes.map((route) => ({ routeId: route.routeId, provenance: route.provenance, directions: route.directions.map((direction) => ({ directionId: direction.directionId, provenance: direction.provenance })) }))
  };
  const files: GtfsFileSet = {
    'agency.txt': csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], [[input.agencyId, input.agencyName, 'https://example.invalid', 'Asia/Seoul']]),
    'stops.txt': csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], stops.map((stop) => [stop.stopId, stop.stopName, stop.latitude, stop.longitude])),
    'routes.txt': csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], routeRows),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'direction_id'], tripRows),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint'], stopTimeRows),
    'calendar.txt': csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], serviceCalendarRows(input.routes, input.startDate, input.endDate)),
    'tap-motis-config.json': JSON.stringify({ street_routing: true, timetable: { with_shapes: true, route_shapes: { mode: 'missing' } } }, null, 2),
    'tap-provenance.json': JSON.stringify(provenance, null, 2),
    'tap-validation.json': JSON.stringify(validation, null, 2)
  };
  return { files, summary: { routeCount: input.routes.length, stopCount: stops.length, tripCount, estimatedFieldCount: estimateCount(input) } };
}

export function compileSyntheticGtfs(input: SyntheticGtfsBuildInput): SyntheticGtfsBuildResult {
  const validation = validateSyntheticGtfs(input);
  if (!validation.isValid) throw new Error(`Synthetic GTFS 검증에 실패했습니다. ${validation.blockingErrors.join(' ')}`);
  const { files, summary } = buildFiles(input, validation);
  return { files, validation, summary };
}
