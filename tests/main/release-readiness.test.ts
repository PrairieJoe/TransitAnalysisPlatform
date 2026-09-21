import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateReadiness } from '../../scripts/release/verify-release-readiness.mjs';

const hash = 'a'.repeat(64);

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tap-release-readiness-'));
  await mkdir(path.join(root, 'test-artifacts', 'packaged-smoke'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'test-reports'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.7.0' }));
  await writeFile(path.join(root, 'test-artifacts', 'motis-validation-attestation.json'), JSON.stringify({
    schemaVersion: 1,
    pbfSha256: hash,
    binarySha256: hash,
    officialControl: { failedNodeOsmId: '10729381152', observedWays: 18, maxWays: 16 },
    candidate: { import: 'passed', health: 'passed', bus: 'passed', footAtProblemNode: 'passed', coordinateTransit: 'passed' },
    evidence: { overflowDiagnostic: { nodeOsmId: '10729381152', observedWays: 33, maxWays: 32 } }
  }));
  await writeFile(path.join(root, 'test-artifacts', 'motis-component-artifact.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'passed',
    archiveSha256: hash,
    binarySha256: hash,
    packagedBinarySha256: hash,
    manifestVerified: true,
    archiveMatchesDistribution: true,
    packagedBinaryMatches: true
  }));
  await writeFile(path.join(root, 'test-artifacts', 'packaged-smoke', 'result.json'), JSON.stringify({ checks: ['core smoke'], rendererErrors: [] }));
  await writeFile(path.join(root, 'docs', 'test-reports', '0.7.0-final-readiness.json'), JSON.stringify({
    schemaVersion: 2,
    appVersion: '0.7.0',
    gates: {
      appRegression: { tests: 'passed', typecheck: 'passed', build: 'passed' },
      packagedSmoke: { status: 'passed', resultPath: 'test-artifacts/packaged-smoke/result.json' }
    }
  }));
  return root;
}

describe('release readiness verifier', () => {
  it('reports all four product gates and permits stable promotion', async () => {
    const root = await createFixture();
    const report = await evaluateReadiness({ root, mode: 'stable' });
    await rm(root, { recursive: true, force: true });

    expect(report.appVersion).toBe('0.7.0');
    expect(report.releaseReady).toBe(true);
    expect(report.internalConsistent).toBe(true);
    expect(report.checks.map((entry) => entry.name)).toEqual([
      'app-version',
      'evidence-version',
      'motis-artifact-and-actual-data',
      'boundary-validation',
      'app-regression',
      'packaged-smoke'
    ]);
    expect(report.checks.filter((entry) => entry.name !== 'app-version' && entry.name !== 'evidence-version').every((entry) => entry.passed)).toBe(true);
  });

  it('does not block on deferred build-proof or supply-chain checks', async () => {
    const root = await createFixture();
    const report = await evaluateReadiness({ root, mode: 'stable' });
    await rm(root, { recursive: true, force: true });

    expect(report.checks.some((entry) => entry.name.includes('proof') || entry.name.includes('hash') || entry.name.includes('lock'))).toBe(false);
    expect(report.deferredChecks).toEqual(expect.arrayContaining([
      'independent-build-proofs',
      'builder-lock-and-supply-chain-hashes'
    ]));
  });
});
