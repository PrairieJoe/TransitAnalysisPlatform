import { createHash } from 'node:crypto';
import { compareJourneys, type NormalizedJourney } from './transit-comparison';
import type {
  CoordinateScenarioJourneyQuery,
  ScenarioExecutionTarget,
  ScenarioJourneyEndpoint,
  ScenarioJourneyEnvironment,
  ScenarioJourneyExecutionManifest,
  ScenarioJourneyExecutionStatus
} from '../shared/types';

export type { ScenarioJourneyEnvironment, ScenarioJourneyExecutionManifest, ScenarioJourneyExecutionStatus } from '../shared/types';

export interface ScenarioJourneyFingerprintInput {
  environment: ScenarioJourneyEnvironment;
  queries: readonly CoordinateScenarioJourneyQuery[];
}

export interface ScenarioJourneySideIdentity extends ScenarioJourneyFingerprintInput {
  fingerprint: string;
}

export interface ScenarioJourneyResult {
  executionSchemaVersion: 1;
  executionId: string;
  inputFingerprint: string;
  before: { target: ScenarioExecutionTarget; journeys: NormalizedJourney[] };
  after: { target: ScenarioExecutionTarget; journeys: NormalizedJourney[] };
  queries: CoordinateScenarioJourneyQuery[];
  environment: ScenarioJourneyEnvironment;
  status: ScenarioJourneyExecutionStatus;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

function canonicalEndpoint(endpoint: ScenarioJourneyEndpoint): Record<string, unknown> {
  return endpoint.kind === 'stop'
    ? { kind: 'stop', stopId: endpoint.stopId }
    : { kind: 'coordinate', latitude: endpoint.latitude, longitude: endpoint.longitude, ...(endpoint.label ? { label: endpoint.label } : {}) };
}

function canonicalInput(input: ScenarioJourneyFingerprintInput): Record<string, unknown> {
  return {
    environment: {
      osmPbfSha256: input.environment.osmPbfSha256,
      motisBinarySha256: input.environment.motisBinarySha256,
      motisManifestSchemaVersion: input.environment.motisManifestSchemaVersion,
      pedestrianProfile: input.environment.pedestrianProfile,
      maxTransfers: input.environment.maxTransfers,
      maxPreTransitTimeSeconds: input.environment.maxPreTransitTimeSeconds,
      maxPostTransitTimeSeconds: input.environment.maxPostTransitTimeSeconds,
      maxMatchingDistanceMeters: input.environment.maxMatchingDistanceMeters
    },
    queries: input.queries.map((query) => ({
      origin: canonicalEndpoint(query.origin),
      destination: canonicalEndpoint(query.destination),
      departureDateTime: query.departureDateTime
    }))
  };
}

export function buildScenarioJourneyFingerprint(input: ScenarioJourneyFingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalInput(input), null, 0), 'utf8').digest('hex');
}

export function assertComparableJourneySides(before: ScenarioJourneySideIdentity, after: ScenarioJourneySideIdentity): void {
  if (before.fingerprint !== after.fingerprint) {
    const sameEnvironment = JSON.stringify(canonicalInput({ environment: before.environment, queries: [] }))
      === JSON.stringify(canonicalInput({ environment: after.environment, queries: [] }));
    if (!sameEnvironment) throw new Error('Before/After 여정 실행 조건이 일치하지 않습니다.');
    throw new Error('Before/After 여정 fingerprint가 일치하지 않습니다.');
  }
}

function uniqueWarnings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeScenarioJourneyResult(result: ScenarioJourneyResult, artifactFileName: string): ScenarioJourneyExecutionManifest {
  const comparisons = result.before.journeys.map((before, index) => {
    const after = result.after.journeys[index];
    return after ? compareJourneys(before, after) : undefined;
  });
  const pairedDeltas = comparisons.filter((comparison) => comparison !== undefined && comparison.before.found && comparison.after.found)
    .map((comparison) => comparison!.delta.totalSeconds)
    .filter((value): value is number => value !== null);
  const warnings = uniqueWarnings([
    ...result.warnings,
    ...result.before.journeys.flatMap((journey) => journey.warnings),
    ...result.after.journeys.flatMap((journey) => journey.warnings)
  ]);
  return {
    executionSchemaVersion: 1,
    executionId: result.executionId,
    beforeTarget: result.before.target,
    afterTarget: result.after.target,
    inputFingerprint: result.inputFingerprint,
    environment: { ...result.environment },
    status: result.status,
    queryCount: result.queries.length,
    foundBeforeCount: result.before.journeys.filter((journey) => journey.found).length,
    foundAfterCount: result.after.journeys.filter((journey) => journey.found).length,
    meanDeltaSeconds: pairedDeltas.length ? pairedDeltas.reduce((sum, value) => sum + value, 0) / pairedDeltas.length : null,
    medianDeltaSeconds: median(pairedDeltas),
    p90DeltaSeconds: percentile(pairedDeltas, 0.9),
    warningCount: warnings.length,
    artifactFileName,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt
  };
}
