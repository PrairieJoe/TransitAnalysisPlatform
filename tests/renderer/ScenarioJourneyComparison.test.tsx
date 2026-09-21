import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioJourneyComparison, { ScenarioJourneyResultView } from '../../src/renderer/ScenarioJourneyComparison';
import type { ScenarioJourneyResult } from '../../src/core/scenario-journey';
import type { RouteStopMasterRecord, ScenarioDefinition } from '../../src/shared/types';

const environment = {
  osmPbfSha256: 'pbf-sha',
  motisBinarySha256: 'motis-sha',
  motisManifestSchemaVersion: 2 as const,
  pedestrianProfile: 'FOOT' as const,
  maxTransfers: 3,
  maxPreTransitTimeSeconds: 1800,
  maxPostTransitTimeSeconds: 1800,
  maxMatchingDistanceMeters: 1000
};

function journey(found: boolean, warning?: string) {
  return {
    found,
    totalSeconds: found ? 900 : 0,
    accessWalkSeconds: found ? 60 : 0,
    egressWalkSeconds: found ? 45 : 0,
    initialWaitSeconds: found ? 120 : 0,
    transferWaitSeconds: found ? 30 : 0,
    transferWalkSeconds: found ? 40 : 0,
    accessWalkMeters: found ? 500 : 0,
    transferWalkMeters: found ? 300 : 0,
    egressWalkMeters: found ? 350 : 0,
    directWalkSeconds: 0,
    directWalkMeters: 0,
    transferCount: found ? 1 : 0,
    inVehicleSeconds: found ? 600 : 0,
    walkMeters: found ? 1150 : 0,
    legs: found ? [{ mode: 'BUS', rideSeconds: 600, waitSeconds: 0, walkSeconds: 0, walkMeters: 0 }] : [],
    warnings: warning ? [warning] : []
  };
}

const result: ScenarioJourneyResult = {
  executionSchemaVersion: 1,
  executionId: 'journey-1',
  inputFingerprint: 'fingerprint',
  before: { target: { kind: 'current' }, journeys: [journey(true)] },
  after: { target: { kind: 'scenario', scenarioId: 'scenario-1' }, journeys: [journey(false, 'After 경로 없음')] },
  queries: [{ origin: { kind: 'coordinate', latitude: 37, longitude: 127, label: '출발지' }, destination: { kind: 'coordinate', latitude: 37.1, longitude: 127.1, label: '도착지' }, departureDateTime: '2026-09-21T08:00' }],
  environment,
  status: 'partial',
  warnings: ['한쪽 질의의 경로를 찾지 못했습니다.'],
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z'
};

it('renders bounded A–B result status, missing-side state, and journey cause fields', () => {
  const markup = renderToStaticMarkup(<ScenarioJourneyResultView result={result} />);

  expect(markup).toContain('부분 결과');
  expect(markup).toContain('경로 없음');
  expect(markup).toContain('접근 보행');
  expect(markup).toContain('환승 보행');
  expect(markup).toContain('귀가 보행');
  expect(markup).toContain('직접 보행');
  expect(markup).toContain('차량 탑승');
  expect(markup).toContain('대기');
  expect(markup).toContain('한쪽 질의의 경로를 찾지 못했습니다.');
  expect(markup).not.toContain('legs');
});

it('repeats the identical departure time for Before and After and downgrades warned completion', () => {
  const completeWithWarning: ScenarioJourneyResult = {
    ...result,
    status: 'complete',
    warnings: ['MOTIS 직접 보행 경고'],
    after: { ...result.after, journeys: [journey(true, 'MOTIS 직접 보행 경고')] }
  };
  const markup = renderToStaticMarkup(<ScenarioJourneyResultView result={completeWithWarning} />);

  expect(markup.match(/2026-09-21T08:00/g)).toHaveLength(3);
  expect(markup).toContain('부분 결과');
  expect(markup).not.toContain('A–B 비교 결과 · 완료');
});

it('renders the main-process A–B controls from a saved coordinate query', () => {
  const definition: ScenarioDefinition = {
    scenarioSchemaVersion: 2,
    scenarioId: 'scenario-1',
    label: '좌표 변경 시나리오',
    routeChanges: [],
    journeyQueries: result.queries,
    source: { assumptions: [], warnings: [], modelVersions: ['test'] },
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z'
  };
  const routeStops: RouteStopMasterRecord[] = [
    { routeId: 'R1', routeName: '1번', transportMode: 'bus', stationSequence: 1, stationId: 'S1', stationName: '출발', latitude: 37, longitude: 127 },
    { routeId: 'R1', routeName: '1번', transportMode: 'bus', stationSequence: 2, stationId: 'S2', stationName: '도착', latitude: 37.1, longitude: 127.1 }
  ];
  const markup = renderToStaticMarkup(<ScenarioJourneyComparison projectId="project-1" routeStops={routeStops} serviceConfigs={[]} scenarioDefinitions={[definition]} />);

  expect(markup).toContain('좌표 A–B 여정 비교');
  expect(markup).toContain('PBF 선택');
  expect(markup).toContain('A–B 비교 실행');
  expect(markup).toContain('출발지 → 도착지');
});

it('labels an after-only journey without treating the missing current side as an execution error', () => {
  const afterOnlyResult: ScenarioJourneyResult = {
    ...result,
    status: 'partial',
    before: { ...result.before, journeys: [journey(false)] },
    after: { ...result.after, journeys: [journey(true)] },
    warnings: []
  };
  const markup = renderToStaticMarkup(<ScenarioJourneyResultView result={afterOnlyResult} />);

  expect(markup).toContain('현행 대응 없음');
  expect(markup).toContain('개편안 신규 경로');
  expect(markup).not.toContain('실행 오류');
});
