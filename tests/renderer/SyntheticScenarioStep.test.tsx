import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SyntheticScenarioStep from '../../src/renderer/SyntheticScenarioStep';
import type { ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

const project = { id: 'project-1', name: '테스트 프로젝트', records: [], sourceFiles: ['sample.csv'] } as unknown as ProjectManifest;
const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'A', stationName: 'A 정류장', latitude: 37.1, longitude: 127.1 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'B', stationName: 'B 정류장', latitude: 37.2, longitude: 127.2 }
];

describe('SyntheticScenarioStep', () => {
  it('opens with the route scenario shell instead of the dense legacy form', () => {
    const markup = renderToStaticMarkup(<SyntheticScenarioStep project={project} routeStops={routeStops} serviceConfigs={[]} onSaveScenarioDefinition={async () => {}} />);

    expect(markup).toContain('노선 개편 시나리오');
    expect(markup).toContain('현행 정류장');
    expect(markup).not.toContain('시나리오 입력·저장');
    expect(markup).not.toContain('Before 정류장 경로');
  });
});
