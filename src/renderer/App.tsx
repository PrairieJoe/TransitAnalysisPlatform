import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import * as echarts from 'echarts';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { analyzeHourlyRecords, analyzeODRecords, analyzeRecords, analyzeStationRecords, uniqueValues } from '../core/analysis';
import { exactDuplicateIndexes, hasSensitiveHeaders, normalizeRows, parseFileRows, previewFile, suggestTransactionMapping } from '../core/parser';
import { analyzeRouteRecords } from '../core/route-analysis';
import { analyzeDataQuality, classifyDataQuality, hasCurrentDataQualityClassification, legacyDataQualityWarnings } from '../core/data-quality';
import { applyTripsToAllRoutes } from '../core/route-service';
import { EMPTY_ROUTE_STOP_MASTER_MAPPING, buildRoutePathIndex, normalizeRouteStopMasterRows, routeOptions, suggestRouteStopMasterMapping } from '../core/route-master';
import { EMPTY_STATION_MASTER_MAPPING, ROUTE_STOP_STATION_FALLBACK_SOURCE, joinODDemandMetrics, joinStationDemandMetrics, mergeStationMasterRecords, normalizeStationMasterRows, suggestStationMasterMapping, usesRouteStopStationFallback } from '../core/station-master';
import { ANALYSIS_DATA_USAGE, buildDataQualitySheetRows, buildHourlySheetRows, buildHourlyTableRows, buildODDemandSheetRows, buildRouteCongestionSheetRows, buildStationDemandSheetRows, buildSummary, buildTableRows, formatPeople, formatStationDemand } from '../core/report';
import { CURRENT_PROJECT_SCHEMA_VERSION, DEFAULT_DISPLAY_UNITS, HOURS, type AnalysisConfig, type AnalysisMode, type ColumnMapping, type DataQualityAnalysisResult, type DisplayUnit, type DisplayUnitConfig, type FilePreview, type HourIndex, type HourlyAnalysisResult, type NormalizedRecord, type ODDemandResult, type ProjectManifest, type RouteCongestionConfig, type RouteCongestionResult, type RouteDirection, type RouteServiceConfig, type RouteStopMasterMapping, type RouteStopMasterRecord, type RouteSummaryMetric, type StationDemandResult, type StationDemandViewRow, type StationMasterMapping, type StationMasterRecord, WEEKDAYS } from '../shared/types';
import StationDemandMap from './StationDemandMap';
import ODDemandMap from './ODDemandMap';
import ODDemandTable from './ODDemandTable';
import RouteCongestionMap from './RouteCongestionMap';
import RouteCongestionTable from './RouteCongestionTable';
import { deleteBrowserProject, listBrowserProjects, saveBrowserProject } from './browser-project-storage';

const DEFAULT_PROJECT_TITLE = '교통카드 요일별 분석';

function attachStationMasterInfo(result: StationDemandResult, stations: StationMasterRecord[]): StationDemandResult {
  const joined = joinStationDemandMetrics(result.metrics, stations);
  return {
    ...result,
    unmatchedStationCount: joined.unmatchedCount,
    warnings: [...new Set([...result.warnings, ...joined.warnings])]
  };
}

function attachODMasterInfo(result: ODDemandResult, stations: StationMasterRecord[]): ODDemandResult {
  const joined = joinODDemandMetrics(result.metrics, stations);
  return {
    ...result,
    unmatchedOriginCount: joined.unmatchedOriginCount,
    unmatchedDestinationCount: joined.unmatchedDestinationCount,
    warnings: [...new Set([...result.warnings, ...joined.warnings])]
  };
}

function stationRecordsFromRouteStops(stops: RouteStopMasterRecord[]): StationMasterRecord[] {
  const seen = new Set<string>();
  return stops.flatMap((stop) => {
    if (seen.has(stop.stationId)) return [];
    seen.add(stop.stationId);
    return [{ stationId: stop.stationId, stationName: stop.stationName, latitude: stop.latitude, longitude: stop.longitude }];
  });
}

function id(): string { return crypto.randomUUID(); }

function qualityWarningsForProject(project: ProjectManifest): string[] {
  return [...new Set([
    ...(project.qualityWarnings ?? []),
    ...legacyDataQualityWarnings(project.schemaVersion, Boolean(project.mapping.stationIdColumn))
  ])];
}

function projectTitle(project: ProjectManifest): string {
  return project.name.trim().toLowerCase() === 'reference' ? DEFAULT_PROJECT_TITLE : project.name;
}

function aggregationLabel(project: ProjectManifest): string {
  return project.mapping.rowSemantics === 'one-row-one-boarding' ? '통행량' : '이용인원';
}

function normalizeDisplayUnits(value?: Partial<DisplayUnitConfig>): DisplayUnitConfig {
  const normalize = (candidate: DisplayUnit | undefined): DisplayUnit => candidate === 'thousand' ? 'thousand' : 'raw';
  return {
    weekday: normalize(value?.weekday ?? DEFAULT_DISPLAY_UNITS.weekday),
    hourly: normalize(value?.hourly ?? DEFAULT_DISPLAY_UNITS.hourly),
    station: normalize(value?.station ?? DEFAULT_DISPLAY_UNITS.station),
    od: normalize(value?.od ?? DEFAULT_DISPLAY_UNITS.od),
    route: normalize(value?.route ?? DEFAULT_DISPLAY_UNITS.route)
  };
}

function looksLikeHeaderlessTransactionPreview(preview: FilePreview): boolean {
  if (preview.headers.length < 20) return false;
  const rows = [
    preview.headers,
    ...preview.rows.slice(0, 3).map((row) => preview.headers.map((header) => String(row[header] ?? '')))
  ];
  return rows.some((values) => {
    const firstValue = values[0]?.trim() ?? '';
    const hasDateAtFirst = /^\d{8}(?:\d{6})?$/.test(firstValue) || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(firstValue);
    const hasTransactionTimestamp = values.slice(10, 17).some((value) => /^\d{14}$/.test(value.trim()));
    return hasDateAtFirst || hasTransactionTimestamp;
  });
}

function looksLikeStationMasterHeader(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  const values = Object.values(row).map((value) => String(value ?? '').trim().toLowerCase());
  return values.includes('station_id') && values.includes('station_name') && values.includes('latitude') && values.includes('longitude');
}

function looksLikeRouteStopMasterHeader(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  const values = Object.values(row).map((value) => String(value ?? '').trim().replace(/[\s_()\-]/g, '').toLowerCase());
  const hasRoute = values.some((value) => ['routeid', '노선id', '노선아이디'].includes(value));
  const hasSequence = values.some((value) => ['stationsequence', 'stopsequence', '정류장순번', '정류장순서'].includes(value));
  return hasRoute && hasSequence;
}

function Chart({ result, metricLabel, metricUnit, valueUnit, displayUnit }: { result: ReturnType<typeof analyzeRecords>; metricLabel: string; metricUnit: string; valueUnit: string; displayUnit: DisplayUnit }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const useThousands = metricLabel !== '통행량' && displayUnit === 'thousand';
    const displayValues = result.metrics.map((metric) => useThousands ? metric.displayAverage : metric.average);
    chart.setOption({
      animation: false,
      grid: { left: 60, right: 32, top: 70, bottom: 52 },
      xAxis: { type: 'category', data: WEEKDAYS, axisLine: { lineStyle: { color: '#adb5bd' } }, axisLabel: { color: '#344054' } },
      yAxis: { type: 'value', name: metricUnit, nameTextStyle: { color: '#667085' }, splitLine: { lineStyle: { color: '#e4e7ec' } }, axisLabel: { color: '#667085' } },
      series: [{ type: 'bar', data: displayValues, barWidth: '42%', itemStyle: { color: '#1261b5' }, label: { show: true, position: 'top', color: '#0057b8', fontSize: 16, formatter: ({ value }: { value: number }) => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) } }],
      graphic: [
        { type: 'text', left: 'center', top: 8, style: { text: `주중 평균 ${metricLabel} ${Math.round(result.weekdayAverage).toLocaleString('ko-KR')}${valueUnit}`, fill: '#9a4d1a', fontWeight: 700, fontSize: 16 } },
        { type: 'text', left: '72%', top: 8, style: { text: `주말 평균 ${metricLabel} ${Math.round(result.weekendAverage).toLocaleString('ko-KR')}${valueUnit}`, fill: '#8b7000', fontWeight: 700, fontSize: 16 } }
      ]
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [displayUnit, result, metricLabel, metricUnit, valueUnit]);
  return <div ref={ref} className="chart" aria-label={`요일별 평균 ${metricLabel} 막대그래프`} />;
}

function HourlyChart({ result, metricLabel, metricUnit, displayUnit }: { result: HourlyAnalysisResult; metricLabel: string; metricUnit: string; displayUnit: DisplayUnit }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const useThousands = metricLabel !== '통행량' && displayUnit === 'thousand';
    const weekdayValues = result.metrics.map((metric) => useThousands ? metric.weekdayDisplayAverage : metric.weekdayAverage);
    const weekendValues = result.metrics.map((metric) => useThousands ? metric.weekendDisplayAverage : metric.weekendAverage);
    const chartMax = Math.max(...weekdayValues, ...weekendValues, 0);
    const yAxisMax = chartMax === 0 ? 1 : Math.ceil(chartMax * 1.12 * 10) / 10;
    const peakAreas = [
      [{ name: '오전 첨두시', xAxis: '7시' }, { xAxis: '8시' }],
      [{ name: '오후 첨두시', xAxis: '17시' }, { xAxis: '18시' }]
    ];
    const hourLabels = HOURS.map((hour) => `${hour}시`);
    chart.setOption({
      animation: false,
      grid: { left: 78, right: 28, top: 92, bottom: 72, containLabel: true },
      legend: { top: 12, right: 8, itemWidth: 13, itemHeight: 13, textStyle: { color: '#344054', fontWeight: 700 } },
      xAxis: { type: 'category', data: hourLabels, axisLine: { lineStyle: { color: '#adb5bd' } }, axisLabel: { color: '#344054', interval: 0 } },
      yAxis: { type: 'value', max: yAxisMax, name: metricUnit, nameTextStyle: { color: '#667085' }, splitLine: { lineStyle: { color: '#e4e7ec' } }, axisLabel: { color: '#667085' } },
      series: [
        {
          name: '주중기준',
          type: 'line',
          data: weekdayValues.map((value) => ({ value })),
          symbol: 'circle',
          symbolSize: 9,
          smooth: true,
          lineStyle: { color: '#1261b5', width: 3 },
          itemStyle: { color: '#fff', borderColor: '#1261b5', borderWidth: 3 },
          label: { show: true, position: 'top', distance: 8, color: '#0057b8', fontSize: 12, formatter: ({ value }: { value: number }) => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) },
          markArea: { silent: true, itemStyle: { color: 'rgba(244, 220, 202, .52)' }, label: { show: false }, data: peakAreas }
        },
        {
          name: '주말기준',
          type: 'line',
          data: weekendValues.map((value, index) => ({ value, label: { show: value !== weekdayValues[index], position: (index === 0 || index === weekendValues.length - 1) && value === 0 ? 'top' : 'bottom' } })),
          symbol: 'circle',
          symbolSize: 8,
          smooth: true,
          lineStyle: { color: '#666', width: 2.5 },
          itemStyle: { color: '#fff', borderColor: '#666', borderWidth: 2.5 },
          label: { show: true, position: 'bottom', distance: 10, color: '#555', fontSize: 11, formatter: ({ value }: { value: number }) => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) }
        }
      ]
    });
    const positionPeakLabels = () => {
      const xForHour = (hour: number): number => Number(chart.convertToPixel({ xAxisIndex: 0 }, hourLabels[hour]));
      chart.setOption({
        graphic: [
          { id: 'morning-peak-label', type: 'text', x: (xForHour(7) + xForHour(8)) / 2, y: 42, style: { text: '오전 첨두시', fill: '#9a4d1a', fontWeight: 700, fontSize: 14, textAlign: 'center', textVerticalAlign: 'middle' } },
          { id: 'afternoon-peak-label', type: 'text', x: (xForHour(17) + xForHour(18)) / 2, y: 42, style: { text: '오후 첨두시', fill: '#9a4d1a', fontWeight: 700, fontSize: 14, textAlign: 'center', textVerticalAlign: 'middle' } }
        ]
      });
    };
    positionPeakLabels();
    const resize = () => { chart.resize(); positionPeakLabels(); };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [displayUnit, result, metricLabel, metricUnit]);
  return <div ref={ref} className="chart hourly-chart" aria-label={`주중·주말 시간대별 평균 ${metricLabel} 선그래프`} />;
}

function ProjectCard({ project, onOpen, onDelete }: { project: ProjectManifest; onOpen: () => void; onDelete: () => void }): JSX.Element {
  return <article className="project-card">
    <button className="project-open" onClick={onOpen}><span className="project-icon">▦</span><span><strong>{projectTitle(project)}</strong><small>{project.sourceFiles.join(', ')} · {project.records.length.toLocaleString('ko-KR')}개 분석 행</small></span></button>
    <button className="icon-button danger" onClick={onDelete} aria-label="프로젝트 삭제">×</button>
  </article>;
}

