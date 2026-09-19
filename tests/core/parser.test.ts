import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { decodeText, detectDelimiter, exactDuplicateIndexes, hasSensitiveHeaders, normalizeRows, parseDelimited, parseFileBytes, parseFileRows, previewFile, suggestDestinationStationIdColumn, suggestStationIdColumn, suggestTransactionMapping } from '../../src/core/parser';

describe('parser', () => {
  it('parses CSV and XLSX bytes identically to browser File inputs', async () => {
    const csvBytes = new TextEncoder().encode('날짜,승차\n2024-01-01,3\n');
    const csvFile = new File([csvBytes], 'rides.csv');
    expect(await parseFileBytes(csvBytes.buffer, csvFile.name)).toEqual(await parseFileRows(csvFile));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['날짜', '승차'],
      ['2024-01-01', 3]
    ]), '승차자료');
    const xlsxBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const xlsxFile = new File([xlsxBytes], 'rides.xlsx');
    const options = { headerRow: 0, sheetName: '승차자료' };
    expect(await parseFileBytes(xlsxBytes, xlsxFile.name, options)).toEqual(await parseFileRows(xlsxFile, options));
  });

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

  it('parses large headerless files without overflowing the call stack', async () => {
    const content = Array.from({ length: 100_000 }, () => '20240415|1').join('\n');
    const file = new File([content], 'daily-transactions.dat');
    const parsed = await parseFileRows(file, { headerRow: -1 });

    expect(parsed.headers).toEqual(['필드1', '필드2']);
    expect(parsed.rows).toHaveLength(100_000);
  });

  it('flags exact duplicates and sensitive identifier headers', () => {
    const identity = { serviceDate: '2024-01-01', boardingCount: 10, virtualCardId: 'VC-1', route: 'R1', stationId: 'A', destinationStationId: 'B', transactionId: '0', transferCount: 0 };
    const records = [identity, { ...identity }];
    expect(exactDuplicateIndexes(records)).toEqual([1]);
    expect(exactDuplicateIndexes([
      { ...identity, transactionId: 'morning' },
      { ...identity, transactionId: 'evening' },
      { ...identity, transactionId: 'morning' }
    ])).toEqual([2]);
    expect(hasSensitiveHeaders(['일자', '카드번호'])).toBe(true);
    expect(hasSensitiveHeaders(['일자', '가상카드번호'])).toBe(false);
    expect(hasSensitiveHeaders(['일자', '승차인원'])).toBe(false);
  });

  it('requires all anonymized trip identity fields to match before removing an exact duplicate', () => {
    const identity = { serviceDate: '2024-01-01', boardingCount: 10, virtualCardId: 'VC-1', route: 'R1', stationId: 'A', destinationStationId: 'B', transactionId: '0', transferCount: 0 };
    expect(exactDuplicateIndexes([
      identity,
      { ...identity },
      { ...identity, virtualCardId: 'VC-2' },
      { ...identity, transferCount: 1 },
      { ...identity, route: 'R2' },
      { ...identity, transactionId: '1' },
      { ...identity, stationId: 'B' },
      { ...identity, virtualCardId: undefined }
    ])).toEqual([1]);
  });

  it('normalizes virtual card ID and transfer count for Trip-Chain storage', () => {
    const result = normalizeRows([
      { 일자: '2024-01-01', 가상카드번호: ' 001234 ', 노선ID: 'R1', 승차ID: 'A', 하차ID: 'B', 거래ID: '0', 환승건수: '2', 승차: '3' }
    ], {
      dateColumn: '일자',
      boardingCountColumn: '승차',
      virtualCardIdColumn: '가상카드번호',
      routeColumn: '노선ID',
      stationIdColumn: '승차ID',
      destinationStationIdColumn: '하차ID',
      transactionIdColumn: '거래ID',
      transferCountColumn: '환승건수',
      rowSemantics: 'count-column'
    });

    expect(result.records[0]).toMatchObject({ virtualCardId: '001234', route: 'R1', stationId: 'A', destinationStationId: 'B', transactionId: '0', transferCount: 2 });
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

  it('normalizes compact transaction dates and timestamps', () => {
    const result = normalizeRows([
      { 필드1: '20240415', 필드15: '20240415125709', 필드17: '3250842', 필드25: '2' }
    ], { dateColumn: '필드1', timeColumn: '필드15', stationIdColumn: '필드17', boardingCountColumn: '필드25', rowSemantics: 'count-column' });

    expect(result.records[0]).toMatchObject({ serviceDate: '2024-04-15', boardingTime: '12:57:09', stationId: '3250842', boardingCount: 2 });
  });

  it('parses the 28-field transaction fixture without headers', async () => {
    const file = new File([
      readFileSync(new URL('../../fixtures/yeosu-card-transaction-sample.dat', import.meta.url), 'utf8')
    ], 'yeosu-card-transaction-sample.dat');
    const parsed = await parseFileRows(file, { headerRow: -1 });
    const normalized = normalizeRows(parsed.rows, {
      dateColumn: '필드1',
      timeColumn: '필드15',
      virtualCardIdColumn: '필드4',
      transactionIdColumn: '필드22',
      transferCountColumn: '필드23',
      boardingCountColumn: '필드25',
      vehicleIdColumn: '필드8',
      stationIdColumn: '필드17',
      routeColumn: '필드13',
      regionColumn: '필드5',
      rowSemantics: 'count-column'
    });

    expect(parsed.headers).toHaveLength(28);
    expect(parsed.rows).toHaveLength(48);
    expect(normalized.records).toHaveLength(48);
    expect(normalized.records[0]).toMatchObject({ serviceDate: '2024-04-15', boardingTime: '07:35:00', virtualCardId: '990000000001', transactionId: '001', transferCount: 0, vehicleId: '146718039', stationId: '3250842', boardingCount: 1 });
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
    const identity = { virtualCardId: 'VC-1', route: 'R1', stationId: 'A', destinationStationId: 'B', transactionId: '0', transferCount: 0 };
    const records = [
      { ...identity, serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '07:00:00' },
      { ...identity, serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '08:00:00' },
      { ...identity, serviceDate: '2024-01-01', boardingCount: 10, boardingTime: '08:00:00' }
    ];
    expect(exactDuplicateIndexes(records)).toEqual([2]);
  });

  it('normalizes optional station IDs without affecting legacy rows', () => {
    const withStation = normalizeRows([
      { 일자: '2024-01-01', 정류장ID: ' 3250001148 ', 승차: '100' }
    ], { dateColumn: '일자', stationIdColumn: '정류장ID', boardingCountColumn: '승차', rowSemantics: 'count-column' });
    const legacy = normalizeRows([
      { 일자: '2024-01-01', 승차: '100' }
    ], { dateColumn: '일자', boardingCountColumn: '승차', rowSemantics: 'count-column' });

    expect(withStation.records[0].stationId).toBe('3250001148');
    expect(legacy.records[0].stationId).toBeUndefined();
  });

  it('retains valid transactions with missing boarding stations for total demand and quality analysis', () => {
    const result = normalizeRows([
      { 일자: '2024-01-01', 승차ID: 'A', 하차ID: '', 승차: '3' },
      { 일자: '2024-01-01', 승차ID: '', 하차ID: 'B', 승차: '4' }
    ], { dateColumn: '일자', stationIdColumn: '승차ID', destinationStationIdColumn: '하차ID', boardingCountColumn: '승차', rowSemantics: 'count-column' });

    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ stationId: 'A', destinationStationId: undefined, boardingCount: 3 });
    expect(result.records[1]).toMatchObject({ stationId: undefined, destinationStationId: 'B', boardingCount: 4 });
    expect(result.excludedRows).toBe(0);
    expect(result.warnings.join(' ')).toContain('승차 정류장 ID 누락');
    expect(result.warnings.join(' ')).toContain('하차 정류장 ID 누락');
  });

  it('suggests the boarding station ID for the standard headerless transaction layout', () => {
    expect(suggestStationIdColumn(['필드1', ...Array.from({ length: 27 }, (_value, index) => `필드${index + 2}`)])).toBe('필드17');
    expect(suggestStationIdColumn(['운행일자', '승차정류장ID(국토부표준)', '승차인원'])).toBe('승차정류장ID(국토부표준)');
  });

  it('suggests and normalizes the alighting station ID for OD analysis', () => {
    expect(suggestDestinationStationIdColumn(['필드1', ...Array.from({ length: 27 }, (_value, index) => `필드${index + 2}`)])).toBe('필드20');
    const result = normalizeRows([{ 일자: '2024-01-01', 승차ID: 'A', 하차ID: 'B', 승차: '3' }], { dateColumn: '일자', stationIdColumn: '승차ID', destinationStationIdColumn: '하차ID', boardingCountColumn: '승차', rowSemantics: 'count-column' });
    expect(result.records[0].destinationStationId).toBe('B');
  });

  it('suggests the standard transaction mappings for headerless card data', () => {
    const headers = Array.from({ length: 28 }, (_value, index) => `필드${index + 1}`);
    const rows = [{ 필드1: '20240415', 필드4: 'VC-1', 필드8: '146718039', 필드13: '325000002', 필드15: '20240415073500', 필드17: '3250842', 필드20: '3250843', 필드22: 'TX-1', 필드23: '2', 필드25: '2' }];
    expect(suggestTransactionMapping(headers, rows)).toMatchObject({
      dateColumn: '필드1', timeColumn: '필드15', virtualCardIdColumn: '필드4', transactionIdColumn: '필드22', transferCountColumn: '필드23', vehicleIdColumn: '필드8', stationIdColumn: '필드17', destinationStationIdColumn: '필드20', boardingCountColumn: '필드25', routeColumn: '필드13', rowSemantics: 'count-column'
    });
  });

  it('falls back to populated settlement IDs in real 28-field exports', () => {
    const headers = Array.from({ length: 28 }, (_value, index) => `필드${index + 1}`);
    const rows = [{ 필드1: '20240415', 필드8: '146718039', 필드14: '46001001', 필드15: '20240415073500', 필드18: '2710250', 필드21: '2709970', 필드22: 'TX-1', 필드25: '1' }];

    expect(suggestTransactionMapping(headers, rows)).toMatchObject({
      dateColumn: '필드1', timeColumn: '필드15', transactionIdColumn: '필드22', vehicleIdColumn: '필드8', stationIdColumn: '필드18', destinationStationIdColumn: '필드21', boardingCountColumn: '필드25', routeColumn: '필드14', rowSemantics: 'count-column'
    });
  });

  it('uses the boarding timestamp as the date when the service-date field is empty', () => {
    const headers = Array.from({ length: 28 }, (_value, index) => `필드${index + 1}`);
    const rows = [{ 필드1: '', 필드15: '20240415125709', 필드17: '3250842', 필드25: '2' }];
    expect(suggestTransactionMapping(headers, rows)).toMatchObject({
      dateColumn: '필드15', timeColumn: '필드15', boardingCountColumn: '필드25'
    });
  });

  it('infers shifted standard fields when an extract physically omits field 1', () => {
    const headers = Array.from({ length: 27 }, (_value, index) => `필드${index + 1}`);
    const rows = [{ 필드14: '20240415125709', 필드16: '3250842', 필드24: '2', 필드12: '325000002' }];
    expect(suggestTransactionMapping(headers, rows)).toMatchObject({
      dateColumn: '필드14', timeColumn: '필드14', stationIdColumn: '필드16', boardingCountColumn: '필드24', routeColumn: '필드12'
    });
  });

  it('suggests boarding time field 15 from the actual transaction fixture', async () => {
    const file = new File([
      readFileSync(new URL('../../fixtures/yeosu-card-transaction-sample.dat', import.meta.url), 'utf8')
    ], 'yeosu-card-transaction-sample.dat');
    const parsed = await parseFileRows(file, { headerRow: -1 });
    expect(suggestTransactionMapping(parsed.headers, parsed.rows)).toMatchObject({
      dateColumn: '필드1', timeColumn: '필드15', vehicleIdColumn: '필드8', stationIdColumn: '필드17', boardingCountColumn: '필드25', routeColumn: '필드13'
    });
  });

  it('prefers semantic transaction header aliases', () => {
    expect(suggestTransactionMapping(['운행일자', '승차일시', '승차정류장ID(국토부표준)', '이용자수', '노선ID(국토부표준)'])).toMatchObject({
      dateColumn: '운행일자', timeColumn: '승차일시', stationIdColumn: '승차정류장ID(국토부표준)', boardingCountColumn: '이용자수', routeColumn: '노선ID(국토부표준)'
    });
  });
});
