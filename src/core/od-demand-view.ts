import type { ODDemandViewRow } from '../shared/types';

const FLOW_COLOR = '#d83a3a';
const SELECTED_FLOW_COLOR = '#a90000';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface ODDemandFlowModel {
  key: string;
  originStationId: string;
  destinationStationId: string;
  points: Coordinate[];
  arrowhead: Coordinate[];
  color: string;
  width: number;
  opacity: number;
  dailyAverage: number;
}

export interface ODDemandMapModel {
  flows: ODDemandFlowModel[];
  endpoints: Array<Coordinate & { stationId: string; stationName: string; role: 'origin' | 'destination' }>;
}

export function odFlowKey(originStationId: string, destinationStationId: string): string {
  return `${originStationId}→${destinationStationId}`;
}

function quadratic(start: Coordinate, control: Coordinate, end: Coordinate, t: number): Coordinate {
  const inverse = 1 - t;
  return {
    latitude: inverse * inverse * start.latitude + 2 * inverse * t * control.latitude + t * t * end.latitude,
    longitude: inverse * inverse * start.longitude + 2 * inverse * t * control.longitude + t * t * end.longitude
  };
}

function controlPoint(start: Coordinate, end: Coordinate, side: number): Coordinate {
  const mid = { latitude: (start.latitude + end.latitude) / 2, longitude: (start.longitude + end.longitude) / 2 };
  const deltaLatitude = end.latitude - start.latitude;
  const deltaLongitude = end.longitude - start.longitude;
  const distance = Math.hypot(deltaLatitude, deltaLongitude);
  if (distance < 0.000001) {
    return { latitude: start.latitude + 0.0035 * side, longitude: start.longitude + 0.0035 * side };
  }
  const curveOffset = Math.max(distance * 0.16, 0.0015) * side;
  return {
    latitude: mid.latitude - (deltaLongitude / distance) * curveOffset,
    longitude: mid.longitude + (deltaLatitude / distance) * curveOffset
  };
}

function triangleAt(start: Coordinate, control: Coordinate, end: Coordinate): Coordinate[] {
  const tip = quadratic(start, control, end, 0.84);
  const before = quadratic(start, control, end, 0.79);
  const after = quadratic(start, control, end, 0.89);
  const tangentLatitude = after.latitude - before.latitude;
  const tangentLongitude = after.longitude - before.longitude;
  const length = Math.hypot(tangentLatitude, tangentLongitude) || 1;
  const unitLatitude = tangentLatitude / length;
  const unitLongitude = tangentLongitude / length;
  const size = Math.max(Math.hypot(end.latitude - start.latitude, end.longitude - start.longitude) * 0.035, 0.0012);
  const base = { latitude: tip.latitude - unitLatitude * size, longitude: tip.longitude - unitLongitude * size };
  const perpendicular = { latitude: -unitLongitude * size * 0.55, longitude: unitLatitude * size * 0.55 };
  return [
    tip,
    { latitude: base.latitude + perpendicular.latitude, longitude: base.longitude + perpendicular.longitude },
    { latitude: base.latitude - perpendicular.latitude, longitude: base.longitude - perpendicular.longitude }
  ];
}

function linePoints(start: Coordinate, control: Coordinate, end: Coordinate): Coordinate[] {
  return Array.from({ length: 25 }, (_value, index) => quadratic(start, control, end, index / 24));
}

export function buildODDemandMapModel(rows: ODDemandViewRow[], selectedFlowKey?: string): ODDemandMapModel {
  const mappableRows = rows.filter((row) => row.mapAvailable && row.originLatitude !== null && row.originLongitude !== null && row.destinationLatitude !== null && row.destinationLongitude !== null);
  if (!mappableRows.length) return { flows: [], endpoints: [] };
  const maxAverage = Math.max(...mappableRows.map((row) => row.dailyAverage), 0);
  const flows = mappableRows.map((row) => {
    const start = { latitude: row.originLatitude!, longitude: row.originLongitude! };
    const end = { latitude: row.destinationLatitude!, longitude: row.destinationLongitude! };
    const key = odFlowKey(row.originStationId, row.destinationStationId);
    // Reversing the direction already reverses the perpendicular vector. Using
    // the same directed-side value therefore places A→B and B→A on opposite
    // physical sides of their shared corridor.
    const side = 1;
    const control = controlPoint(start, end, side);
    const ratio = maxAverage > 0 ? Math.sqrt(row.dailyAverage / maxAverage) : 0;
    const selected = selectedFlowKey === key;
    return {
      key,
      originStationId: row.originStationId,
      destinationStationId: row.destinationStationId,
      points: linePoints(start, control, end),
      arrowhead: triangleAt(start, control, end),
      color: selected ? SELECTED_FLOW_COLOR : FLOW_COLOR,
      width: selected ? 5.5 : 1.5 + ratio * 4,
      opacity: selected ? 0.95 : 0.48,
      dailyAverage: row.dailyAverage
    };
  });

  const endpoints: ODDemandMapModel['endpoints'] = [];
  const seen = new Set<string>();
  for (const row of mappableRows) {
    const originKey = row.originStationId;
    if (!seen.has(originKey)) {
      endpoints.push({ stationId: row.originStationId, stationName: row.originStationName, latitude: row.originLatitude!, longitude: row.originLongitude!, role: 'origin' });
      seen.add(originKey);
    }
    const destinationKey = row.destinationStationId;
    if (!seen.has(destinationKey)) {
      endpoints.push({ stationId: row.destinationStationId, stationName: row.destinationStationName, latitude: row.destinationLatitude!, longitude: row.destinationLongitude!, role: 'destination' });
      seen.add(destinationKey);
    }
  }
  return { flows, endpoints };
}
