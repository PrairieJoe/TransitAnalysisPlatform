import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioDefinitionEditor from '../../src/renderer/ScenarioDefinitionEditor';
import type { ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

const project = { id: 'project-1', name: '테스트 프로젝트', scenarioDefinitions: [] } as unknown as ProjectManifest;
const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 1, stationId: 'B-1', stationName: 'B1', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 2, stationId: 'B-2', stationName: 'B2', latitude: 37, longitude: 127 }
];

it('renders route-definition disclaimer and multiple route cards', () => {
  const markup = renderToStaticMarkup(<ScenarioDefinitionEditor project={project} routeStops={routeStops} onSaveScenarioDefinition={vi.fn(async () => {})} />);
  expect(markup).toContain('시나리오 입력·저장');
  expect(markup).toContain('실제 도로 경로는 다음 단계에서 계산');
  expect(markup).toContain('Before 정류장 경로');
  expect(markup).toContain('After 정류장 순서');
  expect(markup).toContain('노선 추가');
});

it('renders saved scenario labels and route IDs without adding a comparison result', () => {
  const saved = { ...project, scenarioDefinitions: [{ scenarioSchemaVersion: 1, scenarioId: 'saved-1', label: '저장된 A/B 시나리오', routeChanges: [], source: { assumptions: [], warnings: [], modelVersions: [] }, createdAt: '2026-01-01', updatedAt: '2026-01-02' }] } as unknown as ProjectManifest;
  const markup = renderToStaticMarkup(<ScenarioDefinitionEditor project={saved} routeStops={routeStops} onSaveScenarioDefinition={vi.fn(async () => {})} />);
  expect(markup).toContain('저장된 A/B 시나리오');
  expect(markup).toContain('시나리오 정의를 저장');
  expect(markup).not.toContain('MOTIS 여정 비교 결과');
});
