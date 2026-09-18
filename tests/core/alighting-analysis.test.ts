import { describe, expect, it } from 'vitest';
import { analyzeODRecords } from '../../src/core/analysis';
import type { NormalizedRecord } from '../../src/shared/types';

const records: NormalizedRecord[] = [
  {
    serviceDate: '2024-01-01',
    boardingCount: 10,
    stationId: 'A',
    route: 'R1',
    destinationStationId: undefined,
    inferredDestinationStationId: 'C',
    alightingInference: { status: 'inferred-high', method: 'next-boarding', confidence: 0.9 }
  },
  { serviceDate: '2024-01-01', boardingCount: 5, stationId: 'B', destinationStationId: 'C', route: 'R1' }
];

const config = { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' as const };

describe('alighting analysis modes', () => {
  it('keeps observed-only OD totals unchanged', () => {
    const result = analyzeODRecords(records, { ...config, alightingMode: 'observed' });

    expect(result.metrics).toMatchObject([{ originStationId: 'B', destinationStationId: 'C', totalBoardings: 5 }]);
    expect(result.excludedRows).toBe(1);
  });

  it('includes high-confidence inferred destinations when requested', () => {
    const result = analyzeODRecords(records, { ...config, alightingMode: 'high-confidence' });

    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ originStationId: 'A', destinationStationId: 'C', totalBoardings: 10 }),
      expect.objectContaining({ originStationId: 'B', destinationStationId: 'C', totalBoardings: 5 })
    ]));
    expect(result.excludedRows).toBe(0);
  });
});
