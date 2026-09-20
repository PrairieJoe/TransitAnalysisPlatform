import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const observationFields = ['compilerFamily', 'compilerVersion', 'windowsSdkVersion', 'cmakeVersion', 'ninjaVersion', 'generator', 'runnerImage'];
const sha256Pattern = /^[0-9a-f]{64}$/i;
const defaultDirectory = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}

function requireHash(value, description) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) fail(`${description} must be a SHA-256 hash.`);
  return value.toLowerCase();
}

function readToolchain(observation, label) {
  const toolchain = observation?.toolchain ?? observation;
  if (!isObject(toolchain)) fail(`${label} toolchain is required.`);
  for (const field of observationFields) {
    if (typeof toolchain[field] !== 'string' || toolchain[field].length === 0) fail(`${label} ${field} is required.`);
  }
  if (toolchain.compilerFamily !== 'MSVC' || toolchain.generator !== 'Ninja') fail(`${label} must use MSVC with Ninja.`);
  return toolchain;
}

function readIdentity(observation, label, fallback) {
  const source = observation?.source ?? fallback.source;
  const patch = observation?.patch ?? fallback.patch;
  if (!isObject(source) || !isObject(patch)) fail(`${label} source and patch identities are required.`);
  if (stable(source) !== stable(fallback.source)) fail(`${label} source identity differs from the builder lock.`);
  if (stable(patch) !== stable(fallback.patch)) fail(`${label} patch identity differs from the builder lock.`);
  return { source, patch };
}

function validateAttestation(attestation, firstObservation, secondObservation) {
  if (!isObject(attestation) || attestation.schemaVersion !== 1) fail('Validation attestation schema is unknown.');
  for (const field of ['buildRunId', 'archiveSha256', 'binarySha256', 'pbfSha256']) {
    if (typeof attestation[field] !== 'string' || attestation[field].length === 0) fail(`Validation attestation ${field} is required.`);
  }
  requireHash(attestation.archiveSha256, 'Validation archive SHA-256');
  requireHash(attestation.binarySha256, 'Validation binary SHA-256');
  requireHash(attestation.pbfSha256, 'Validation PBF SHA-256');
  const firstRunId = firstObservation.buildRunId;
  const secondRunId = secondObservation.buildRunId;
  if (firstRunId && secondRunId && firstRunId !== secondRunId) fail('Proof observations have different build run IDs.');
  if ((firstRunId ?? attestation.buildRunId) !== attestation.buildRunId) fail('Validation attestation build run differs from proof observation.');
  if (!isObject(attestation.officialControl) || attestation.officialControl.maxWays !== 16 || attestation.officialControl.observedWays !== 18) {
    fail('Validation attestation is missing the official 16-way control result.');
  }
  const candidate = attestation.candidate;
  const requiredChecks = ['import', 'health', 'bus', 'footAtProblemNode', 'coordinateTransit'];
  if (!isObject(candidate) || requiredChecks.some((field) => candidate[field] !== 'passed')) fail('Validation attestation candidate checks are not all passed.');
}

export function lockValidatedCandidate({ currentLock, firstObservation, secondObservation, attestation, replaceApprovedCandidate = false }) {
  if (!isObject(currentLock) || currentLock.schemaVersion !== 1 || !isObject(currentLock.source) || !isObject(currentLock.patch)) fail('Current builder lock is invalid.');
  const firstToolchain = readToolchain(firstObservation, 'First proof');
  const secondToolchain = readToolchain(secondObservation, 'Second proof');
  if (stable(firstToolchain) !== stable(secondToolchain)) fail('Proof observations have different MSVC toolchains.');
  readIdentity(firstObservation, 'First proof', currentLock);
  readIdentity(secondObservation, 'Second proof', currentLock);
  validateAttestation(attestation, firstObservation, secondObservation);

  const nextRelease = {
    buildRunId: attestation.buildRunId,
    archiveSha256: attestation.archiveSha256.toLowerCase(),
    binarySha256: attestation.binarySha256.toLowerCase()
  };
  if (currentLock.state === 'locked' && currentLock.release && stable(currentLock.release) !== stable(nextRelease) && !replaceApprovedCandidate) {
    fail('A different locked candidate exists; --replace-approved-candidate is required.');
  }

  const lock = {
    ...currentLock,
    state: 'locked',
    source: currentLock.source,
    patch: currentLock.patch,
    artifact: currentLock.artifact,
    toolchain: firstToolchain,
    release: nextRelease
  };
  return { lock, validationReport: attestation };
}

async function readJson(filePath, description) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${description}: ${error.message}`);
  }
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, filePath);
}

function releaseConfigSource(baseConfig, lock) {
  const next = {
    ...baseConfig,
    archiveSha256: lock.release.archiveSha256,
    expectedBinarySha256: lock.release.binarySha256,
    expectedBinarySizeBytes: baseConfig.expectedBinarySizeBytes ?? null
  };
  return `export const MOTIS_RELEASE_CONFIG = Object.freeze(${JSON.stringify(next, null, 2)});\n`;
}

export async function writeLockedCandidate({ lockPath, configPath, reportPath, result, baseConfig }) {
  await atomicWrite(lockPath, `${JSON.stringify(result.lock, null, 2)}\n`);
  await atomicWrite(configPath, releaseConfigSource(baseConfig, result.lock));
  await atomicWrite(reportPath, `${JSON.stringify(result.validationReport, null, 2)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const values = {};
  let replaceApprovedCandidate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--replace-approved-candidate') {
      replaceApprovedCandidate = true;
      continue;
    }
    values[argument] = argv[++index];
  }
  if (!values['--first-observation'] || !values['--second-observation'] || !values['--attestation']) {
    throw new Error('Usage: node scripts/motis/lock-release-candidate.mjs --first-observation <json> --second-observation <json> --attestation <json>');
  }
  const lockPath = values['--lock'] ?? path.join(defaultDirectory, 'motis-builder-lock.json');
  const configPath = values['--config'] ?? path.join(defaultDirectory, 'motis-release-config.mjs');
  const reportPath = values['--report'] ?? path.resolve(defaultDirectory, '../../docs/test-reports/2026-09-20-motis-msvc-validation.json');
  const currentLock = await readJson(lockPath, 'builder lock');
  const firstObservation = await readJson(values['--first-observation'], 'first proof observation');
  const secondObservation = await readJson(values['--second-observation'], 'second proof observation');
  const attestation = await readJson(values['--attestation'], 'validation attestation');
  const baseConfig = await import(pathToFileURL(configPath).href).then((module) => module.MOTIS_RELEASE_CONFIG);
  const result = lockValidatedCandidate({ currentLock, firstObservation, secondObservation, attestation, replaceApprovedCandidate });
  await writeLockedCandidate({ lockPath, configPath, reportPath, result, baseConfig });
  console.log(`Locked validated Custom MOTIS candidate: ${result.lock.release.buildRunId}`);
}

function pathToFileURL(filePath) {
  return new URL(`file://${path.resolve(filePath).replaceAll('\\', '/')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`MOTIS candidate lock failed: ${error.message}`);
    process.exitCode = 1;
  });
}
