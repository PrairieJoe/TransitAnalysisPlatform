import * as XLSX from 'xlsx';
import type { ColumnMapping, FilePreview, NormalizedRecord, ParseOptions } from '../shared/types';

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
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function normalizeRows(rows: Record<string, unknown>[], mapping: ColumnMapping, sourceFile?: string): { records: NormalizedRecord[]; excludedRows: number; warnings: string[] } {
  const records: NormalizedRecord[] = [];
  const warnings: string[] = [];
  let excludedRows = 0;
  rows.forEach((row, index) => {
    const serviceDate = normalizeDate(row[mapping.dateColumn]);
    const boardingCount = mapping.rowSemantics === 'one-row-one-boarding' ? 1 : toNumber(row[mapping.boardingCountColumn ?? '']);
    if (!serviceDate || boardingCount === null) {
      excludedRows += 1;
      return;
    }
    records.push({
      serviceDate,
      boardingCount,
      route: mapping.routeColumn ? String(row[mapping.routeColumn] ?? '').trim() || undefined : undefined,
      station: mapping.stationColumn ? String(row[mapping.stationColumn] ?? '').trim() || undefined : undefined,
      region: mapping.regionColumn ? String(row[mapping.regionColumn] ?? '').trim() || undefined : undefined,
      sourceFile,
      sourceRow: index + 1
    });
  });
  if (excludedRows) warnings.push(`${excludedRows}개 행이 날짜 또는 집계값 형식 오류로 제외되었습니다.`);
  return { records, excludedRows, warnings };
}

export function exactDuplicateIndexes(records: NormalizedRecord[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  records.forEach((record, index) => {
    const key = [record.serviceDate, record.boardingCount, record.route ?? '', record.station ?? '', record.region ?? ''].join('\u001f');
    if (seen.has(key)) duplicates.push(index);
    else seen.add(key);
  });
  return duplicates;
}

export function hasSensitiveHeaders(headers: string[]): boolean {
  return headers.some((header) => /카드\s*(번호|id)?|card\s*([_-]?number|id)|주민|전화|phone|이름|name/i.test(header));
}
