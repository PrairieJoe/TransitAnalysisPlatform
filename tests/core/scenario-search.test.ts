import { describe, expect, it } from 'vitest';
import { rankScenarioSearchOptions } from '../../src/core/scenario-search';

describe('rankScenarioSearchOptions', () => {
  it('orders exact ID, exact name, prefixes, contains, and limited label fuzzy matches', () => {
    const options = [
      { value: 'S-100', label: '다른 정류장' },
      { value: '100', label: '번호 정류장' },
      { value: 'S-200', label: '100번 인근' },
      { value: 'S-300', label: '강남역' }
    ];

    expect(rankScenarioSearchOptions(options, '100').map((option) => option.value)).toEqual(['100', 'S-200', 'S-100']);
    expect(rankScenarioSearchOptions(options, '강남엿').map((option) => option.value)).toEqual(['S-300']);
  });

  it('keeps original order for equal scores and leaves empty queries untouched', () => {
    const options = [
      { value: 'S-1', label: '터미널 북측' },
      { value: 'S-2', label: '터미널 남측' }
    ];

    expect(rankScenarioSearchOptions(options, '터미널').map((option) => option.value)).toEqual(['S-1', 'S-2']);
    expect(rankScenarioSearchOptions(options, ' ')).toBe(options);
  });
});
