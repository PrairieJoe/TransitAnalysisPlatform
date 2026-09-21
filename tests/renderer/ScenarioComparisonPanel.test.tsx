import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioComparisonPanel, { ComparisonResultView } from '../../src/renderer/ScenarioComparisonPanel';
import type { ScenarioComparisonResult } from '../../src/core/scenario-comparison';
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
  expect(markup).toContain('요금 계산 불가');
  expect(markup).toContain('실행 시각');
});

it('renders an empty comparison state with one editable journey query', () => {
  const markup = renderToStaticMarkup(<ScenarioComparisonPanel
    projectId={project.id}
    routeStops={routeStops}
    serviceConfigs={[]}
    scenarioDefinitions={[]}
    scenarioExecutionManifests={[]}
  />);

  expect(markup).toContain('비교할 실행 결과가 없습니다');
  expect(markup).toContain('비교 출발 정류장 ID 1');
  expect(markup).toContain('비교 실행');
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

it('renders scenario-to-scenario labels, journey breakdown, and all operation changes', () => {
  const result: ScenarioComparisonResult = {
    comparisonSchemaVersion: 1,
    before: { kind: 'scenario', scenarioId: 'scenario-a', executionId: 'exec-a', label: '시나리오 A' },
    after: { kind: 'scenario', scenarioId: 'scenario-b', executionId: 'exec-b', label: '시나리오 B' },
    environment: { comparable: true, warnings: [], before: environment, after: environment },
    routes: [{
      routeId: 'A', routeName: { before: '노선-A', after: '노선-A', changed: false }, transportMode: { before: 'BUS', after: 'BUS', changed: false },
      beforeStopIds: ['a-1'], afterStopIds: ['a-2'], addedStopIds: ['a-2'], removedStopIds: ['a-1'], reordered: false,
      distanceMeters: { before: 1000, after: 1200, delta: 200 }, runtimeSeconds: { before: 120, after: 150, delta: 30 }, status: 'complete', warnings: [],
      operation: {
        serviceDays: { before: [0, 1], after: [0, 1, 5], changed: true },
        firstDeparture: { before: '06:00', after: '05:30', changed: true }, lastDeparture: { before: '22:00', after: '23:00', changed: true },
        headwayMinutes: { before: 20, after: 15, delta: -5, changed: true }, vehicleCount: { before: 4, after: 5, delta: 1, changed: true },
        dwellSeconds: { before: 20, after: 30, delta: 10, changed: true }, deriveReverseDirection: { before: false, after: true, changed: true }
      }
    }],
    journeys: [{
      query: { originStopId: 'a-1', destinationStopId: 'a-2', departureDateTime: '2026-09-20T08:00' },
      before: { found: true, totalSeconds: 900, accessWalkSeconds: 60, egressWalkSeconds: 30, initialWaitSeconds: 120, transferWaitSeconds: 0, transferWalkSeconds: 0, transferCount: 0, inVehicleSeconds: 690, walkMeters: 100, legs: [{ mode: 'BUS', rideSeconds: 690, waitSeconds: 0, walkSeconds: 0, walkMeters: 0 }], warnings: [] },
      after: { found: true, totalSeconds: 840, accessWalkSeconds: 30, egressWalkSeconds: 20, initialWaitSeconds: 60, transferWaitSeconds: 0, transferWalkSeconds: 0, transferCount: 0, inVehicleSeconds: 730, walkMeters: 80, legs: [{ mode: 'BUS', rideSeconds: 730, waitSeconds: 0, walkSeconds: 0, walkMeters: 0 }], warnings: [] },
      journey: { before: {} as never, after: {} as never, delta: { totalSeconds: -60, accessWalkSeconds: -30, egressWalkSeconds: -10, initialWaitSeconds: -60, transferWaitSeconds: 0, transferWalkSeconds: 0, transferCount: 0, inVehicleSeconds: 40, walkMeters: -20 }, causeBreakdown: {}, warnings: [] },
      fare: { status: 'unavailable', amount: null, reason: '운임 규칙과 교통카드 환승 정책이 연결되지 않았습니다.' }
    }],
    warnings: []
  };
  const markup = renderToStaticMarkup(<ComparisonResultView result={result} />);

  expect(markup).toContain('시나리오 A');
  expect(markup).toContain('시나리오 B');
  expect(markup).toContain('차량 탑승시간');
  expect(markup).toContain('대기시간');
  expect(markup).toContain('보행시간');
  expect(markup).toContain('운행요일');
  expect(markup).toContain('정차시간');
  expect(markup).toContain('역방향 파생');
});

it('renders an after-only route as an explicit new route state', () => {
  const result: ScenarioComparisonResult = {
    comparisonSchemaVersion: 1,
    before: { kind: 'current', executionId: 'current-1', label: '현행' },
    after: { kind: 'scenario', scenarioId: 'scenario-1', executionId: 'scenario-1', label: '노선 신설안' },
    environment: { comparable: true, warnings: [], before: environment, after: environment },
    routes: [{
      routeId: 'N-1',
      routeName: { before: null, after: '신규 순환선', changed: true },
      transportMode: { before: null, after: 'BUS', changed: true },
      beforeStopIds: [], afterStopIds: ['a-1', 'a-2'], addedStopIds: ['a-1', 'a-2'], removedStopIds: [], reordered: false,
      distanceMeters: { before: null, after: 1200, delta: null }, runtimeSeconds: { before: null, after: 300, delta: null },
      status: 'new' as never, warnings: [], operation: {} as never
    } as never],
    journeys: [],
    warnings: []
  };
  const markup = renderToStaticMarkup(<ComparisonResultView result={result} />);

  expect(markup).toContain('신규 노선');
  expect(markup).toContain('현행 대응 없음');
  expect(markup).toContain('개편안 신규 경로');
});
