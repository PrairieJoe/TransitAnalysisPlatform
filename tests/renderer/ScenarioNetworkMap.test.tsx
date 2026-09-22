import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ScenarioNetworkMap, { createScenarioMapDraft, filterScenarioMapStations } from '../../src/renderer/ScenarioNetworkMap';

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
  expect(markup).toContain('선택 노선');
  expect(markup).toContain('전체 정류장');
});

it('normalizes map clicks into a coordinate draft without changing the domain state', () => {
  expect(createScenarioMapDraft(37.123456, 127.654321)).toEqual({ latitude: 37.123456, longitude: 127.654321 });
});

it('filters the default map layer to the selected route and keeps an explicit all-stations option', () => {
  const stations = [
    { stationId: 'S1', stationName: '노선 정류장', latitude: 37.1, longitude: 127.1 },
    { stationId: 'S2', stationName: '다른 정류장', latitude: 37.2, longitude: 127.2 }
  ];

  expect(filterScenarioMapStations(stations, ['S1'], ['S1'], 'route').map((station) => station.stationId)).toEqual(['S1']);
  expect(filterScenarioMapStations(stations, ['S1'], ['S1'], 'all').map((station) => station.stationId)).toEqual(['S1', 'S2']);
});
