import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioComparisonPanel from '../../src/renderer/ScenarioComparisonPanel';
import type { ProjectManifest, ScenarioDefinition, ScenarioExecutionEnvironment, ScenarioExecutionManifest, RouteStopMasterRecord } from '../../src/shared/types';

const environment: ScenarioExecutionEnvironment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'sha-1',
  routingProfile: 'bus',
  travelTimeModelVersion: 'model-1',
  motisVersion: '2.11.3'
};

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 0, stationId: 'a-1', stationName: 'A-1', latitude: 34.75, longitude: 127.73 },
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 1, stationId: 'a-2', stationName: 'A-2', latitude: 34.76, longitude: 127.74 }
];

const scenario: ScenarioDefinition = {
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-1',
  label: 'A 변경',
  routeChanges: [],
  journeyQueries: [{ originStopId: 'a-1', destinationStopId: 'a-2', departureDateTime: '2026-09-20T08:00' }],
  source: { assumptions: [], warnings: [], modelVersions: ['model-1'] },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
};

function manifest(target: ScenarioExecutionManifest['target'], executionId: string, status: ScenarioExecutionManifest['status'] = 'complete'): ScenarioExecutionManifest {
  return {
    executionSchemaVersion: 1,
    executionId,
    target,
    inputFingerprint: `fingerprint-${executionId}`,
    environment,
    status,
    routeCount: 1,
    completeRouteCount: status === 'complete' ? 1 : 0,
    warningCount: status === 'complete' ? 0 : 1,
    artifactFileName: `scenario-executions/${executionId}.json`,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };
}

const project = { id: 'project-1', name: '테스트 프로젝트' } as ProjectManifest;

it('renders current/scenario comparison controls and the supported analysis scope', () => {
  const markup = renderToStaticMarkup(<ScenarioComparisonPanel
    projectId={project.id}
    routeStops={routeStops}
    serviceConfigs={[]}
    scenarioDefinitions={[scenario]}
    scenarioExecutionManifests={[manifest({ kind: 'current' }, 'current-1'), manifest({ kind: 'scenario', scenarioId: 'scenario-1' }, 'scenario-1')]}
  />);

  expect(markup).toContain('현행·시나리오 비교');
  expect(markup).toContain('현재 네트워크');
  expect(markup).toContain('A 변경');
  expect(markup).toContain('노선·운행정보 비교');
  expect(markup).toContain('X→Y 여정 비교');
  expect(markup).toContain('이용요금');
});

it('does not offer failed artifacts and explains why comparison is unavailable', () => {
  const markup = renderToStaticMarkup(<ScenarioComparisonPanel
    projectId={project.id}
    routeStops={routeStops}
    serviceConfigs={[]}
    scenarioDefinitions={[scenario]}
    scenarioExecutionManifests={[manifest({ kind: 'current' }, 'current-1'), manifest({ kind: 'scenario', scenarioId: 'scenario-1' }, 'scenario-1', 'failed')]}
  />);

  expect(markup).toContain('실패');
  expect(markup).toContain('완료된 실행 결과 2개가 필요합니다');
  expect(markup).toContain('disabled=""');
});

it('requires a route master before enabling comparison', () => {
  const markup = renderToStaticMarkup(<ScenarioComparisonPanel
    projectId={project.id}
    routeStops={[]}
    serviceConfigs={[]}
    scenarioDefinitions={[scenario]}
    scenarioExecutionManifests={[manifest({ kind: 'current' }, 'current-1'), manifest({ kind: 'scenario', scenarioId: 'scenario-1' }, 'scenario-1')]}
    onComparisonComplete={vi.fn()}
  />);

  expect(markup).toContain('비교할 노선 master가 없습니다');
  expect(markup).toContain('disabled=""');
});
