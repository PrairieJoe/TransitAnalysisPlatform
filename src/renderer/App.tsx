import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import * as echarts from 'echarts';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { analyzeHourlyRecords, analyzeRecords, uniqueValues } from '../core/analysis';
import { exactDuplicateIndexes, hasSensitiveHeaders, normalizeRows, parseFileRows, previewFile } from '../core/parser';
import { buildHourlySheetRows, buildHourlyTableRows, buildSummary, buildTableRows, formatPeople } from '../core/report';
import { HOURS, type AnalysisConfig, type AnalysisMode, type ColumnMapping, type FilePreview, type HourlyAnalysisResult, type NormalizedRecord, type ProjectManifest, WEEKDAYS } from '../shared/types';

const DEFAULT_PROJECT_TITLE = '교통카드 요일별 분석';

function id(): string { return crypto.randomUUID(); }

function projectTitle(project: ProjectManifest): string {
  return project.name.trim().toLowerCase() === 'reference' ? DEFAULT_PROJECT_TITLE : project.name;
}

function aggregationLabel(project: ProjectManifest): string {
  return project.mapping.rowSemantics === 'one-row-one-boarding' ? '통행량' : '이용인원';
}

function Chart({ result, metricLabel, metricUnit, valueUnit }: { result: ReturnType<typeof analyzeRecords>; metricLabel: string; metricUnit: string; valueUnit: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: false,
      grid: { left: 60, right: 32, top: 70, bottom: 52 },
      xAxis: { type: 'category', data: WEEKDAYS, axisLine: { lineStyle: { color: '#adb5bd' } }, axisLabel: { color: '#344054' } },
      yAxis: { type: 'value', name: metricUnit, nameTextStyle: { color: '#667085' }, splitLine: { lineStyle: { color: '#e4e7ec' } }, axisLabel: { color: '#667085' } },
      series: [{ type: 'bar', data: result.metrics.map((metric) => metric.displayAverage), barWidth: '42%', itemStyle: { color: '#1261b5' }, label: { show: true, position: 'top', color: '#0057b8', fontSize: 16, formatter: ({ value }: { value: number }) => value.toFixed(1) } }],
      graphic: [
        { type: 'text', left: 'center', top: 8, style: { text: `주중 평균 ${metricLabel} ${Math.round(result.weekdayAverage).toLocaleString('ko-KR')}${valueUnit}`, fill: '#9a4d1a', fontWeight: 700, fontSize: 16 } },
        { type: 'text', left: '72%', top: 8, style: { text: `주말 평균 ${metricLabel} ${Math.round(result.weekendAverage).toLocaleString('ko-KR')}${valueUnit}`, fill: '#8b7000', fontWeight: 700, fontSize: 16 } }
      ]
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); chart.dispose(); };
  }, [result, metricLabel, metricUnit, valueUnit]);
  return <div ref={ref} className="chart" aria-label={`요일별 평균 ${metricLabel} 막대그래프`} />;
}

function HourlyChart({ result, metricLabel, metricUnit }: { result: HourlyAnalysisResult; metricLabel: string; metricUnit: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const displayValue = (average: number, displayAverage: number): number => metricLabel === '통행량' ? average : displayAverage;
    const weekdayValues = result.metrics.map((metric) => displayValue(metric.weekdayAverage, metric.weekdayDisplayAverage));
    const weekendValues = result.metrics.map((metric) => displayValue(metric.weekendAverage, metric.weekendDisplayAverage));
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
          label: { show: true, position: 'top', distance: 8, color: '#0057b8', fontSize: 12, formatter: ({ value }: { value: number }) => Number(value).toFixed(1) },
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
          label: { show: true, position: 'bottom', distance: 10, color: '#555', fontSize: 11, formatter: ({ value }: { value: number }) => Number(value).toFixed(1) }
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
  }, [result, metricLabel, metricUnit]);
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

