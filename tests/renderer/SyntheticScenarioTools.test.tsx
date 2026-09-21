import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SyntheticScenarioTools from '../../src/renderer/SyntheticScenarioTools';
import type { ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 }
];
const project = { id: 'project-1', name: '테스트', scenarioDefinitions: [], scenarioExecutionManifests: [], scenarioJourneyManifests: [] } as unknown as ProjectManifest;

describe('SyntheticScenarioTools', () => {
  it('keeps advanced tools collapsed and exposes demand tools at the batch step', () => {
    const markup = renderToStaticMarkup(
      <SyntheticScenarioTools
        projectId={project.id}
        demand={undefined}
        routeStops={routeStops}
        serviceConfigs={[]}
        scenarioDefinitions={[]}
        activeStep="batch"
      />
    );

    expect(markup).toContain('고급 다중 노선·레거시 실증');
    expect(markup).toContain('시나리오 수요 추정');
    expect(markup).toContain('<details');
  });
});
