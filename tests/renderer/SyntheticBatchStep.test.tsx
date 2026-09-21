import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SyntheticBatchStep from '../../src/renderer/SyntheticBatchStep';

it('keeps the same OD batch contract while identifying after-only routes', () => {
  const markup = renderToStaticMarkup(
    <SyntheticBatchStep
      result={{} as never}
      baseResult={{} as never}
      comparisonReady
      motisBusy={false}
      batchStartTime="06:00"
      batchEndTime="09:00"
      batchInterval="5"
      afterOnlyRouteIds={['N-1']}
      onRunBatch={async () => {}}
      onInputChange={() => {}}
    />
  );

  expect(markup).toContain('같은 출발지·도착지');
  expect(markup).toContain('개편안 신규 경로');
  expect(markup).toContain('현행 대응 없음');
});
