import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RouteSearchMap from '../../src/renderer/RouteSearchMap';
import type { RouteSearchMapModel } from '../../src/core/route-search-map';

const model: RouteSearchMapModel = {
  endpoints: [
    { role: 'origin', label: '시청', latitude: 37.1, longitude: 127.1 },
    { role: 'destination', label: '터미널', latitude: 37.2, longitude: 127.2 }
  ],
  routes: [{ id: 'route-1', totalSeconds: 900, transferCount: 0, warnings: [], legs: [{ mode: 'BUS', routeId: 'R1', points: [{ latitude: 37.1, longitude: 127.1 }, { latitude: 37.2, longitude: 127.2 }], geometrySource: 'motis' }] }],
  selectedRouteId: 'route-1',
  boundsPoints: [{ latitude: 37.1, longitude: 127.1 }, { latitude: 37.2, longitude: 127.2 }]
};

it('renders a map-first route canvas before and after a query', () => {
  const markup = renderToStaticMarkup(<RouteSearchMap model={model} activeEndpoint="origin" onMapClick={() => undefined} onSelectRoute={() => undefined} />);

  expect(markup).toContain('route-search-map');
  expect(markup).toContain('경로탐색 지도');
  expect(markup).toContain('출발지');
  expect(markup).toContain('도착지');
});
