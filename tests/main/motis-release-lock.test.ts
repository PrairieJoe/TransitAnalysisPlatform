import { describe, expect, it } from 'vitest';

import { lockValidatedCandidate } from '../../scripts/motis/lock-release-candidate.mjs';

const source = { motisVersion: 'v2.11.3', motisCommit: 'motis-a', osrCommit: 'osr-a' };
const patch = { id: 'osr-max-ways-per-node-32', file: 'scripts/motis/osr-max-ways-per-node-32.patch', sha256: '1'.repeat(64) };
const toolchain = {
  compilerFamily: 'MSVC', compilerVersion: '19.44', windowsSdkVersion: '10.0.26100.0', cmakeVersion: '3.31.6', ninjaVersion: '1.12.1', generator: 'Ninja', runnerImage: 'windows-2025'
};
const baseLock = { schemaVersion: 2, state: 'probe', source, patch, artifact: { format: 'zip', manifestSchemaVersion: 2 } };

function proof(runId: string, overrides: Record<string, any> = {}) {
  const provenance = {
    repository: 'PrairieJoe/TransitAnalysisPlatform', workflowPath: '.github/workflows/motis-build.yml', workflowSha: '2'.repeat(40), headSha: '3'.repeat(40),
    runId, runAttempt: 1, runnerImage: 'windows-2025', runnerImageVersion: '20260914.1', ...overrides.provenance
  };
  const outputs = { binarySha256: 'b'.repeat(64), payloadTreeSha256: 'c'.repeat(64), archiveSha256: 'a'.repeat(64), ...overrides.outputs };
  return {
    schemaVersion: 1,
    provenance,
    artifact: { id: `artifact-${runId}`, name: `motis-windows-x64-v2.11.3-osr32-${runId}`, digestSha256: 'd'.repeat(64), ...overrides.artifact },
    source: { ...source, ...overrides.source }, patch: { ...patch, ...overrides.patch }, toolchain: { ...toolchain, ...overrides.toolchain },
    buildInputs: { configuration: 'Release', platform: 'windows-x64', generator: 'Ninja', parallelism: 4, cmakeDefinitions: ['MOTIS_MIMALLOC=ON', 'NO_BUILDCACHE=ON'], ...overrides.buildInputs },
    outputs,
    artifactAttestation: {
      schemaVersion: 1, status: 'verified', repository: provenance.repository, workflowPath: provenance.workflowPath, workflowSha: provenance.workflowSha,
      headSha: provenance.headSha, subjectDigestSha256: outputs.archiveSha256, bundleSha256: 'e'.repeat(64), ...overrides.artifactAttestation
    }
  };
}

function attestation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, buildRunId: 'run-1', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'f'.repeat(64), scenarioReportSha256: '9'.repeat(64),
    officialControl: { maxWays: 16, failedNodeOsmId: '10729381152', observedWays: 18 },
    candidate: { import: 'passed', health: 'passed', bus: 'passed', footAtProblemNode: 'passed', coordinateTransit: 'passed' }, ...overrides
  };
}

describe('MOTIS validated release lock transition', () => {
  it('rejects a missing external proof identity and unverified artifact provenance', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1', { provenance: { workflowSha: '' } }), secondProof: proof('run-2'), attestation: attestation() })).toThrow(/workflow.*SHA|required/i);
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1', { artifactAttestation: { status: 'pending' } }), secondProof: proof('run-2'), attestation: attestation() })).toThrow(/attestation.*verified/i);
  });

  it('rejects the same workflow run even when the attempt differs', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-1', { provenance: { runAttempt: 2 } }), attestation: attestation() })).toThrow(/distinct.*run|run ID/i);
  });

  it.each([
    ['head SHA', { provenance: { headSha: '4'.repeat(40) } }], ['source', { source: { osrCommit: 'osr-b' } }],
    ['patch', { patch: { sha256: '8'.repeat(64) } }], ['toolchain', { toolchain: { ninjaVersion: 'different' } }],
    ['build inputs', { buildInputs: { parallelism: 8 } }], ['binary', { outputs: { binarySha256: '6'.repeat(64) } }],
    ['payload tree', { outputs: { payloadTreeSha256: '7'.repeat(64) } }],
    ['archive', { outputs: { archiveSha256: '8'.repeat(64) }, artifactAttestation: { subjectDigestSha256: '8'.repeat(64) } }]
  ])('rejects differing %s evidence', (_label, overrides) => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2', overrides), attestation: attestation() })).toThrow(/proof|differ|match/i);
  });

  it('rejects validation evidence that does not belong to the selected publish proof', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation({ buildRunId: 'run-other' }) })).toThrow(/build run/i);
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation({ archiveSha256: '0'.repeat(64) }) })).toThrow(/archive/i);
  });

  it('rejects unvalidated candidate evidence and the wrong official control', () => {
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation({ candidate: { import: 'passed' } }) })).toThrow(/candidate|validation/i);
    expect(() => lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation({ officialControl: { maxWays: 16, failedNodeOsmId: 'other-node', observedWays: 18 } }) })).toThrow(/official.*control|node/i);
  });

  it('locks two distinct matching proof envelopes and selects the validated proof for publish', () => {
    const result = lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation() });
    expect(result.lock).toMatchObject({
      schemaVersion: 2, state: 'locked', source, patch, toolchain,
      release: { buildRunId: 'run-1', selectedPublishProofRunId: 'run-1', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), payloadTreeSha256: 'c'.repeat(64), pbfSha256: 'f'.repeat(64), scenarioReportSha256: '9'.repeat(64) }
    });
    expect(result.lock.release.proofs).toHaveLength(2);
    expect(result.lock.release.proofs.map((entry: { runId: string }) => entry.runId)).toEqual(['run-1', 'run-2']);
    expect(result.lock.release.proofs.every((entry: { proofEnvelopeSha256: string }) => /^[a-f0-9]{64}$/.test(entry.proofEnvelopeSha256))).toBe(true);
  });

  it('does not replace a different locked release without explicit approval', () => {
    const first = lockValidatedCandidate({ currentLock: baseLock, firstProof: proof('run-1'), secondProof: proof('run-2'), attestation: attestation() }).lock;
    expect(() => lockValidatedCandidate({
      currentLock: first, firstProof: proof('run-3', { outputs: { binarySha256: '6'.repeat(64) } }), secondProof: proof('run-4', { outputs: { binarySha256: '6'.repeat(64) } }),
      attestation: attestation({ buildRunId: 'run-3', binarySha256: '6'.repeat(64) })
    })).toThrow(/replace|locked candidate/i);
  });
});
