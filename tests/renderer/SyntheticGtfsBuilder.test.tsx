import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { upsertScenarioDefinition } from '../../src/core/scenario-editor';
import { buildGenerationInputSnapshot, buildScenarioExplanationCopy, buildScenarioResultSummary } from '../../src/renderer/SyntheticGtfsBuilder';
import SyntheticGtfsBuilder from '../../src/renderer/SyntheticGtfsBuilder';
import SyntheticGenerationStep from '../../src/renderer/SyntheticGenerationStep';
import SyntheticMotisStep from '../../src/renderer/SyntheticMotisStep';
import SyntheticBatchStep from '../../src/renderer/SyntheticBatchStep';
import type { BatchSummary } from '../../src/core/transit-batch';
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
  expect(markup).toContain('시나리오 설정');
  expect(markup).toContain('GTFS 생성·검수');
  expect(markup).toContain('synthetic-workflow');
  expect(markup).toContain('synthetic-stepper');
  expect(markup).toContain('synthetic-step-panel');
  expect(markup).not.toContain('synthetic-stale-note');
  expect(markup).not.toContain('class="synthetic-generation-step"');
  expect(markup).not.toContain('MOTIS 로컬 sidecar');
  expect(markup).not.toContain('시간창 반복·스케일 실증');
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

it('asks for a verified OSM PBF before the MOTIS step can run', () => {
  const markup = renderToStaticMarkup(
    <SyntheticMotisStep
      result={{} as never}
      baseResult={{} as never}
      osmPbfPath=""
      motisStatus={{ state: 'stopped' }}
      motisBusy={false}
      originStopId="A-1"
      destinationStopId="A-2"
      departureDateTime="2026-01-01T08:00"
      onRunBeforeAfter={async () => {}}
      onStopMotis={async () => {}}
      onSelectOsmPbf={async () => {}}
      onInspectOsmPbf={async () => {}}
      onOpenOsmDownloadPage={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('먼저 OSM PBF 파일을 선택하거나 경로를 입력하세요.');
  expect(markup).toContain('MOTIS 로컬 실증');
});

it('keeps the batch step closed until a MOTIS comparison is available', () => {
  const markup = renderToStaticMarkup(
    <SyntheticBatchStep
      result={{} as never}
      baseResult={{} as never}
      comparisonReady={false}
      motisBusy={false}
      batchStartTime="06:00"
      batchEndTime="09:00"
      batchInterval="5"
      onRunBatch={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('먼저 단일 OD Before/After 비교를 완료하세요.');
});

it('renders the completed batch summary in the batch step', () => {
  const batchSummary: BatchSummary = {
    sampleCount: 3,
    foundBefore: 3,
    foundAfter: 2,
    meanTotalSecondsBefore: 600,
    meanTotalSecondsAfter: 540,
    medianTotalSecondsBefore: 600,
    medianTotalSecondsAfter: 540,
    p90TotalSecondsBefore: 660,
    p90TotalSecondsAfter: 600,
    warnings: []
  };
  const markup = renderToStaticMarkup(
    <SyntheticBatchStep
      result={{} as never}
      baseResult={{} as never}
      comparisonReady
      motisBusy={false}
      batchStartTime="06:00"
      batchEndTime="09:00"
      batchInterval="5"
      batchSummary={batchSummary}
      onRunBatch={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('시간창 반복·스케일 실증');
  expect(markup).toContain('배치 요약 · 3개 시점');
});

it('replaces one saved scenario without changing legacy deltas', () => {
  const oldScenario = { scenarioId: 'scenario-1', label: 'old' } as ScenarioDefinition;
  const nextScenario = { scenarioId: 'scenario-1', label: 'new' } as ScenarioDefinition;
  const project = { scenarioDefinitions: [oldScenario], scenarioDeltas: [{ scenarioId: 'legacy-1' }] } as unknown as ProjectManifest;
  const nextDefinitions = upsertScenarioDefinition(project.scenarioDefinitions ?? [], nextScenario);
  expect(nextDefinitions).toEqual([nextScenario]);
  expect(project.scenarioDeltas).toHaveLength(1);
});