function SamplePreview({ preview, open }: { preview: FilePreview; open: boolean }): JSX.Element {
  const sampleRows = preview.rows.slice(0, 10);
  return <details className="sample-preview" open={open}><summary><strong>{preview.name}</strong><span>데이터 미리보기 · 상위 {sampleRows.length}개 행</span></summary><div className="sample-table-scroll"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{sampleRows.map((row, rowIndex) => <tr key={`${preview.name}-${rowIndex}`}>{preview.headers.map((header) => <td key={`${header}-${rowIndex}`}>{String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div></details>;
}

type StationSortKey = 'rank' | 'stationId' | 'stationName' | 'dailyAverage';

function StationDemandTable({ rows, metricLabel, displayUnit, selectedStationId, onSelectStation }: { rows: StationDemandViewRow[]; metricLabel: string; displayUnit: DisplayUnit; selectedStationId?: string; onSelectStation: (stationId: string) => void }): JSX.Element {
  const [sortKey, setSortKey] = useState<StationSortKey>('dailyAverage');
  const [descending, setDescending] = useState(true);
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = sortKey === 'stationId' ? left.stationId : sortKey === 'stationName' ? left.stationName : left[sortKey];
    const rightValue = sortKey === 'stationId' ? right.stationId : sortKey === 'stationName' ? right.stationName : right[sortKey];
    const compared = typeof leftValue === 'string' && typeof rightValue === 'string'
      ? leftValue.localeCompare(rightValue, 'ko')
      : Number(leftValue) - Number(rightValue);
    return (descending ? -1 : 1) * compared || left.stationId.localeCompare(right.stationId, 'en');
  }), [descending, rows, sortKey]);

  function changeSort(nextKey: StationSortKey): void {
    if (sortKey === nextKey) setDescending((value) => !value);
    else { setSortKey(nextKey); setDescending(nextKey === 'dailyAverage' || nextKey === 'rank'); }
  }

  const useThousands = metricLabel !== '통행량' && displayUnit === 'thousand';
  const heading = metricLabel === '통행량' ? '통행량(건/일)' : useThousands ? '승차인원(천 명/일)' : '승차인원(인/일)';
  return <div className="station-table-scroll"><table className="station-demand-table"><thead><tr>
    {([['rank', '순위'], ['stationId', '정류장 ID'], ['stationName', '정류장명'], ['dailyAverage', heading]] as Array<[StationSortKey, string]>).map(([key, label]) => <th key={key} aria-sort={sortKey === key ? (descending ? 'descending' : 'ascending') : 'none'}><button className="table-sort" onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sortKey === key ? (descending ? ' ↓' : ' ↑') : ''}</span></button></th>)}
  </tr></thead><tbody>{sortedRows.length ? sortedRows.map((row) => <tr key={row.stationId} className={row.stationId === selectedStationId ? 'is-selected' : ''} onMouseEnter={() => onSelectStation(row.stationId)} onClick={() => onSelectStation(row.stationId)}><td>{row.rank}</td><td>{row.stationId}</td><td>{row.stationName}</td><td>{formatStationDemand(row.dailyAverage, useThousands ? 'thousand' : 'raw')}</td></tr>) : <tr><td className="table-empty" colSpan={4}>선택한 조건에 해당하는 정류장이 없습니다.</td></tr>}</tbody></table></div>;
}

function formatRoutePercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function RouteSummaryTable({ rows, selectedRouteId, selectedDirection, onSelectRoute }: { rows: RouteSummaryMetric[]; selectedRouteId?: string; selectedDirection?: RouteDirection; onSelectRoute: (routeId: string, direction: RouteDirection) => void }): JSX.Element {
  return <div className="route-summary-scroll"><table className="route-summary-table"><thead><tr><th>노선번호</th><th>노선 ID</th><th>교통수단</th><th>방향</th><th>최대 정류장</th><th>최대 재차인원</th><th>혼잡도</th><th>시간대</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={`${row.routeId}-${row.direction}`} className={row.routeId === selectedRouteId && row.direction === selectedDirection ? 'is-selected' : ''} onClick={() => onSelectRoute(row.routeId, row.direction)}><td><strong>{row.routeName}</strong></td><td className="route-id-cell">{row.routeId}</td><td>{row.transportMode}</td><td>{row.directionLabel}</td><td>{row.stationLabel}</td><td>{row.peakOnboardPassengers.toFixed(1)}</td><td>{formatRoutePercent(row.congestionPercent)}</td><td>{row.hour === 'all' ? '전체' : `${row.hour}시`}</td></tr>) : <tr><td className="table-empty" colSpan={8}>선택한 조건에 해당하는 노선이 없습니다.</td></tr>}</tbody></table></div>;
}

