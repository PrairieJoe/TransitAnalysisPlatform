import type { AnalysisResult } from '../shared/types';

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

export function buildTableRows(result: AnalysisResult, metricLabel = '이용인원'): Array<{ label: string; values: string[] }> {
  const isTraffic = metricLabel === '통행량';
  const unit = isTraffic ? '건/일' : '천 명/일';
  return [
    { label: `${metricLabel}(${unit})`, values: result.metrics.map((metric) => formatThousands(isTraffic ? metric.average : metric.average / 1000)) },
    { label: '요일별 비율', values: result.metrics.map((metric) => metric.percent === null ? '—' : `${metric.percent.toFixed(1)}%`) }
  ];
}
