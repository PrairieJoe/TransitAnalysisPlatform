import React from 'react';

export type ReportDomain = 'analysis' | 'planning';

export interface ReportDomainNavigationProps {
  activeDomain: ReportDomain;
  onSelectDomain: (domain: ReportDomain) => void;
}

export default function ReportDomainNavigation({ activeDomain, onSelectDomain }: ReportDomainNavigationProps): JSX.Element {
  return <nav className="report-domain-navigation" aria-label="보고서 영역">
    <button type="button" className={activeDomain === 'analysis' ? 'active' : ''} role="tab" aria-selected={activeDomain === 'analysis'} onClick={() => onSelectDomain('analysis')}>분석</button>
    <button type="button" className={activeDomain === 'planning' ? 'active' : ''} role="tab" aria-selected={activeDomain === 'planning'} onClick={() => onSelectDomain('planning')}>계획·시나리오</button>
  </nav>;
}
