import * as XLSX from 'xlsx';
import type { ColumnMapping, FilePreview, HourIndex, NormalizedRecord, ParseOptions } from '../shared/types';

const DELIMITERS: ParseOptions['delimiter'][] = [',', '\t', ';', '|'];

function extension(name: string): string {
  return name.toLowerCase().split('.').pop() ?? '';
}

export function detectDelimiter(text: string): ParseOptions['delimiter'] {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  return DELIMITERS.map((delimiter) => ({
    delimiter,
    score: sample.split(delimiter).length - 1
  })).sort((a, b) => b.score - a.score)[0]?.delimiter ?? ',';
}

export function decodeText(bytes: ArrayBuffer, encoding: ParseOptions['encoding'] = 'utf-8'): string {
  try {
    return new TextDecoder(encoding === 'euc-kr' ? 'euc-kr' : 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function detectEncoding(bytes: ArrayBuffer): ParseOptions['encoding'] {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'euc-kr';
  }
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows: string[][], headerRow: number): { headers: string[]; rows: Record<string, unknown>[] } {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const headers = headerRow < 0
    ? Array.from({ length: width }, (_value, index) => `필드${index + 1}`)
    : (rows[headerRow] ?? []).map((value, index) => value || `필드${index + 1}`);
  const dataRows = headerRow < 0 ? rows : rows.slice(headerRow + 1);
  return {
    headers,
    rows: dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
  };
}

export async function previewFile(file: File, options?: Partial<ParseOptions>): Promise<FilePreview> {
  const parsed = await parseFileRows(file, options);
  return {
    name: file.name,
    headers: parsed.headers,
    rows: parsed.rows.slice(0, 20),
    options: parsed.options,
    encoding: parsed.options.encoding,
    delimiter: parsed.options.delimiter
  };
}

export async function parseFileRows(file: File, options?: Partial<ParseOptions>): Promise<{ headers: string[]; rows: Record<string, unknown>[]; options: ParseOptions }> {
  const ext = extension(file.name);
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheetName = options?.sheetName ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false }) as string[][];
    const parsed = rowsToObjects(rows, options?.headerRow ?? 0);
    return {
      headers: parsed.headers,
      rows: parsed.rows,
      options: { encoding: 'utf-8', delimiter: ',', headerRow: options?.headerRow ?? 0, sheetName }
    };
  }
  const bytes = await file.arrayBuffer();
  const encoding = options?.encoding ?? detectEncoding(bytes);
  const text = decodeText(bytes, encoding);
  const delimiter = options?.delimiter ?? detectDelimiter(text);
  const parsed = rowsToObjects(parseDelimited(text, delimiter), options?.headerRow ?? 0);
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    options: { encoding, delimiter, headerRow: options?.headerRow ?? 0 }
  };
}

