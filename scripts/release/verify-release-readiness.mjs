import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuilderLock } from '../motis/builder-lock.mjs';

const sha256Pattern = /^[a-f0-9]{64}$/i;
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

function proofGate(lock) {
  const proofs = lock.release?.proofs;
  if (lock.state !== 'locked' || !lock.release) return check('builder-lock', false, 'builder lock is still in probe state');
  if (!Array.isArray(proofs) || proofs.length !== 2) return check('independent-proofs', false, 'exactly two build proofs are required');
  if (proofs[0]?.runId === proofs[1]?.runId) return check('independent-proofs', false, 'proof run IDs must be distinct');
  return check('independent-proofs', true, 'two distinct proof identities are recorded');
}

export async function evaluateReadiness({ root = rootDirectory, mode = 'stable', evidencePath } = {}) {
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
    const evidenceMatches = evidence.schemaVersion === 1 && evidence.appVersion === packageJson.version && evidence.component?.archiveSha256 === release?.archiveSha256 && evidence.component?.binarySha256 === release?.binarySha256;
    checks.push(check('final-evidence', evidenceMatches, 'final evidence must bind app version and locked Custom MOTIS hashes'));
  }

  const internalConsistent = checks.every((entry) => !['app-version'].includes(entry.name) || entry.passed);
  return { schemaVersion: 1, mode, appVersion: packageJson.version, releaseReady: checks.every((entry) => entry.passed), internalConsistent, checks };
}

function pathToFileURL(filePath) {
  return new URL(`file://${path.resolve(filePath).replaceAll('\\', '/')}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) values[argv[index]] = argv[++index];
  const report = await evaluateReadiness({ mode: values['--mode'] ?? 'stable', evidencePath: values['--evidence'] && path.resolve(values['--evidence']) });
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
