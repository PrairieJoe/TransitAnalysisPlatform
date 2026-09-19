import type { AlightingAnalysisMode, AnalysisConfig, NormalizedRecord, ODDemandResult } from '../shared/types';

/** Records are immutable snapshots. Retain only the current dataset/filter and three modes. */
export function createODAnalysisCache() {
  let source: NormalizedRecord[] | undefined;
  let filterKey = '';
  let results = new Map<AlightingAnalysisMode, Promise<ODDemandResult>>();
  return (records: NormalizedRecord[], config: AnalysisConfig, compute: (config: AnalysisConfig) => Promise<ODDemandResult>): Promise<ODDemandResult> => {
    const { from, to, route, station, region } = config.filter;
    const key = JSON.stringify([from, to, route, station, region, config.denominator]);
    if (source !== records || filterKey !== key) {
      source = records;
      filterKey = key;
      results = new Map();
    }
    const mode = config.alightingMode ?? 'observed';
    const cached = results.get(mode);
    if (cached) return cached;
    const current = results;
    const pending = Promise.resolve().then(() => compute(config)).catch((error) => {
      current.delete(mode);
      throw error;
    });
    current.set(mode, pending);
    return pending;
  };
}
