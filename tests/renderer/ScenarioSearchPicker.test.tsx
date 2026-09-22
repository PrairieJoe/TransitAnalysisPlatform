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

  it('renders a searchable listbox instead of a long select', () => {
    const markup = renderToStaticMarkup(<ScenarioSearchPicker id="station-search" label="기존 정류장 추가" options={options} onSelect={() => {}} clearAfterSelect />);

    expect(markup).toContain('type="search"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('강남역');
    expect(markup).not.toContain('<select');
  });
});
