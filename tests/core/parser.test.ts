import { describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, exactDuplicateIndexes, hasSensitiveHeaders, normalizeRows, parseDelimited, parseFileRows, previewFile } from '../../src/core/parser';

describe('parser', () => {
  it('detects delimiters and parses quoted values', () => {
    const text = '일자\t승차인원\t노선\n2024-01-01\t62,000\t"1,000번"';
    expect(detectDelimiter(text)).toBe('\t');
    expect(parseDelimited(text, '\t')).toEqual([['일자', '승차인원', '노선'], ['2024-01-01', '62,000', '1,000번']]);
  });

  it('decodes legacy Korean text bytes', () => {
    const bytes = new Uint8Array([0xbf, 0xa9, 0xbc, 0xf6]).buffer;
    expect(decodeText(bytes, 'euc-kr')).toBe('여수');
  });

  it('auto-detects legacy Korean text encoding', async () => {
    const file = new File([new Uint8Array([0xbf, 0xa9, 0xbc, 0xf6, 0x0a, 0xbf, 0xa9, 0xbc, 0xf6, 0x0a])], 'legacy.txt');
    const parsed = await parseFileRows(file);
    expect(parsed.options.encoding).toBe('euc-kr');
    expect(parsed.headers).toEqual(['여수']);
  });

  it('supports files without a header row by creating stable field names', async () => {
    const file = new File(['2024-01-01,62000\n2024-01-02,60200\n'], 'no-header.csv');
    const parsed = await parseFileRows(file, { headerRow: -1 });
    expect(parsed.headers).toEqual(['필드1', '필드2']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ 필드1: '2024-01-01', 필드2: '62000' });
  });

  it('normalizes aggregate rows and reports invalid values', () => {
    const result = normalizeRows([
      { 일자: '2024/01/01', 승차: '62,000', 노선: '1번' },
      { 일자: '잘못된 날짜', 승차: '20', 노선: '1번' },
      { 일자: '2024-01-02', 승차: '-4', 노선: '1번' }
    ], { dateColumn: '일자', boardingCountColumn: '승차', rowSemantics: 'count-column', routeColumn: '노선' }, 'sample.csv');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ serviceDate: '2024-01-01', boardingCount: 62000, route: '1번' });
    expect(result.excludedRows).toBe(2);
  });

  it('supports one-row-one-boarding files', () => {
    const result = normalizeRows([{ 날짜: '2024-01-01' }, { 날짜: '2024-01-01' }], { dateColumn: '날짜', rowSemantics: 'one-row-one-boarding' });
    expect(result.records.map((record) => record.boardingCount)).toEqual([1, 1]);
  });

  it('keeps preview rows bounded without truncating the full import path', async () => {
    const content = ['날짜,승차', ...Array.from({ length: 25 }, (_, index) => `2024-01-01,${index + 1}`)].join('\n');
    const file = new File([content], 'large.csv', { type: 'text/csv' });
    const preview = await previewFile(file);
    expect(preview.rows).toHaveLength(20);
  });

  it('flags exact duplicates and sensitive identifier headers', () => {
    const records = [{ serviceDate: '2024-01-01', boardingCount: 10 }, { serviceDate: '2024-01-01', boardingCount: 10 }];
    expect(exactDuplicateIndexes(records)).toEqual([1]);
    expect(hasSensitiveHeaders(['일자', '카드번호'])).toBe(true);
    expect(hasSensitiveHeaders(['일자', '승차인원'])).toBe(false);
  });

  it('normalizes combined timestamps and separate time columns', () => {
    const combined = normalizeRows([
      { 일시: '2024-01-01 07:35:00', 승차: '100' }
    ], { dateColumn: '일시', boardingCountColumn: '승차', rowSemantics: 'count-column' });
    const separate = normalizeRows([
      { 일자: '2024/01/06', 승차시각: '17:05', 승차: '50' }
    ], { dateColumn: '일자', timeColumn: '승차시각', boardingCountColumn: '승차', rowSemantics: 'count-column' });

    expect(combined.records[0]).toMatchObject({ serviceDate: '2024-01-01', boardingTime: '07:35:00' });
    expect(separate.records[0]).toMatchObject({ serviceDate: '2024-01-06', boardingTime: '17:05:00' });
  });

  it('normalizes Korean hour-minute-second notation', () => {
    const result = normalizeRows([
      { 일시: '2024-01-01 7시35분00초', 승차: '10' }
    ], { dateColumn: '일시', boardingCountColumn: '승차', rowSemantics: 'count-column' });
    expect(result.records[0].boardingTime).toBe('07:35:00');
  });

  it('keeps date-only rows and warns about invalid explicit times', () => {
    const result = normalizeRows([
      { 일자: '2024-01-01', 시각: '', 승차: '10' },
      { 일자: '2024-01-02', 시각: '24:00', 승차: '20' }
    ], { dateColumn: '일자', timeColumn: '시각', boardingCountColumn: '승차', rowSemantics: 'count-column' });

    expect(result.records).toHaveLength(2);
    expect(result.records.every((record) => !record.boardingTime)).toBe(true);
    expect(result.warnings.join(' ')).toContain('시간');
  });

  it('does not treat different boarding times as exact duplicates', () => {
    const records = [
      { serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '07:00:00' },
      { serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '08:00:00' },
      { serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '08:00:00' }
    ];
    expect(exactDuplicateIndexes(records)).toEqual([2]);
  });
});
