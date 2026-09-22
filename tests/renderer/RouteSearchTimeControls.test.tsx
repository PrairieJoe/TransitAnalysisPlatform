import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RouteSearchTimeControls from '../../src/renderer/RouteSearchTimeControls';

it('presents now, quick presets, and separate explicit date/time controls', () => {
  const markup = renderToStaticMarkup(<RouteSearchTimeControls
    mode="explicit"
    value="2026-09-18T08:30"
    onChange={() => undefined}
    onModeChange={() => undefined}
  />);

  expect(markup).toContain('지금 출발');
  expect(markup).toContain('+15분');
  expect(markup).toContain('+30분');
  expect(markup).toContain('+1시간');
  expect(markup).toContain('출발 날짜');
  expect(markup).toContain('출발 시각');
  expect(markup).toContain('KST');
});
