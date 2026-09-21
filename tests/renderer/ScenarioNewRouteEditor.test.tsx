import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ScenarioNewRouteEditor, { buildScenarioAddedRoute, validateScenarioNewRouteDraft, type ScenarioNewRouteDraft } from '../../src/renderer/ScenarioNewRouteEditor';
import type { ScenarioOperationPlan } from '../../src/shared/types';

const operation: ScenarioOperationPlan = {
  serviceDays: [0, 1, 2, 3, 4], firstDeparture: '06:00', lastDeparture: '22:00', headwayMinutes: 10, vehicleCount: 4, dwellSeconds: 20, startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  travelTimeModel: { modelVersion: 'test-model', speedsKph: { unknown: 15 }, intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30 }
};

const draft = (overrides: Partial<ScenarioNewRouteDraft> = {}): ScenarioNewRouteDraft => ({ routeId: 'N-1', routeName: '신규 노선', transportMode: '버스', stopIds: ['A', 'B'], operation, ...overrides });

it('renders route metadata and ordered station controls', () => {
  const markup = renderToStaticMarkup(<ScenarioNewRouteEditor value={draft()} stations={[{ stationId: 'A', stationName: 'A 정류장', latitude: 37.1, longitude: 127.1 }, { stationId: 'B', stationName: 'B 정류장', latitude: 37.2, longitude: 127.2 }]} onChange={() => {}} onSave={() => {}} />);

  expect(markup).toContain('새 노선 만들기');
  expect(markup).toContain('노선 ID');
  expect(markup).toContain('노선명');
  expect(markup).toContain('정류장 순서');
  expect(markup).toContain('A 정류장');
  expect(markup).toContain('B 정류장');
});

it('rejects a one-stop route and emits a valid two-stop route', () => {
  const invalid = validateScenarioNewRouteDraft(draft({ stopIds: ['A'] }), ['A', 'B']);
  expect(invalid).toContain('신규 노선은 최소 2개 정류장이 필요합니다.');

  expect(buildScenarioAddedRoute(draft(), ['A', 'B'])).toMatchObject({ routeId: 'N-1', stopIds: ['A', 'B'], afterOperation: operation });
});
