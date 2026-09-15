import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import * as echarts from 'echarts';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { analyzeHourlyRecords, analyzeODRecords, analyzeRecords, analyzeStationRecords, uniqueValues } from '../core/analysis';
import { exactDuplicateIndexes, hasSensitiveHeaders, normalizeRows, parseFileRows, previewFile, suggestTransactionMapping } from '../core/parser';
import { EMPTY_STATION_MASTER_MAPPING, joinODDemandMetrics, joinStationDemandMetrics, normalizeStationMasterRows, suggestStationMasterMapping } from '../core/station-master';
import { buildHourlySheetRows, buildHourlyTableRows, buildODDemandSheetRows, buildStationDemandSheetRows, buildSummary, buildTableRows, formatPeople, formatStationDemand } from '../core/report';
import { DEFAULT_DISPLAY_UNITS, HOURS, type AnalysisConfig, type AnalysisMode, type ColumnMapping, type DisplayUnit, type DisplayUnitConfig, type FilePreview, type HourlyAnalysisResult, type NormalizedRecord, type ODDemandResult, type ProjectManifest, type StationDemandResult, type StationDemandViewRow, type StationMasterMapping, type StationMasterRecord, WEEKDAYS } from '../shared/types';
import StationDemandMap from './StationDemandMap';
import ODDemandMap from './ODDemandMap';
import ODDemandTable from './ODDemandTable';

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

