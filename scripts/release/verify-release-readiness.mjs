import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuilderLock } from '../motis/builder-lock.mjs';

const sha256Pattern = /^[a-f0-9]{64}$/i;
const gitObjectPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const componentTagPattern = /^motis-v2\.11\.3-osr32\.[1-9][0-9]*$/;
const requiredFeatureChecks = [
  'packagedMotisSmoke',
  'scenarioSaveRunCompare',
  'coordinateAccessEgress',
  'cancellationCleanup',
  'savedResultReopen',
  'demandEstimationIdentity'
];
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function check(name, passed, detail) {
  return { name, passed, detail };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function hash(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function gitObject(value) {
  return typeof value === 'string' && gitObjectPattern.test(value);
}

function proofGate(lock) {
  const proofs = lock.release?.proofs;
  if (lock.state !== 'locked' || !lock.release) return check('builder-lock', false, 'builder lock is still in probe state');
  if (!Array.isArray(proofs) || proofs.length !== 2) return check('independent-proofs', false, 'exactly two build proofs are required');
  if (proofs[0]?.runId === proofs[1]?.runId) return check('independent-proofs', false, 'proof run IDs must be distinct');
  if (proofs.some((proof) => !proof || typeof proof.runId !== 'string' || !Number.isInteger(proof.runAttempt) || proof.runAttempt < 1 || typeof proof.artifactId !== 'string' || !hash(proof.artifactDigestSha256) || !hash(proof.attestationBundleSha256) || !hash(proof.proofEnvelopeSha256))) {
    return check('independent-proofs', false, 'each proof must include immutable artifact and attestation identities');
  }
  return check('independent-proofs', true, 'two distinct proof identities are recorded');
}

function validateFinalEvidence(evidence, { packageVersion, release, targetSha, mode }) {
  const failures = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) failures.push('evidence must be an object');
  if (evidence?.schemaVersion !== 1) failures.push('evidence schemaVersion must be 1');
  if (!gitObject(evidence?.appCandidateSha)) failures.push('evidence appCandidateSha is invalid');
  if (targetSha && evidence?.appCandidateSha !== targetSha.toLowerCase()) failures.push('evidence appCandidateSha differs from target SHA');
  if (mode === 'stable' && !targetSha) failures.push('stable verification requires an explicit target SHA');
  if (evidence?.appVersion !== packageVersion) failures.push('evidence appVersion differs from package version');
  if (!componentTagPattern.test(evidence?.component?.tag ?? '')) failures.push('evidence component tag is not canonical');
  if (!gitObject(evidence?.component?.sourceSha)) failures.push('evidence component source SHA is invalid');
  for (const field of ['archiveSha256', 'binarySha256', 'pbfSha256']) {
    if (!hash(evidence?.component?.[field])) failures.push(`evidence component ${field} is invalid`);
    else if (release?.[field] !== evidence.component[field]) failures.push(`evidence component ${field} differs from lock`);
  }
  if (!hash(evidence?.deployment?.installerSha256)) failures.push('evidence installer hash is invalid');
  if (!hash(evidence?.validation?.scenarioReportSha256) || evidence.validation.scenarioReportSha256 !== release?.scenarioReportSha256) failures.push('evidence scenario report hash differs from lock');
  if (!hash(evidence?.validation?.featureReportSha256)) failures.push('evidence feature report hash is invalid');
  for (const checkName of requiredFeatureChecks) {
    if (evidence?.validation?.checks?.[checkName] !== 'passed') failures.push(`feature check is not passed: ${checkName}`);
  }
  if (!Array.isArray(evidence?.validation?.rawResultHashes) || evidence.validation.rawResultHashes.length === 0 || evidence.validation.rawResultHashes.some((value) => !hash(value))) failures.push('raw result hashes are required');
  return failures;
}

export async function evaluateReadiness({ root = rootDirectory, mode = 'stable', evidencePath, targetSha } = {}) {
  if (mode !== 'stable' && mode !== 'rc') throw new Error(`Unknown readiness mode: ${mode}`);
  const packageJson = await readJson(path.join(root, 'package.json'));
  const lock = await readBuilderLock(path.join(root, 'scripts/motis/motis-builder-lock.json'));
  const config = await import(pathToFileURL(path.join(root, 'scripts/motis/motis-release-config.mjs')).href);
  const expectedVersion = mode === 'stable' ? '0.7.0' : /^0\.7\.0-rc\.\d+$/;
  const checks = [];

  checks.push(check(
    'app-version',
    typeof packageJson.version === 'string' && (expectedVersion instanceof RegExp ? expectedVersion.test(packageJson.version) : packageJson.version === expectedVersion),
    mode === 'stable' ? `package version must be ${expectedVersion}` : 'package version must remain a 0.7.0 release candidate'
  ));
  checks.push(proofGate(lock));
  const environmentOverrides = Object.keys(process.env).filter((name) => name.startsWith('TRANSIT_MOTIS_'));
  checks.push(check('environment-overrides', environmentOverrides.length === 0, environmentOverrides.length === 0 ? 'no TRANSIT_MOTIS_* release override is active' : `release overrides are active: ${environmentOverrides.join(', ')}`));

  const release = lock.release;
  const hashesPresent = release && ['archiveSha256', 'binarySha256', 'payloadTreeSha256', 'pbfSha256', 'scenarioReportSha256'].every((field) => hash(release[field]));
  checks.push(check('release-hashes', Boolean(hashesPresent), 'locked archive, binary, payload, PBF, and report hashes are required'));
  checks.push(check('config-binding', Boolean(release && config.MOTIS_RELEASE_CONFIG.archiveSha256 === release.archiveSha256 && config.MOTIS_RELEASE_CONFIG.expectedBinarySha256 === release.binarySha256), 'release config must match the locked candidate'));

  const evidenceFile = evidencePath ?? path.join(root, 'docs/test-reports/0.7.0-final-readiness.json');
  let evidence;
  try {
    evidence = await readJson(evidenceFile);
  } catch {
    checks.push(check('final-evidence', false, `final integrated evidence bundle is missing: ${path.relative(root, evidenceFile)}`));
  }
  if (evidence) {
    const failures = validateFinalEvidence(evidence, { packageVersion: packageJson.version, release, targetSha, mode });
    checks.push(check('final-evidence', failures.length === 0, failures.length === 0 ? 'final evidence binds the app candidate, component, installer, and feature hashes' : failures.join('; ')));
  } else if (mode === 'stable') {
    checks.push(check('candidate-commit', false, 'stable verification requires final evidence for an explicit app candidate SHA'));
  }

  const internalConsistent = checks.every((entry) => !['app-version', 'environment-overrides'].includes(entry.name) || entry.passed) && (!evidence || checks.find((entry) => entry.name === 'final-evidence')?.passed === true);
  return { schemaVersion: 1, mode, appVersion: packageJson.version, releaseReady: checks.every((entry) => entry.passed), internalConsistent, checks };
}

function pathToFileURL(filePath) {
  return new URL(`file://${path.resolve(filePath).replaceAll('\\', '/')}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) values[argv[index]] = argv[++index];
  const report = await evaluateReadiness({ mode: values['--mode'] ?? 'stable', evidencePath: values['--evidence'] && path.resolve(values['--evidence']), targetSha: values['--target-sha'] });
  if (values['--output']) await writeFile(path.resolve(values['--output']), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (report.mode === 'stable' && !report.releaseReady) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Release readiness verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
