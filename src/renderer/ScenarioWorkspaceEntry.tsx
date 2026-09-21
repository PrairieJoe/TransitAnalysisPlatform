import React from 'react';

export interface ScenarioWorkspaceEntryProps {
  routeCount: number;
  hasRouteStops: boolean;
  onOpen: () => void;
}

export default function ScenarioWorkspaceEntry({ routeCount, hasRouteStops, onOpen }: ScenarioWorkspaceEntryProps): JSX.Element {
  return <section className="scenario-workspace-entry panel">
    <div className="scenario-workspace-entry-copy">
      <p className="eyebrow">계획·시나리오</p>
      <h2>노선 개편 시나리오</h2>
      <p>현행 노선을 기준으로 정류장을 추가·삭제·순서 변경하고, 개편 전후의 결과를 같은 조건에서 비교합니다.</p>
      <small>{hasRouteStops ? `불러온 노선 ${routeCount.toLocaleString('ko-KR')}개` : '노선별 정류장정보를 먼저 준비하세요.'}</small>
    </div>
    <div className="scenario-workspace-entry-action">
      {!hasRouteStops && <p className="scenario-workspace-entry-warning">노선별 정류장정보가 필요합니다</p>}
      <button type="button" className="primary-button" disabled={!hasRouteStops} onClick={onOpen}>노선 개편 시나리오 시작 <span>→</span></button>
    </div>
  </section>;
}
