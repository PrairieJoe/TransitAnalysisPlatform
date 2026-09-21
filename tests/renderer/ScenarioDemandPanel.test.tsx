import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioDemandPanel, { ScenarioDemandResultView } from '../../src/renderer/ScenarioDemandPanel';
import type { ScenarioDemandEstimationResult } from '../../src/core/scenario-demand-estimation';
import type {
  AnalysisConfig,
  ODDemandResult,
  RouteStopMasterRecord,
  ScenarioExecutionEnvironment,
  ScenarioExecutionManifest,
  ScenarioDefinition
} from '../../src/shared/types';

const environment: ScenarioExecutionEnvironment = {
  osmPbfFileName: 'region.osm.pbf',
  osmPbfSha256: 'pbf-sha',
  routingProfile: 'bus',
  travelTimeModelVersion: 'model-1',
  motisVersion: '2.11.3'
};

const analysisConfig: AnalysisConfig = {
  filter: { from: '2026-09-20', to: '2026-09-20' },
  denominator: 'observed',
  alightingMode: 'observed'
};

const demand: ODDemandResult = {
  metrics: [{ originStationId: 'O', destinationStationId: 'D', dailyAverage: 10, totalBoardings: 10, rank: 1 }],
  selectedDays: 1,
  totalBoardings: 10,
  excludedRows: 0,
  unmatchedOriginCount: 0,
  unmatchedDestinationCount: 0,
  warnings: [],
  config: analysisConfig
};

const scenario: ScenarioDefinition = {
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-a',
  label: '시나리오 A',
  routeChanges: [],
  journeyQueries: [],
  source: { assumptions: [], warnings: [], modelVersions: [] },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
};

const scenarioB: ScenarioDefinition = { ...scenario, scenarioId: 'scenario-b', label: '시나리오 B' };

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'BUS', stationSequence: 1, stationId: 'O', stationName: '출발역', latitude: 37, longitude: 127 },
  { routeId: 'R1', routeName: '1번 노선', transportMode: 'BUS', stationSequence: 2, stationId: 'D', stationName: '도착역', latitude: 37.1, longitude: 127.1 }
];

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

const comparableEnvironment = {
  comparable: true,
  warnings: [],
  before: environment,
  after: environment
};

const result: ScenarioDemandEstimationResult = {
  demandSchemaVersion: 1,
  model: { modelVersion: 'scenario-demand-direct-logit-v1', choiceSensitivity: 0.08, waitTimeWeight: 1 },
  source: { selectedDays: 1, analysisConfig, totalBoardings: 10, demandWarnings: [], assumptions: ['직접 운행 후보만 반영'] },
  before: { kind: 'current', executionId: 'current-1', label: '현재 네트워크' },
  after: { kind: 'scenario', scenarioId: 'scenario-a', executionId: 'scenario-a-1', label: '시나리오 A' },
  environment: comparableEnvironment,
  totals: { observedDailyAverage: 10, beforeServedDailyAverage: 10, afterServedDailyAverage: 8, beforeUnservedDailyAverage: 0, afterUnservedDailyAverage: 2 },
  od: [{
    originStationId: 'O',
    destinationStationId: 'D',
    observedDailyAverage: 10,
    beforeDailyAverage: 10,
    afterDailyAverage: 8,
    deltaDailyAverage: -2,
    unservedBeforeDailyAverage: 0,
    unservedAfterDailyAverage: 2,
    beforeAssignments: [{ routeId: 'R1', direction: 'forward', share: 1, dailyAverage: 10, confidence: 'high', warnings: [] }],
    afterAssignments: [],
    warnings: ['After 직접 운행 후보 없음']
  }],
  routes: [{ routeId: 'R1', routeName: '1번 노선', beforeBoardings: 10, afterBoardings: 8, deltaBoardings: -2, beforeAlightings: 10, afterAlightings: 8, deltaAlightings: -2, confidence: 'medium', warnings: ['경고'] }],
  stations: [{ stationId: 'O', beforeBoardings: 10, afterBoardings: 8, deltaBoardings: -2, beforeAlightings: 0, afterAlightings: 0, deltaAlightings: 0, warnings: [] }],
  warnings: ['결과 전역 경고']
};

