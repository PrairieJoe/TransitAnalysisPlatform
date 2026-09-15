import type { DisplayUnit, StationDemandViewRow } from '../shared/types';

const BAND_COLORS = ['#ffd9a3', '#ffae72', '#f47c59', '#e64b3c', '#bd1117'];

export interface StationDemandBand {
  color: string;
  min: number;
  max: number;
  label: string;
}

export interface StationDemandMapMarker {
  stationId: string;
  latitude: number;
  longitude: number;
  color: string;
  radius: number;
}

export interface StationDemandMapModel {
  bands: StationDemandBand[];
  markers: StationDemandMapMarker[];
}

function formatValue(value: number, displayUnit: DisplayUnit): string {
  return displayUnit === 'thousand'
    ? (value / 1000).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(value).toLocaleString('ko-KR');
}

function quantile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export function buildStationDemandMapModel(rows: StationDemandViewRow[], displayUnit: DisplayUnit = 'raw'): StationDemandMapModel {
  const mappableRows = rows.filter((row) => row.mapAvailable && row.latitude !== null && row.longitude !== null);
  if (!mappableRows.length) return { bands: [], markers: [] };

  const values = mappableRows.map((row) => row.dailyAverage).sort((a, b) => a - b);
  const bounds = [values[0], quantile(values, 0.2), quantile(values, 0.4), quantile(values, 0.6), quantile(values, 0.8), values[values.length - 1]];
  const bands: StationDemandBand[] = [];
  bounds.slice(0, -1).forEach((min, index) => {
    const max = bounds[index + 1];
    if (bands.length && bands[bands.length - 1].max === max && bands[bands.length - 1].min === min) return;
    if (max < min) return;
    bands.push({ color: BAND_COLORS[Math.min(index, BAND_COLORS.length - 1)], min, max, label: min === max ? `${formatValue(min, displayUnit)}` : `${formatValue(min, displayUnit)}–${formatValue(max, displayUnit)}` });
  });
  if (!bands.length) bands.push({ color: BAND_COLORS[0], min: values[0], max: values[values.length - 1], label: `${formatValue(values[0], displayUnit)}–${formatValue(values[values.length - 1], displayUnit)}` });

  const minValue = values[0];
  const maxValue = values[values.length - 1];
  const markers = mappableRows.map((row) => {
    const band = bands.find((candidate) => row.dailyAverage <= candidate.max) ?? bands[bands.length - 1];
    const ratio = maxValue === minValue ? 0.5 : Math.sqrt((row.dailyAverage - minValue) / (maxValue - minValue));
    return { stationId: row.stationId, latitude: row.latitude!, longitude: row.longitude!, color: band.color, radius: 6 + ratio * 14 };
  });
  return { bands, markers };
}
