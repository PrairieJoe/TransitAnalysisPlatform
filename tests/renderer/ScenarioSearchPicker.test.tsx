import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ScenarioSearchPicker, { filterScenarioSearchOptions } from '../../src/renderer/ScenarioSearchPicker';

const options = [
  { value: 'S1', label: '강남역', meta: 'ID S1', searchText: '12345' },
  { value: 'S2', label: '강변역', meta: 'ID S2', searchText: '54321' }
];

describe('ScenarioSearchPicker', () => {
  it('filters by label, ID, and additional search text', () => {
    expect(filterScenarioSearchOptions(options, '강남')).toHaveLength(1);
    expect(filterScenarioSearchOptions(options, 's2')[0].value).toBe('S2');
    expect(filterScenarioSearchOptions(options, '12345')[0].value).toBe('S1');
  });

  it('ranks exact ID, exact name, prefixes, contains, and small typos deterministically', () => {
    const ranked = filterScenarioSearchOptions([
      { value: 'S-100', label: '다른 정류장' },
      { value: '100', label: '번호 정류장' },
      { value: 'S-200', label: '100번 인근' },
      { value: 'S-300', label: '강남역' },
      { value: 'S-400', label: '강남엿' },
      { value: 'S-500', label: '강남로' }
    ], '100');

    expect(ranked.map((option) => option.value)).toEqual(['100', 'S-200', 'S-100']);
    expect(filterScenarioSearchOptions([
      { value: 'S-1', label: '터미널 북측' },
      { value: 'S-2', label: '터미널 남측' }
    ], '터미널').map((option) => option.value)).toEqual(['S-1', 'S-2']);
    expect(filterScenarioSearchOptions([{ value: 'S-300', label: '강남역' }], '강남엿')[0].value).toBe('S-300');
  });

  it('renders a searchable listbox instead of a long select', () => {
    const markup = renderToStaticMarkup(<ScenarioSearchPicker id="station-search" label="기존 정류장 추가" options={options} onSelect={() => {}} clearAfterSelect />);

    expect(markup).toContain('type="search"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('강남역');
    expect(markup).not.toContain('<select');
  });
});