function id(): string { return crypto.randomUUID(); }

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
    od: normalize(value?.od ?? DEFAULT_DISPLAY_UNITS.od)
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
  const [importStep, setImportStep] = useState<'transaction' | 'station'>('transaction');
  const [config, setConfig] = useState<AnalysisConfig>({ filter: { from: '', to: '' }, denominator: 'observed' });
  const [result, setResult] = useState<ReturnType<typeof analyzeRecords> | null>(null);
  const [hourlyResult, setHourlyResult] = useState<HourlyAnalysisResult | null>(null);
  const [stationResult, setStationResult] = useState<StationDemandResult | null>(null);
  const [odResult, setODResult] = useState<ODDemandResult | null>(null);
  const [stationMasterFile, setStationMasterFile] = useState<File | null>(null);
  const [stationMasterPreview, setStationMasterPreview] = useState<FilePreview | null>(null);
  const [stationMasterRows, setStationMasterRows] = useState<Record<string, unknown>[]>([]);
  const [stationMasterHasHeaderRow, setStationMasterHasHeaderRow] = useState(false);
  const [stationMasterMapping, setStationMasterMapping] = useState<StationMasterMapping>(EMPTY_STATION_MASTER_MAPPING);
  const [stationMasterRecords, setStationMasterRecords] = useState<StationMasterRecord[]>([]);
  const [stationMasterSource, setStationMasterSource] = useState<string>();
  const [stationMasterWarnings, setStationMasterWarnings] = useState<string[]>([]);
  const [stationMasterError, setStationMasterError] = useState<string>();
  const [optionalMappingOpen, setOptionalMappingOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('weekday');
  const [displayUnits, setDisplayUnits] = useState<DisplayUnitConfig>(DEFAULT_DISPLAY_UNITS);
  const [selectedStationId, setSelectedStationId] = useState<string>();
  const [selectedODKey, setSelectedODKey] = useState<string>();
  const reportRef = useRef<HTMLDivElement>(null);
  const selectStation = useCallback((stationId: string) => setSelectedStationId(stationId), []);
  const selectODFlow = useCallback((flowKey: string) => setSelectedODKey(flowKey), []);

  useEffect(() => { void (async () => setProjects(window.transitDesktop ? await window.transitDesktop.listProjects() : JSON.parse(localStorage.getItem('transit-projects') ?? '[]')))(); }, []);

  const headers = previews[0]?.headers ?? [];
  const records = project?.records ?? [];
  const dimensionValues = useMemo(() => ({ route: uniqueValues(records, 'route'), station: uniqueValues(records, 'station'), region: uniqueValues(records, 'region') }), [records]);
  const hasHourlyData = records.some((record) => record.boardingHour !== undefined || record.boardingTime);
  const hasStationData = records.some((record) => Boolean(record.stationId));
  const hasStationDemand = hasStationData && (stationMasterRecords.length > 0 || Boolean(stationResult));
  const hasODData = records.some((record) => Boolean(record.stationId && record.destinationStationId));
  const hasODDemand = hasODData && (stationMasterRecords.length > 0 || Boolean(odResult));
  const stationView = useMemo(() => stationResult ? joinStationDemandMetrics(stationResult.metrics, stationMasterRecords) : { rows: [], unmatchedCount: 0, warnings: [] }, [stationMasterRecords, stationResult]);
  const odView = useMemo(() => odResult ? joinODDemandMetrics(odResult.metrics, stationMasterRecords) : { rows: [], unmatchedOriginCount: 0, unmatchedDestinationCount: 0, warnings: [] }, [odResult, stationMasterRecords]);

  async function save(next: ProjectManifest): Promise<void> {
    if (window.transitDesktop) await window.transitDesktop.saveProject(next);
    else localStorage.setItem('transit-projects', JSON.stringify([...projects.filter((item) => item.id !== next.id), next]));
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
      setStationMasterRecords([]);
      setStationMasterWarnings([]);
      setStationMasterError(undefined);
      return;
    }
    try {
      const parsed = normalizeStationMasterRows(rows, nextMapping);
      setStationMasterRecords(parsed.stations);
      setStationMasterWarnings(parsed.warnings);
      setStationMasterError(parsed.stations.length ? undefined : '유효한 정류장 정보 행이 없습니다. 필드 매핑과 원본 좌표를 확인하세요.');
    } catch (error) {
      setStationMasterRecords([]);
      setStationMasterWarnings([]);
      setStationMasterError(error instanceof Error ? error.message : '정류장 정보를 읽지 못했습니다.');
    }
  }

  async function selectStationMasterFile(file: File | undefined, hasHeader = stationMasterHasHeaderRow): Promise<void> {
    if (!file) return;
    setOptionalMappingOpen(true);
    setStationMasterError(undefined);
    try {
      let preview = await previewFile(file, { headerRow: hasHeader ? 0 : -1 });
      let parsed = await parseFileRows(file, preview.options);
      if (!hasHeader && looksLikeStationMasterHeader(parsed.rows[0])) {
        preview = await previewFile(file, { headerRow: 0 });
        parsed = await parseFileRows(file, preview.options);
        setStationMasterHasHeaderRow(true);
      }
      const nextMapping = suggestStationMasterMapping(preview.headers, parsed.rows);
      setStationMasterFile(file);
      setStationMasterPreview(preview);
      setStationMasterRows(parsed.rows);
      setStationMasterMapping(nextMapping);
      setStationMasterSource(file.name);
      setImportError(undefined);
      applyStationMasterMapping(parsed.rows, nextMapping);
    } catch (error) {
      setStationMasterFile(file);
      setStationMasterPreview(null);
      setStationMasterRows([]);
      setStationMasterMapping(EMPTY_STATION_MASTER_MAPPING);
      setStationMasterRecords([]);
      setStationMasterError(error instanceof Error ? error.message : '정류장 정보를 읽지 못했습니다.');
    }
  }

  async function updateStationMasterHeaderMode(nextHasHeaderRow: boolean): Promise<void> {
    setStationMasterHasHeaderRow(nextHasHeaderRow);
    if (stationMasterFile) await selectStationMasterFile(stationMasterFile, nextHasHeaderRow);
  }

  function updateStationMasterMapping(key: keyof StationMasterMapping, value: string): void {
    const nextMapping = { ...stationMasterMapping, [key]: value };
    setStationMasterMapping(nextMapping);
    applyStationMasterMapping(stationMasterRows, nextMapping);
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
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setImportError(undefined);
    setStationMasterFile(null);
    setStationMasterPreview(null);
    setStationMasterRows([]);
    setStationMasterHasHeaderRow(false);
    setStationMasterMapping(EMPTY_STATION_MASTER_MAPPING);
    setStationMasterRecords([]);
    setStationMasterSource(undefined);
    setStationMasterWarnings([]);
    setStationMasterError(undefined);
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
        normalized.push(...parsed.records);
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
        const keepDuplicates = window.confirm(`완전히 동일한 행 ${duplicateIndexes.length}개가 발견되었습니다. 확인을 누르면 그대로 합산하고, 취소를 누르면 중복 행을 제외합니다.`);
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
      const stationMasterFields = stationMasterRecords.length ? { stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings } : {};
      const next: ProjectManifest = { schemaVersion: 4, id: id(), name: DEFAULT_PROJECT_TITLE, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceFiles: files.map((file) => file.name), records: recordsToSave, mapping, parseOptions: previews[0].options, ...stationMasterFields, analysisConfig: nextConfig, analysisMode: 'weekday', displayUnits };
      const nextResult = analyzeRecords(recordsToSave, nextConfig);
      nextResult.excludedRows = excludedRows;
      nextResult.warnings = warnings;
      next.lastResult = nextResult;
      setConfig(nextConfig);
      setResult(nextResult);
      setHourlyResult(null);
      setStationResult(null);
      setODResult(null);
      setSelectedStationId(undefined);
      setSelectedODKey(undefined);
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
    const next = { ...project, schemaVersion: 4 as const, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'weekday' as const, lastResult: nextResult };
    setResult(nextResult);
    setAnalysisMode('weekday');
    await save(next);
  }

  async function runHourlyAnalysis(): Promise<void> {
    if (!project || !hasHourlyData) return;
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runHourlyAnalysis(project.id, config)
      : analyzeHourlyRecords(project.records, config);
    const next = { ...project, schemaVersion: 4 as const, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'hourly' as const, lastHourlyResult: nextResult };
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
    const next = { ...project, schemaVersion: 4 as const, updatedAt: new Date().toISOString(), stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings, analysisConfig: config, analysisMode: 'station' as const, lastStationResult: nextResult };
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
    const next = { ...project, schemaVersion: 4 as const, updatedAt: new Date().toISOString(), stationMaster: stationMasterRecords, stationMasterSource, stationMasterMapping, stationMasterWarnings, analysisConfig: config, analysisMode: 'od' as const, lastODResult: nextResult };
    setODResult(nextResult);
    setSelectedODKey(undefined);
    setAnalysisMode('od');
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
    await runAnalysis();
  }

  async function updateDisplayUnit(unit: DisplayUnit): Promise<void> {
    if (!project) return;
    const nextDisplayUnits = { ...displayUnits, [analysisMode]: unit } as DisplayUnitConfig;
    setDisplayUnits(nextDisplayUnits);
    await save({ ...project, schemaVersion: 4, updatedAt: new Date().toISOString(), displayUnits: nextDisplayUnits });
  }

  async function restoreProject(): Promise<void> {
    if (!window.transitDesktop) return;
    const restored = await window.transitDesktop.importProject();
    if (!restored) return;
    const restoredConfig = restored.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const restoredMode = restored.analysisMode ?? 'weekday';
    const restoredDisplayUnits = normalizeDisplayUnits(restored.displayUnits);
    const restoredHourlyResult = restored.lastHourlyResult ?? (restoredMode === 'hourly' && restored.records.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(restored.records, restoredConfig) : null);
    const restoredMaster = restored.stationMaster ?? [];
    const restoredMasterSource = restored.stationMasterSource;
    const restoredMasterMapping = restored.stationMasterMapping ?? EMPTY_STATION_MASTER_MAPPING;
    const restoredMasterWarnings = restored.stationMasterWarnings ?? [];
    const restoredStationResult = restored.lastStationResult ? attachStationMasterInfo(restored.lastStationResult, restoredMaster) : (restoredMode === 'station' && restored.records.some((record) => record.stationId) ? attachStationMasterInfo(analyzeStationRecords(restored.records, restoredConfig), restoredMaster) : null);
    const restoredODResult = restored.lastODResult ? attachODMasterInfo(restored.lastODResult, restoredMaster) : (restoredMode === 'od' && restored.records.some((record) => record.stationId && record.destinationStationId) ? attachODMasterInfo(analyzeODRecords(restored.records, restoredConfig), restoredMaster) : null);
    const restoredProject = { ...restored, schemaVersion: 4 as const, updatedAt: new Date().toISOString(), stationMaster: restoredMaster.length ? restoredMaster : undefined, stationMasterSource: restoredMasterSource, stationMasterMapping: restoredMaster.length ? restoredMasterMapping : undefined, stationMasterWarnings: restoredMasterWarnings, analysisConfig: restoredConfig, analysisMode: restoredMode, displayUnits: restoredDisplayUnits, lastHourlyResult: restoredHourlyResult ?? undefined, lastStationResult: restoredStationResult ?? undefined, lastODResult: restoredODResult ?? undefined };
    await save(restoredProject);
    setConfig(restoredConfig);
    setResult(restored.lastResult ?? analyzeRecords(restored.records, restoredConfig));
    setHourlyResult(restoredHourlyResult);
    setStationResult(restoredStationResult);
    setODResult(restoredODResult);
    setStationMasterRecords(restoredMaster);
    setStationMasterSource(restoredMasterSource);
    setStationMasterMapping(restoredMasterMapping);
    setStationMasterWarnings(restoredMasterWarnings);
    setStationMasterError(undefined);
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setDisplayUnits(restoredDisplayUnits);
    setAnalysisMode(restoredMode === 'hourly' && restoredHourlyResult ? 'hourly' : restoredMode === 'station' && restoredStationResult ? 'station' : restoredMode === 'od' && restoredODResult ? 'od' : 'weekday');
    setView('report');
  }

  function openProject(nextProject: ProjectManifest): void {
    const nextConfig = nextProject.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const nextMode = nextProject.analysisMode ?? 'weekday';
    const nextDisplayUnits = normalizeDisplayUnits(nextProject.displayUnits);
    const nextHourlyResult = nextProject.lastHourlyResult ?? (nextMode === 'hourly' && nextProject.records.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(nextProject.records, nextConfig) : null);
    const nextMaster = nextProject.stationMaster ?? [];
    const nextMasterSource = nextProject.stationMasterSource;
    const nextMasterMapping = nextProject.stationMasterMapping ?? EMPTY_STATION_MASTER_MAPPING;
    const nextMasterWarnings = nextProject.stationMasterWarnings ?? [];
    const nextStationResult = nextProject.lastStationResult ? attachStationMasterInfo(nextProject.lastStationResult, nextMaster) : (nextMode === 'station' && nextProject.records.some((record) => record.stationId) ? attachStationMasterInfo(analyzeStationRecords(nextProject.records, nextConfig), nextMaster) : null);
    const nextODResult = nextProject.lastODResult ? attachODMasterInfo(nextProject.lastODResult, nextMaster) : (nextMode === 'od' && nextProject.records.some((record) => record.stationId && record.destinationStationId) ? attachODMasterInfo(analyzeODRecords(nextProject.records, nextConfig), nextMaster) : null);
    setProject(nextProject);
    setConfig(nextConfig);
    setResult(nextProject.lastResult ?? analyzeRecords(nextProject.records, nextConfig));
    setHourlyResult(nextHourlyResult);
    setStationResult(nextStationResult);
    setODResult(nextODResult);
    setStationMasterRecords(nextMaster);
    setStationMasterSource(nextMasterSource);
    setStationMasterMapping(nextMasterMapping);
    setStationMasterWarnings(nextMasterWarnings);
    setStationMasterError(undefined);
    setSelectedStationId(undefined);
    setSelectedODKey(undefined);
    setDisplayUnits(nextDisplayUnits);
    setAnalysisMode(nextMode === 'hourly' && nextHourlyResult ? 'hourly' : nextMode === 'station' && nextStationResult ? 'station' : nextMode === 'od' && nextODResult ? 'od' : 'weekday');
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

  function renderHome(): JSX.Element {
    return <main className="home"><div className="hero"><div><p className="eyebrow">교통카드 분석</p><h1>교통카드 데이터를<br /><span>요일별 분석</span>으로 바꿔보세요</h1><p className="hero-copy">CSV, DAT, TXT, XLSX 파일을 불러오면<br />요일별 이용인원과 통행량을 한눈에 정리합니다.</p><button className="primary-button" onClick={startNewAnalysis}>새 분석 시작 <span>→</span></button></div><div className="hero-visual"><div className="mini-chart"><span style={{ height: '76%' }} /><span style={{ height: '70%' }} /><span style={{ height: '72%' }} /><span style={{ height: '70%' }} /><span style={{ height: '66%' }} /><span style={{ height: '55%' }} /><span style={{ height: '38%' }} /></div><div className="mini-table"><i /><i /><i /></div></div></div><section className="projects-section"><div className="section-heading"><div><p className="eyebrow">내 분석</p><h2>최근 분석 프로젝트</h2></div><div className="section-actions"><button className="secondary-button" onClick={() => void restoreProject()}>프로젝트 불러오기</button><button className="secondary-button" onClick={startNewAnalysis}>＋ 새 분석</button></div></div>{projects.length ? <div className="project-list">{projects.map((item) => <ProjectCard key={item.id} project={item} onOpen={() => openProject(item)} onDelete={async () => { if (window.confirm('이 프로젝트를 삭제할까요?')) { if (window.transitDesktop) await window.transitDesktop.deleteProject(item.id); setProjects((current) => current.filter((candidate) => candidate.id !== item.id)); } }} />)}</div> : <div className="empty-state"><div className="empty-icon">＋</div><h3>아직 분석 프로젝트가 없습니다</h3><p>교통카드 파일을 올리고 첫 번째 요일 분석을 만들어보세요.</p></div>}</section></main>;
  }

  function renderImport(): JSX.Element {
    const coreMappingReady = Boolean(files.length && mapping.dateColumn && (mapping.rowSemantics === 'one-row-one-boarding' || mapping.boardingCountColumn));
    const isSuggested = (key: keyof ColumnMapping): boolean => Boolean(mappingSuggestions[key] && mappingSuggestions[key] === mapping[key]);

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
        <button className={importStep === 'station' ? 'is-active' : ''} disabled={!files.length} onClick={continueToStationStep}><strong>1-2</strong><span>정류장정보</span><small>파일·ID 매칭</small></button>
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
              <MappingSelect label="날짜 또는 통합 일시" hint="요일과 분석 기간에 사용" required value={mapping.dateColumn} options={headers} suggested={isSuggested('dateColumn')} onChange={(value) => updateMapping('dateColumn', value)} />
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
      </section> : <section className="import-grid">
        <div className="panel upload-panel">
          <h2>1-2 정류장정보</h2>
          <div className="step-intro"><strong>정류장정보는 이 분석 프로젝트에 함께 저장됩니다.</strong><span>거래내역의 승차·하차 정류장 ID와 정확히 일치하는 OD 흐름만 지도에 표시합니다.</span></div>
          <label className="dropzone station-master-dropzone">
            <input type="file" accept=".csv,.dat,.txt,.xlsx,.xls" onChange={(event) => void selectStationMasterFile(event.target.files?.[0])} />
            <span className="upload-icon">↑</span>
            <strong>{stationMasterFile ? '정류장정보 파일 선택됨' : '정류장정보 파일을 클릭하거나 끌어오세요'}</strong>
            <small>CSV · DAT · TXT · XLSX · 파일 1개</small>
          </label>
          <label className="header-toggle">
            <input type="checkbox" checked={stationMasterHasHeaderRow} onChange={(event) => void updateStationMasterHeaderMode(event.target.checked)} />
            <span><strong>첫 번째 행을 필드명으로 사용</strong><small>끄면 필드1, 필드2처럼 자동으로 이름을 만듭니다.</small></span>
          </label>
          {stationMasterPreview && <>
            <div className="file-list"><div className="file-row"><span>▤</span><div><strong>{stationMasterPreview.name}</strong><small>{stationMasterPreview.headers.length}개 필드 · {stationMasterPreview.rows.length}개 미리보기 행</small></div><em>{stationMasterPreview.encoding.toUpperCase()}</em></div></div>
            <div className="sample-list"><SamplePreview preview={stationMasterPreview} open /></div>
          </>}
        </div>
        <div className="panel mapping-panel">
          <h2>1-2 정류장정보 자동 제안·확인</h2>
          {!stationMasterPreview ? <>
            <div className="hint-box">정류장정보 파일을 선택하면 정류장 ID·명칭·위도·경도 필드를 자동 제안합니다.</div>
            <div className="warning-box">정류장정보 없이도 기존 요일별·시간대별 분석은 실행할 수 있습니다. 정류장 수요 지도·표가 필요하면 파일을 선택하세요.</div>
          </> : <>
            <div className="auto-map-summary"><strong>정류장정보 매핑을 확인하세요.</strong><span>제안 기준: 표준 헤더명 우선, 헤더 없는 14필드 위치 보완, 값이 비어 있지 않은지 확인. 표준 형식은 ID(필드4), 명칭(필드5), 위도(필드7), 경도(필드8)입니다.</span></div>
            <div className="station-master-input station-master-input-step">
              <p>현재 파일: <strong>{stationMasterSource}</strong> · <strong>{stationMasterRecords.length.toLocaleString('ko-KR')}개</strong> 유효 정류장</p>
              <MappingSelect label="정류장 ID" hint="거래내역의 승차·하차 정류장 ID와 일치시킬 값" required value={stationMasterMapping.stationIdColumn} options={stationMasterPreview.headers} onChange={(value) => updateStationMasterMapping('stationIdColumn', value)} />
              <MappingSelect label="정류장 명칭" required value={stationMasterMapping.stationNameColumn} options={stationMasterPreview.headers} onChange={(value) => updateStationMasterMapping('stationNameColumn', value)} />
              <MappingSelect label="위도" hint="십진수 위도" required value={stationMasterMapping.latitudeColumn} options={stationMasterPreview.headers} onChange={(value) => updateStationMasterMapping('latitudeColumn', value)} />
              <MappingSelect label="경도" hint="십진수 경도" required value={stationMasterMapping.longitudeColumn} options={stationMasterPreview.headers} onChange={(value) => updateStationMasterMapping('longitudeColumn', value)} />
            </div>
            {stationMasterWarnings.map((warning) => <div className="warning-box" key={warning}>⚠ {warning}</div>)}
            {stationMasterError && <div className="error-box" role="alert">⚠ {stationMasterError}</div>}
            {!mapping.stationIdColumn && <div className="warning-box">⚠ 거래내역의 승차 정류장 ID를 먼저 연결해야 정류장 수요 분석을 실행할 수 있습니다.</div>}
            {mapping.stationIdColumn && !mapping.destinationStationIdColumn && <div className="hint-box">OD 분석을 사용하려면 거래내역 화면에서 하차 정류장 ID도 연결하세요. 기존 정류장 수요 분석은 계속 사용할 수 있습니다.</div>}
            {stationMasterRecords.length > 0 && mapping.stationIdColumn && <div className="match-summary"><strong>연결 준비 완료</strong><span>{stationMasterRecords.length.toLocaleString('ko-KR')}개 정류장 사전을 읽었습니다. 분석 실행 시 거래내역 ID와 정확히 일치시킵니다.</span></div>}
          </>}
          <div className="mapping-actions wizard-actions">
            <button className="secondary-button" onClick={() => setImportStep('transaction')}>← 거래내역으로 돌아가기</button>
            <button className="primary-button" disabled={!coreMappingReady || !mapping.stationIdColumn || !stationMasterRecords.length} onClick={() => void importData()}>이 설정으로 분석하기 <span>→</span></button>
          </div>
          <button className="text-button legacy-import-link" disabled={!coreMappingReady} onClick={() => void importData()}>정류장정보 없이 기존 분석 실행</button>
          {importError && <div className="error-box" role="alert">⚠ {importError}</div>}
        </div>
      </section>}
    </main>;
  }

  function renderReport(): JSX.Element {
    const isHourly = analysisMode === 'hourly';
    const isStation = analysisMode === 'station';
    const isOD = analysisMode === 'od';
    if (!project || !result || (isHourly && !hourlyResult) || (isStation && !stationResult) || (isOD && !odResult)) return <div className="loading">분석 결과를 준비하고 있습니다.</div>;
    const metricLabel = aggregationLabel(project);
    const hourlyMetricLabel = metricLabel === '통행량' ? '통행량' : '승차인원';
    const displayUnit = metricLabel === '통행량' ? 'raw' : displayUnits[analysisMode];
    const metricUnit = isStation || isOD ? (metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '인/일') : isHourly ? (metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '명/일') : metricLabel === '통행량' ? '건/일' : displayUnit === 'thousand' ? '천 명/일' : '명/일';
    const valueUnit = metricLabel === '통행량' ? '건' : '명';
    const stationWarnings = [...stationMasterWarnings, ...stationView.warnings];
    const odWarnings = [...stationMasterWarnings, ...odView.warnings];
    const warnings = isStation ? [...new Set([...stationResult!.warnings, ...stationWarnings])] : isOD ? [...new Set([...odResult!.warnings, ...odWarnings])] : isHourly ? hourlyResult!.warnings : result.warnings;
    const stationTitle = metricLabel === '통행량' ? '정류장별 일평균 통행량' : '정류장별 일평균 승차인원';
    const odTitle = metricLabel === '통행량' ? 'OD별 일평균 통행량' : 'OD별 일평균 승차인원';

    return <main className="workspace report-workspace">
      <div className="page-header report-header">
        <div>
          <button className="back-button" onClick={() => setView('home')}>← 프로젝트 목록</button>
          <p className="eyebrow">분석 결과</p>
          <h1>{projectTitle(project)}</h1>
          <p>{config.filter.from} ~ {config.filter.to} · {config.denominator === 'observed' ? '실제 관측일 기준' : '전체 날짜 기준'} · 원본: {project.sourceFiles.join(', ')}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportProject(project) : undefined)}>프로젝트 백업</button>
          <button className="secondary-button" onClick={exportExcel}>엑셀</button>
          <button className="secondary-button" onClick={exportPng}>PNG</button>
          <button className="primary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportPdf() : window.print())}>PDF</button>
        </div>
      </div>
      <div className="analysis-mode" role="tablist" aria-label="분석 모드">
        <button className={!isHourly && !isStation && !isOD ? 'active' : ''} role="tab" aria-selected={!isHourly && !isStation && !isOD} onClick={() => void selectAnalysisMode('weekday')}>요일별 분석</button>
        <button className={isHourly ? 'active' : ''} role="tab" aria-selected={isHourly} disabled={!hasHourlyData} title={!hasHourlyData ? '시간 정보가 있는 파일을 가져오세요.' : undefined} onClick={() => void selectAnalysisMode('hourly')}>시간대 분석</button>
        <button className={isStation ? 'active' : ''} role="tab" aria-selected={isStation} disabled={!hasStationDemand} title={!hasStationDemand ? '교통카드 데이터와 정류장 정보 파일을 모두 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('station')}>정류장 수요</button>
        <button className={isOD ? 'active' : ''} role="tab" aria-selected={isOD} disabled={!hasODDemand} title={!hasODDemand ? '승차·하차 정류장 ID와 정류장 정보 파일을 모두 불러오세요.' : undefined} onClick={() => void selectAnalysisMode('od')}>OD 흐름</button>
      </div>
      {!hasHourlyData && <p className="analysis-mode-note">시간 정보가 없어 시간대 분석은 사용할 수 없습니다. 요일별 분석은 기존처럼 사용할 수 있습니다.</p>}
      {!hasStationData && <p className="analysis-mode-note">정류장 ID가 없어 정류장 수요 분석은 사용할 수 없습니다. 가져오기 화면에서 정류장 ID 필드를 연결하세요.</p>}
      {hasStationData && !stationMasterRecords.length && <p className="analysis-mode-note">정류장 정보 파일이 없어 정류장 수요 분석은 사용할 수 없습니다. 새 분석에서 정류장 정보 파일을 함께 불러오세요.</p>}
      {!hasODData && <p className="analysis-mode-note">승차·하차 정류장 ID가 모두 있는 행이 없어 OD 흐름 분석은 사용할 수 없습니다. 가져오기 화면에서 두 필드를 연결하세요.</p>}
      <div className="report-layout">
        <aside className="panel filters">
          <h2>분석 조건</h2>
          <div className="field"><label>시작일</label><input type="date" value={config.filter.from} onChange={(event) => setConfig({ ...config, filter: { ...config.filter, from: event.target.value } })} /></div>
          <div className="field"><label>종료일</label><input type="date" value={config.filter.to} onChange={(event) => setConfig({ ...config, filter: { ...config.filter, to: event.target.value } })} /></div>
          <FilterSelect label="노선" value={config.filter.route ?? ''} options={dimensionValues.route} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, route: value || undefined } })} />
          <FilterSelect label="정류장/역" value={config.filter.station ?? ''} options={dimensionValues.station} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, station: value || undefined } })} />
          <FilterSelect label="지역" value={config.filter.region ?? ''} options={dimensionValues.region} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, region: value || undefined } })} />
          <div className="field">
            <label>평균 계산 기준</label>
            <label className="radio-line"><input type="radio" checked={config.denominator === 'observed'} onChange={() => setConfig({ ...config, denominator: 'observed' })} /> 실제 관측일</label>
            <label className="radio-line"><input type="radio" checked={config.denominator === 'calendar'} onChange={() => setConfig({ ...config, denominator: 'calendar' })} /> 전체 날짜</label>
          </div>
          <button className="primary-button full" onClick={() => void (isHourly ? runHourlyAnalysis() : isStation ? runStationAnalysis() : isOD ? runODAnalysis() : runAnalysis())}>조건 적용하기</button>
        </aside>
        <section className="report-area" ref={reportRef}>
          <div className="report-title">
            <div>
              <p className="eyebrow">{isOD ? 'OD 수요 집계' : isStation ? '정류장 수요 집계' : isHourly ? '시간대 집계' : '요일별 집계'}</p>
              <h2>{isOD ? odTitle : isStation ? stationTitle : isHourly ? '주중·주말 ' + hourlyMetricLabel + ' 시간대 분석' : buildSummary(result, metricLabel)}</h2>
            </div>
            <div className="report-unit-control">
              <span>단위: {metricUnit}</span>
              {metricLabel !== '통행량' && <label className="unit-toggle"><input type="checkbox" checked={displayUnit === 'thousand'} onChange={(event) => void updateDisplayUnit(event.target.checked ? 'thousand' : 'raw')} /><span>천 명 단위로 표시</span></label>}
            </div>
          </div>
          {isOD ? <><div className="station-summary od-summary">선택 조건의 <strong>{odView.rows.length.toLocaleString('ko-KR')}개 OD 흐름</strong> · 공통 분모 <strong>{odResult!.selectedDays}일</strong> · 모든 흐름 표시 · 화살표는 하차 방향을 나타냅니다.{(odView.unmatchedOriginCount + odView.unmatchedDestinationCount) > 0 && <> · 좌표 미매칭 <strong>{odView.unmatchedOriginCount + odView.unmatchedDestinationCount}건</strong></>}</div><div className="od-report-grid"><div className="station-map-card"><ODDemandMap rows={odView.rows} metricLabel={metricLabel} displayUnit={displayUnit} selectedFlowKey={selectedODKey} onSelectFlow={selectODFlow} /></div><div className="table-card station-table-card"><div className="station-table-heading"><strong>{odTitle}</strong><span>열 제목을 누르면 정렬하고, 행을 누르면 지도 흐름을 강조합니다.</span></div><ODDemandTable rows={odView.rows} metricLabel={metricLabel} displayUnit={displayUnit} selectedFlowKey={selectedODKey} onSelectFlow={selectODFlow} /></div></div></> : isStation ? <><div className="station-summary">선택 조건의 <strong>{stationView.rows.length.toLocaleString('ko-KR')}개 정류장</strong> · 공통 분모 <strong>{stationResult!.selectedDays}일</strong> · 정류장 사전 <strong>{stationMasterSource}</strong>{stationResult!.unmatchedStationCount > 0 && <> · 사전 미등록 <strong>{stationResult!.unmatchedStationCount}개</strong></>}</div><div className="station-report-grid"><div className="station-map-card"><StationDemandMap rows={stationView.rows} displayUnit={displayUnit} selectedStationId={selectedStationId} onSelectStation={selectStation} /></div><div className="table-card station-table-card"><div className="station-table-heading"><strong>정류장별 수요</strong><span>열 제목을 누르면 정렬합니다.</span></div><StationDemandTable rows={stationView.rows} metricLabel={metricLabel === '통행량' ? '통행량' : '승차인원'} displayUnit={displayUnit} selectedStationId={selectedStationId} onSelectStation={selectStation} /></div></div></> : <><div className={'chart-card' + (isHourly ? ' hourly-chart-card' : '')}>{isHourly ? <HourlyChart result={hourlyResult!} metricLabel={hourlyMetricLabel} metricUnit={metricUnit} displayUnit={displayUnit} /> : <Chart result={result} metricLabel={metricLabel} metricUnit={metricUnit} valueUnit={valueUnit} displayUnit={displayUnit} />}</div>{isHourly ? <div className="hourly-summary">주중 관측일 <strong>{hourlyResult!.weekdayDays}일</strong> · 주말 관측일 <strong>{hourlyResult!.weekendDays}일</strong></div> : <div className="report-callout">선택한 조건의 하루 평균 {metricLabel}은 <strong>{formatPeople(result.overallAverage)}{valueUnit}</strong>입니다.</div>}<div className={'table-card' + (isHourly ? ' hourly-table-card' : '')}><div className={isHourly ? 'table-scroll hourly-table-scroll' : 'table-scroll'}><table><thead><tr><th>구분</th>{(isHourly ? HOURS.map((hour) => hour + '시') : WEEKDAYS).map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{(isHourly ? buildHourlyTableRows(hourlyResult!, hourlyMetricLabel, displayUnit) : buildTableRows(result, metricLabel, displayUnit)).map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={row.label + '-' + index}>{value}</td>)}</tr>)}</tbody></table></div></div></>}
          {warnings.length > 0 && <div className="warning-box">{warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
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
