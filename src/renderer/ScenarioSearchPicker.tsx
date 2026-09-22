import { useEffect, useMemo, useState, type JSX } from 'react';

export interface ScenarioSearchOption {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
}

export interface ScenarioSearchPickerProps {
  id: string;
  label: string;
  options: ScenarioSearchOption[];
  selectedValue?: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  clearAfterSelect?: boolean;
}

export function filterScenarioSearchOptions(options: ScenarioSearchOption[], query: string): ScenarioSearchOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('ko');
  if (!normalizedQuery) return options;
  return options.filter((option) => [option.label, option.value, option.meta ?? '', option.searchText ?? '']
    .join(' ')
    .toLocaleLowerCase('ko')
    .includes(normalizedQuery));
}

export default function ScenarioSearchPicker({ id, label, options, selectedValue, onSelect, placeholder = '이름 또는 ID로 검색', clearAfterSelect = false }: ScenarioSearchPickerProps): JSX.Element {
  const selected = options.find((option) => option.value === selectedValue);
  const [query, setQuery] = useState(selected?.label ?? '');
  const visibleOptions = useMemo(() => filterScenarioSearchOptions(options, query).slice(0, 80), [options, query]);

  useEffect(() => {
    setQuery(selected?.label ?? '');
  }, [selected?.label, selectedValue]);

  function select(value: string): void {
    onSelect(value);
    setQuery(clearAfterSelect ? '' : options.find((option) => option.value === value)?.label ?? '');
  }

  return <div className="scenario-search-picker">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="search" value={query} placeholder={placeholder} onChange={(event) => setQuery(event.target.value)} />
    <div className="scenario-search-picker-meta" aria-live="polite">{visibleOptions.length}개 후보</div>
    <div className="scenario-search-picker-options" role="listbox" aria-label={`${label} 검색 결과`}>
      {visibleOptions.length ? visibleOptions.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === selectedValue} onClick={() => select(option.value)}>
        <span><strong>{option.label}</strong>{option.meta && <small>{option.meta}</small>}</span>
      </button>) : <span className="scenario-search-picker-empty">검색 결과가 없습니다.</span>}
    </div>
  </div>;
}
