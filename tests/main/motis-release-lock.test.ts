import { describe, expect, it } from 'vitest';

import { lockValidatedCandidate } from '../../scripts/motis/lock-release-candidate.mjs';

const source = { motisVersion: 'v2.11.3', motisCommit: 'motis-a', osrCommit: 'osr-a' };
const patch = { id: 'osr-max-ways-per-node-32', file: 'scripts/motis/osr-max-ways-per-node-32.patch', sha256: 'p'.repeat(64) };
const toolchain = {
  compilerFamily: 'MSVC', compilerVersion: '19.44', windowsSdkVersion: '10.0.26100.0', cmakeVersion: '3.31.6', ninjaVersion: '1.12.1', generator: 'Ninja', runnerImage: 'windows-2025'
};
const baseLock = { schemaVersion: 1, state: 'probe', source, patch, artifact: { format: 'zip', manifestSchemaVersion: 2 } };

function observation(overrides: Record<string, unknown> = {}) {
  return { buildRunId: 'run-1', source, patch, toolchain, ...overrides };
}

function attestation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, buildRunId: 'run-1', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64),
    officialControl: { maxWays: 16, failedNodeOsmId: '10729381152', observedWays: 18 },
    candidate: { import: 'passed', health: 'passed', bus: 'passed', footAtProblemNode: 'passed', coordinateTransit: 'passed' },
    ...overrides
  };
}

describe('MOTIS validated release lock transition', () => {
  it('rejects differing toolchain observations', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation({ toolchain: { ...toolchain, ninjaVersion: 'different' } }), attestation: attestation() })).toThrow(/Ninja|observation|differ/i);
  });

  it('rejects differing source commits or patch identities', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation({ source: { ...source, osrCommit: 'osr-b' } }), attestation: attestation() })).toThrow(/source|osr/i);
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation({ patch: { ...patch, sha256: 'q'.repeat(64) } }), attestation: attestation() })).toThrow(/patch/i);
  });

  it('rejects unvalidated evidence and a mismatched build run', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation(), attestation: attestation({ candidate: { import: 'passed' } }) })).toThrow(/candidate|validation/i);
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation(), attestation: attestation({ buildRunId: 'run-other' }) })).toThrow(/build run/i);
  });

  it('transitions a matching probe candidate to a locked release', () => {
    const result = lockValidatedCandidate({ currentLock: baseLock, firstObservation: observation(), secondObservation: observation(), attestation: attestation() });

    expect(result.lock).toMatchObject({
      schemaVersion: 1, state: 'locked', source, patch, artifact: { format: 'zip', manifestSchemaVersion: 2 }, toolchain,
      release: { buildRunId: 'run-1', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64) }
    });
    expect(result.validationReport).toMatchObject({ schemaVersion: 1, buildRunId: 'run-1', pbfSha256: 'c'.repeat(64) });
  });

  it('does not replace a different locked release without explicit approval', () => {
    const locked = { ...baseLock, state: 'locked', toolchain, release: { buildRunId: 'old', archiveSha256: 'd'.repeat(64), binarySha256: 'e'.repeat(64) } };
    expect(() => lockValidatedCandidate({ currentLock: locked, firstObservation: observation(), secondObservation: observation(), attestation: attestation() })).toThrow(/replace|locked candidate/i);
  });
});