export default function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [view, setView] = useState<'home' | 'import' | 'report'>('home');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [importError, setImportError] = useState<string>();
  const [mapping, setMapping] = useState<ColumnMapping>({ dateColumn: '', rowSemantics: 'count-column' });
  const [mappingSuggestions, setMappingSuggestions] = useState<Partial<ColumnMapping>>({});
  const [importStep, setImportStep] = useState<'transaction' | 'station' | 'route'>('transaction');
  const [config, setConfig] = useState<AnalysisConfig>({ filter: { from: '', to: '' }, denominator: 'observed' });
  const [result, setResult] = useState<ReturnType<typeof analyzeRecords> | null>(null);
  const [hourlyResult, setHourlyResult] = useState<HourlyAnalysisResult | null>(null);
  const [stationResult, setStationResult] = useState<StationDemandResult | null>(null);
  const [odResult, setODResult] = useState<ODDemandResult | null>(null);
  const [stationMasterFiles, setStationMasterFiles] = useState<File[]>([]);
  const [stationMasterPreviews, setStationMasterPreviews] = useState<FilePreview[]>([]);
  const [stationMasterRows, setStationMasterRows] = useState<Record<string, unknown>[]>([]);
  const [stationMasterHasHeaderRow, setStationMasterHasHeaderRow] = useState(false);
  const [stationMasterMapping, setStationMasterMapping] = useState<StationMasterMapping>(EMPTY_STATION_MASTER_MAPPING);
  const [stationMasterSourceRecords, setStationMasterSourceRecords] = useState<StationMasterRecord[]>([]);
  const [stationMasterRecords, setStationMasterRecords] = useState<StationMasterRecord[]>([]);
  const [stationMasterSource, setStationMasterSource] = useState<string>();
  const [stationMasterWarnings, setStationMasterWarnings] = useState<string[]>([]);
  const [stationMasterMergeWarnings, setStationMasterMergeWarnings] = useState<string[]>([]);
  const [stationMasterError, setStationMasterError] = useState<string>();
  const [routeStopMasterFiles, setRouteStopMasterFiles] = useState<File[]>([]);
  const [routeStopMasterPreviews, setRouteStopMasterPreviews] = useState<FilePreview[]>([]);
  const [routeStopMasterRows, setRouteStopMasterRows] = useState<Record<string, unknown>[]>([]);
  const [routeStopMasterHasHeaderRow, setRouteStopMasterHasHeaderRow] = useState(false);
  const [routeStopMasterMapping, setRouteStopMasterMapping] = useState<RouteStopMasterMapping>(EMPTY_ROUTE_STOP_MASTER_MAPPING);
  const [routeStopMasterSuggestions, setRouteStopMasterSuggestions] = useState<Partial<RouteStopMasterMapping>>({});
  const [routeStopMasterRecords, setRouteStopMasterRecords] = useState<RouteStopMasterRecord[]>([]);
  const [routeStopMasterSource, setRouteStopMasterSource] = useState<string>();
  const [routeStopMasterWarnings, setRouteStopMasterWarnings] = useState<string[]>([]);
  const [routeStopMasterError, setRouteStopMasterError] = useState<string>();
  const [routeServiceConfigs, setRouteServiceConfigs] = useState<RouteServiceConfig[]>([]);
  const [bulkTripsInput, setBulkTripsInput] = useState('');
  const [routeConfig, setRouteConfig] = useState<RouteCongestionConfig>({ filter: { from: '', to: '' }, denominator: 'observed', hour: 'all' });
  const [routeResult, setRouteResult] = useState<RouteCongestionResult | null>(null);
  const [qualityResult, setQualityResult] = useState<DataQualityAnalysisResult | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [selectedRouteDirection, setSelectedRouteDirection] = useState<RouteDirection>();
  const [selectedRouteSegmentKey, setSelectedRouteSegmentKey] = useState<string>();
  const [optionalMappingOpen, setOptionalMappingOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('weekday');
  const [displayUnits, setDisplayUnits] = useState<DisplayUnitConfig>(DEFAULT_DISPLAY_UNITS);
  const [selectedStationId, setSelectedStationId] = useState<string>();
  const [selectedODKey, setSelectedODKey] = useState<string>();
  const reportRef = useRef<HTMLDivElement>(null);
  const selectStation = useCallback((stationId: string) => setSelectedStationId(stationId), []);
  const selectODFlow = useCallback((flowKey: string) => setSelectedODKey(flowKey), []);
  const selectRoute = useCallback((routeId: string, direction?: RouteDirection) => { setSelectedRouteId(routeId); setSelectedRouteDirection(direction); setSelectedRouteSegmentKey(undefined); }, []);
  const selectRouteSegment = useCallback((key: string) => setSelectedRouteSegmentKey(key), []);

  useEffect(() => { void (async () => setProjects(window.transitDesktop ? await window.transitDesktop.listProjects() : await listBrowserProjects()))(); }, []);

  const headers = previews[0]?.headers ?? [];
  const records = project?.records ?? [];
  const dimensionValues = useMemo(() => ({ route: uniqueValues(records, 'route'), station: uniqueValues(records, 'station'), region: uniqueValues(records, 'region') }), [records]);
  const hasHourlyData = records.some((record) => record.boardingHour !== undefined || record.boardingTime);
  const hasStationData = records.some((record) => Boolean(record.stationId));
  const hasStationDemand = hasStationData && (stationMasterRecords.length > 0 || Boolean(stationResult));
  const hasODData = records.some((record) => Boolean(record.stationId && record.destinationStationId));
  const hasQualityData = routeStopMasterRecords.length > 0;
  const routeMasterOptions = useMemo(() => routeOptions(buildRoutePathIndex(routeStopMasterRecords)), [routeStopMasterRecords]);
  const hasRouteData = records.some((record) => Boolean(record.route && record.stationId && record.destinationStationId && (record.boardingHour !== undefined || record.boardingTime))) && routeMasterOptions.length > 0;
  const hasODDemand = hasODData && (stationMasterRecords.length > 0 || Boolean(odResult));
  const stationView = useMemo(() => stationResult ? joinStationDemandMetrics(stationResult.metrics, stationMasterRecords) : { rows: [], unmatchedCount: 0, warnings: [] }, [stationMasterRecords, stationResult]);
  const odView = useMemo(() => odResult ? joinODDemandMetrics(odResult.metrics, stationMasterRecords) : { rows: [], unmatchedOriginCount: 0, unmatchedDestinationCount: 0, warnings: [] }, [odResult, stationMasterRecords]);

  async function save(next: ProjectManifest): Promise<void> {
    if (window.transitDesktop) await window.transitDesktop.saveProject(next);
    else await saveBrowserProject(next);
    setProjects((current) => [...current.filter((item) => item.id !== next.id), next]);
    setProject(next);
  }

  async function selectFiles(nextFiles: FileList | null): Promise<void> {
    const selected = Array.from(nextFiles ?? []);
    setImportError(undefined);
    setFiles(selected);
    let nextPreviews = await Promise.all(selected.map((file) => previewFile(file, { headerRow: hasHeaderRow ? 0 : -1 })));
    if (hasHeaderRow && nextPreviews.length > 0 && nextPreviews.every(looksLikeHeaderlessTransactionPreview)) {
      setHasHeaderRow(false);
      nextPreviews = await Promise.all(selected.map((file) => previewFile(file, { headerRow: -1 })));
    }
    setPreviews(nextPreviews);
    const suggestions = suggestTransactionMapping(nextPreviews[0]?.headers ?? [], nextPreviews[0]?.rows ?? []);
    setMappingSuggestions(suggestions);
    setMapping((current) => ({ ...current, ...suggestions }));
    setIsDragging(false);
  }

  function applyStationMasterMapping(rows: Record<string, unknown>[], nextMapping: StationMasterMapping): void {
    if (Object.values(nextMapping).some((column) => !column)) {
      setStationMasterSourceRecords([]);
      setStationMasterRecords([]);
      setStationMasterWarnings([]);
      setStationMasterMergeWarnings([]);
      setStationMasterError(undefined);
      return;
    }
    try {
      const parsed = normalizeStationMasterRows(rows, nextMapping);
      const merged = mergeStationMasterRecords(parsed.stations, stationRecordsFromRouteStops(routeStopMasterRecords));
      setStationMasterSourceRecords(parsed.stations);
      setStationMasterRecords(merged.stations);
      setStationMasterWarnings(parsed.warnings);
      setStationMasterMergeWarnings(merged.warnings);
      setStationMasterError(parsed.stations.length ? undefined : '유효한 정류장 정보 행이 없습니다. 필드 매핑과 원본 좌표를 확인하세요.');
    } catch (error) {
      setStationMasterSourceRecords([]);
      setStationMasterRecords([]);
      setStationMasterWarnings([]);
      setStationMasterMergeWarnings([]);
      setStationMasterError(error instanceof Error ? error.message : '정류장 정보를 읽지 못했습니다.');
    }
  }

  function applyRouteStopMasterMapping(rows: Record<string, unknown>[], nextMapping: RouteStopMasterMapping): void {
    const required = ['routeIdColumn', 'routeNameColumn', 'transportModeColumn', 'stationSequenceColumn', 'stationIdColumn', 'stationNameColumn', 'latitudeColumn', 'longitudeColumn'] as const;
    if (required.some((key) => !nextMapping[key])) {
      setRouteStopMasterRecords([]);
      setRouteStopMasterWarnings([]);
      setRouteStopMasterError(undefined);
      return;
    }
    try {
      const parsed = normalizeRouteStopMasterRows(rows, nextMapping);
      const pathIndex = buildRoutePathIndex(parsed.stops);
      const mergedStations = mergeStationMasterRecords(stationMasterSourceRecords, stationRecordsFromRouteStops(parsed.stops));
      setRouteStopMasterRecords(parsed.stops);
      setStationMasterRecords(mergedStations.stations);
      setStationMasterMergeWarnings(mergedStations.warnings);
      if (!stationMasterSourceRecords.length && parsed.stops.length) setStationMasterSource(ROUTE_STOP_STATION_FALLBACK_SOURCE);
      setRouteServiceConfigs((current) => routeOptions(pathIndex).map((option) => current.find((candidate) => candidate.routeId === option.routeId) ?? { routeId: option.routeId, vehicleCapacity: 0, tripsByHour: Object.fromEntries(HOURS.map((hour) => [String(hour), 0])) }));
      setRouteStopMasterWarnings([...parsed.warnings, ...pathIndex.warnings]);
      setRouteStopMasterError(pathIndex.paths.length ? undefined : '유효한 노선 경로가 없습니다. 노선 ID·정류장 순번·정류장 ID를 확인하세요.');
    } catch (error) {
      setRouteStopMasterRecords([]);
      setStationMasterRecords(stationMasterSourceRecords);
      setStationMasterMergeWarnings([]);
      setRouteStopMasterWarnings([]);
      setRouteStopMasterError(error instanceof Error ? error.message : '노선별 정류장정보를 읽지 못했습니다.');
    }
  }

  async function selectStationMasterFiles(nextFiles: FileList | null, hasHeader = stationMasterHasHeaderRow): Promise<void> {
    const selected = Array.from(nextFiles ?? []);
    if (!selected.length) return;
    setOptionalMappingOpen(true);
    setStationMasterError(undefined);
    try {
      const parsedFiles = await Promise.all(selected.map(async (file) => {
        let preview = await previewFile(file, { headerRow: hasHeader ? 0 : -1 });
        let parsed = await parseFileRows(file, preview.options);
        if (!hasHeader && looksLikeStationMasterHeader(parsed.rows[0])) {
          preview = await previewFile(file, { headerRow: 0 });
          parsed = await parseFileRows(file, preview.options);
        }
        return { preview, rows: parsed.rows };
      }));
      const first = parsedFiles[0];
      const nextMapping = suggestStationMasterMapping(first.preview.headers, first.rows);
      const allRows = parsedFiles.flatMap((item) => item.rows);
      setStationMasterFiles(selected);
      setStationMasterPreviews(parsedFiles.map((item) => item.preview));
      setStationMasterRows(allRows);
      setStationMasterMapping(nextMapping);
      setStationMasterSource(selected.map((file) => file.name).join(', '));
      setImportError(undefined);
      applyStationMasterMapping(allRows, nextMapping);
    } catch (error) {
      setStationMasterFiles(selected);
      setStationMasterPreviews([]);
      setStationMasterRows([]);
      setStationMasterMapping(EMPTY_STATION_MASTER_MAPPING);
      setStationMasterSourceRecords([]);
      setStationMasterRecords([]);
      setStationMasterMergeWarnings([]);
      setStationMasterError(error instanceof Error ? error.message : '정류장 정보를 읽지 못했습니다.');
    }
  }

  async function updateStationMasterHeaderMode(nextHasHeaderRow: boolean): Promise<void> {
    setStationMasterHasHeaderRow(nextHasHeaderRow);
    if (stationMasterFiles.length) {
      const files = new DataTransfer();
      stationMasterFiles.forEach((file) => files.items.add(file));
      await selectStationMasterFiles(files.files, nextHasHeaderRow);
    }
  }

  function updateStationMasterMapping(key: keyof StationMasterMapping, value: string): void {
    const nextMapping = { ...stationMasterMapping, [key]: value };
    setStationMasterMapping(nextMapping);
    applyStationMasterMapping(stationMasterRows, nextMapping);
  }

  async function selectRouteStopMasterFiles(nextFiles: FileList | null, hasHeader = routeStopMasterHasHeaderRow): Promise<void> {
    const selected = Array.from(nextFiles ?? []);
    if (!selected.length) return;
    setRouteStopMasterError(undefined);
    try {
      const parsedFiles = await Promise.all(selected.map(async (file) => {
        let preview = await previewFile(file, { headerRow: hasHeader ? 0 : -1 });
        let parsed = await parseFileRows(file, preview.options);
        if (!hasHeader && looksLikeRouteStopMasterHeader(parsed.rows[0])) {
          preview = await previewFile(file, { headerRow: 0 });
          parsed = await parseFileRows(file, preview.options);
        }
        return { preview, rows: parsed.rows };
      }));
      const first = parsedFiles[0];
      const nextMapping = suggestRouteStopMasterMapping(first.preview.headers, first.rows);
      const allRows = parsedFiles.flatMap((item) => item.rows);
      setRouteStopMasterSuggestions(nextMapping);
      setRouteStopMasterFiles(selected);
      setRouteStopMasterPreviews(parsedFiles.map((item) => item.preview));
      setRouteStopMasterRows(allRows);
      setRouteStopMasterMapping(nextMapping);
      setRouteStopMasterSource(selected.map((file) => file.name).join(', '));
      applyRouteStopMasterMapping(allRows, nextMapping);
    } catch (error) {
      setRouteStopMasterFiles(selected);
      setRouteStopMasterPreviews([]);
      setRouteStopMasterRows([]);
      setRouteStopMasterMapping(EMPTY_ROUTE_STOP_MASTER_MAPPING);
      setRouteStopMasterSuggestions({});
      setRouteStopMasterRecords([]);
      setStationMasterRecords(stationMasterSourceRecords);
      setStationMasterMergeWarnings([]);
      setRouteStopMasterError(error instanceof Error ? error.message : '노선별 정류장정보를 읽지 못했습니다.');
    }
  }

  async function updateRouteStopMasterHeaderMode(nextHasHeaderRow: boolean): Promise<void> {
    setRouteStopMasterHasHeaderRow(nextHasHeaderRow);
    if (routeStopMasterFiles.length) {
      const files = new DataTransfer();
      routeStopMasterFiles.forEach((file) => files.items.add(file));
      await selectRouteStopMasterFiles(files.files, nextHasHeaderRow);
    }
  }

  function updateRouteStopMasterMapping(key: keyof RouteStopMasterMapping, value: string): void {
    const nextMapping = { ...routeStopMasterMapping, [key]: value || undefined };
    setRouteStopMasterMapping(nextMapping);
    setRouteStopMasterSuggestions((current) => { const next = { ...current }; delete next[key]; return next; });
    applyRouteStopMasterMapping(routeStopMasterRows, nextMapping);
  }

  function startNewAnalysis(): void {
    setFiles([]);
    setPreviews([]);
    setMapping({ dateColumn: '', rowSemantics: 'count-column' });
    setMappingSuggestions({});
    setImportStep('transaction');
    setConfig({ filter: { from: '', to: '' }, denominator: 'observed' });
    setProject(null);
    setResult(null);
    setHourlyResult(null);
    setStationResult(null);
    setODResult(null);
    setRouteResult(null);
    setQualityResult(null);
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setSelectedRouteId(undefined);
    setSelectedRouteDirection(undefined);
    setSelectedRouteSegmentKey(undefined);
    setImportError(undefined);
    setStationMasterFiles([]);
    setStationMasterPreviews([]);
    setStationMasterRows([]);
    setStationMasterHasHeaderRow(false);
    setStationMasterMapping(EMPTY_STATION_MASTER_MAPPING);
    setStationMasterSourceRecords([]);
    setStationMasterRecords([]);
    setStationMasterSource(undefined);
    setStationMasterWarnings([]);
    setStationMasterMergeWarnings([]);
    setStationMasterError(undefined);
    setRouteStopMasterFiles([]);
    setRouteStopMasterPreviews([]);
    setRouteStopMasterRows([]);
    setRouteStopMasterHasHeaderRow(false);
    setRouteStopMasterMapping(EMPTY_ROUTE_STOP_MASTER_MAPPING);
    setRouteStopMasterSuggestions({});
    setRouteStopMasterRecords([]);
    setRouteStopMasterSource(undefined);
    setRouteStopMasterWarnings([]);
    setRouteStopMasterError(undefined);
    setRouteServiceConfigs([]);
    setBulkTripsInput('');
    setRouteConfig({ filter: { from: '', to: '' }, denominator: 'observed', hour: 'all' });
    setOptionalMappingOpen(false);
    setAnalysisMode('weekday');
    setDisplayUnits(DEFAULT_DISPLAY_UNITS);
    setView('import');
  }

  async function updateHeaderMode(nextHasHeaderRow: boolean): Promise<void> {
    setImportError(undefined);
    setHasHeaderRow(nextHasHeaderRow);
    if (files.length) {
      const nextPreviews = await Promise.all(files.map((file) => previewFile(file, { headerRow: nextHasHeaderRow ? 0 : -1 })));
      setPreviews(nextPreviews);
      const suggestions = suggestTransactionMapping(nextPreviews[0]?.headers ?? [], nextPreviews[0]?.rows ?? []);
      setMappingSuggestions(suggestions);
      setMapping({ dateColumn: '', rowSemantics: 'count-column', ...suggestions });
    } else {
      setMappingSuggestions({});
      setMapping({ dateColumn: '', rowSemantics: 'count-column' });
    }
  }

  function updateMapping(key: keyof ColumnMapping, value: string | undefined): void {
    setMapping((current) => ({ ...current, [key]: value || undefined }));
    setMappingSuggestions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function continueToStationStep(): void {
    setImportError(undefined);
    if (!files.length) { setImportError('먼저 교통카드 거래내역 파일을 선택하세요.'); return; }
    if (!mapping.dateColumn || (mapping.rowSemantics === 'count-column' && !mapping.boardingCountColumn)) {
      setImportError('거래내역의 날짜와 집계 필드를 먼저 연결하세요.');
      return;
    }
    setImportStep('station');
  }

  function continueToRouteStep(): void {
    setImportError(undefined);
    if (!files.length) { setImportError('먼저 교통카드 거래내역 파일을 선택하세요.'); return; }
    if (!mapping.dateColumn || (mapping.rowSemantics === 'count-column' && !mapping.boardingCountColumn)) {
      setImportError('거래내역의 날짜와 집계 필드를 먼저 연결하세요.');
      return;
    }
    setImportStep('route');
  }

  async function importData(): Promise<void> {
    if (!files.length || !mapping.dateColumn) return;
    setImportError(undefined);
    try {
      if (previews.some((preview) => hasSensitiveHeaders(preview.headers))) {
        window.alert('카드번호·이름·전화번호 등 개인 식별자로 보이는 컬럼이 있습니다. 개인 식별자를 제거한 파일만 가져올 수 있습니다.');
        return;
      }
      const normalized: NormalizedRecord[] = [];
      let excludedRows = 0;
      const warnings: string[] = [];
      for (const [index, file] of files.entries()) {
        const preview = previews[index];
        const content = await parseFileRows(file, preview.options);
        const parsed = normalizeRows(content.rows, mapping, file.name);
        // Keep the import stack-safe for daily files with hundreds of
        // thousands of normalized records.
        for (const record of parsed.records) normalized.push(record);
        excludedRows += parsed.excludedRows;
        warnings.push(...parsed.warnings);
      }
      if (!normalized.length) {
        setImportError(`분석할 수 있는 행이 없습니다. 날짜(${mapping.dateColumn})와 승차인원(${mapping.boardingCountColumn ?? '선택 안 함'}) 매핑 및 원본 날짜 형식을 확인하세요.`);
        return;
      }
      const duplicateIndexes = exactDuplicateIndexes(normalized);
      let recordsToSave = normalized;
      if (duplicateIndexes.length) {
        const keepDuplicates = window.confirm(`거래 식별 6개 필드(가상카드번호·노선 ID·승차/하차 정류장 ID·트랜잭션 ID·환승건수)와 날짜·시간·이용인원 및 나머지 매핑 값까지 모두 같은 행 ${duplicateIndexes.length}개가 발견되었습니다. 확인을 누르면 그대로 합산하고, 취소를 누르면 중복 행을 제외합니다.`);
        if (!keepDuplicates) {
          const duplicateSet = new Set(duplicateIndexes);
          recordsToSave = normalized.filter((_record, index) => !duplicateSet.has(index));
        }
        warnings.push(`완전 중복 행 ${duplicateIndexes.length}개를 ${keepDuplicates ? '합산' : '제외'}했습니다.`);
      }
      if (!recordsToSave.length) {
        setImportError('중복 행을 제외한 뒤 분석할 수 있는 행이 없습니다. 중복 제외 설정을 확인하세요.');
        return;
      }
      const dates = recordsToSave.map((record) => record.serviceDate).sort();
      const nextConfig = { ...config, filter: { ...config.filter, from: dates[0], to: dates[dates.length - 1] } };
      const nextRouteConfig: RouteCongestionConfig = { filter: nextConfig.filter, denominator: nextConfig.denominator, hour: 'all' };
      recordsToSave = classifyDataQuality(recordsToSave, stationMasterRecords, routeStopMasterRecords);
      const persistedStationWarnings = [...stationMasterWarnings, ...stationMasterMergeWarnings];
      const stationMasterFields = stationMasterRecords.length ? { stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings: persistedStationWarnings } : {};
      const routeMasterFields = routeStopMasterRecords.length ? { routeStopMaster: routeStopMasterRecords, routeStopMasterSource, routeStopMasterMapping, routeStopMasterWarnings, routeServiceConfigs } : {};
      const next: ProjectManifest = { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, id: id(), name: DEFAULT_PROJECT_TITLE, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceFiles: files.map((file) => file.name), records: recordsToSave, mapping, parseOptions: previews[0].options, ...stationMasterFields, ...routeMasterFields, analysisConfig: nextConfig, routeAnalysisConfig: nextRouteConfig, analysisMode: 'weekday', displayUnits };
      const nextResult = analyzeRecords(recordsToSave, nextConfig);
      nextResult.excludedRows = excludedRows;
      nextResult.warnings = warnings;
      next.lastResult = nextResult;
      setConfig(nextConfig);
      setRouteConfig(nextRouteConfig);
      setResult(nextResult);
      setHourlyResult(null);
      setStationResult(null);
      setODResult(null);
      setRouteResult(null);
      setQualityResult(null);
      setSelectedStationId(undefined);
      setSelectedODKey(undefined);
      setSelectedRouteId(undefined);
      setSelectedRouteDirection(undefined);
      setSelectedRouteSegmentKey(undefined);
      setAnalysisMode('weekday');
      await save(next);
      setView('report');
    } catch (error) {
      console.error('교통카드 데이터 분석 실패', error);
      setImportError('데이터를 분석하거나 프로젝트를 저장하지 못했습니다. 파일 형식과 필드 매핑을 확인한 뒤 다시 시도하세요.');
    }
  }

  async function runAnalysis(): Promise<void> {
    if (!project) return;
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runAnalysis(project.id, config)
      : analyzeRecords(project.records, config);
    const next = { ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'weekday' as const, lastResult: nextResult };
    setResult(nextResult);
    setAnalysisMode('weekday');
    await save(next);
  }

  async function runHourlyAnalysis(): Promise<void> {
    if (!project || !hasHourlyData) return;
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runHourlyAnalysis(project.id, config)
      : analyzeHourlyRecords(project.records, config);
    const next = { ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'hourly' as const, lastHourlyResult: nextResult };
    setHourlyResult(nextResult);
    setAnalysisMode('hourly');
    await save(next);
  }

  async function runStationAnalysis(): Promise<void> {
    if (!project || !hasStationData || !stationMasterRecords.length) return;
    const analyzedResult = window.transitDesktop
      ? await window.transitDesktop.runStationDemand(project.id, config)
      : analyzeStationRecords(project.records, config);
    const nextResult = attachStationMasterInfo(analyzedResult, stationMasterRecords);
    const next = { ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings: [...stationMasterWarnings, ...stationMasterMergeWarnings], analysisConfig: config, analysisMode: 'station' as const, lastStationResult: nextResult };
    setStationResult(nextResult);
    setODResult(null);
    setSelectedStationId(undefined);
    setAnalysisMode('station');
    await save(next);
  }

  async function runODAnalysis(): Promise<void> {
    if (!project || !hasODData || !stationMasterRecords.length) return;
    const analyzedResult = window.transitDesktop
      ? await window.transitDesktop.runODDemand(project.id, config)
      : analyzeODRecords(project.records, config);
    const nextResult = attachODMasterInfo(analyzedResult, stationMasterRecords);
    const next = { ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings: [...stationMasterWarnings, ...stationMasterMergeWarnings], analysisConfig: config, analysisMode: 'od' as const, lastODResult: nextResult };
    setODResult(nextResult);
    setSelectedODKey(undefined);
    setAnalysisMode('od');
    await save(next);
  }

  function updateRouteServiceConfig(routeId: string, key: 'vehicleCapacity' | HourIndex, value: number): void {
    const normalizedValue = Number.isFinite(value) ? Math.trunc(value) : 0;
    setRouteServiceConfigs((current) => current.map((candidate) => candidate.routeId !== routeId ? candidate : key === 'vehicleCapacity'
      ? { ...candidate, vehicleCapacity: normalizedValue }
      : { ...candidate, tripsByHour: { ...candidate.tripsByHour, [String(key)]: Math.max(0, normalizedValue) } }));
  }

  function applyBulkRouteTrips(): void {
    const value = Number(bulkTripsInput);
    if (!bulkTripsInput.trim() || !Number.isInteger(value) || value < 0 || !routeMasterOptions.length) return;
    setRouteServiceConfigs((current) => applyTripsToAllRoutes(current, routeMasterOptions.map((option) => option.routeId), value));
  }

  async function runRouteAnalysis(): Promise<void> {
    if (!project || !hasRouteData) return;
    const nextConfig = { ...routeConfig, filter: { ...routeConfig.filter, from: routeConfig.filter.from || config.filter.from, to: routeConfig.filter.to || config.filter.to } };
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runRouteCongestion(project.id, nextConfig, routeStopMasterRecords, routeServiceConfigs)
      : analyzeRouteRecords(project.records, routeStopMasterRecords, routeServiceConfigs, nextConfig);
    const next = { ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), routeStopMaster: routeStopMasterRecords, routeStopMasterSource, routeStopMasterMapping, routeStopMasterWarnings, routeServiceConfigs, routeAnalysisConfig: nextConfig, analysisMode: 'route' as const, lastRouteResult: nextResult };
    setRouteConfig(nextConfig);
    setRouteResult(nextResult);
    setSelectedRouteId(nextResult.summaries[0]?.routeId ?? routeMasterOptions[0]?.routeId);
    setSelectedRouteDirection(nextResult.summaries[0]?.direction);
    setSelectedRouteSegmentKey(undefined);
    setAnalysisMode('route');
    await save(next);
  }

  async function runQualityAnalysis(): Promise<void> {
    if (!project || !hasQualityData) return;
    const qualityFilter = { from: config.filter.from, to: config.filter.to, route: config.filter.route };
    const qualityConfig: AnalysisConfig = { filter: qualityFilter, denominator: 'observed' };
    const qualityRecords = hasCurrentDataQualityClassification(project.records, project.schemaVersion)
      ? project.records
      : classifyDataQuality(project.records, stationMasterRecords, routeStopMasterRecords);
    const nextResult = analyzeDataQuality(qualityRecords, qualityConfig);
    const qualityWarnings = qualityWarningsForProject(project);
    const next = {
      ...project,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      records: qualityRecords,
      stationMaster: stationMasterRecords,
      routeStopMaster: routeStopMasterRecords,
      analysisConfig: { ...config, filter: qualityFilter },
      analysisMode: 'quality' as const,
      lastQualityResult: nextResult,
      qualityWarnings
    };
    setConfig({ ...config, filter: qualityFilter });
    setQualityResult(nextResult);
    setAnalysisMode('quality');
    await save(next);
  }

  async function selectAnalysisMode(mode: AnalysisMode): Promise<void> {
    if (mode === 'hourly') {
      await runHourlyAnalysis();
      return;
    }
    if (mode === 'station') {
      await runStationAnalysis();
      return;
    }
    if (mode === 'od') {
      await runODAnalysis();
      return;
    }
    if (mode === 'route') {
      await runRouteAnalysis();
      return;
    }
    if (mode === 'quality') {
      await runQualityAnalysis();
      return;
    }
    await runAnalysis();
  }

  async function updateDisplayUnit(unit: DisplayUnit): Promise<void> {
    if (!project) return;
    const nextDisplayUnits = { ...displayUnits, [analysisMode]: unit } as DisplayUnitConfig;
    setDisplayUnits(nextDisplayUnits);
    await save({ ...project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), displayUnits: nextDisplayUnits });
  }

  async function restoreProject(): Promise<void> {
    if (!window.transitDesktop) return;
    const restored = await window.transitDesktop.importProject();
    if (!restored) return;
    const restoredConfig = restored.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const restoredMode = restored.analysisMode ?? 'weekday';
    const restoredDisplayUnits = normalizeDisplayUnits(restored.displayUnits);
    const restoredRouteMaster = restored.routeStopMaster ?? [];
    const restoredClassificationIsCurrent = hasCurrentDataQualityClassification(restored.records, restored.schemaVersion);
    const restoredRecords = restoredClassificationIsCurrent
      ? restored.records
      : classifyDataQuality(restored.records, restored.stationMaster ?? [], restoredRouteMaster);
    const restoredQualityWarnings = qualityWarningsForProject(restored);
    const restoredHourlyResult = restored.lastHourlyResult ?? (restoredMode === 'hourly' && restored.records.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(restored.records, restoredConfig) : null);
    const restoredMaster = restored.stationMaster ?? [];
    const restoredMasterSource = restored.stationMasterSource;
    const restoredMasterMapping = restored.stationMasterMapping ?? EMPTY_STATION_MASTER_MAPPING;
    const restoredMasterWarnings = restored.stationMasterWarnings ?? [];
    const restoredStationResult = restored.lastStationResult ? attachStationMasterInfo(restored.lastStationResult, restoredMaster) : (restoredMode === 'station' && restoredRecords.some((record) => record.stationId) ? attachStationMasterInfo(analyzeStationRecords(restoredRecords, restoredConfig), restoredMaster) : null);
    const restoredODResult = restored.lastODResult ? attachODMasterInfo(analyzeODRecords(restoredRecords, restoredConfig), restoredMaster) : (restoredMode === 'od' && restoredRecords.some((record) => record.stationId && record.destinationStationId) ? attachODMasterInfo(analyzeODRecords(restoredRecords, restoredConfig), restoredMaster) : null);
    const restoredRouteConfigs = restored.routeServiceConfigs ?? [];
    const restoredRouteConfig = restored.routeAnalysisConfig ?? restored.lastRouteResult?.config ?? { filter: restoredConfig.filter, denominator: restoredConfig.denominator, hour: 'all' as const };
    const refreshRestoredRouteResult = restoredRouteMaster.length > 0 && (restoredMode === 'route' || Boolean(restored.lastRouteResult && !restoredClassificationIsCurrent));
    const restoredRouteResult = refreshRestoredRouteResult ? analyzeRouteRecords(restoredRecords, restoredRouteMaster, restoredRouteConfigs, restoredRouteConfig) : restored.lastRouteResult ?? null;
    const refreshRestoredQualityResult = Boolean(restored.lastQualityResult && typeof restored.lastQualityResult.uniqueErrorBoardings !== 'number') || (restoredRouteMaster.length > 0 && (restoredMode === 'quality' || Boolean(restored.lastQualityResult && !restoredClassificationIsCurrent)));
    const restoredQualityResult = refreshRestoredQualityResult ? analyzeDataQuality(restoredRecords, restored.lastQualityResult?.config ?? restoredConfig) : restored.lastQualityResult ?? null;
    const restoredProject = { ...restored, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, updatedAt: new Date().toISOString(), records: restoredRecords, stationMaster: restoredMaster.length ? restoredMaster : undefined, stationMasterSource: restoredMasterSource, stationMasterMapping: restoredMaster.length ? restoredMasterMapping : undefined, stationMasterWarnings: restoredMasterWarnings, routeStopMaster: restoredRouteMaster.length ? restoredRouteMaster : undefined, routeStopMasterSource: restored.routeStopMasterSource, routeStopMasterMapping: restored.routeStopMasterMapping, routeStopMasterWarnings: restored.routeStopMasterWarnings ?? [], routeServiceConfigs: restoredRouteConfigs, analysisConfig: restoredConfig, routeAnalysisConfig: restoredRouteConfig, analysisMode: restoredMode, displayUnits: restoredDisplayUnits, lastHourlyResult: restoredHourlyResult ?? undefined, lastStationResult: restoredStationResult ?? undefined, lastODResult: restoredODResult ?? undefined, lastRouteResult: restoredRouteResult ?? undefined, lastQualityResult: restoredQualityResult ?? undefined, qualityWarnings: restoredQualityWarnings };
    await save(restoredProject);
    setConfig(restoredConfig);
    setResult(restored.lastResult ?? analyzeRecords(restoredRecords, restoredConfig));
    setHourlyResult(restoredHourlyResult);
    setStationResult(restoredStationResult);
    setODResult(restoredODResult);
    setRouteResult(restoredRouteResult);
    setQualityResult(restoredQualityResult);
    setStationMasterSourceRecords(restoredMaster);
    setStationMasterRecords(restoredMaster);
    setStationMasterSource(restoredMasterSource);
    setStationMasterMapping(restoredMasterMapping);
    setStationMasterWarnings(restoredMasterWarnings);
    setStationMasterMergeWarnings([]);
    setStationMasterError(undefined);
    setRouteStopMasterRecords(restoredRouteMaster);
    setRouteStopMasterSource(restored.routeStopMasterSource);
    setRouteStopMasterMapping(restored.routeStopMasterMapping ?? EMPTY_ROUTE_STOP_MASTER_MAPPING);
    setRouteStopMasterWarnings(restored.routeStopMasterWarnings ?? []);
    setRouteStopMasterError(undefined);
    setRouteServiceConfigs(restoredRouteConfigs);
    setRouteConfig(restoredRouteConfig);
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setSelectedRouteId(restoredRouteResult?.summaries[0]?.routeId);
    setSelectedRouteDirection(restoredRouteResult?.summaries[0]?.direction);
    setSelectedRouteSegmentKey(undefined);
    setDisplayUnits(restoredDisplayUnits);
    setAnalysisMode(restoredMode === 'hourly' && restoredHourlyResult ? 'hourly' : restoredMode === 'station' && restoredStationResult ? 'station' : restoredMode === 'od' && restoredODResult ? 'od' : restoredMode === 'route' && restoredRouteResult ? 'route' : restoredMode === 'quality' && restoredQualityResult ? 'quality' : 'weekday');
    setView('report');
  }

  async function openProject(nextProject: ProjectManifest): Promise<void> {
    const nextConfig = nextProject.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const nextMode = nextProject.analysisMode ?? 'weekday';
    const nextDisplayUnits = normalizeDisplayUnits(nextProject.displayUnits);
    const nextMaster = nextProject.stationMaster ?? [];
    const nextRouteMaster = nextProject.routeStopMaster ?? [];
    const classificationIsCurrent = hasCurrentDataQualityClassification(nextProject.records, nextProject.schemaVersion);
    const nextRecords = classificationIsCurrent ? nextProject.records : classifyDataQuality(nextProject.records, nextMaster, nextRouteMaster);
    const nextQualityWarnings = qualityWarningsForProject(nextProject);
    const nextHourlyResult = nextProject.lastHourlyResult ?? (nextMode === 'hourly' && nextRecords.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(nextRecords, nextConfig) : null);
    const nextMasterSource = nextProject.stationMasterSource;
    const nextMasterMapping = nextProject.stationMasterMapping ?? EMPTY_STATION_MASTER_MAPPING;
    const nextMasterWarnings = nextProject.stationMasterWarnings ?? [];
    const nextStationResult = nextProject.lastStationResult ? attachStationMasterInfo(nextProject.lastStationResult, nextMaster) : (nextMode === 'station' && nextRecords.some((record) => record.stationId) ? attachStationMasterInfo(analyzeStationRecords(nextRecords, nextConfig), nextMaster) : null);
    const hasODRecords = nextRecords.some((record) => record.stationId && record.destinationStationId);
    const refreshODResult = (nextMode === 'od' && hasODRecords) || Boolean(nextProject.lastODResult && !classificationIsCurrent);
    const nextODResult = refreshODResult
      ? attachODMasterInfo(analyzeODRecords(nextRecords, nextConfig), nextMaster)
      : nextProject.lastODResult ? attachODMasterInfo(nextProject.lastODResult, nextMaster) : null;
    const nextRouteConfigs = nextProject.routeServiceConfigs ?? [];
    const nextRouteConfig = nextProject.routeAnalysisConfig ?? nextProject.lastRouteResult?.config ?? { filter: nextConfig.filter, denominator: nextConfig.denominator, hour: 'all' as const };
    const refreshRouteResult = nextRouteMaster.length > 0 && (nextMode === 'route' || Boolean(nextProject.lastRouteResult && !classificationIsCurrent));
    const nextRouteResult = refreshRouteResult ? analyzeRouteRecords(nextRecords, nextRouteMaster, nextRouteConfigs, nextRouteConfig) : nextProject.lastRouteResult ?? null;
    const refreshQualityResult = Boolean(nextProject.lastQualityResult && typeof nextProject.lastQualityResult.uniqueErrorBoardings !== 'number') || (nextRouteMaster.length > 0 && (nextMode === 'quality' || Boolean(nextProject.lastQualityResult && !classificationIsCurrent)));
    const nextQualityResult = refreshQualityResult ? analyzeDataQuality(nextRecords, nextProject.lastQualityResult?.config ?? nextConfig) : nextProject.lastQualityResult ?? null;
    const readyProject = { ...nextProject, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION, records: nextRecords, lastODResult: nextODResult ?? undefined, lastRouteResult: nextRouteResult ?? undefined, lastQualityResult: nextQualityResult ?? undefined, qualityWarnings: nextQualityWarnings };
    if (classificationIsCurrent && nextProject.schemaVersion === CURRENT_PROJECT_SCHEMA_VERSION) setProject(readyProject);
    else await save({ ...readyProject, updatedAt: new Date().toISOString() });
    setConfig(nextConfig);
    setResult(nextProject.lastResult ?? analyzeRecords(nextRecords, nextConfig));
    setHourlyResult(nextHourlyResult);
    setStationResult(nextStationResult);
    setODResult(nextODResult);
    setRouteResult(nextRouteResult);
    setQualityResult(nextQualityResult);
    setStationMasterSourceRecords(nextMaster);
    setStationMasterRecords(nextMaster);
    setStationMasterSource(nextMasterSource);
    setStationMasterMapping(nextMasterMapping);
    setStationMasterWarnings(nextMasterWarnings);
    setStationMasterMergeWarnings([]);
    setStationMasterError(undefined);
    setRouteStopMasterRecords(nextRouteMaster);
    setRouteStopMasterSource(nextProject.routeStopMasterSource);
    setRouteStopMasterMapping(nextProject.routeStopMasterMapping ?? EMPTY_ROUTE_STOP_MASTER_MAPPING);
    setRouteStopMasterWarnings(nextProject.routeStopMasterWarnings ?? []);
    setRouteStopMasterError(undefined);
    setRouteServiceConfigs(nextRouteConfigs);
    setRouteConfig(nextRouteConfig);
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setSelectedRouteId(nextRouteResult?.summaries[0]?.routeId);
    setSelectedRouteDirection(nextRouteResult?.summaries[0]?.direction);
    setSelectedRouteSegmentKey(undefined);
    setDisplayUnits(nextDisplayUnits);
    setAnalysisMode(nextMode === 'hourly' && nextHourlyResult ? 'hourly' : nextMode === 'station' && nextStationResult ? 'station' : nextMode === 'od' && nextODResult ? 'od' : nextMode === 'route' && nextRouteResult ? 'route' : nextMode === 'quality' && nextQualityResult ? 'quality' : 'weekday');
    setView('report');
  }

  async function exportPng(): Promise<void> {
    if (!reportRef.current || !project) return;
    const canvas = await html2canvas(reportRef.current, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
    const anchor = document.createElement('a');
    anchor.download = `${projectTitle(project)}.png`;
    anchor.href = canvas.toDataURL('image/png');
    anchor.click();
  }

  function exportExcel(): void {
    if (!project || !result) return;
    if (analysisMode === 'quality' && qualityResult) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(buildDataQualitySheetRows(qualityResult)), '오류유형');
      XLSX.writeFile(book, `${projectTitle(project)}-오류유형.xlsx`);
      return;
    }
    if (analysisMode === 'route' && routeResult) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(buildRouteCongestionSheetRows(routeResult)), '노선혼잡도');
      XLSX.writeFile(book, `${projectTitle(project)}-노선혼잡도.xlsx`);
      return;
    }
    if (analysisMode === 'od' && odResult) {
      const metricLabel = aggregationLabel(project) === '통행량' ? '통행량' : '승차인원';
      const data = [...buildODDemandSheetRows(odView.rows, metricLabel, displayUnits.od), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜'], ['선택 기간 일수', odResult.selectedDays]];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), 'OD분석');
      XLSX.writeFile(book, `${projectTitle(project)}-OD분석.xlsx`);
      return;
    }
    if (analysisMode === 'station' && stationResult) {
      const metricLabel = aggregationLabel(project) === '통행량' ? '통행량' : '승차인원';
      const data = [...buildStationDemandSheetRows(stationView.rows, metricLabel, displayUnits.station), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜'], ['선택 기간 일수', stationResult.selectedDays]];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), '정류장수요');
      XLSX.writeFile(book, `${projectTitle(project)}-정류장수요.xlsx`);
      return;
    }
    if (analysisMode === 'hourly' && hourlyResult) {
      const metricLabel = aggregationLabel(project) === '통행량' ? '통행량' : '승차인원';
      const data = [...buildHourlySheetRows(hourlyResult, metricLabel, displayUnits.hourly), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜'], ['주중 관측일', hourlyResult.weekdayDays], ['주말 관측일', hourlyResult.weekendDays]];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), '시간대분석');
      XLSX.writeFile(book, `${projectTitle(project)}-시간대.xlsx`);
      return;
    }
    const rows = buildTableRows(result, aggregationLabel(project), displayUnits.weekday);
    const data = [['구분', ...WEEKDAYS], ...rows.map((row) => [row.label, ...row.values]), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜']];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), '요일분석');
    XLSX.writeFile(book, `${projectTitle(project)}.xlsx`);
  }

  async function removeProject(item: ProjectManifest): Promise<void> {
    if (window.transitDesktop) await window.transitDesktop.deleteProject(item.id);
    else await deleteBrowserProject(item.id);
    setProjects((current) => current.filter((candidate) => candidate.id !== item.id));
  }

  function renderHome(): JSX.Element {
    return <main className="home"><div className="hero"><div><p className="eyebrow">교통카드 분석</p><h1>교통카드 데이터를<br /><span>요일별 분석</span>으로 바꿔보세요</h1><p className="hero-copy">CSV, DAT, TXT, XLSX 파일을 불러오면<br />요일별 이용인원과 통행량을 한눈에 정리합니다.</p><button className="primary-button" onClick={startNewAnalysis}>새 분석 시작 <span>→</span></button></div><div className="hero-visual"><div className="mini-chart"><span style={{ height: '76%' }} /><span style={{ height: '70%' }} /><span style={{ height: '72%' }} /><span style={{ height: '70%' }} /><span style={{ height: '66%' }} /><span style={{ height: '55%' }} /><span style={{ height: '38%' }} /></div><div className="mini-table"><i /><i /><i /></div></div></div><section className="projects-section"><div className="section-heading"><div><p className="eyebrow">내 분석</p><h2>최근 분석 프로젝트</h2></div><div className="section-actions"><button className="secondary-button" onClick={() => void restoreProject()}>프로젝트 불러오기</button><button className="secondary-button" onClick={startNewAnalysis}>＋ 새 분석</button></div></div>{projects.length ? <div className="project-list">{projects.map((item) => <ProjectCard key={item.id} project={item} onOpen={() => openProject(item)} onDelete={async () => { if (window.confirm('이 프로젝트를 삭제할까요?')) await removeProject(item); }} />)}</div> : <div className="empty-state"><div className="empty-icon">＋</div><h3>아직 분석 프로젝트가 없습니다</h3><p>교통카드 파일을 올리고 첫 번째 요일 분석을 만들어보세요.</p></div>}</section></main>;
  }

  function renderImport(): JSX.Element {
    const coreMappingReady = Boolean(files.length && mapping.dateColumn && (mapping.rowSemantics === 'one-row-one-boarding' || mapping.boardingCountColumn));
    const isSuggested = (key: keyof ColumnMapping): boolean => Boolean(mappingSuggestions[key] && mappingSuggestions[key] === mapping[key]);
    const isRouteRouteSuggested = (key: keyof RouteStopMasterMapping): boolean => Boolean(routeStopMasterSuggestions[key] && routeStopMasterSuggestions[key] === routeStopMasterMapping[key]);

    return <main className="workspace">
      <div className="page-header">
        <div>
          <button className="back-button" onClick={() => setView('home')}>← 프로젝트 목록</button>
          <p className="eyebrow">새 분석</p>
          <h1>데이터 불러오기</h1>
          <p>거래내역과 정류장정보를 순서대로 확인하고, 자동 제안된 필드를 필요하면 수정하세요.</p>
        </div>
      </div>
      <nav className="import-stepper" aria-label="데이터 가져오기 단계">
        <button className={importStep === 'transaction' ? 'is-active' : 'is-complete'} onClick={() => setImportStep('transaction')}><strong>1-1</strong><span>교통카드 거래내역</span><small>파일·핵심 필드</small></button>
        <span className="import-stepper-line" />
        <button className={importStep === 'station' ? 'is-active' : importStep === 'route' ? 'is-complete' : ''} disabled={!files.length} onClick={continueToStationStep}><strong>1-2</strong><span>정류장정보</span><small>정류장 사전</small></button>
        <span className="import-stepper-line" />
        <button className={importStep === 'route' ? 'is-active' : ''} disabled={!files.length} onClick={continueToRouteStep}><strong>1-3</strong><span>노선별 정류장정보</span><small>경로·구간 매칭</small></button>
        <span className="import-stepper-line" />
        <div className="import-step is-disabled"><strong>2</strong><span>분석 실행</span><small>조건·결과</small></div>
      </nav>
      {importStep === 'transaction' ? <section className="import-grid">
        <div className="panel upload-panel">
          <h2>1-1 교통카드 거래내역</h2>
          <label className={'dropzone' + (isDragging ? ' is-dragging' : '')} onDragOver={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); setIsDragging(false); void selectFiles(event.dataTransfer.files); }}>
            <input type="file" multiple accept=".csv,.dat,.txt,.xlsx,.xls" onChange={(event) => void selectFiles(event.target.files)} />
            <span className="upload-icon">↑</span>
            <strong>{files.length ? files.length + '개 파일 선택됨' : '거래내역 파일을 클릭하거나 끌어오세요'}</strong>
            <small>CSV · DAT · TXT · XLSX · 여러 파일 가능</small>
          </label>
          <label className="header-toggle">
            <input type="checkbox" checked={hasHeaderRow} onChange={(event) => void updateHeaderMode(event.target.checked)} />
            <span><strong>첫 번째 행을 필드명으로 사용</strong><small>끄면 필드1, 필드2처럼 자동으로 이름을 만듭니다.</small></span>
          </label>
          {previews.length > 0 && <>
            <div className="file-list">{previews.map((preview) => <div className="file-row" key={preview.name}><span>▤</span><div><strong>{preview.name}</strong><small>{preview.headers.length}개 필드 · {preview.rows.length}개 미리보기 행</small></div><em>{preview.encoding.toUpperCase()}</em></div>)}</div>
            <div className="sample-heading"><strong>데이터 미리보기</strong><span>파일별 상위 10개 행</span></div>
            <div className="sample-list">{previews.map((preview, index) => <SamplePreview key={preview.name} preview={preview} open={index === 0} />)}</div>
          </>}
        </div>
        <div className="panel mapping-panel">
          <h2>1-1 필드 자동 제안·확인</h2>
          {!previews.length ? <div className="hint-box">거래내역 파일을 선택하면 데이터 구조를 확인해 분석 역할을 자동 제안합니다.</div> : <>
            <div className="auto-map-summary"><strong>자동 매핑 제안이 준비되었습니다.</strong><span>제안 기준: 의미 있는 헤더명 우선, 표준 28필드 위치 보완, 샘플 값 존재 여부 확인. 파란색 값은 모두 직접 수정할 수 있습니다.</span></div>
            <div className="mapping-group">
              <p className="mapping-group-title">핵심 필드</p>
              <MappingSelect label="날짜 또는 통합 일시" hint="요일과 분석 기간에 사용" required value={mapping.dateColumn ?? ''} options={headers} suggested={isSuggested('dateColumn')} onChange={(value) => updateMapping('dateColumn', value)} />
              <MappingSelect label="시간" hint="날짜와 분리된 시간 필드가 있을 때 선택" value={mapping.timeColumn ?? ''} options={headers} optional suggested={isSuggested('timeColumn')} onChange={(value) => updateMapping('timeColumn', value)} />
              <div className="field aggregation-field">
                <label>집계 방식</label>
                <div className="segmented aggregation-options">
                  <button className={mapping.rowSemantics === 'count-column' ? 'active' : ''} aria-pressed={mapping.rowSemantics === 'count-column'} onClick={() => setMapping({ ...mapping, rowSemantics: 'count-column' })}><strong>이용인원 합계</strong><small>승차인원 필드 값을 합산</small></button>
                  <button className={mapping.rowSemantics === 'one-row-one-boarding' ? 'active' : ''} aria-pressed={mapping.rowSemantics === 'one-row-one-boarding'} onClick={() => { setMapping({ ...mapping, rowSemantics: 'one-row-one-boarding', boardingCountColumn: undefined }); setMappingSuggestions((current) => { const next = { ...current }; delete next.boardingCountColumn; return next; }); }}><strong>통행량(행 수)</strong><small>각 행을 1건으로 집계</small></button>
                </div>
              </div>
              {mapping.rowSemantics === 'count-column' && <MappingSelect label="승차인원" hint="합산할 값이 있는 필드" required value={mapping.boardingCountColumn ?? ''} options={headers} suggested={isSuggested('boardingCountColumn')} onChange={(value) => updateMapping('boardingCountColumn', value)} />}
            </div>
            <div className="station-demand-link">
              <div className="mapping-group-title"><span>정류장·OD 수요를 분석할 때 필요한 연결</span><span>선택 사항</span></div>
              <MappingSelect label="승차 정류장 ID" hint="정류장정보의 ID와 정확히 일치시킬 값" value={mapping.stationIdColumn ?? ''} options={headers} optional suggested={isSuggested('stationIdColumn')} onChange={(value) => updateMapping('stationIdColumn', value)} />
              <MappingSelect label="하차 정류장 ID" hint="OD 도착지 흐름에 사용할 정류장 ID" value={mapping.destinationStationIdColumn ?? ''} options={headers} optional suggested={isSuggested('destinationStationIdColumn')} onChange={(value) => updateMapping('destinationStationIdColumn', value)} />
              <MappingSelect label="가상카드번호" hint="이미 비식별화된 값이며, 이후 Trip-Chain과 중복행 확인에 사용합니다." value={mapping.virtualCardIdColumn ?? ''} options={headers} optional suggested={isSuggested('virtualCardIdColumn')} onChange={(value) => updateMapping('virtualCardIdColumn', value)} />
              <MappingSelect label="트랜잭션 ID" hint="가상카드·노선·승하차 정류장 ID·환승건수와 함께 거래행 중복 확인 및 Trip-Chain에 사용합니다." value={mapping.transactionIdColumn ?? ''} options={headers} optional suggested={isSuggested('transactionIdColumn')} onChange={(value) => updateMapping('transactionIdColumn', value)} />
              <MappingSelect label="환승건수" hint="중복 거래행 확인과 이후 Trip-Chain 분석에 사용합니다." value={mapping.transferCountColumn ?? ''} options={headers} optional suggested={isSuggested('transferCountColumn')} onChange={(value) => updateMapping('transferCountColumn', value)} />
              <small className="mapping-help">완전 중복 확인은 가상카드번호·노선·승차/하차 정류장 ID·트랜잭션 ID·환승건수 6개 필드가 모두 연결되어 있을 때만 수행합니다.</small>
            </div>
            <div className="station-demand-link route-demand-link">
              <div className="mapping-group-title"><span>차내재차인원 분석에 필요한 연결</span><span>선택 사항</span></div>
              <MappingSelect label="차량 ID" hint="차량·시간대별 최대 차내재차인원 계산에 사용합니다. 없으면 운행횟수 기반 평균으로 추정합니다." value={mapping.vehicleIdColumn ?? ''} options={headers} optional suggested={isSuggested('vehicleIdColumn')} onChange={(value) => updateMapping('vehicleIdColumn', value)} />
            </div>
            <details className="optional-mapping" open={optionalMappingOpen} onToggle={(event) => setOptionalMappingOpen(event.currentTarget.open)}>
              <summary><strong>추가 분석 필드</strong><span>선택 사항 · 노선·지역 필터에 사용</span></summary>
              <div className="mapping-group optional-mapping-body">
                <MappingSelect label="노선" value={mapping.routeColumn ?? ''} options={headers} optional suggested={isSuggested('routeColumn')} onChange={(value) => updateMapping('routeColumn', value)} />
                <MappingSelect label="정류장/역" value={mapping.stationColumn ?? ''} options={headers} optional onChange={(value) => updateMapping('stationColumn', value)} />
                <MappingSelect label="지역" value={mapping.regionColumn ?? ''} options={headers} optional onChange={(value) => updateMapping('regionColumn', value)} />
              </div>
            </details>
            <div className="mapping-actions wizard-actions">
              <button className="secondary-button" disabled={!coreMappingReady} onClick={() => void importData()}>정류장정보 없이 기존 분석 실행</button>
              <button className="primary-button" disabled={!coreMappingReady} onClick={continueToStationStep}>다음: 정류장정보 연결 <span>→</span></button>
            </div>
            {importError && <div className="error-box" role="alert">⚠ {importError}</div>}
          </>}
        </div>
      </section> : importStep === 'station' ? <section className="import-grid">
        <div className="panel upload-panel">
          <h2>1-2 정류장정보</h2>
          <div className="step-intro"><strong>정류장 사전</strong><span>거래내역의 승차·하차 정류장 ID를 좌표와 명칭에 연결합니다. 노선별 정류장정보는 다음 단계에서 별도로 관리합니다.</span></div>
          <label className="dropzone station-master-dropzone">
            <input type="file" multiple accept=".csv,.dat,.txt,.xlsx,.xls" onChange={(event) => void selectStationMasterFiles(event.target.files)} />
            <span className="upload-icon">↑</span>
            <strong>{stationMasterFiles.length ? `${stationMasterFiles.length}개 정류장정보 파일 선택됨` : '정류장정보 파일을 클릭하거나 끌어오세요'}</strong>
            <small>CSV · DAT · TXT · XLSX · 여러 날짜 파일 가능</small>
          </label>
          <label className="header-toggle">
            <input type="checkbox" checked={stationMasterHasHeaderRow} onChange={(event) => void updateStationMasterHeaderMode(event.target.checked)} />
            <span><strong>첫 번째 행을 필드명으로 사용</strong><small>끄면 필드1, 필드2처럼 자동으로 이름을 만듭니다.</small></span>
          </label>
          {stationMasterPreviews.length > 0 && <>
            <div className="file-list">{stationMasterPreviews.map((preview) => <div className="file-row" key={preview.name}><span>▤</span><div><strong>{preview.name}</strong><small>{preview.headers.length}개 필드 · {preview.rows.length}개 미리보기 행</small></div><em>{preview.encoding.toUpperCase()}</em></div>)}</div>
            <div className="sample-heading"><strong>데이터 미리보기</strong><span>파일별 상위 10개 행</span></div>
            <div className="sample-list">{stationMasterPreviews.map((preview, index) => <SamplePreview key={preview.name} preview={preview} open={index === 0} />)}</div>
          </>}
        </div>
        <div className="panel mapping-panel">
          <h2>1-2 정류장정보 필드 매핑</h2>
          {!stationMasterPreviews.length ? <>
            <div className="hint-box">정류장정보 파일을 선택하면 정류장 ID·명칭·위도·경도 필드를 자동 제안합니다.</div>
            <div className="warning-box">정류장정보 없이도 기존 요일별·시간대별 분석은 실행할 수 있습니다. 정류장 수요 지도·표가 필요하면 파일을 선택하세요.</div>
          </> : <>
            <div className="auto-map-summary"><strong>정류장정보 매핑을 확인하세요.</strong><span>제안 기준: 표준 헤더명 우선, 헤더 없는 14필드 위치 보완, 값이 비어 있지 않은지 확인. 표준 형식은 ID(필드4), 명칭(필드5), 위도(필드7), 경도(필드8)입니다.</span></div>
            <div className="station-master-input station-master-input-step">
              <p>현재 파일들: <strong>{stationMasterSource}</strong> · <strong>{stationMasterRecords.length.toLocaleString('ko-KR')}개</strong> 병합 후 유효 정류장</p>
              <MappingSelect label="정류장 ID" hint="거래내역의 승차·하차 정류장 ID와 일치시킬 값" required value={stationMasterMapping.stationIdColumn ?? ''} options={stationMasterPreviews[0].headers} onChange={(value) => updateStationMasterMapping('stationIdColumn', value)} />
              <MappingSelect label="정류장 명칭" required value={stationMasterMapping.stationNameColumn ?? ''} options={stationMasterPreviews[0].headers} onChange={(value) => updateStationMasterMapping('stationNameColumn', value)} />
              <MappingSelect label="위도" hint="십진수 위도" required value={stationMasterMapping.latitudeColumn ?? ''} options={stationMasterPreviews[0].headers} onChange={(value) => updateStationMasterMapping('latitudeColumn', value)} />
              <MappingSelect label="경도" required value={stationMasterMapping.longitudeColumn ?? ''} options={stationMasterPreviews[0].headers} onChange={(value) => updateStationMasterMapping('longitudeColumn', value)} />
            </div>
            {stationMasterWarnings.map((warning, index) => <div className="warning-box" key={`${warning}-${index}`}>⚠ {warning}</div>)}
            {stationMasterMergeWarnings.map((warning, index) => <div className="warning-box" key={`merge-${warning}-${index}`}>⚠ {warning}</div>)}
            {stationMasterError && <div className="error-box" role="alert">⚠ {stationMasterError}</div>}
            {!mapping.stationIdColumn && <div className="warning-box">⚠ 거래내역의 승차 정류장 ID를 먼저 연결해야 정류장 수요 분석을 실행할 수 있습니다.</div>}
            {mapping.stationIdColumn && !mapping.destinationStationIdColumn && <div className="hint-box">OD 분석을 사용하려면 거래내역 화면에서 하차 정류장 ID도 연결하세요. 기존 정류장 수요 분석은 계속 사용할 수 있습니다.</div>}
            {stationMasterRecords.length > 0 && mapping.stationIdColumn && <div className="match-summary"><strong>연결 준비 완료</strong><span>{stationMasterRecords.length.toLocaleString('ko-KR')}개 정류장 사전을 읽었습니다. 분석 실행 시 거래내역 ID와 정확히 일치시킵니다.</span></div>}
          </>}
          <div className="step-next-card"><strong>노선 혼잡도 분석이 필요하신가요?</strong><span>노선 ID·정류장 순번·운행 기준은 별도 단계에서 입력해 노선 구간 분석에 사용합니다.</span><button className="secondary-button" onClick={continueToRouteStep}>노선별 정류장정보 입력 →</button></div>
          <div className="mapping-actions wizard-actions">
            <button className="secondary-button" onClick={() => setImportStep('transaction')}>← 거래내역으로 돌아가기</button>
            <button className="secondary-button" disabled={!coreMappingReady || !stationMasterRecords.length} onClick={() => void importData()}>정류장정보만으로 분석</button>
            <button className="primary-button" onClick={continueToRouteStep}>다음: 노선별 정류장정보 <span>→</span></button>
          </div>
          <button className="text-button legacy-import-link" disabled={!coreMappingReady} onClick={() => void importData()}>정류장정보 없이 기존 분석 실행</button>
          {importError && <div className="error-box" role="alert">⚠ {importError}</div>}
        </div>
      </section> : <section className="import-grid">
        <div className="panel upload-panel">
          <h2>1-3 노선별 정류장정보</h2>
          <div className="step-intro"><strong>노선 경로 사전</strong><span>노선번호와 노선 ID를 분리해 관리하고, 정류장 순번으로 구간 경로를 구성합니다. 공유한 14필드 DAT 형식을 자동 인식합니다.</span></div>
          {stationMasterRecords.length > 0 && <div className="match-summary"><strong>정류장 사전 연결됨</strong><span>{stationMasterSource} · {stationMasterRecords.length.toLocaleString('ko-KR')}개 정류장. 노선 분석은 이 단계의 노선 경로 사전과 함께 사용할 수 있습니다.</span></div>}
          <label className="dropzone station-master-dropzone route-master-dropzone">
            <input type="file" multiple accept=".csv,.dat,.txt,.xlsx,.xls" onChange={(event) => void selectRouteStopMasterFiles(event.target.files)} />
            <span className="upload-icon">↑</span>
            <strong>{routeStopMasterFiles.length ? `${routeStopMasterFiles.length}개 노선별 정류장정보 파일 선택됨` : '노선별 정류장정보 파일을 클릭하거나 끌어오세요'}</strong>
            <small>공유한 14필드 DAT 형식 · 여러 날짜 파일 가능</small>
          </label>
          <label className="header-toggle">
            <input type="checkbox" checked={routeStopMasterHasHeaderRow} onChange={(event) => void updateRouteStopMasterHeaderMode(event.target.checked)} />
            <span><strong>첫 번째 행을 필드명으로 사용</strong><small>끄면 필드1, 필드2처럼 자동으로 이름을 만듭니다.</small></span>
          </label>
          {routeStopMasterPreviews.length > 0 && <>
            <div className="file-list">{routeStopMasterPreviews.map((preview) => <div className="file-row" key={preview.name}><span>▤</span><div><strong>{preview.name}</strong><small>{preview.headers.length}개 필드 · {preview.rows.length}개 미리보기 행</small></div><em>{preview.encoding.toUpperCase()}</em></div>)}</div>
            <div className="sample-heading"><strong>데이터 미리보기</strong><span>파일별 상위 10개 행</span></div>
            <div className="sample-list">{routeStopMasterPreviews.map((preview, index) => <SamplePreview key={preview.name} preview={preview} open={index === 0} />)}</div>
          </>}
        </div>
        <div className="panel mapping-panel">
          <h2>1-3 노선별 정류장정보 필드 매핑</h2>
          {!routeStopMasterPreviews.length ? <>
            <div className="hint-box">노선별 정류장정보 파일을 선택하면 공유한 14개 필드 위치를 자동 제안합니다.</div>
            <div className="warning-box">노선 혼잡도 분석에는 노선 ID·정류장 순번·승차·하차·시간 필드가 모두 필요합니다.</div>
          </> : <>
            <div className="auto-map-summary"><strong>{routeStopMasterSource} · {routeStopMasterRecords.length.toLocaleString('ko-KR')}개 유효 정류장</strong><span>필수: 노선 ID, 노선명, 교통수단, 정류장 순번·ID·명칭, 위도·경도. 운행일자가 있으면 거래일 경로를 우선 사용합니다.</span></div>
            <div className="mapping-group">
              <MappingSelect label="운행일자" hint="날짜가 없으면 정적 경로로 재사용" value={routeStopMasterMapping.serviceDateColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('serviceDateColumn')} onChange={(value) => updateRouteStopMasterMapping('serviceDateColumn', value)} />
              <MappingSelect label="노선 ID" required value={routeStopMasterMapping.routeIdColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('routeIdColumn')} onChange={(value) => updateRouteStopMasterMapping('routeIdColumn', value)} />
              <MappingSelect label="노선 명칭" required value={routeStopMasterMapping.routeNameColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('routeNameColumn')} onChange={(value) => updateRouteStopMasterMapping('routeNameColumn', value)} />
              <MappingSelect label="교통수단구분" required value={routeStopMasterMapping.transportModeColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('transportModeColumn')} onChange={(value) => updateRouteStopMasterMapping('transportModeColumn', value)} />
              <MappingSelect label="정류장 순번" required value={routeStopMasterMapping.stationSequenceColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('stationSequenceColumn')} onChange={(value) => updateRouteStopMasterMapping('stationSequenceColumn', value)} />
              <MappingSelect label="정류장 ID" required value={routeStopMasterMapping.stationIdColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('stationIdColumn')} onChange={(value) => updateRouteStopMasterMapping('stationIdColumn', value)} />
              <MappingSelect label="정류장 명칭" required value={routeStopMasterMapping.stationNameColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('stationNameColumn')} onChange={(value) => updateRouteStopMasterMapping('stationNameColumn', value)} />
              <MappingSelect label="위도(X)" required value={routeStopMasterMapping.latitudeColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('latitudeColumn')} onChange={(value) => updateRouteStopMasterMapping('latitudeColumn', value)} />
              <MappingSelect label="경도(Y)" required value={routeStopMasterMapping.longitudeColumn ?? ''} options={routeStopMasterPreviews[0].headers} suggested={isRouteRouteSuggested('longitudeColumn')} onChange={(value) => updateRouteStopMasterMapping('longitudeColumn', value)} />
            </div>
            <details className="optional-mapping" open={false}>
              <summary><strong>추가 필드</strong><span>선택 사항</span></summary>
              <div className="mapping-group optional-mapping-body">
                <MappingSelect label="정산사 ID" value={routeStopMasterMapping.settlementCompanyIdColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('settlementCompanyIdColumn')} onChange={(value) => updateRouteStopMasterMapping('settlementCompanyIdColumn', value)} />
                <MappingSelect label="정산 지역 코드" value={routeStopMasterMapping.settlementRegionCodeColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('settlementRegionCodeColumn')} onChange={(value) => updateRouteStopMasterMapping('settlementRegionCodeColumn', value)} />
                <MappingSelect label="ARS번호" value={routeStopMasterMapping.arsNumberColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('arsNumberColumn')} onChange={(value) => updateRouteStopMasterMapping('arsNumberColumn', value)} />
                <MappingSelect label="노선 누적 거리" value={routeStopMasterMapping.cumulativeDistanceColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('cumulativeDistanceColumn')} onChange={(value) => updateRouteStopMasterMapping('cumulativeDistanceColumn', value)} />
                <MappingSelect label="정류장 거리" value={routeStopMasterMapping.stationDistanceColumn ?? ''} options={routeStopMasterPreviews[0].headers} optional suggested={isRouteRouteSuggested('stationDistanceColumn')} onChange={(value) => updateRouteStopMasterMapping('stationDistanceColumn', value)} />
              </div>
            </details>
            {routeStopMasterWarnings.map((warning, index) => { const informational = warning.startsWith('안내:'); return <div className={informational ? 'info-box' : 'warning-box'} key={`${warning}-${index}`}>{informational ? 'ℹ' : '⚠'} {informational ? warning.slice(3).trim() : warning}</div>; })}
            {routeStopMasterError && <div className="error-box" role="alert">⚠ {routeStopMasterError}</div>}
          </>}
          <div className="mapping-actions wizard-actions">
            <button className="secondary-button" onClick={() => setImportStep('station')}>← 정류장정보로 돌아가기</button>
            <button className="primary-button" disabled={!coreMappingReady || !routeStopMasterRecords.length} onClick={() => void importData()}>이 설정으로 분석하기 <span>→</span></button>
          </div>
          {importError && <div className="error-box" role="alert">⚠ {importError}</div>}
        </div>
      </section>}
    </main>;
  }

  function renderReport(): JSX.Element {
    const isHourly = analysisMode === 'hourly';
    const isStation = analysisMode === 'station';
    const isOD = analysisMode === 'od';
    const isRoute = analysisMode === 'route';
    const isQuality = analysisMode === 'quality';
    const isWeekday = !isHourly && !isStation && !isOD && !isRoute && !isQuality;
    if (!project || !result || (isHourly && !hourlyResult) || (isStation && !stationResult) || (isOD && !odResult) || (isRoute && !routeResult) || (isQuality && !qualityResult)) return <div className="loading">분석 결과를 준비하고 있습니다.</div>;
    const metricLabel = aggregationLabel(project);
    const hourlyMetricLabel = metricLabel === '통행량' ? '통행량' : '승차인원';
    const displayUnit = metricLabel === '통행량' || isQuality ? 'raw' : displayUnits[analysisMode];
    const metricUnit = isQuality ? '거래행 · 이용인원' : isRoute ? '혼잡도(%)' : isStation || isOD ? (metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '인/일') : isHourly ? (metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '명/일') : metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '명/일';
    const valueUnit = metricLabel === '통행량' ? '건' : '명';
    const stationWarnings = [...stationMasterWarnings, ...stationMasterMergeWarnings, ...stationView.warnings];
    const odWarnings = [...stationMasterWarnings, ...stationMasterMergeWarnings, ...odView.warnings];
    const routeWarnings = [...routeStopMasterWarnings, ...(routeResult?.warnings ?? [])];
    const qualityReferenceWarnings = isQuality && usesRouteStopStationFallback(stationMasterSource, stationMasterSourceRecords.length)
      ? ['별도 정류장정보가 없어 노선정류장정보의 정류장 목록을 승·하차 매칭 기준으로 사용합니다.']
      : [];
    const warnings = isQuality ? [...new Set([...qualityResult!.warnings, ...qualityWarningsForProject(project), ...qualityReferenceWarnings])] : isRoute ? [...new Set(routeWarnings)] : isStation ? [...new Set([...stationResult!.warnings, ...stationWarnings])] : isOD ? [...new Set([...odResult!.warnings, ...odWarnings])] : isHourly ? hourlyResult!.warnings : result.warnings;
    const stationTitle = metricLabel === '통행량' ? '정류장별 일평균 통행량' : '정류장별 일평균 승차인원';
    const odTitle = metricLabel === '통행량' ? 'OD별 일평균 통행량' : 'OD별 일평균 승차인원';
    const reportEyebrow: Record<AnalysisMode, string> = {
      weekday: '요일별 집계',
      hourly: '시간대 집계',
      station: '정류장 수요 집계',
      od: 'OD 수요 집계',
      route: '노선 구간 혼잡도 집계',
      quality: '교통카드 데이터 품질 집계'
    };
    const reportHeading: Record<AnalysisMode, string> = {
      weekday: buildSummary(result, metricLabel),
      hourly: `주중·주말 ${hourlyMetricLabel} 시간대 분석`,
      station: stationTitle,
      od: odTitle,
      route: '노선별 차내재차인원·혼잡도',
      quality: '오류 유형별 거래행·이용인원'
    };
    const activeRouteId = isRoute ? selectedRouteId ?? routeResult!.summaries[0]?.routeId : undefined;
    const activeRouteDirections = isRoute && routeResult ? routeResult.summaries.filter((summary) => summary.routeId === activeRouteId) : [];
    const activeRouteDirection = isRoute ? selectedRouteDirection ?? activeRouteDirections[0]?.direction : undefined;
    const activeRouteMetrics = isRoute && routeResult ? routeResult.metrics.filter((metric) => metric.routeId === activeRouteId && metric.direction === activeRouteDirection) : [];
    const activeFilter = isRoute ? routeConfig.filter : config.filter;
    const activeDenominator = isRoute ? routeConfig.denominator : config.denominator;
    const updateReportFilter = (nextFilter: AnalysisConfig['filter']): void => {
      setConfig({ ...config, filter: nextFilter });
      if (isRoute) setRouteConfig({ ...routeConfig, filter: nextFilter });
    };

    return <main className="workspace report-workspace">
      <div className="page-header report-header">
        <div>
          <button className="back-button" onClick={() => setView('home')}>← 프로젝트 목록</button>
          <p className="eyebrow">분석 결과</p>
          <h1>{projectTitle(project)}</h1>
          <p>{activeFilter.from} ~ {activeFilter.to} · {isQuality ? '유효 날짜·이용인원의 오류 유형별 누계' : isRoute ? '선택 기간의 차량·시간대별 최대 차내재차인원' : activeDenominator === 'observed' ? '실제 관측일 기준' : '전체 날짜 기준'} · 원본: {project.sourceFiles.join(', ')}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportProject(project) : undefined)}>프로젝트 백업</button>
          <button className="secondary-button" onClick={exportExcel}>엑셀</button>
          <button className="secondary-button" onClick={exportPng}>PNG</button>
          <button className="primary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportPdf() : window.print())}>PDF</button>
        </div>
      </div>
      <div className="analysis-mode" role="tablist" aria-label="분석 모드">
        <button className={isWeekday ? 'active' : ''} role="tab" aria-selected={isWeekday} onClick={() => void selectAnalysisMode('weekday')}>요일별 분석</button>
        <button className={isHourly ? 'active' : ''} role="tab" aria-selected={isHourly} disabled={!hasHourlyData} title={!hasHourlyData ? '시간 정보가 있는 파일을 가져오세요.' : undefined} onClick={() => void selectAnalysisMode('hourly')}>시간대 분석</button>
        <button className={isStation ? 'active' : ''} role="tab" aria-selected={isStation} disabled={!hasStationDemand} title={!hasStationDemand ? '교통카드 데이터와 정류장 정보 파일을 모두 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('station')}>정류장 수요</button>
        <button className={isOD ? 'active' : ''} role="tab" aria-selected={isOD} disabled={!hasODDemand} title={!hasODDemand ? '승차·하차 정류장 ID와 정류장 정보 파일을 모두 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('od')}>OD 흐름</button>
        <button className={isRoute ? 'active' : ''} role="tab" aria-selected={isRoute} disabled={!hasRouteData} title={!hasRouteData ? '노선별 정류장정보와 승·하차·시간 필드를 모두 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('route')}>노선 혼잡도</button>
        <button className={isQuality ? 'active' : ''} role="tab" aria-selected={isQuality} disabled={!hasQualityData} title={!hasQualityData ? '노선별 정류장정보를 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('quality')}>오류유형 집계</button>
      </div>
      {!hasHourlyData && <p className="analysis-mode-note">시간 정보가 없어 시간대 분석은 사용할 수 없습니다. 요일별 분석은 기존처럼 사용할 수 있습니다.</p>}
      {!hasStationData && <p className="analysis-mode-note">정류장 ID가 없어 정류장 수요 분석은 사용할 수 없습니다. 가져오기 화면에서 정류장 ID 필드를 연결하세요.</p>}
      {hasStationData && !stationMasterRecords.length && <p className="analysis-mode-note">정류장 정보 파일이 없어 정류장 수요 분석은 사용할 수 없습니다. 새 분석에서 정류장 정보 파일을 함께 불러오세요.</p>}
      {!hasODData && <p className="analysis-mode-note">승차·하차 정류장 ID가 모두 있는 행이 없어 OD 흐름 분석은 사용할 수 없습니다. 가져오기 화면에서 두 필드를 연결하세요.</p>}
      {!hasRouteData && <p className="analysis-mode-note">노선 혼잡도는 노선·승차·하차·시간 필드와 노선별 정류장정보가 모두 필요합니다.</p>}
      {!hasQualityData && <p className="analysis-mode-note">오류유형 집계는 노선별 정류장정보가 필요합니다. 승·하차 ID 매칭에는 노선정보와 정류장정보의 정류장 목록을 함께 사용합니다.</p>}
      <div className="report-layout">
        <aside className="panel filters">
          <h2>분석 조건</h2>
          <div className="field"><label>시작일</label><input type="date" value={isRoute ? routeConfig.filter.from : config.filter.from} onChange={(event) => updateReportFilter({ ...(isRoute ? routeConfig.filter : config.filter), from: event.target.value })} /></div>
          <div className="field"><label>종료일</label><input type="date" value={isRoute ? routeConfig.filter.to : config.filter.to} onChange={(event) => updateReportFilter({ ...(isRoute ? routeConfig.filter : config.filter), to: event.target.value })} /></div>
          <FilterSelect label="노선" value={(isRoute ? routeConfig.filter.route : config.filter.route) ?? ''} options={dimensionValues.route} onChange={(value) => updateReportFilter({ ...(isRoute ? routeConfig.filter : config.filter), route: value || undefined })} />
          {!isQuality && <FilterSelect label="정류장/역" value={(isRoute ? routeConfig.filter.station : config.filter.station) ?? ''} options={dimensionValues.station} onChange={(value) => updateReportFilter({ ...(isRoute ? routeConfig.filter : config.filter), station: value || undefined })} />}
          {!isQuality && <FilterSelect label="지역" value={(isRoute ? routeConfig.filter.region : config.filter.region) ?? ''} options={dimensionValues.region} onChange={(value) => updateReportFilter({ ...(isRoute ? routeConfig.filter : config.filter), region: value || undefined })} />}
          {isRoute && <div className="field"><label>시간대</label><select value={String(routeConfig.hour)} onChange={(event) => setRouteConfig({ ...routeConfig, hour: event.target.value === 'all' ? 'all' : Number(event.target.value) as HourIndex })}><option value="all">전체 시간대</option>{HOURS.map((hour) => <option key={hour} value={hour}>{hour}시</option>)}</select></div>}
          {!isRoute && !isQuality && <div className="field">
            <label>평균 계산 기준</label>
            <label className="radio-line"><input type="radio" checked={activeDenominator === 'observed'} onChange={() => setConfig({ ...config, denominator: 'observed' })} /> 실제 관측일</label>
            <label className="radio-line"><input type="radio" checked={activeDenominator === 'calendar'} onChange={() => setConfig({ ...config, denominator: 'calendar' })} /> 전체 날짜</label>
          </div>}
          <button className="primary-button full" onClick={() => void selectAnalysisMode(analysisMode)}>조건 적용하기</button>
        </aside>
        <section className="report-area" ref={reportRef}>
          <div className="report-title">
            <div>
              <p className="eyebrow">{reportEyebrow[analysisMode]}</p>
              <h2>{reportHeading[analysisMode]}</h2>
            </div>
            {!isQuality && <div className="report-unit-control">
              <span>단위: {metricUnit}</span>
              {metricLabel !== '통행량' && <label className="unit-toggle"><input type="checkbox" checked={displayUnit === 'thousand'} onChange={(event) => void updateDisplayUnit(event.target.checked ? 'thousand' : 'raw')} /><span>천 명 단위로 표시</span></label>}
            </div>}
          </div>
          <details className="data-usage-guide">
            <summary>분석별 데이터 활용 기준 보기</summary>
            <div className="data-usage-table-scroll"><table className="data-usage-table"><thead><tr><th>분석</th><th>영향이 있는 오류 유형</th><th>그 외 적용 기준</th></tr></thead><tbody>{ANALYSIS_DATA_USAGE.map((entry) => <tr key={entry.mode} className={entry.mode === analysisMode ? 'is-current' : ''}><th>{entry.label}</th><td>{entry.errorTypes.length ? <div className="data-usage-errors">{entry.errorTypes.map((error) => <span className="data-usage-error" key={error.type}><strong>{error.type}</strong><small>{error.effect}</small></span>)}</div> : '오류 유형에 따른 제외 없음'}</td><td>{entry.rule}</td></tr>)}</tbody></table></div>
          </details>
          {isQuality ? <>
            <div className="station-summary quality-summary">대상 <strong>{qualityResult!.totalTransactions.toLocaleString('ko-KR')}개 거래행</strong> · 이용인원 <strong>{qualityResult!.totalBoardings.toLocaleString('ko-KR')}명</strong> · 중복을 제외한 전체 오류 거래 <strong>{qualityResult!.uniqueErrorTransactions.toLocaleString('ko-KR')}개 / {qualityResult!.uniqueErrorBoardings.toLocaleString('ko-KR')}명</strong> · 유형별 집계는 한 행이 여러 유형에 중복 포함될 수 있습니다.</div>
            <div className="table-card quality-table-card"><div className="station-table-heading"><strong>오류 유형별 집계</strong><span>행 수는 거래 레코드 수, 이용인원은 정규화된 승차인원 합계입니다.</span></div><div className="quality-table-scroll"><table className="quality-table"><thead><tr><th>오류 유형</th><th>거래행 수</th><th>이용인원 합계</th></tr></thead><tbody><tr className="quality-total-row"><th>전체 오류 거래(중복 제외)</th><td>{qualityResult!.uniqueErrorTransactions.toLocaleString('ko-KR')}</td><td>{qualityResult!.uniqueErrorBoardings.toLocaleString('ko-KR')}</td></tr>{qualityResult!.metrics.map((metric) => <tr key={metric.type}><th>{metric.type}</th><td>{metric.transactionCount.toLocaleString('ko-KR')}</td><td>{metric.boardingCount.toLocaleString('ko-KR')}</td></tr>)}</tbody></table></div></div>
          </> : isRoute ? <>
            <div className="route-service-card">
              <div className="station-table-heading"><strong>노선별 운행 기준</strong><span>차량 정원은 혼잡도 기준, 운행횟수는 차량 ID가 없을 때 평균 재차인원 추정에 사용됩니다.</span></div>
              <div className="route-service-bulk"><div><strong>운행횟수 일괄 입력</strong><span>입력한 값을 모든 노선의 0~23시 운행횟수에 적용합니다. 기존 운행횟수는 덮어씁니다.</span></div><div className="route-service-bulk-controls"><label>시간당 운행횟수<input aria-label="일괄 운행횟수" aria-invalid={bulkTripsInput !== '' && (!Number.isInteger(Number(bulkTripsInput)) || Number(bulkTripsInput) < 0)} type="number" min="0" step="1" value={bulkTripsInput} onChange={(event) => setBulkTripsInput(event.target.value)} /></label><button className="secondary-button" disabled={!routeMasterOptions.length || !bulkTripsInput.trim() || !Number.isInteger(Number(bulkTripsInput)) || Number(bulkTripsInput) < 0} onClick={applyBulkRouteTrips}>전체 시간대에 적용</button></div></div>
              <div className="route-service-scroll"><table className="route-service-table"><thead><tr><th>노선번호</th><th>노선 ID</th><th>차량 정원</th>{HOURS.map((hour) => <th key={hour}>{hour}시</th>)}</tr></thead><tbody>{routeMasterOptions.map((option) => { const service = routeServiceConfigs.find((candidate) => candidate.routeId === option.routeId) ?? { routeId: option.routeId, vehicleCapacity: 0, tripsByHour: {} }; const capacityInvalid = !Number.isInteger(service.vehicleCapacity) || service.vehicleCapacity < 1; return <tr key={option.routeId}><th>{option.routeName}</th><td className="route-id-cell">{option.routeId}</td><td><input aria-label={`${option.routeId} 차량 정원`} aria-invalid={capacityInvalid} type="number" min="1" step="1" value={service.vehicleCapacity || ''} onChange={(event) => updateRouteServiceConfig(option.routeId, 'vehicleCapacity', Number(event.target.value))} /></td>{HOURS.map((hour) => { const trips = service.tripsByHour[String(hour)] ?? 0; return <td key={hour}><input aria-label={`${option.routeId} ${hour}시 운행횟수`} aria-invalid={!Number.isInteger(trips) || trips < 0} type="number" min="0" step="1" value={service.tripsByHour[String(hour)] ?? ''} onChange={(event) => updateRouteServiceConfig(option.routeId, hour, Number(event.target.value))} /></td>; })}</tr>; })}</tbody></table></div>
            </div>
            <div className="station-summary route-summary">선택 기간의 <strong>{new Set(routeResult!.summaries.map((summary) => summary.routeId)).size.toLocaleString('ko-KR')}개 노선</strong> · 방향별 최대 정류장 <strong>{routeResult!.summaries.length.toLocaleString('ko-KR')}개</strong> · 관측일 <strong>{routeResult!.selectedDays}일</strong> · {routeResult!.loadBasis === 'vehicle' ? '차량·시간대별 최대 재차인원' : routeResult!.loadBasis === 'mixed' ? '차량 단위·평균 추정 혼합 최대 재차인원' : '운행횟수 기반 평균 재차인원 추정치'}입니다.</div>
            <div className="table-card route-summary-card"><div className="station-table-heading"><strong>노선별 최대 차내재차인원</strong><span>행을 누르면 노선과 방향별 도면을 표시합니다.</span></div><RouteSummaryTable rows={routeResult!.summaries} selectedRouteId={activeRouteId} selectedDirection={activeRouteDirection} onSelectRoute={selectRoute} /></div>
            <div className="route-detail-heading"><div><strong>{routeMasterOptions.find((option) => option.routeId === activeRouteId)?.routeName ?? activeRouteId ?? '선택 노선'} 상세 도면</strong><span>노선 ID: {activeRouteId ?? '—'} · 방향: {activeRouteDirections.find((summary) => summary.direction === activeRouteDirection)?.directionLabel ?? '—'} · {routeConfig.hour === 'all' ? '전체 시간대' : `${routeConfig.hour}시`} · 정류장별 누적 수치를 표시합니다.</span></div><div className="route-detail-selects"><select aria-label="상세 도면 노선" value={activeRouteId ?? ''} onChange={(event) => selectRoute(event.target.value)}>{routeMasterOptions.map((option) => <option key={option.routeId} value={option.routeId}>{option.routeName} · ID {option.routeId}</option>)}</select><select aria-label="상세 도면 방향" value={activeRouteDirection ?? ''} onChange={(event) => setSelectedRouteDirection(event.target.value as RouteDirection)}>{activeRouteDirections.map((summary) => <option key={summary.direction} value={summary.direction}>{summary.directionLabel}</option>)}</select></div></div>
            <div className="route-report-grid"><div className="station-map-card"><RouteCongestionMap metrics={activeRouteMetrics} selectedSegmentKey={selectedRouteSegmentKey} onSelectSegment={selectRouteSegment} /></div><div className="table-card station-table-card"><div className="station-table-heading"><strong>정류장별 차내재차인원·누적 산출</strong><span>이전 재차인원 + 승차 - 하차 = 현재 재차인원입니다.</span></div><RouteCongestionTable metrics={activeRouteMetrics} selectedSegmentKey={selectedRouteSegmentKey} onSelectSegment={selectRouteSegment} /></div></div>
          </> : isOD ? <><div className="station-summary od-summary">선택 조건의 <strong>{odView.rows.length.toLocaleString('ko-KR')}개 OD 흐름</strong> · 공통 분모 <strong>{odResult!.selectedDays}일</strong> · 모든 흐름 표시 · 화살표는 하차 방향을 나타냅니다.{(odView.unmatchedOriginCount + odView.unmatchedDestinationCount) > 0 && <> · 좌표 미매칭 <strong>{odView.unmatchedOriginCount + odView.unmatchedDestinationCount}건</strong></>}</div><div className="od-report-grid"><div className="station-map-card"><ODDemandMap rows={odView.rows} metricLabel={metricLabel} displayUnit={displayUnit} selectedFlowKey={selectedODKey} onSelectFlow={selectODFlow} /></div><div className="table-card station-table-card"><div className="station-table-heading"><strong>{odTitle}</strong><span>열 제목을 누르면 정렬하고, 행을 누르면 지도 흐름을 강조합니다.</span></div><ODDemandTable rows={odView.rows} metricLabel={metricLabel} displayUnit={displayUnit} selectedFlowKey={selectedODKey} onSelectFlow={selectODFlow} /></div></div></> : isStation ? <><div className="station-summary">선택 조건의 <strong>{stationView.rows.length.toLocaleString('ko-KR')}개 정류장</strong> · 공통 분모 <strong>{stationResult!.selectedDays}일</strong> · 정류장 사전 <strong>{stationMasterSource}</strong>{stationResult!.unmatchedStationCount > 0 && <> · 사전 미등록 <strong>{stationResult!.unmatchedStationCount}개</strong></>}</div><div className="station-report-grid"><div className="station-map-card"><StationDemandMap rows={stationView.rows} displayUnit={displayUnit} selectedStationId={selectedStationId} onSelectStation={selectStation} /></div><div className="table-card station-table-card"><div className="station-table-heading"><strong>정류장별 수요</strong><span>열 제목을 누르면 정렬합니다.</span></div><StationDemandTable rows={stationView.rows} metricLabel={metricLabel === '통행량' ? '통행량' : '승차인원'} displayUnit={displayUnit} selectedStationId={selectedStationId} onSelectStation={selectStation} /></div></div></> : <><div className={'chart-card' + (isHourly ? ' hourly-chart-card' : '')}>{isHourly ? <HourlyChart result={hourlyResult!} metricLabel={hourlyMetricLabel} metricUnit={metricUnit} displayUnit={displayUnit} /> : <Chart result={result} metricLabel={metricLabel} metricUnit={metricUnit} valueUnit={valueUnit} displayUnit={displayUnit} />}</div>{isHourly ? <div className="hourly-summary">주중 관측일 <strong>{hourlyResult!.weekdayDays}일</strong> · 주말 관측일 <strong>{hourlyResult!.weekendDays}일</strong></div> : <div className="report-callout">선택한 조건의 하루 평균 {metricLabel}은 <strong>{formatPeople(result.overallAverage)}{valueUnit}</strong>입니다.</div>}<div className={'table-card' + (isHourly ? ' hourly-table-card' : '')}><div className={isHourly ? 'table-scroll hourly-table-scroll' : 'table-scroll'}><table><thead><tr><th>구분</th>{(isHourly ? HOURS.map((hour) => hour + '시') : WEEKDAYS).map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{(isHourly ? buildHourlyTableRows(hourlyResult!, hourlyMetricLabel, displayUnit) : buildTableRows(result, metricLabel, displayUnit)).map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={row.label + '-' + index}>{value}</td>)}</tr>)}</tbody></table></div></div></>}
          {warnings.map((warning, index) => { const informational = warning.startsWith('안내:'); return <div className={informational ? 'info-box' : 'warning-box'} key={`${warning}-${index}`} role={informational ? 'status' : 'alert'}>{informational ? 'ℹ' : '⚠'} {informational ? warning.slice(3).trim() : warning}</div>; })}
        </section>
      </div>
    </main>;
  }

    return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => setView('home')}><span className="brand-mark">↗</span> 교통카드 분석</button><span className="offline-badge">● 로컬 모드</span></header>{view === 'home' ? renderHome() : view === 'import' ? renderImport() : renderReport()}</div>;
}

function MappingSelect({ label, hint, value, options, optional, required, suggested, onChange }: { label: string; hint?: string; value: string; options: string[]; optional?: boolean; required?: boolean; suggested?: boolean; onChange: (value: string) => void }): JSX.Element {
  return <div className={'mapping-row' + (suggested ? ' is-suggested' : '')}><div className="mapping-role"><strong>{label}{required && <em>*</em>}{optional && <span className="optional">선택</span>}</strong>{suggested && <small className="mapping-suggested">자동 제안</small>}{hint && <small>{hint}</small>}</div><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">필드를 선택하세요</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }): JSX.Element {
  return <div className="field"><label>{label}{!options.length && <span className="optional">데이터 없음</span>}</label><select value={value} disabled={!options.length} onChange={(event) => onChange(event.target.value)}><option value="">전체</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
}
