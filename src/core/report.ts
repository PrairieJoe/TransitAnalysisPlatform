import { HOURS, type AnalysisResult, type DisplayUnit, type HourlyAnalysisResult, type StationDemandViewRow } from '../shared/types';

export function formatThousands(value: number): string {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatPeople(value: number): string {
  return Math.round(value).toLocaleString('ko-KR');
}

export function buildSummary(result: AnalysisResult, metricLabel = '승차인원'): string {
  const unit = metricLabel === '통행량' ? '건' : '명';
  return `선택 기간 일평균 ${metricLabel} 약 ${formatPeople(result.overallAverage)}${unit}`;
}

export function buildTableRows(result: AnalysisResult, metricLabel = '이용인원', displayUnit: DisplayUnit = 'thousand'): Array<{ label: string; values: string[] }> {
  const isTraffic = metricLabel === '통행량';
  const useThousands = !isTraffic && displayUnit === 'thousand';
  const unit = isTraffic ? '건/일' : useThousands ? '천 명/일' : '명/일';
  return [
    { label: `${metricLabel}(${unit})`, values: result.metrics.map((metric) => formatThousands(useThousands ? metric.average / 1000 : metric.average)) },
    { label: '요일별 비율', values: result.metrics.map((metric) => metric.percent === null ? '—' : `${metric.percent.toFixed(1)}%`) }
  ];
}

export function buildHourlyTableRows(result: HourlyAnalysisResult, metricLabel = '승차인원', displayUnit: DisplayUnit = 'raw'): Array<{ label: string; values: string[] }> {
  const isTraffic = metricLabel === '통행량';
  const useThousands = !isTraffic && displayUnit === 'thousand';
  const unit = isTraffic ? '건/일' : useThousands ? '천 명/일' : '명/일';
  const formatMetric = (value: number): string => formatThousands(useThousands ? value / 1000 : value);
  return [
    { label: `주중기준 ${metricLabel}(${unit})`, values: result.metrics.map((metric) => formatMetric(metric.weekdayAverage)) },
    { label: '주중기준 요일별 비율', values: result.metrics.map((metric) => metric.weekdayPercent === null ? '—' : `${metric.weekdayPercent.toFixed(1)}%`) },
    { label: `주말기준 ${metricLabel}(${unit})`, values: result.metrics.map((metric) => formatMetric(metric.weekendAverage)) },
    { label: '주말기준 요일별 비율', values: result.metrics.map((metric) => metric.weekendPercent === null ? '—' : `${metric.weekendPercent.toFixed(1)}%`) }
  ];
}

export function buildHourlySheetRows(result: HourlyAnalysisResult, metricLabel = '승차인원', displayUnit: DisplayUnit = 'raw'): string[][] {
  return [
    ['구분', ...HOURS.map((hour) => `${hour}시`)],
    ...buildHourlyTableRows(result, metricLabel, displayUnit).map((row) => [row.label, ...row.values])
  ];
}

export function formatStationDemand(value: number, displayUnit: DisplayUnit = 'raw'): string {
  return displayUnit === 'thousand' ? formatThousands(value / 1000) : Math.round(value).toLocaleString('ko-KR');
}

export function buildStationDemandSheetRows(rows: StationDemandViewRow[], metricLabel = '승차인원', displayUnit: DisplayUnit = 'raw'): string[][] {
  const useThousands = metricLabel !== '통행량' && displayUnit === 'thousand';
  const unit = metricLabel === '통행량' ? '통행량(건/일)' : useThousands ? '승차인원(천 명/일)' : '승차인원(인/일)';
  return [
    ['순위', '정류장 ID', '정류장명', unit],
    ...rows.map((row) => [String(row.rank), row.stationId, row.stationName, formatStationDemand(row.dailyAverage, useThousands ? 'thousand' : 'raw')])
  ];
}
