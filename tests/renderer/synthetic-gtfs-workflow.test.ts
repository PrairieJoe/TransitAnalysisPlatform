import { describe, expect, it } from 'vitest';
import { buildSyntheticWorkflowStatuses, canEnterSyntheticStep, type SyntheticWorkflowSnapshot } from '../../src/renderer/synthetic-gtfs-workflow';

function snapshot(overrides: Partial<SyntheticWorkflowSnapshot> = {}): SyntheticWorkflowSnapshot {
  return {
    hasRouteOptions: true,
    hasScenarioDefinition: false,
    hasGenerationResult: false,
    generationResultValid: false,
    generationInputStale: false,
    hasJourneyComparison: false,
    journeyInputStale: false,
    hasBatchSummary: false,
    batchInputStale: false,
    ...overrides
  };
}

describe('Synthetic GTFS workflow', () => {
  it('starts with only scenario and generation available', () => {
    const statuses = buildSyntheticWorkflowStatuses(snapshot());

    expect(statuses.scenario.isAvailable).toBe(true);
    expect(statuses.generation.isAvailable).toBe(true);
    expect(statuses.motis.isAvailable).toBe(false);
    expect(statuses.batch.isAvailable).toBe(false);
  });

  it('marks downstream results stale after generation inputs change', () => {
    const statuses = buildSyntheticWorkflowStatuses(snapshot({
      hasScenarioDefinition: true,
      hasGenerationResult: true,
      generationResultValid: true,
      generationInputStale: true,
      hasJourneyComparison: true,
      hasBatchSummary: true
    }));

    expect(statuses.generation.isStale).toBe(true);
    expect(statuses.motis.isStale).toBe(true);
    expect(statuses.batch.isStale).toBe(true);
    expect(statuses.generation.isComplete).toBe(false);
  });

  it('requires a fresh single comparison before batch validation', () => {
    const statuses = buildSyntheticWorkflowStatuses(snapshot({
      hasScenarioDefinition: true,
      hasGenerationResult: true,
      generationResultValid: true,
      hasJourneyComparison: true,
      journeyInputStale: true
    }));

    expect(statuses.motis.isAvailable).toBe(true);
    expect(statuses.batch.isAvailable).toBe(false);
  });

  it('allows a valid current route to reach generation without a saved scenario', () => {
    const statuses = buildSyntheticWorkflowStatuses(snapshot());

    expect(canEnterSyntheticStep('generation', statuses)).toBe(true);
    expect(statuses.scenario.isComplete).toBe(false);
  });

  it('locks every step when route master data is missing', () => {
    const statuses = buildSyntheticWorkflowStatuses(snapshot({ hasRouteOptions: false }));

    expect(Object.values(statuses).every((status) => !status.isAvailable)).toBe(true);
  });
});
