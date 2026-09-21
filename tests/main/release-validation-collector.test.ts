import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectFinalValidation, FINAL_FEATURE_CHECKS } from '../../scripts/release/collect-final-validation.mjs';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tap-final-validation-'));
  const files = {
    archive: join(root, 'candidate.zip'), binary: join(root, 'motis.exe'), pbf: join(root, 'south-korea.osm.pbf'),
    scenario: join(root, 'scenario-report.json'), installer: join(root, 'TransitAnalysisPlatform-0.7.0-setup.exe'), feature: join(root, 'feature-report.json'),
    lock: join(root, 'motis-builder-lock.json'), output: join(root, 'final-readiness.json')
  };
  await writeFile(files.archive, 'archive');
  await writeFile(files.binary, 'binary');
  await writeFile(files.pbf, 'pbf');
  await writeFile(files.scenario, JSON.stringify({ scenario: 'validated' }));
  await writeFile(files.installer, 'installer');
  await writeFile(files.feature, JSON.stringify({ appCandidateSha: 'a'.repeat(40), checks: Object.fromEntries(FINAL_FEATURE_CHECKS.map((name) => [name, 'passed'])), rawResultHashes: ['1'.repeat(64), '2'.repeat(64)] }));
  await writeFile(files.lock, JSON.stringify({
    schemaVersion: 2,
    state: 'locked',
    source: { motisVersion: 'v2.11.3', motisCommit: 'b'.repeat(40), osrCommit: 'c'.repeat(40) },
    patch: { id: 'osr-max-ways-per-node-32', file: 'scripts/motis/osr-max-ways-per-node-32.patch', sha256: 'd'.repeat(64) },
    artifact: { format: 'zip', manifestSchemaVersion: 2 },
    toolchain: { compilerFamily: 'MSVC', compilerVersion: '19.44', windowsSdkVersion: '10.0.26100.0', cmakeVersion: '4.4.3', ninjaVersion: '1.13.2', generator: 'Ninja', runnerImage: 'windows-2025' },
    release: {
      buildRunId: 'run-1', selectedPublishProofRunId: 'run-1', archiveSha256: digest('archive'), binarySha256: digest('binary'), payloadTreeSha256: 'e'.repeat(64), pbfSha256: digest('pbf'), scenarioReportSha256: digest(JSON.stringify({ scenario: 'validated' })),
      proofs: [1, 2].map((index) => ({ runId: `run-${index}`, runAttempt: 1, artifactId: `artifact-${index}`, artifactName: `candidate-${index}`, artifactDigestSha256: 'f'.repeat(64), attestationBundleSha256: '1'.repeat(64), proofEnvelopeSha256: '2'.repeat(64) }))
    }
  }));
  return { root, files };
}

describe('final validation collector', () => {
  it('binds installer, component, PBF, scenario, and feature evidence to a locked candidate', async () => {
    const { root, files } = await fixture();
    try {
      const evidence = await collectFinalValidation({
        lockPath: files.lock,
        archivePath: files.archive,
        binaryPath: files.binary,
        pbfPath: files.pbf,
        scenarioReportPath: files.scenario,
        installerPath: files.installer,
        featureReportPath: files.feature,
        outputPath: files.output,
        appCandidateSha: 'a'.repeat(40),
        appVersion: '0.7.0',
        componentTag: 'motis-v2.11.3-osr32.1',
        componentSourceSha: '9'.repeat(40)
      });
      expect(evidence.validation.checks).toMatchObject({ packagedMotisSmoke: 'passed', demandEstimationIdentity: 'passed' });
      expect(JSON.parse(await readFile(files.output, 'utf8')).deployment.installerSha256).toBe(digest('installer'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to collect evidence for an RC app version', async () => {
    const { root, files } = await fixture();
    try {
      await expect(collectFinalValidation({ lockPath: files.lock, archivePath: files.archive, binaryPath: files.binary, pbfPath: files.pbf, scenarioReportPath: files.scenario, installerPath: files.installer, featureReportPath: files.feature, outputPath: files.output, appCandidateSha: 'a'.repeat(40), appVersion: '0.7.0-rc.1', componentTag: 'motis-v2.11.3-osr32.1', componentSourceSha: '9'.repeat(40) })).rejects.toThrow(/exact 0\.7\.0/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
