import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { routeSegmentKey } from '../core/route-demand-view';
import type { RouteSegmentMetric } from '../shared/types';
import { paginateItems } from './route-congestion-table';

const PAGE_SIZE = 250;

type SortKey = 'rank' | 'fromStationName' | 'toStationName' | 'peakOnboardPassengers' | 'congestionPercent';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export default function RouteCongestionTable({ metrics, selectedSegmentKey, onSelectSegment }: { metrics: RouteSegmentMetric[]; selectedSegmentKey?: string; onSelectSegment: (key: string) => void }): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('congestionPercent');
  const [descending, setDescending] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const sorted = useMemo(() => [...metrics].sort((left, right) => {
    if (sortKey === 'congestionPercent') {
      const leftValue = left.congestionPercent;
      const rightValue = right.congestionPercent;
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return (descending ? -1 : 1) * (leftValue - rightValue);
    } else {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      const compared = typeof leftValue === 'string' && typeof rightValue === 'string' ? leftValue.localeCompare(rightValue, 'ko') : Number(leftValue) - Number(rightValue);
      if (compared) return (descending ? -1 : 1) * compared;
    }
    return left.fromSequence - right.fromSequence || left.fromStationId.localeCompare(right.fromStationId, 'en');
  }), [descending, metrics, sortKey]);
  const page = useMemo(() => paginateItems(sorted, pageIndex, PAGE_SIZE), [pageIndex, sorted]);

  useEffect(() => {
    setPageIndex(0);
  }, [descending, metrics, sortKey]);

  function changeSort(nextKey: SortKey): void {
    if (sortKey === nextKey) setDescending((value) => !value);
    else { setSortKey(nextKey); setDescending(nextKey === 'rank' || nextKey === 'peakOnboardPassengers' || nextKey === 'congestionPercent'); }
  }

  const heading = (key: SortKey, label: string): JSX.Element => <button className="table-sort" onClick={() => changeSort(key)}>{label}{sortKey === key ? descending ? ' ↓' : ' ↑' : ''}</button>;
  return <div className="route-table-scroll"><table className="route-congestion-table"><thead><tr><th>{heading('rank', '순위')}</th><th>방향</th><th>정류장</th><th>이전 재차</th><th>승차</th><th>하차</th><th>{heading('peakOnboardPassengers', '재차인원')}</th><th>{heading('congestionPercent', '혼잡도')}</th><th>구간거리</th></tr></thead><tbody>{page.items.length ? page.items.map((metric) => {
    const key = routeSegmentKey(metric);
    return <tr key={key} className={key === selectedSegmentKey ? 'is-selected' : ''} onMouseEnter={() => onSelectSegment(key)} onClick={() => onSelectSegment(key)}><td>{metric.rank}</td><td>{metric.directionLabel}</td><td>{metric.fromStationName} → {metric.toStationName}</td><td>{metric.previousOnboard.toFixed(1)}</td><td>{metric.boardings.toFixed(1)}</td><td>{metric.alightings.toFixed(1)}</td><td>{metric.peakOnboardPassengers.toFixed(1)}</td><td>{formatPercent(metric.congestionPercent)}</td><td>{metric.segmentDistance === undefined ? '—' : metric.segmentDistance.toFixed(1)}</td></tr>;
  }) : <tr><td className="table-empty" colSpan={9}>선택한 조건에 해당하는 노선 구간이 없습니다.</td></tr>}</tbody></table>{page.pageCount > 1 && <nav aria-label="노선 혼잡도 표 페이지" className="table-pagination"><button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>이전</button><span>{pageIndex + 1} / {page.pageCount}페이지 · 전체 {sorted.length.toLocaleString('ko-KR')}개 구간</span><button type="button" disabled={pageIndex >= page.pageCount - 1} onClick={() => setPageIndex((current) => Math.min(page.pageCount - 1, current + 1))}>다음</button></nav>}</div>;
}
