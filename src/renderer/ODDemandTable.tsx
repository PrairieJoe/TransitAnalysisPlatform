import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { formatStationDemand } from '../core/report';
import type { DisplayUnit, ODDemandViewRow } from '../shared/types';

type SortKey = 'rank' | 'originStationName' | 'destinationStationName' | 'dailyAverage';

export default function ODDemandTable({ rows, metricLabel, displayUnit, selectedFlowKey, onSelectFlow }: { rows: ODDemandViewRow[]; metricLabel: string; displayUnit: DisplayUnit; selectedFlowKey?: string; onSelectFlow: (flowKey: string) => void }): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('dailyAverage');
  const [descending, setDescending] = useState(true);
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];
    const comparison = typeof leftValue === 'number' && typeof rightValue === 'number' ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), 'ko');
    return (descending ? -1 : 1) * (comparison || left.rank - right.rank);
  }), [descending, rows, sortKey]);

  function sortBy(nextKey: SortKey): void {
    if (nextKey === sortKey) setDescending((value) => !value);
    else { setSortKey(nextKey); setDescending(nextKey === 'dailyAverage' || nextKey === 'rank'); }
  }

  const metricHeading = metricLabel === '통행량' ? '통행량(건/일)' : displayUnit === 'thousand' ? '승차인원(천 명/일)' : '승차인원(인/일)';
  const heading = (label: string, key: SortKey): JSX.Element => <button className="table-sort-button" onClick={() => sortBy(key)}>{label}{sortKey === key ? descending ? ' ↓' : ' ↑' : ''}</button>;
  return <div className="table-scroll od-table-scroll"><table className="od-flow-table"><thead><tr><th>{heading('순위', 'rank')}</th><th>{heading('승차정류장(O)', 'originStationName')}</th><th>{heading('하차정류장(D)', 'destinationStationName')}</th><th>{heading(metricHeading, 'dailyAverage')}</th></tr></thead><tbody>{sortedRows.map((row) => {
    const key = `${row.originStationId}→${row.destinationStationId}`;
    return <tr key={key} className={selectedFlowKey === key ? 'is-selected' : ''} onClick={() => onSelectFlow(key)}><td>{row.rank}</td><td title={row.originStationId}>{row.originStationName}</td><td title={row.destinationStationId}>{row.destinationStationName}</td><td>{formatStationDemand(row.dailyAverage, displayUnit)}</td></tr>;
  })}</tbody></table></div>;
}
