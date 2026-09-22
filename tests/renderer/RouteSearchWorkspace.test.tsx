import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RouteSearchWorkspace from '../../src/renderer/RouteSearchWorkspace';

it('renders route search as an independent current-network workspace', () => {
  const markup = renderToStaticMarkup(<RouteSearchWorkspace
    routeStops={[
      { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'S1', stationName: '시청', latitude: 37.1, longitude: 127.1 },
      { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'S2', stationName: '터미널', latitude: 37.2, longitude: 127.2 }
    ]}
    serviceConfigs={[]}
  />);

  expect(markup).toContain('MOTIS 경로탐색');
  expect(markup).toContain('현행 네트워크 기준');
  expect(markup).toContain('출발 정류장');
  expect(markup).toContain('도착 정류장');
  expect(markup).toContain('경로탐색 실행');
  expect(markup).not.toContain('현행·개편안');
});
