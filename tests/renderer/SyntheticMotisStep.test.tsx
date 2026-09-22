import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SyntheticMotisStep from '../../src/renderer/SyntheticMotisStep';
import type { MotisOsmPbfResolution } from '../../src/shared/types';

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
  expect(markup).toContain('현행·개편안 OD 비교 실행');
  expect(markup).not.toContain('현행→개편안 OD 비교');
});

it('shows automatic PBF guidance before exposing manual selection as an advanced fallback', () => {
  const missing: MotisOsmPbfResolution = {
    status: 'missing',
    geofabrikUrl: 'https://download.geofabrik.de/asia/south-korea.html',
    expectedFileName: 'south-korea-latest.osm.pbf',
    recommendedPath: 'C:\\routing\\south-korea-latest.osm.pbf',
    message: 'OSM PBF가 없습니다. Geofabrik에서 다운로드하세요.'
  };
  const markup = renderToStaticMarkup(
    <SyntheticMotisStep
      result={{} as never}
      baseResult={{} as never}
      osmPbfPath=""
      pbfResolution={missing}
      motisStatus={{ state: 'stopped' }}
      motisBusy={false}
      originStopId="S1"
      destinationStopId="S2"
      departureDateTime="2026-01-01T08:00"
      onRunBeforeAfter={async () => {}}
      onStopMotis={async () => {}}
      onSelectOsmPbf={async () => {}}
      onInspectOsmPbf={async () => {}}
      onOpenOsmDownloadPage={async () => {}}
      onRescanOsmPbf={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('PBF 자동 준비');
  expect(markup).toContain('Geofabrik 다운로드 안내');
  expect(markup).toContain('다시 찾기');
  expect(markup).toContain('다른 PBF 직접 선택 · 고급 설정');
});
