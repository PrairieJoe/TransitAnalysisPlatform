import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ScenarioWorkspaceEntry from '../../src/renderer/ScenarioWorkspaceEntry';

describe('scenario workspace entry', () => {
  it('renders the plan entry separately from report utilities', () => {
    const markup = renderToStaticMarkup(
      <ScenarioWorkspaceEntry routeCount={2} hasRouteStops onOpen={() => {}} />
    );

    expect(markup).toContain('노선 개편 시나리오');
    expect(markup).toContain('노선 개편 시나리오 시작');
  });

  it('explains why planning is unavailable without route master data', () => {
    const markup = renderToStaticMarkup(
      <ScenarioWorkspaceEntry routeCount={0} hasRouteStops={false} onOpen={() => {}} />
    );

    expect(markup).toContain('노선별 정류장정보가 필요합니다');
    expect(markup).toContain('disabled');
  });
});
