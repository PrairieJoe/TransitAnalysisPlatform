import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SyntheticRouteScenarioEditor, { type SyntheticRouteScenarioEditorProps } from '../../src/renderer/SyntheticRouteScenarioEditor';
import type { RouteStopMasterRecord } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'A', stationName: 'A 정류장', latitude: 37.1, longitude: 127.1 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'B', stationName: 'B 정류장', latitude: 37.2, longitude: 127.2 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 3, stationId: 'C', stationName: 'C 정류장', latitude: 37.3, longitude: 127.3 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 4, stationId: 'D', stationName: 'D 정류장', latitude: 37.4, longitude: 127.4 },
  { routeId: 'R2', routeName: '202번', transportMode: '버스', stationSequence: 1, stationId: 'X', stationName: 'X 정류장', latitude: 38.1, longitude: 128.1 }
];

const fixtureProps: SyntheticRouteScenarioEditorProps = {
  routeOptions: [{ routeId: 'R1', routeName: '101번', transportMode: '버스' }, { routeId: 'R2', routeName: '202번', transportMode: '버스' }],
  routeStops,
  selectedRouteId: 'R1',
  scenarioStopIds: ['B', 'A', 'D'],
  scenarioLabel: '',
  onRouteChange: () => {},
  onScenarioStopIdsChange: () => {},
  onScenarioLabelChange: () => {},
  onSave: async () => {}
};

describe('SyntheticRouteScenarioEditor', () => {
  it('shows current and scenario stops as editable lists', () => {
    const markup = renderToStaticMarkup(<SyntheticRouteScenarioEditor {...fixtureProps} />);

    expect(markup).toContain('현행 정류장');
    expect(markup).toContain('개편안 정류장');
    expect(markup).toContain('scenario-route-editor');
    expect(markup).toContain('scenario-stop-list');
    expect(markup).toContain('scenario-stop-row');
    expect(markup).toContain('scenario-stop-status');
    expect(markup).toContain('scenario-diff-summary');
    expect(markup).toContain('scenario-save-actions');
    expect(markup).toContain('현행 유지');
    expect(markup).toContain('추가');
    expect(markup).toContain('제외');
    expect(markup).toContain('정류장 추가');
    expect(markup).toContain('위로 이동');
    expect(markup).toContain('아래로 이동');
    expect(markup).toContain('정류장 제거');
    expect(markup).toContain('순서 변경');
    expect(markup).toContain('101번 정류장 개편안');
    expect(markup).not.toContain('Before 정류장 경로');
    expect(markup).not.toContain('쉼표로 구분');
  });
});
