import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SyntheticWorkflowStep, SyntheticWorkflowStepStatus } from '../../src/renderer/synthetic-gtfs-workflow';
import SyntheticGtfsStepper from '../../src/renderer/SyntheticGtfsStepper';

const fixtureStatuses = {
  scenario: { step: 'scenario', label: '시나리오 설정', description: '노선과 Before/After 경로를 정합니다.', isAvailable: true, isComplete: false, isStale: false },
  generation: { step: 'generation', label: 'GTFS 생성·검수', description: '운행 가정으로 GTFS를 만들고 결과를 확인합니다.', isAvailable: true, isComplete: false, isStale: false },
  motis: { step: 'motis', label: 'MOTIS 여정 검증', description: '같은 OD의 Before/After 여정을 비교합니다.', isAvailable: false, isComplete: false, isStale: false },
  batch: { step: 'batch', label: '반복 검증', description: '시간창을 반복 실행해 변화를 요약합니다.', isAvailable: false, isComplete: false, isStale: false }
} satisfies Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus>;

describe('SyntheticGtfsStepper', () => {
  it('renders the four named steps and locks unavailable steps', () => {
    const markup = renderToStaticMarkup(
      <SyntheticGtfsStepper
        activeStep="scenario"
        statuses={fixtureStatuses}
        onSelectStep={() => {}}
      />
    );

    expect(markup).toContain('시나리오 설정');
    expect(markup).toContain('GTFS 생성·검수');
    expect(markup).toContain('MOTIS 여정 검증');
    expect(markup).toContain('반복 검증');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('aria-disabled="true"');
  });
});
