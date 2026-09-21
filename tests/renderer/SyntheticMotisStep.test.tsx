import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SyntheticMotisStep from '../../src/renderer/SyntheticMotisStep';

it('explains that a new route exists only in the scenario MOTIS package', () => {
  const markup = renderToStaticMarkup(
    <SyntheticMotisStep
      result={{} as never}
      baseResult={{} as never}
      osmPbfPath="region.osm.pbf"
      motisStatus={{ state: 'stopped' }}
      motisBusy={false}
      originStopId="S1"
      destinationStopId="S2"
      departureDateTime="2026-01-01T08:00"
      afterOnlyRouteIds={['N-1']}
      onRunBeforeAfter={async () => {}}
      onStopMotis={async () => {}}
      onSelectOsmPbf={async () => {}}
      onInspectOsmPbf={async () => {}}
      onOpenOsmDownloadPage={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('개편안 신규 경로');
  expect(markup).toContain('현행 대응 없음');
  expect(markup).toContain('N-1');
});
