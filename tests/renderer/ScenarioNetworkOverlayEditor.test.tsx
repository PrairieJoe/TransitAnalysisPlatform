import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ScenarioNetworkOverlayEditor, { applyScenarioNetworkMapAction, type ScenarioNetworkOverlayState } from '../../src/renderer/ScenarioNetworkOverlayEditor';
import type { ScenarioAddedRoute, ScenarioAddedStation, ScenarioStationOverride } from '../../src/shared/types';

const addedStations: ScenarioAddedStation[] = [{ stationId: 'S-new', stationName: '신규 정류장', latitude: 37.3, longitude: 127.3 }];
const stationOverrides: ScenarioStationOverride[] = [];
const addedRoutes: ScenarioAddedRoute[] = [];
const state: ScenarioNetworkOverlayState = {
  selectedRouteId: 'R1',
  selectedStationId: 'S2',
  scenarioStopIds: ['S1', 'S2', 'S-new'],
  addedStations,
  stationOverrides,
  addedRoutes
};

it('renders the two-area overlay editor with map tools and station lists', () => {
  const markup = renderToStaticMarkup(<ScenarioNetworkOverlayEditor
    state={state}
    stations={[
      { stationId: 'S1', stationName: '현행 정류장 1', latitude: 37.1, longitude: 127.1 },
      { stationId: 'S2', stationName: '현행 정류장 2', latitude: 37.2, longitude: 127.2 },
      ...addedStations
    ]}
    currentStopIds={['S1', 'S2']}
    onChange={() => {}}
  />);

  expect(markup).toContain('scenario-network-overlay-editor');
  expect(markup).toContain('scenario-network-map');
  expect(markup).toContain('우클릭해 신규 정류장 추가');
  expect(markup).toContain('개편안에서 제외');
  expect(markup).toContain('현행 정류장');
  expect(markup).toContain('개편안 정류장');
});

it('adapts map actions into immutable overlay state changes', () => {
  const selected = applyScenarioNetworkMapAction(state, { type: 'select', stationId: 'S1' });
  const excluded = applyScenarioNetworkMapAction(state, { type: 'exclude', stationId: 'S2' });
  const moved = applyScenarioNetworkMapAction(state, { type: 'move', stationId: 'S1', latitude: 37.11, longitude: 127.11 });

  expect(selected.selectedStationId).toBe('S1');
  expect(excluded.scenarioStopIds).toEqual(['S1', 'S-new']);
  expect(moved.stationOverrides).toEqual([{ stationId: 'S1', latitude: 37.11, longitude: 127.11 }]);
  expect(state.scenarioStopIds).toEqual(['S1', 'S2', 'S-new']);
});