const panelProps = {
  projectId: 'project-1',
  routeStops,
  scenarioDefinitions: [scenario],
  scenarioExecutionManifests: [manifest({ kind: 'current' }, 'current-1'), manifest({ kind: 'scenario', scenarioId: 'scenario-a' }, 'scenario-a-1')]
};

it('renders an OD prerequisite state when no OD result exists', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandPanel {...panelProps} />);

  expect(markup).toContain('시나리오 수요 추정');
  expect(markup).toContain('OD 수요 분석을 먼저 실행하세요');
  expect(markup).toContain('disabled=""');
});

it('blocks estimation until two completed execution artifacts are available', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandPanel
    {...panelProps}
    demand={demand}
    scenarioExecutionManifests={[manifest({ kind: 'current' }, 'current-1'), manifest({ kind: 'scenario', scenarioId: 'scenario-a' }, 'scenario-a-1', 'failed')]}
  />);

  expect(markup).toContain('완료된 실행 artifact 2개가 필요합니다');
  expect(markup).toContain('실패');
  expect(markup).toContain('disabled=""');
});

it('renders the supported targets, model disclosure, and demand limitations', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandPanel {...panelProps} demand={demand} />);

  expect(markup).toContain('현재 네트워크');
  expect(markup).toContain('시나리오 A');
  expect(markup).toContain('scenario-demand-direct-logit-v1');
  expect(markup).toContain('choiceSensitivity = 0.08');
  expect(markup).toContain('환승·운임·다중 노선 경로는 반영하지 않습니다');
  expect(markup).toContain('시나리오 수요 추정 실행');
});

it('renders scenario-to-scenario target options with their real labels', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandPanel
    {...panelProps}
    demand={demand}
    scenarioDefinitions={[scenario, scenarioB]}
    scenarioExecutionManifests={[
      manifest({ kind: 'scenario', scenarioId: 'scenario-a' }, 'scenario-a-1'),
      manifest({ kind: 'scenario', scenarioId: 'scenario-b' }, 'scenario-b-1')
    ]}
  />);

  expect(markup).toContain('시나리오 A');
  expect(markup).toContain('시나리오 B');
});

it('defaults to the latest successful scenario when multiple scenarios are available', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandPanel
    {...panelProps}
    demand={demand}
    scenarioDefinitions={[scenario, scenarioB]}
    scenarioExecutionManifests={[
      manifest({ kind: 'scenario', scenarioId: 'scenario-a' }, 'scenario-a-1'),
      { ...manifest({ kind: 'scenario', scenarioId: 'scenario-b' }, 'scenario-b-1'), updatedAt: '2026-09-21T00:00:00.000Z' }
    ]}
  />);

  expect(markup).toContain('<option value="scenario-b-1" selected="">시나리오 B');
});

it('renders route, station, and OD results without overstating certainty', () => {
  const markup = renderToStaticMarkup(<ScenarioDemandResultView result={result} stationNames={{ O: '출발역', D: '도착역' }} />);

  expect(markup).toContain('관측 OD 일평균');
  expect(markup).toContain('노선별 수요 변화');
  expect(markup).toContain('정류장별 수요 변화');
  expect(markup).toContain('OD별 수요 변화');
  expect(markup).toContain('출발역');
  expect(markup).toContain('1번 노선');
  expect(markup).toContain('결과 전역 경고');
  expect(markup).not.toContain('탄력성');
  expect(markup).not.toContain('확정 노선 선택');
  expect(markup).not.toContain('요금 절감');
});

it('hides numeric results when execution environments are not comparable', () => {
  const blocked: ScenarioDemandEstimationResult = {
    ...result,
    environment: { ...comparableEnvironment, comparable: false, warnings: ['OSM PBF가 일치하지 않습니다.'] },
    totals: { observedDailyAverage: 0, beforeServedDailyAverage: 0, afterServedDailyAverage: 0, beforeUnservedDailyAverage: 0, afterUnservedDailyAverage: 0 },
    routes: [],
    stations: [],
    od: []
  };
  const markup = renderToStaticMarkup(<ScenarioDemandResultView result={blocked} />);

  expect(markup).toContain('수요 재배분 계산 불가');
  expect(markup).toContain('OSM PBF가 일치하지 않습니다.');
  expect(markup).not.toContain('관측 OD 일평균');
  expect(markup).not.toContain('노선별 수요 변화');
});
