import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReportDomainNavigation from '../../src/renderer/ReportDomainNavigation';

describe('report domain navigation', () => {
  it('renders analysis, planning, and routing as separate top-level domains', () => {
    const markup = renderToStaticMarkup(
      <ReportDomainNavigation activeDomain="analysis" onSelectDomain={() => {}} />
    );

    expect(markup).toContain('분석');
    expect(markup).toContain('계획·시나리오');
    expect(markup).toContain('경로탐색');
    expect(markup).toContain('report-domain-nav');
    expect(markup).toContain('aria-selected="true"');
  });
});
