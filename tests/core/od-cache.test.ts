import { expect, it, vi } from 'vitest';
import { createODAnalysisCache } from '../../src/core/od-cache';
import { analyzeODRecords } from '../../src/core/analysis';
import type { AnalysisConfig, NormalizedRecord } from '../../src/shared/types';

const config: AnalysisConfig = { filter: { from: '2024-01-01', to: '2024-01-01' }, denominator: 'observed' };
const records: NormalizedRecord[] = [{ serviceDate: '2024-01-01', boardingCount: 5, stationId: 'A', destinationStationId: 'B' }];

it('reuses concurrent and repeated mode requests, invalidates filter and data changes', async () => {
  const cache = createODAnalysisCache();
  const compute = vi.fn(async (c: AnalysisConfig) => analyzeODRecords(records, c));
  const first = cache(records, config, compute);
  expect(await cache(records, { ...config }, compute)).toBe(await first);
  await cache(records, { ...config, alightingMode: 'high-confidence' }, compute);
  await cache(records, config, compute);
  expect(compute).toHaveBeenCalledTimes(2);
  await cache(records, { ...config, denominator: 'calendar' }, compute);
  await cache(records, config, compute);
  await cache([...records], config, compute);
  expect(compute).toHaveBeenCalledTimes(5);
});

it('does not retain failed requests', async () => {
  const cache = createODAnalysisCache();
  await expect(cache(records, config, async () => { throw new Error('retry'); })).rejects.toThrow('retry');
  expect((await cache(records, config, async (c) => analyzeODRecords(records, c))).totalBoardings).toBe(5);
});