function toNumber(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/[,_\s]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim().replace(/[./]/g, '-');
  const compactMatch = /^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/.exec(raw);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function dateLikeValue(value: unknown): boolean {
  return normalizeDate(value) !== null;
}

const TIME_PATTERN = /(?:^|[T\s])(\d{1,2})(?::|시)\s*(\d{1,2})(?:분)?(?:\s*(?::|분)?\s*(\d{1,2})(?:초)?)?/;

function hasTimeComponent(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return /^\d{14}$/.test(raw) || TIME_PATTERN.test(raw);
}

function normalizeTime(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const compactMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  const match = compactMatch ? [raw, compactMatch[4], compactMatch[5], compactMatch[6]] : TIME_PATTERN.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function timeLikeValue(value: unknown): boolean {
  return normalizeTime(value) !== null;
}

function numericLikeValue(value: unknown): boolean {
  const raw = String(value ?? '').replace(/[,_\s]/g, '');
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

function hourFromTime(value: string): HourIndex | null {
  const hour = Number(value.slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour as HourIndex : null;
}

export function normalizeRows(rows: Record<string, unknown>[], mapping: ColumnMapping, sourceFile?: string): { records: NormalizedRecord[]; excludedRows: number; warnings: string[] } {
  const records: NormalizedRecord[] = [];
  const warnings: string[] = [];
  let excludedRows = 0;
  let timeExcludedRows = 0;
  rows.forEach((row, index) => {
    const serviceDate = normalizeDate(row[mapping.dateColumn]);
    const boardingCount = mapping.rowSemantics === 'one-row-one-boarding' ? 1 : toNumber(row[mapping.boardingCountColumn ?? '']);
    if (!serviceDate || boardingCount === null) {
      excludedRows += 1;
      return;
    }
    const timeValue = mapping.timeColumn ? row[mapping.timeColumn] : row[mapping.dateColumn];
    const timeText = String(timeValue ?? '').trim();
    const hasExpectedTime = mapping.timeColumn ? Boolean(timeText) : hasTimeComponent(timeValue);
    const boardingTime = normalizeTime(timeValue);
    const boardingHour = boardingTime ? hourFromTime(boardingTime) : null;
    if ((hasExpectedTime || mapping.timeColumn) && (boardingTime === null || boardingHour === null)) timeExcludedRows += 1;
    records.push({
      serviceDate,
      boardingCount,
      boardingTime: boardingTime ?? undefined,
      boardingHour: boardingHour ?? undefined,
      stationId: mapping.stationIdColumn ? String(row[mapping.stationIdColumn] ?? '').trim() || undefined : undefined,
      route: mapping.routeColumn ? String(row[mapping.routeColumn] ?? '').trim() || undefined : undefined,
      station: mapping.stationColumn ? String(row[mapping.stationColumn] ?? '').trim() || undefined : undefined,
      region: mapping.regionColumn ? String(row[mapping.regionColumn] ?? '').trim() || undefined : undefined,
      sourceFile,
      sourceRow: index + 1
    });
  });
  if (excludedRows) warnings.push(`${excludedRows}개 행이 날짜 또는 집계값 형식 오류로 제외되었습니다.`);
  if (timeExcludedRows) warnings.push(`${timeExcludedRows}개 행의 시간 정보가 없어 시간대 분석에서 제외됩니다.`);
  return { records, excludedRows, warnings };
}

export function exactDuplicateIndexes(records: NormalizedRecord[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  records.forEach((record, index) => {
    const key = [record.serviceDate, record.boardingTime ?? '', record.boardingCount, record.stationId ?? '', record.route ?? '', record.station ?? '', record.region ?? ''].join('\u001f');
    if (seen.has(key)) duplicates.push(index);
    else seen.add(key);
  });
  return duplicates;
}

export function hasSensitiveHeaders(headers: string[]): boolean {
  return headers.some((header) => /카드\s*(번호|id)?|card\s*([_-]?number|id)|주민|전화|phone|이름|name/i.test(header));
}

function normalizeHeader(header: string): string {
  return header.normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

/** Suggests the boarding-station ID column without making it mandatory for legacy analyses. */
export function suggestStationIdColumn(headers: string[]): string | undefined {
  const aliases = new Set([
    'stationid',
    'stationidcolumn',
    'boardingstationid',
    'boardingstationidstandard',
    '승차정류장id',
    '승차정류장id국토부표준',
    '정류장id',
    '정류장아이디'
  ]);
  const matched = headers.find((header) => aliases.has(normalizeHeader(header)));
  if (matched) return matched;

  // The supplied 28-column transaction layout puts the boarding station ID at field 17.
  // This is only a suggestion; users can change it before analysis.
  const field17 = headers.find((header) => normalizeHeader(header) === '필드17');
  return field17 && headers.length === 28 ? field17 : undefined;
}

function looksLikeGeneratedHeaders(headers: string[]): boolean {
  return headers.length > 0 && headers.every((header, index) => normalizeHeader(header) === `필드${index + 1}`);
}

function firstHeaderMatch(headers: string[], aliases: string[]): string | undefined {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.find((header) => normalizedAliases.has(normalizeHeader(header)));
}

function inferColumnFromValues(
  headers: string[],
  rows: Record<string, unknown>[],
  predicate: (value: unknown) => boolean,
  preferredIndexes: number[] = []
): string | undefined {
  if (!rows.length) return undefined;
  const sampleRows = rows.slice(0, 50);
  const candidates = headers.map((header, index) => {
    const values = sampleRows.map((row) => row[header]).filter((value) => String(value ?? '').trim() !== '');
    const matches = values.filter(predicate).length;
    return {
      header,
      index,
      ratio: values.length ? matches / values.length : 0,
      matches
    };
  }).filter((candidate) => candidate.matches > 0 && candidate.ratio >= 0.8);
  candidates.sort((left, right) => {
    const preferred = (preferredIndexes.indexOf(right.index) >= 0 ? 1 : 0) - (preferredIndexes.indexOf(left.index) >= 0 ? 1 : 0);
    return preferred || right.ratio - left.ratio || right.matches - left.matches || left.index - right.index;
  });
  return candidates[0]?.header;
}

/**
 * Suggests the common transaction schema while keeping every suggestion editable.
 * Positional suggestions are deliberately limited to the supplied 28-column layout.
 */
export function suggestTransactionMapping(headers: string[], rows: Record<string, unknown>[] = []): Partial<ColumnMapping> {
  const suggestion: Partial<ColumnMapping> = {};
  const generated = looksLikeGeneratedHeaders(headers) && headers.length === 28;
  const semanticDate = firstHeaderMatch(headers, ['운행일자', '일자', '날짜', 'service_date', 'date']);
  const semanticTime = firstHeaderMatch(headers, ['승차일시', '승차시간', 'boarding_time', 'boarding_datetime']);
  const inferredDate = inferColumnFromValues(headers, rows, dateLikeValue, [0, 14]);
  const inferredTime = inferColumnFromValues(headers, rows, timeLikeValue, [14, 0]);
  suggestion.dateColumn = semanticDate ?? (generated ? headers[0] : inferredDate);
  suggestion.timeColumn = semanticTime ?? (generated ? headers[14] : inferredTime);
  const timeIndex = suggestion.timeColumn ? headers.indexOf(suggestion.timeColumn) : -1;
  const relativeStation = timeIndex >= 0 ? inferColumnFromValues(headers, rows, (value) => String(value ?? '').trim() !== '', [timeIndex + 2]) : undefined;
  const relativeCount = timeIndex >= 0 ? inferColumnFromValues(headers, rows, numericLikeValue, [timeIndex + 10]) : undefined;
  const relativeRoute = timeIndex >= 0 ? inferColumnFromValues(headers, rows, (value) => String(value ?? '').trim() !== '', [timeIndex - 2]) : undefined;
  suggestion.stationIdColumn = suggestStationIdColumn(headers) ?? relativeStation;
  suggestion.boardingCountColumn = firstHeaderMatch(headers, ['이용자수', '승차인원', '승차인원수', 'boarding_count', 'passenger_count', 'count']) ?? (generated ? headers[24] : relativeCount);
  suggestion.routeColumn = firstHeaderMatch(headers, ['노선id(국토부표준)', '노선id', '노선ID(정산사)', 'route_id', 'route']) ?? (generated ? headers[12] : relativeRoute);
  if (suggestion.boardingCountColumn) suggestion.rowSemantics = 'count-column';

  // If a header happens to contain a misleading alias, only keep it when the
  // preview has at least one non-empty value. This prevents empty template
  // columns from becoming mandatory suggestions.
  for (const key of ['dateColumn', 'timeColumn', 'stationIdColumn', 'boardingCountColumn', 'routeColumn'] as const) {
    const column = suggestion[key];
    if (column && rows.length > 0 && !rows.some((row) => String(row[column] ?? '').trim())) delete suggestion[key];
  }

  // Some transaction extracts omit the service-date column but retain the
  // boarding timestamp. Reusing that timestamp for both date and time keeps
  // the import usable without inventing a date from another field.
  if (!suggestion.dateColumn && suggestion.timeColumn) suggestion.dateColumn = suggestion.timeColumn;
  if (!suggestion.timeColumn && suggestion.dateColumn && rows.some((row) => timeLikeValue(row[suggestion.dateColumn!]))) {
    suggestion.timeColumn = suggestion.dateColumn;
  }
  return suggestion;
}
