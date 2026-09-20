import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertCandidateEvidence,
  assertOfficialControlDiagnostic,
  assertReleaseInputFiles,
  createValidationAttestation,
  validateReleaseCandidate
} from '../../scripts/motis/validate-release-candidate.mts';

const hash = (character: string) => character.repeat(64);

describe('MOTIS nationwide release validation', () => {
  it('rejects a missing candidate archive before running MOTIS', async () => {
    await expect(assertReleaseInputFiles({ archivePath: join(tmpdir(), 'missing-motis.zip'), pbfPath: __filename })).rejects.toThrow(/archive.*not found/i);
  });

  it('rejects a candidate archive whose SHA-256 differs from the expected hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-validation-'));
    const archivePath = join(root, 'candidate.zip');
    const pbfPath = join(root, 'south-korea.osm.pbf');
    await writeFile(archivePath, 'archive');
    await writeFile(pbfPath, 'pbf');
    try {
      await expect(assertReleaseInputFiles({ archivePath, pbfPath, expectedArchiveSha256: hash('a') })).rejects.toThrow(/archive SHA-256/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a PBF whose SHA-256 differs from the expected hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-validation-'));
    const archivePath = join(root, 'candidate.zip');
    const pbfPath = join(root, 'south-korea.osm.pbf');
    await writeFile(archivePath, 'archive');
    await writeFile(pbfPath, 'pbf');
    try {
      await expect(assertReleaseInputFiles({ archivePath, pbfPath, expectedPbfSha256: hash('b') })).rejects.toThrow(/PBF SHA-256/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires the official control to record the expected 16-way failure', () => {
    expect(() => assertOfficialControlDiagnostic('node 10729381152 has 18 ways, maximum is 16')).not.toThrow();
    expect(() => assertOfficialControlDiagnostic('node 10729381152 has 18 ways, maximum is 32')).toThrow(/maximum is 16/i);
  });

  it('rejects a candidate import failure and zero access or egress walking', () => {
    expect(() => assertCandidateEvidence({
      import: 'failed', health: 'passed', bus: 'passed',
      footAtProblemNode: { status: 'passed', accessWalkSeconds: 120, egressWalkSeconds: 60 },
      coordinateTransit: { status: 'passed', accessWalkSeconds: 90, egressWalkSeconds: 45 }
    })).toThrow(/import/i);

    expect(() => assertCandidateEvidence({
      import: 'passed', health: 'passed', bus: 'passed',
      footAtProblemNode: { status: 'passed', accessWalkSeconds: 0, egressWalkSeconds: 60 },
      coordinateTransit: { status: 'passed', accessWalkSeconds: 90, egressWalkSeconds: 0 }
    })).toThrow(/access|egress|walk/i);
  });

  it('rejects problem-node walking failure and records a 32-way overflow diagnostic', () => {
    expect(() => assertCandidateEvidence({
      import: 'passed', health: 'passed', bus: 'passed',
      footAtProblemNode: { status: 'failed', accessWalkSeconds: 120, egressWalkSeconds: 60, error: 'node 10729381152 has 33 ways, maximum is 32' },
      coordinateTransit: { status: 'passed', accessWalkSeconds: 90, egressWalkSeconds: 45 },
      overflowDiagnostic: { nodeOsmId: '10729381152', observedWays: 33, maxWays: 32 }
    })).toThrow(/foot|walking|problem/i);

    expect(() => assertCandidateEvidence({
      import: 'passed', health: 'passed', bus: 'passed',
      footAtProblemNode: { status: 'passed', accessWalkSeconds: 120, egressWalkSeconds: 60 },
      coordinateTransit: { status: 'passed', accessWalkSeconds: 90, egressWalkSeconds: 45 },
      overflowDiagnostic: { nodeOsmId: '10729381152', observedWays: 33, maxWays: 16 }
    })).toThrow(/32|overflow/i);
  });

  it('creates a hash-bound attestation only for a complete passing evidence set', () => {
    const evidence = {
      import: 'passed' as const, health: 'passed' as const, bus: 'passed' as const,
      footAtProblemNode: { status: 'passed' as const, accessWalkSeconds: 120, egressWalkSeconds: 60 },
      coordinateTransit: { status: 'passed' as const, accessWalkSeconds: 90, egressWalkSeconds: 45 },
      overflowDiagnostic: { nodeOsmId: '10729381152', observedWays: 33, maxWays: 32 }
    };
    const attestation = createValidationAttestation({
      buildRunId: 'run-123', archiveSha256: hash('a'), binarySha256: hash('b'), pbfSha256: hash('c'), scenarioReportSha256: hash('d'), evidence
    });

    expect(attestation).toMatchObject({
      schemaVersion: 1, buildRunId: 'run-123', archiveSha256: hash('a'), binarySha256: hash('b'), pbfSha256: hash('c'), scenarioReportSha256: hash('d'),
      officialControl: { maxWays: 16, failedNodeOsmId: '10729381152', observedWays: 18 },
      candidate: { import: 'passed', health: 'passed', bus: 'passed', footAtProblemNode: 'passed', coordinateTransit: 'passed' }
    });
  });

  it('fails closed when exact archive or PBF inputs are absent before running scenarios', async () => {
    await expect(validateReleaseCandidate({ archivePath: join(tmpdir(), 'absent.zip'), pbfPath: join(tmpdir(), 'absent.pbf'), buildRunId: 'run-absent' })).rejects.toThrow(/archive.*not found/i);
  });
});
