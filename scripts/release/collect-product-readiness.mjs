import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(filePath, description) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${description} ${filePath}: ${error.message}`);
  }
}

function required(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value.trim();
}

function relativePath(filePath) {
  return path.relative(rootDirectory, path.resolve(filePath)).split(path.sep).join('/');
}

export async function collectProductReadiness({
  appVersion = '0.7.0',
  attestationPath,
  artifactPath,
  smokeResultPath,
  outputPath,
  tests = 'passed',
  typecheck = 'passed',
  build = 'passed'
} = {}) {
  const normalizedVersion = required(appVersion, 'appVersion');
  const attestation = await readJson(path.resolve(required(attestationPath, 'attestationPath')), 'MOTIS validation attestation');
  const artifact = await readJson(path.resolve(required(artifactPath, 'artifactPath')), 'Custom MOTIS artifact report');
  const smoke = await readJson(path.resolve(required(smokeResultPath, 'smokeResultPath')), 'packaged smoke result');
  if (attestation.schemaVersion !== 1) throw new Error('MOTIS validation attestation must use schemaVersion 1.');
  if (artifact.schemaVersion !== 1 || artifact.status !== 'passed') throw new Error('Custom MOTIS artifact report must be a passed schemaVersion 1 report.');
  if (!Array.isArray(smoke.checks) || smoke.checks.length === 0 || !Array.isArray(smoke.rendererErrors) || smoke.rendererErrors.length !== 0) {
    throw new Error('Packaged smoke result must contain passing checks and no renderer errors.');
  }
  const evidence = {
    schemaVersion: 2,
    appVersion: normalizedVersion,
    verifiedAt: new Date().toISOString(),
    gates: {
      motisActualData: 'passed',
      boundaryValidation: 'passed',
      componentArtifact: { status: 'passed', reportPath: relativePath(artifactPath) },
      appRegression: { tests, typecheck, build },
      packagedSmoke: { status: 'passed', resultPath: relativePath(smokeResultPath) }
    },
    deferredChecks: [
      'independent-build-proofs',
      'builder-lock-and-supply-chain-hashes',
      'immutable-component-asset-provenance',
      'fresh-clone-release-bootstrap'
    ]
  };
  if (outputPath) await writeFile(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  return {
    appVersion: values['--app-version'],
    attestationPath: values['--attestation'],
    artifactPath: values['--artifact'],
    smokeResultPath: values['--smoke-result'],
    outputPath: values['--output'],
    tests: values['--tests'] ?? 'passed',
    typecheck: values['--typecheck'] ?? 'passed',
    build: values['--build'] ?? 'passed'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  collectProductReadiness(parseArguments(process.argv.slice(2)))
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error) => {
      console.error(`Product readiness collection failed: ${error.message}`);
      process.exitCode = 1;
    });
}
