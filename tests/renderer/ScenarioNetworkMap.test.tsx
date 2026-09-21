import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ScenarioNetworkMap, { createScenarioMapDraft } from '../../src/renderer/ScenarioNetworkMap';

it('renders an accessible map surface and add-mode toolbar', () => {
  const markup = renderToStaticMarkup(<ScenarioNetworkMap
    stations={[{ stationId: 'S1', stationName: '정류장 1', latitude: 37.1, longitude: 127.1 }]}
    currentStopIds={['S1']}
    scenarioStopIds={['S1']}
    selectedStationId="S1"
    onSelectStation={() => {}}
    onCreateStationDraft={() => {}}
    onExcludeStation={() => {}}
    onMoveStation={() => {}}
  />);

  expect(markup).toContain('scenario-network-map');
  expect(markup).toContain('지도에서 정류장 추가');
  expect(markup).toContain('정류장 1');
});

it('normalizes map clicks into a coordinate draft without changing the domain state', () => {
  expect(createScenarioMapDraft(37.123456, 127.654321)).toEqual({ latitude: 37.123456, longitude: 127.654321 });
});
