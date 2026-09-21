import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256Pattern = /^[a-f0-9]{64}$/i;
const requiredGateNames = Object.freeze([
  'motis-artifact-and-actual-data',
  'boundary-validation',
  'app-regression',
  'packaged-smoke'
]);
const deferredChecks = Object.freeze([
  'independent-build-proofs',
  'builder-lock-and-supply-chain-hashes',
  'immutable-component-asset-provenance',
  'fresh-clone-release-bootstrap'
]);

function check(name, passed, detail) {
  return { name, passed, detail };
}

async function readJson(filePath, description) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${description} ${filePath}: ${error.message}`);
  }
}

function passed(value) {
  return value === 'passed' || value === true;
}

function validHash(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function validateMotisAttestation(attestation) {
  const failures = [];
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) failures.push('attestation must be an object');
  if (attestation?.schemaVersion !== 1) failures.push('attestation schemaVersion must be 1');
  if (!validHash(attestation?.pbfSha256)) failures.push('attestation PBF hash is missing');
  if (attestation?.officialControl?.failedNodeOsmId !== '10729381152' || attestation?.officialControl?.observedWays !== 18 || attestation?.officialControl?.maxWays !== 16) {
    failures.push('official 16-way control must record node 10729381152 with 18 ways');
  }
  const candidate = attestation?.candidate;
  for (const field of ['import', 'health', 'bus', 'footAtProblemNode', 'coordinateTransit']) {
    if (!passed(candidate?.[field])) failures.push(`32-way candidate ${field} did not pass`);
  }
  return failures;
}

function validateBoundary(attestation) {
  const overflow = attestation?.evidence?.overflowDiagnostic;
  if (!overflow || overflow.nodeOsmId !== '10729381152' || overflow.maxWays !== 32 || overflow.observedWays <= 32) {
    return ['33-way boundary rejection for node 10729381152 is missing'];
  }
  return [];
}

function validateCustomMotisArtifact(attestation, artifact) {
  const failures = [];
  if (!artifact || artifact.status !== 'passed' || artifact.schemaVersion !== 1) failures.push('deployable Custom MOTIS artifact report is missing');
  if (artifact?.manifestVerified !== true || artifact?.archiveMatchesDistribution !== true || artifact?.packagedBinaryMatches !== true) failures.push('Custom MOTIS artifact was not verified in the packaged app');
  if (!validHash(artifact?.archiveSha256) || !validHash(artifact?.binarySha256) || !validHash(artifact?.packagedBinarySha256)) failures.push('Custom MOTIS artifact hashes are invalid');
  if (attestation?.binarySha256 !== artifact?.binarySha256 || artifact?.binarySha256 !== artifact?.packagedBinarySha256) failures.push('validated and packaged Custom MOTIS binaries differ');
  return failures;
}

function validateAppRegression(evidence) {
  const regression = evidence?.gates?.appRegression;
  const failures = [];
  for (const field of ['tests', 'typecheck', 'build']) {
    if (!passed(regression?.[field])) failures.push(`app ${field} did not pass`);
  }
  return failures;
}

async function validatePackagedSmoke(root, evidence) {
  const smoke = evidence?.gates?.packagedSmoke;
  if (!passed(smoke?.status)) return ['packaged application smoke did not pass'];
  if (typeof smoke.resultPath !== 'string' || smoke.resultPath.trim().length === 0) return ['packaged smoke result path is missing'];
  let result;
  try {
    result = await readJson(path.resolve(root, smoke.resultPath), 'packaged smoke result');
  } catch (error) {
    return [error.message];
  }
  if (!Array.isArray(result.checks) || result.checks.length === 0) return ['packaged smoke has no passing checks'];
  if (!Array.isArray(result.rendererErrors) || result.rendererErrors.length !== 0) return ['packaged smoke recorded renderer errors'];
  return [];
}

export async function evaluateReadiness({ root = rootDirectory, mode = 'stable', evidencePath } = {}) {
  if (mode !== 'stable' && mode !== 'rc') throw new Error(`Unknown readiness mode: ${mode}`);
  const packageJson = await readJson(path.join(root, 'package.json'), 'package metadata');
  const evidenceFile = evidencePath ?? path.join(root, 'docs/test-reports/0.7.1-final-readiness.json');
  const evidence = await readJson(evidenceFile, 'release readiness evidence');
  const checks = [];
  const expectedVersion = mode === 'stable' ? '0.7.1' : /^0\.7\.1-rc\.\d+$/;
  const appVersionPassed = typeof packageJson.version === 'string' && (expectedVersion instanceof RegExp ? expectedVersion.test(packageJson.version) : packageJson.version === expectedVersion);
  checks.push(check('app-version', appVersionPassed, mode === 'stable' ? 'package version must be 0.7.1' : 'package version must remain a 0.7.1 release candidate'));

  const evidenceVersionPassed = evidence?.appVersion === packageJson.version;
  checks.push(check('evidence-version', evidenceVersionPassed, evidenceVersionPassed ? 'evidence uses the current package version' : 'evidence appVersion differs from package version'));

  let attestation;
  let artifact;
  const attestationPath = path.join(root, 'test-artifacts/motis-validation-attestation.json');
  const artifactPath = path.join(root, 'test-artifacts/motis-component-artifact.json');
  try {
    attestation = await readJson(attestationPath, '32-way MOTIS validation attestation');
  } catch (error) {
    checks.push(check('motis-artifact-and-actual-data', false, error.message));
    checks.push(check('boundary-validation', false, '32-way attestation is unavailable'));
    attestation = undefined;
  }
  try {
    artifact = await readJson(artifactPath, 'deployable Custom MOTIS artifact report');
  } catch (error) {
    if (attestation) checks.push(check('motis-artifact-and-actual-data', false, error.message));
  }
  if (attestation) {
    const motisFailures = [...validateMotisAttestation(attestation), ...validateCustomMotisArtifact(attestation, artifact)];
    checks.push(check('motis-artifact-and-actual-data', motisFailures.length === 0, motisFailures.length === 0 ? 'verified 32-way Custom MOTIS artifact passed actual-data validation and is included in the packaged app' : motisFailures.join('; ')));
    const boundaryFailures = validateBoundary(attestation);
    checks.push(check('boundary-validation', boundaryFailures.length === 0, boundaryFailures.length === 0 ? '32-way boundary rejects the 33-way overflow case' : boundaryFailures.join('; ')));
  }

  const regressionFailures = validateAppRegression(evidence);
  checks.push(check('app-regression', regressionFailures.length === 0, regressionFailures.length === 0 ? 'regression tests, typecheck, and production build passed' : regressionFailures.join('; ')));
  const smokeFailures = await validatePackagedSmoke(root, evidence);
  checks.push(check('packaged-smoke', smokeFailures.length === 0, smokeFailures.length === 0 ? 'packaged app core smoke passed with no renderer errors' : smokeFailures.join('; ')));

  const blockingChecks = checks.filter((entry) => requiredGateNames.includes(entry.name) || entry.name === 'app-version' || entry.name === 'evidence-version');
  const gatesPassed = blockingChecks.every((entry) => entry.passed);
  const releaseReady = mode === 'stable' && gatesPassed;
  return {
    schemaVersion: 2,
    mode,
    appVersion: packageJson.version,
    releaseReady,
    internalConsistent: evidenceVersionPassed && checks.filter((entry) => entry.name !== 'app-version').every((entry) => entry.passed),
    checks,
    deferredChecks
  };
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
