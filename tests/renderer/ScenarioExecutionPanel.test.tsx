import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioExecutionPanel from '../../src/renderer/ScenarioExecutionPanel';
import type { ProjectManifest, RouteStopMasterRecord, ScenarioDefinition } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 0, stationId: 'A-1', stationName: 'A-1', latitude: 34.75, longitude: 127.73 },
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 1, stationId: 'A-2', stationName: 'A-2', latitude: 34.76, longitude: 127.74 }
];
const scenario: ScenarioDefinition = {
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-1',
  label: '저장된 A 시나리오',
  routeChanges: [],
  source: { assumptions: [], warnings: [], modelVersions: [] },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02'
};
const project = { id: 'project-1', name: '테스트 프로젝트', scenarioDefinitions: [scenario] } as unknown as ProjectManifest;

it('disables execution when the route master is empty', () => {
  const markup = renderToStaticMarkup(<ScenarioExecutionPanel projectId="project-1" routeStops={[]} serviceConfigs={[]} scenarioDefinitions={[]} onExecutionSaved={vi.fn()} />);

  expect(markup).toContain('실행할 노선 master가 없습니다');
  expect(markup).toContain('disabled=""');
});

it('renders current/scenario selection and explicit actual-vs-fallback quality guidance', () => {
  const markup = renderToStaticMarkup(<ScenarioExecutionPanel projectId={project.id} routeStops={routeStops} serviceConfigs={[]} scenarioDefinitions={[scenario]} onExecutionSaved={vi.fn()} />);

  expect(markup).toContain('시나리오 경로 생성·저장');
  expect(markup).toContain('현재 네트워크');
  expect(markup).toContain('저장된 A 시나리오');
  expect(markup).toContain('fallback 구간은 실제 도로 경로가 아닙니다');
  expect(markup).not.toContain('수요 변화 결과');
  expect(markup).not.toContain('이용요금 결과');
});
