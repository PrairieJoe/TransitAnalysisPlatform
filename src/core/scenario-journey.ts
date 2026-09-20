import { createHash } from 'node:crypto';
import type { CoordinateScenarioJourneyQuery, ScenarioJourneyEndpoint } from '../shared/types';

export interface ScenarioJourneyEnvironment {
  osmPbfSha256: string;
  motisBinarySha256: string;
  motisManifestSchemaVersion: 2;
  pedestrianProfile: 'FOOT';
  maxTransfers: number;
  maxPreTransitTimeSeconds: number;
  maxPostTransitTimeSeconds: number;
  maxMatchingDistanceMeters: number;
}

export interface ScenarioJourneyFingerprintInput {
  environment: ScenarioJourneyEnvironment;
  queries: readonly CoordinateScenarioJourneyQuery[];
}

export interface ScenarioJourneySideIdentity extends ScenarioJourneyFingerprintInput {
  fingerprint: string;
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
