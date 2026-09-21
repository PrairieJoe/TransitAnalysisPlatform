import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { upsertScenarioDefinition } from '../../src/core/scenario-editor';
import { buildGenerationInputSnapshot, buildScenarioExplanationCopy, buildScenarioResultSummary } from '../../src/renderer/SyntheticGtfsBuilder';
import SyntheticGtfsBuilder from '../../src/renderer/SyntheticGtfsBuilder';
import SyntheticGenerationStep from '../../src/renderer/SyntheticGenerationStep';
import type { ProjectManifest, RouteStopMasterRecord, ScenarioDefinition } from '../../src/shared/types';

describe('Synthetic GTFS explanation copy', () => {
  it('identifies Before as the current route and After as the user scenario', () => {
    const copy = buildScenarioExplanationCopy('101번 · R101', '8', 'A,B,C');

    expect(copy.before).toContain('현재 노선별 정류장정보');
    expect(copy.before).toContain('101번 · R101');
    expect(copy.after).toContain('사용자가 입력한 정류장 순서');
  });

  it('includes a fleet-assumption caution when vehicle count exists', () => {
    const copy = buildScenarioExplanationCopy('101번 · R101', '8', 'A,B,C');

    expect(copy.fleetCaution).toContain('운행대수 8대');
    expect(copy.fleetCaution).toContain('실제 차량별 배차·회차는 검증하지 않았습니다');
  });

  it('omits the fleet-assumption caution when vehicle count is empty', () => {
    expect(buildScenarioExplanationCopy('101번 · R101', '  ', 'A,B,C').fleetCaution).toBeUndefined();
  });

  it('explains that a blank After input keeps the current route order', () => {
    const copy = buildScenarioExplanationCopy('101번 · R101', '8', '  ');

    expect(copy.after).toContain('입력란을 비워 현재 노선 정류장 순서를 그대로 사용');
  });

  it('keeps generated summary values from the captured input snapshot', () => {
    const baseStopIds = ['BEFORE-1', 'BEFORE-2'];
    const scenarioStopIds = ['AFTER-1', 'AFTER-2'];
    const snapshot = buildGenerationInputSnapshot({
      routeId: 'R101',
      routeLabel: '101번 · R101',
      vehicleCount: '8',
      firstDeparture: '06:00',
      lastDeparture: '23:00',
      headwayMinutes: '20',
      scenarioStopText: '',
      baseStopIds,
      scenarioStopIds
    });

    baseStopIds[0] = 'EDITED-BEFORE';
    scenarioStopIds[0] = 'EDITED-AFTER';

    expect(buildScenarioResultSummary(snapshot)).toEqual({
      routeLabel: '101번 · R101',
      vehicleLabel: '8대',
      operatingWindow: '06:00–23:00',
      headwayLabel: '20분',
      beforeStopCount: 2,
      afterStopCount: 2,
      fleetCaution: '운행대수 8대는 사용자 입력 가정이며 실제 차량별 배차·회차는 검증하지 않았습니다.'
    });
  });
});

it('renders the multi-route editor inside the Synthetic GTFS screen', () => {
  const project = { id: 'project-1', name: '테스트', records: [], scenarioDefinitions: [] } as unknown as ProjectManifest;
  const routeStops: RouteStopMasterRecord[] = [
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 }
  ];
  const markup = renderToStaticMarkup(
    <SyntheticGtfsBuilder project={project} routeStops={routeStops} serviceConfigs={[]} onBack={() => {}} onSaveScenarioDefinition={async () => {}} />
  );
  expect(markup).toContain('시나리오 입력·저장');
});

it('renders core generation inputs with advanced settings closed by default', () => {
  const markup = renderToStaticMarkup(
    <SyntheticGenerationStep
      routeOptions={[{ routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus' }]}
      activeRouteId="R-A"
      activeRouteLabel="A 노선 · R-A"
      baseStopIds={['A-1', 'A-2']}
      scenarioStopIds={['A-1', 'A-2']}
      scenarioStopText=""
      vehicleCount="4"
      firstDeparture="06:00"
      lastDeparture="22:00"
      headwayMinutes="10"
      exported={false}
      onRouteChange={() => {}}
      onScenarioStopTextChange={() => {}}
      onVehicleCountChange={() => {}}
      onFirstDepartureChange={() => {}}
      onLastDepartureChange={() => {}}
      onHeadwayMinutesChange={() => {}}
      onGenerate={() => {}}
      onExport={async () => {}}
    />
  );

  expect(markup).toContain('Before/After GTFS 생성');
  expect(markup).toContain('고급 생성 설정');
  expect(markup).not.toContain('<details class="synthetic-advanced-settings" open');
});

it('replaces one saved scenario without changing legacy deltas', () => {
  const oldScenario = { scenarioId: 'scenario-1', label: 'old' } as ScenarioDefinition;
  const nextScenario = { scenarioId: 'scenario-1', label: 'new' } as ScenarioDefinition;
  const project = { scenarioDefinitions: [oldScenario], scenarioDeltas: [{ scenarioId: 'legacy-1' }] } as unknown as ProjectManifest;
  const nextDefinitions = upsertScenarioDefinition(project.scenarioDefinitions ?? [], nextScenario);
  expect(nextDefinitions).toEqual([nextScenario]);
  expect(project.scenarioDeltas).toHaveLength(1);
});