export default function App(): JSX.Element {
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [view, setView] = useState<'home' | 'import' | 'report'>('home');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({ dateColumn: '', rowSemantics: 'count-column' });
  const [config, setConfig] = useState<AnalysisConfig>({ filter: { from: '', to: '' }, denominator: 'observed' });
  const [result, setResult] = useState<ReturnType<typeof analyzeRecords> | null>(null);
  const [hourlyResult, setHourlyResult] = useState<HourlyAnalysisResult | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('weekday');
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void (async () => setProjects(window.transitDesktop ? await window.transitDesktop.listProjects() : JSON.parse(localStorage.getItem('transit-projects') ?? '[]')))(); }, []);

  const headers = previews[0]?.headers ?? [];
  const records = project?.records ?? [];
  const dimensionValues = useMemo(() => ({ route: uniqueValues(records, 'route'), station: uniqueValues(records, 'station'), region: uniqueValues(records, 'region') }), [records]);
  const hasHourlyData = records.some((record) => record.boardingHour !== undefined || record.boardingTime);

  async function save(next: ProjectManifest): Promise<void> {
    if (window.transitDesktop) await window.transitDesktop.saveProject(next);
    else localStorage.setItem('transit-projects', JSON.stringify([...projects.filter((item) => item.id !== next.id), next]));
    setProjects((current) => [...current.filter((item) => item.id !== next.id), next]);
    setProject(next);
  }

  async function selectFiles(nextFiles: FileList | null): Promise<void> {
    const selected = Array.from(nextFiles ?? []);
    setFiles(selected);
    setPreviews(await Promise.all(selected.map((file) => previewFile(file, { headerRow: hasHeaderRow ? 0 : -1 }))));
    setIsDragging(false);
  }

  async function updateHeaderMode(nextHasHeaderRow: boolean): Promise<void> {
    setHasHeaderRow(nextHasHeaderRow);
    setMapping({ dateColumn: '', rowSemantics: 'count-column' });
    if (files.length) setPreviews(await Promise.all(files.map((file) => previewFile(file, { headerRow: nextHasHeaderRow ? 0 : -1 }))));
  }

  async function importData(): Promise<void> {
    if (!files.length || !mapping.dateColumn) return;
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
    if (!normalized.length) return;
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
    const dates = recordsToSave.map((record) => record.serviceDate).sort();
    const nextConfig = { ...config, filter: { ...config.filter, from: dates[0], to: dates[dates.length - 1] } };
    const next: ProjectManifest = { schemaVersion: 2, id: id(), name: DEFAULT_PROJECT_TITLE, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceFiles: files.map((file) => file.name), records: recordsToSave, mapping, parseOptions: previews[0].options, analysisConfig: nextConfig, analysisMode: 'weekday' };
    const nextResult = analyzeRecords(recordsToSave, nextConfig);
    nextResult.excludedRows = excludedRows;
    nextResult.warnings = warnings;
    next.lastResult = nextResult;
    setConfig(nextConfig);
    setResult(nextResult);
    setHourlyResult(null);
    setAnalysisMode('weekday');
    await save(next);
    setView('report');
  }

  async function runAnalysis(): Promise<void> {
    if (!project) return;
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runAnalysis(project.id, config)
      : analyzeRecords(project.records, config);
    const next = { ...project, schemaVersion: 2 as const, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'weekday' as const, lastResult: nextResult };
    setResult(nextResult);
    setAnalysisMode('weekday');
    await save(next);
  }

  async function runHourlyAnalysis(): Promise<void> {
    if (!project || !hasHourlyData) return;
    const nextResult = window.transitDesktop
      ? await window.transitDesktop.runHourlyAnalysis(project.id, config)
      : analyzeHourlyRecords(project.records, config);
    const next = { ...project, schemaVersion: 2 as const, updatedAt: new Date().toISOString(), analysisConfig: config, analysisMode: 'hourly' as const, lastHourlyResult: nextResult };
    setHourlyResult(nextResult);
    setAnalysisMode('hourly');
    await save(next);
  }

  async function selectAnalysisMode(mode: AnalysisMode): Promise<void> {
    if (mode === 'hourly') {
      await runHourlyAnalysis();
      return;
    }
    await runAnalysis();
  }

  async function restoreProject(): Promise<void> {
    if (!window.transitDesktop) return;
    const restored = await window.transitDesktop.importProject();
    if (!restored) return;
    const restoredConfig = restored.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const restoredMode = restored.analysisMode ?? 'weekday';
    const restoredHourlyResult = restored.lastHourlyResult ?? (restoredMode === 'hourly' && restored.records.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(restored.records, restoredConfig) : null);
    const restoredProject = { ...restored, schemaVersion: 2 as const, updatedAt: new Date().toISOString(), analysisConfig: restoredConfig, analysisMode: restoredMode, lastHourlyResult: restoredHourlyResult ?? undefined };
    await save(restoredProject);
    setConfig(restoredConfig);
    setResult(restored.lastResult ?? analyzeRecords(restored.records, restoredConfig));
    setHourlyResult(restoredHourlyResult);
    setAnalysisMode(restoredMode === 'hourly' && restoredHourlyResult ? 'hourly' : 'weekday');
    setView('report');
  }

  function openProject(nextProject: ProjectManifest): void {
    const nextConfig = nextProject.analysisConfig ?? { filter: { from: '', to: '' }, denominator: 'observed' as const };
    const nextMode = nextProject.analysisMode ?? 'weekday';
    const nextHourlyResult = nextProject.lastHourlyResult ?? (nextMode === 'hourly' && nextProject.records.some((record) => record.boardingHour !== undefined || record.boardingTime) ? analyzeHourlyRecords(nextProject.records, nextConfig) : null);
    setProject(nextProject);
    setConfig(nextConfig);
    setResult(nextProject.lastResult ?? analyzeRecords(nextProject.records, nextConfig));
    setHourlyResult(nextHourlyResult);
    setAnalysisMode(nextMode === 'hourly' && nextHourlyResult ? 'hourly' : 'weekday');
    setView('report');
  }

  async function exportPng(): Promise<void> {
    if (!reportRef.current || !project) return;
    const canvas = await html2canvas(reportRef.current, { backgroundColor: '#ffffff', scale: 2 });
    const anchor = document.createElement('a');
    anchor.download = `${projectTitle(project)}.png`;
    anchor.href = canvas.toDataURL('image/png');
    anchor.click();
  }

  function exportExcel(): void {
    if (!project || !result) return;
    if (analysisMode === 'hourly' && hourlyResult) {
      const metricLabel = aggregationLabel(project) === '통행량' ? '통행량' : '승차인원';
      const data = [...buildHourlySheetRows(hourlyResult, metricLabel), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜'], ['주중 관측일', hourlyResult.weekdayDays], ['주말 관측일', hourlyResult.weekendDays]];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), '시간대분석');
      XLSX.writeFile(book, `${projectTitle(project)}-시간대.xlsx`);
      return;
    }
    const rows = buildTableRows(result, aggregationLabel(project));
    const data = [['구분', ...WEEKDAYS], ...rows.map((row) => [row.label, ...row.values]), [], ['분석 기간', config.filter.from, config.filter.to], ['평균 계산 기준', config.denominator === 'observed' ? '실제 관측일' : '전체 날짜']];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), '요일분석');
    XLSX.writeFile(book, `${projectTitle(project)}.xlsx`);
  }

  function renderHome(): JSX.Element {
    return <main className="home"><div className="hero"><div><p className="eyebrow">교통카드 분석</p><h1>교통카드 데이터를<br /><span>요일별 분석</span>으로 바꿔보세요</h1><p className="hero-copy">CSV, DAT, TXT, XLSX 파일을 불러오면<br />요일별 이용인원과 통행량을 한눈에 정리합니다.</p><button className="primary-button" onClick={() => { setFiles([]); setPreviews([]); setView('import'); }}>새 분석 시작 <span>→</span></button></div><div className="hero-visual"><div className="mini-chart"><span style={{ height: '76%' }} /><span style={{ height: '70%' }} /><span style={{ height: '72%' }} /><span style={{ height: '70%' }} /><span style={{ height: '66%' }} /><span style={{ height: '55%' }} /><span style={{ height: '38%' }} /></div><div className="mini-table"><i /><i /><i /></div></div></div><section className="projects-section"><div className="section-heading"><div><p className="eyebrow">내 분석</p><h2>최근 분석 프로젝트</h2></div><div className="section-actions"><button className="secondary-button" onClick={() => void restoreProject()}>프로젝트 불러오기</button><button className="secondary-button" onClick={() => setView('import')}>＋ 새 분석</button></div></div>{projects.length ? <div className="project-list">{projects.map((item) => <ProjectCard key={item.id} project={item} onOpen={() => openProject(item)} onDelete={async () => { if (window.confirm('이 프로젝트를 삭제할까요?')) { if (window.transitDesktop) await window.transitDesktop.deleteProject(item.id); setProjects((current) => current.filter((candidate) => candidate.id !== item.id)); } }} />)}</div> : <div className="empty-state"><div className="empty-icon">＋</div><h3>아직 분석 프로젝트가 없습니다</h3><p>교통카드 파일을 올리고 첫 번째 요일 분석을 만들어보세요.</p></div>}</section></main>;
  }

  function renderImport(): JSX.Element {
    return <main className="workspace">
      <div className="page-header">
        <div>
          <button className="back-button" onClick={() => setView('home')}>← 프로젝트 목록</button>
          <p className="eyebrow">새 분석</p>
          <h1>데이터 불러오기</h1>
          <p>파일을 선택한 후, 분석에 사용할 필드와 집계 방식을 지정하세요.</p>
        </div>
      </div>
      <section className="import-grid">
        <div className="panel upload-panel">
          <h2>1. 데이터 파일</h2>
          <label className={'dropzone' + (isDragging ? ' is-dragging' : '')} onDragOver={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); setIsDragging(false); void selectFiles(event.dataTransfer.files); }}>
            <input type="file" multiple accept=".csv,.dat,.txt,.xlsx,.xls" onChange={(event) => void selectFiles(event.target.files)} />
            <span className="upload-icon">↑</span>
            <strong>{files.length ? files.length + '개 파일 선택됨' : '파일을 클릭하거나 이곳에 끌어오세요'}</strong>
            <small>클릭해 파일 선택 · CSV · DAT · TXT · XLSX · 여러 파일 가능</small>
          </label>
          <label className="header-toggle">
            <input type="checkbox" checked={hasHeaderRow} onChange={(event) => void updateHeaderMode(event.target.checked)} />
            <span><strong>첫 번째 행을 필드명으로 사용</strong><small>끄면 필드1, 필드2처럼 자동으로 이름을 만듭니다.</small></span>
          </label>
          {previews.length > 0 && <>
            <div className="file-list">
              {previews.map((preview) => <div className="file-row" key={preview.name}><span>▤</span><div><strong>{preview.name}</strong><small>{preview.headers.length}개 필드 · {preview.rows.length}개 미리보기 행</small></div><em>{preview.encoding.toUpperCase()}</em></div>)}
            </div>
            <div className="sample-heading"><strong>데이터 미리보기</strong><span>파일별 상위 10개 행</span></div>
            <div className="sample-list">{previews.map((preview, index) => <SamplePreview key={preview.name} preview={preview} open={index === 0} />)}</div>
          </>}
        </div>
        <div className="panel mapping-panel">
          <h2>2. 필드 연결</h2>
          {!previews.length ? <div className="hint-box">파일을 선택하면 원본 필드와 분석 역할을 연결할 수 있습니다.</div> : <>
            <div className="mapping-intro">
              <strong>핵심 필드만 먼저 연결하세요</strong>
              <span>날짜와 승차인원을 지정하면 바로 분석할 수 있습니다. 시간 필드는 선택 사항입니다.</span>
            </div>
            <div className="mapping-group">
              <p className="mapping-group-title">핵심 필드</p>
              <MappingSelect label="날짜 또는 통합 일시" hint="요일과 분석 기간에 사용" required value={mapping.dateColumn} options={headers} onChange={(value) => setMapping({ ...mapping, dateColumn: value })} />
              <MappingSelect label="시간" hint="날짜와 분리된 시간 필드가 있을 때 선택" value={mapping.timeColumn ?? ''} options={headers} optional onChange={(value) => setMapping({ ...mapping, timeColumn: value || undefined })} />
              <div className="field aggregation-field">
                <label>집계 방식</label>
                <div className="segmented aggregation-options">
                  <button className={mapping.rowSemantics === 'count-column' ? 'active' : ''} aria-pressed={mapping.rowSemantics === 'count-column'} onClick={() => setMapping({ ...mapping, rowSemantics: 'count-column' })}><strong>이용인원 합계</strong><small>승차인원 필드 값을 합산</small></button>
                  <button className={mapping.rowSemantics === 'one-row-one-boarding' ? 'active' : ''} aria-pressed={mapping.rowSemantics === 'one-row-one-boarding'} onClick={() => setMapping({ ...mapping, rowSemantics: 'one-row-one-boarding', boardingCountColumn: undefined })}><strong>통행량(행 수)</strong><small>각 행을 1건으로 집계</small></button>
                </div>
              </div>
              {mapping.rowSemantics === 'count-column' && <MappingSelect label="승차인원" hint="합산할 값이 있는 필드" required value={mapping.boardingCountColumn ?? ''} options={headers} onChange={(value) => setMapping({ ...mapping, boardingCountColumn: value })} />}
            </div>
            <details className="optional-mapping">
              <summary><strong>필터용 필드</strong><span>선택 사항 · 펼치기</span></summary>
              <div className="mapping-group optional-mapping-body">
                <MappingSelect label="노선" value={mapping.routeColumn ?? ''} options={headers} optional onChange={(value) => setMapping({ ...mapping, routeColumn: value || undefined })} />
                <MappingSelect label="정류장/역" value={mapping.stationColumn ?? ''} options={headers} optional onChange={(value) => setMapping({ ...mapping, stationColumn: value || undefined })} />
                <MappingSelect label="지역" value={mapping.regionColumn ?? ''} options={headers} optional onChange={(value) => setMapping({ ...mapping, regionColumn: value || undefined })} />
              </div>
            </details>
            <div className="mapping-actions">
              <button className="primary-button full" disabled={!mapping.dateColumn || (mapping.rowSemantics === 'count-column' && !mapping.boardingCountColumn)} onClick={() => void importData()}>이 설정으로 분석하기 <span>→</span></button>
            </div>
          </>}
        </div>
      </section>
    </main>;
  }

  function renderReport(): JSX.Element {
    if (!project || !result || (analysisMode === 'hourly' && !hourlyResult)) return <div className="loading">분석 결과를 준비하고 있습니다.</div>;
    const isHourly = analysisMode === 'hourly';
    const metricLabel = aggregationLabel(project);
    const hourlyMetricLabel = metricLabel === '통행량' ? '통행량' : '승차인원';
    const metricUnit = metricLabel === '통행량' ? '건/일' : '천 명/일';
    const valueUnit = metricLabel === '통행량' ? '건' : '명';
    const tableRows = isHourly ? buildHourlyTableRows(hourlyResult!, hourlyMetricLabel) : buildTableRows(result, metricLabel);
    const warnings = isHourly ? hourlyResult!.warnings : result.warnings;
    return <main className="workspace report-workspace"><div className="page-header report-header"><div><button className="back-button" onClick={() => setView('home')}>← 프로젝트 목록</button><p className="eyebrow">분석 결과</p><h1>{projectTitle(project)}</h1><p>{config.filter.from} ~ {config.filter.to} · {config.denominator === 'observed' ? '실제 관측일 기준' : '전체 날짜 기준'} · 원본: {project.sourceFiles.join(', ')}</p></div><div className="header-actions"><button className="secondary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportProject(project) : undefined)}>프로젝트 백업</button><button className="secondary-button" onClick={exportExcel}>엑셀</button><button className="secondary-button" onClick={exportPng}>PNG</button><button className="primary-button" onClick={() => void (window.transitDesktop ? window.transitDesktop.exportPdf() : window.print())}>PDF</button></div></div><div className="analysis-mode" role="tablist" aria-label="분석 모드"><button className={!isHourly ? 'active' : ''} role="tab" aria-selected={!isHourly} onClick={() => void selectAnalysisMode('weekday')}>요일별 분석</button><button className={isHourly ? 'active' : ''} role="tab" aria-selected={isHourly} disabled={!hasHourlyData} title={!hasHourlyData ? '시간 정보가 있는 파일을 가져오세요.' : undefined} onClick={() => void selectAnalysisMode('hourly')}>시간대 분석</button></div>{!hasHourlyData && <p className="analysis-mode-note">시간 정보가 없어 시간대 분석은 사용할 수 없습니다. 요일별 분석은 기존처럼 사용할 수 있습니다.</p>}<div className="report-layout"><aside className="panel filters"><h2>분석 조건</h2><div className="field"><label>시작일</label><input type="date" value={config.filter.from} onChange={(event) => setConfig({ ...config, filter: { ...config.filter, from: event.target.value } })} /></div><div className="field"><label>종료일</label><input type="date" value={config.filter.to} onChange={(event) => setConfig({ ...config, filter: { ...config.filter, to: event.target.value } })} /></div><FilterSelect label="노선" value={config.filter.route ?? ''} options={dimensionValues.route} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, route: value || undefined } })} /><FilterSelect label="정류장/역" value={config.filter.station ?? ''} options={dimensionValues.station} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, station: value || undefined } })} /><FilterSelect label="지역" value={config.filter.region ?? ''} options={dimensionValues.region} onChange={(value) => setConfig({ ...config, filter: { ...config.filter, region: value || undefined } })} /><div className="field"><label>평균 계산 기준</label><label className="radio-line"><input type="radio" checked={config.denominator === 'observed'} onChange={() => setConfig({ ...config, denominator: 'observed' })} /> 실제 관측일</label><label className="radio-line"><input type="radio" checked={config.denominator === 'calendar'} onChange={() => setConfig({ ...config, denominator: 'calendar' })} /> 전체 날짜</label></div><button className="primary-button full" onClick={() => void (isHourly ? runHourlyAnalysis() : runAnalysis())}>조건 적용하기</button></aside><section className="report-area" ref={reportRef}><div className="report-title"><div><p className="eyebrow">{isHourly ? '시간대 집계' : '요일별 집계'}</p><h2>{isHourly ? `주중·주말 ${hourlyMetricLabel} 시간대 분석` : buildSummary(result, metricLabel)}</h2></div><span>단위: {metricUnit}</span></div><div className={`chart-card${isHourly ? ' hourly-chart-card' : ''}`}>{isHourly ? <HourlyChart result={hourlyResult!} metricLabel={hourlyMetricLabel} metricUnit={metricUnit} /> : <Chart result={result} metricLabel={metricLabel} metricUnit={metricUnit} valueUnit={valueUnit} />}</div>{isHourly ? <div className="hourly-summary">주중 관측일 <strong>{hourlyResult!.weekdayDays}일</strong> · 주말 관측일 <strong>{hourlyResult!.weekendDays}일</strong></div> : <div className="report-callout">선택한 조건의 하루 평균 {metricLabel}은 <strong>{formatPeople(result.overallAverage)}{valueUnit}</strong>입니다.</div>}<div className={`table-card${isHourly ? ' hourly-table-card' : ''}`}><div className={isHourly ? 'table-scroll hourly-table-scroll' : 'table-scroll'}><table><thead><tr><th>구분</th>{(isHourly ? HOURS.map((hour) => `${hour}시`) : WEEKDAYS).map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{tableRows.map((row) => <tr key={row.label}><th>{row.label}</th>{row.values.map((value, index) => <td key={`${row.label}-${index}`}>{value}</td>)}</tr>)}</tbody></table></div></div>{warnings.length > 0 && <div className="warning-box">{warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}</section></div></main>;
  }

    return <div className="app-shell"><header className="topbar"><button className="brand" onClick={() => setView('home')}><span className="brand-mark">↗</span> 교통카드 분석</button><span className="offline-badge">● 로컬 모드</span></header>{view === 'home' ? renderHome() : view === 'import' ? renderImport() : renderReport()}</div>;
}

function MappingSelect({ label, hint, value, options, optional, required, onChange }: { label: string; hint?: string; value: string; options: string[]; optional?: boolean; required?: boolean; onChange: (value: string) => void }): JSX.Element {
  return <div className="mapping-row"><div className="mapping-role"><strong>{label}{required && <em>*</em>}{optional && <span className="optional">선택</span>}</strong>{hint && <small>{hint}</small>}</div><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">필드를 선택하세요</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }): JSX.Element {
  return <div className="field"><label>{label}{!options.length && <span className="optional">데이터 없음</span>}</label><select value={value} disabled={!options.length} onChange={(event) => onChange(event.target.value)}><option value="">전체</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
}
