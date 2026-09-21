import { expect, it } from 'vitest';
import {
  assertComparableJourneySides,
  buildScenarioJourneyFingerprint,
  summarizeScenarioJourneyResult,
  type ScenarioJourneyResult,
  type ScenarioJourneyEnvironment
} from '../../src/core/scenario-journey';
import type { NormalizedJourney } from '../../src/core/transit-comparison';

const environment = (overrides: Partial<ScenarioJourneyEnvironment> = {}): ScenarioJourneyEnvironment => ({
  osmPbfSha256: 'pbf-hash',
  motisBinarySha256: 'binary-hash',
  motisManifestSchemaVersion: 2,
  pedestrianProfile: 'FOOT',
  maxTransfers: 3,
  maxPreTransitTimeSeconds: 900,
  maxPostTransitTimeSeconds: 900,
  maxMatchingDistanceMeters: 250,
  ...overrides
});

const queries = [
  {
    origin: { kind: 'coordinate' as const, latitude: 34.7604, longitude: 127.6622 },
    destination: { kind: 'coordinate' as const, latitude: 34.7463, longitude: 127.7441 },
    departureDateTime: '2026-09-20T08:00'
  }
];

function journey(overrides: Partial<NormalizedJourney> = {}): NormalizedJourney {
  return {
    found: true,
    totalSeconds: 1800,
    accessWalkSeconds: 120,
    egressWalkSeconds: 180,
    initialWaitSeconds: 300,
    transferWaitSeconds: 0,
    transferWalkSeconds: 0,
    accessWalkMeters: 100,
    transferWalkMeters: 0,
    egressWalkMeters: 200,
    directWalkSeconds: 0,
    directWalkMeters: 0,
    transferCount: 0,
    inVehicleSeconds: 1200,
    walkMeters: 300,
    legs: [],
    warnings: [],
    ...overrides
  };
}

it('builds a stable fingerprint while preserving query order and coordinate precision', () => {
  const first = buildScenarioJourneyFingerprint({ environment: environment(), queries });
  const second = buildScenarioJourneyFingerprint({ environment: environment(), queries: [...queries] });
  const changed = buildScenarioJourneyFingerprint({ environment: environment(), queries: [{ ...queries[0], origin: { ...queries[0].origin, latitude: 34.7604001 } }] });
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(second).toBe(first);
  expect(changed).not.toBe(first);
});

it('changes identity when any routing input changes', () => {
  const baseline = buildScenarioJourneyFingerprint({ environment: environment(), queries });
  expect(buildScenarioJourneyFingerprint({ environment: environment({ osmPbfSha256: 'other' }), queries })).not.toBe(baseline);
  expect(buildScenarioJourneyFingerprint({ environment: environment({ motisBinarySha256: 'other' }), queries })).not.toBe(baseline);
  expect(buildScenarioJourneyFingerprint({ environment: environment({ maxTransfers: 4 }), queries })).not.toBe(baseline);
  expect(buildScenarioJourneyFingerprint({ environment: environment({ pedestrianProfile: 'FOOT', maxMatchingDistanceMeters: 251 }), queries })).not.toBe(baseline);
});

it('rejects Before and After sides with different fingerprints', () => {
  const before = { environment: environment(), queries, fingerprint: buildScenarioJourneyFingerprint({ environment: environment(), queries }) };
  const after = { environment: environment({ osmPbfSha256: 'other' }), queries, fingerprint: buildScenarioJourneyFingerprint({ environment: environment({ osmPbfSha256: 'other' }), queries }) };
  expect(() => assertComparableJourneySides(before, after)).toThrow('Before/After 여정 실행 조건이 일치하지 않습니다.');
  expect(() => assertComparableJourneySides(before, { ...before, fingerprint: 'wrong' })).toThrow('Before/After 여정 fingerprint가 일치하지 않습니다.');
});

it('returns a bounded summary with aggregate journey deltas and no raw legs', () => {
  const result: ScenarioJourneyResult = {
    executionSchemaVersion: 1,
    executionId: 'journey-1',
    inputFingerprint: 'fingerprint-1',
    before: { target: { kind: 'current' }, journeys: [journey()] },
    after: { target: { kind: 'scenario', scenarioId: 'scenario-1' }, journeys: [journey({ totalSeconds: 1500, inVehicleSeconds: 900 })] },
    queries,
    environment: environment(),
    status: 'complete',
    warnings: ['경고 1'],
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z'
  };

  expect(summarizeScenarioJourneyResult(result, 'scenario-journeys/journey-1.json')).toMatchObject({
    executionId: 'journey-1',
    status: 'complete',
    queryCount: 1,
    foundBeforeCount: 1,
    foundAfterCount: 1,
    meanDeltaSeconds: -300,
    medianDeltaSeconds: -300,
    p90DeltaSeconds: -300,
    warningCount: 1,
    artifactFileName: 'scenario-journeys/journey-1.json'
  });
  expect(summarizeScenarioJourneyResult(result, 'scenario-journeys/journey-1.json')).not.toHaveProperty('before.journeys');
});
