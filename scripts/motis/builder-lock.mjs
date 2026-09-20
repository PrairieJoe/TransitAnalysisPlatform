import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const observationFields = ['compilerFamily', 'compilerVersion', 'windowsSdkVersion', 'cmakeVersion', 'ninjaVersion', 'generator', 'runnerImage'];
const lockedToolchainFields = observationFields;
const sha256Pattern = /^[a-f0-9]{64}$/i;

export async function readBuilderLock(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid builder lock JSON: ${error.message}`);
    throw error;
  }
  validateBuilderLock(parsed);
  return parsed;
}

export function verifyBuilderObservation(lock, observation, { requireLocked = true } = {}) {
  validateBuilderLock(lock);
  requireFields(observation, observationFields, 'Builder observation');
  if (observation.compilerFamily !== 'MSVC' || observation.generator !== 'Ninja') {
    throw new Error('Custom MOTIS requires MSVC with Ninja.');
  }
  if (requireLocked && lock.state !== 'locked') throw new Error('Builder toolchain is not locked.');
  if (lock.state === 'locked') {
    for (const key of lockedToolchainFields) {
      if (lock.toolchain[key] !== observation[key]) {
        throw new Error(`Builder ${displayName(key)} differs from lock.`);
      }
    }
  }
  return observation;
}

export function verifyReleaseAttestation(lock, attestation) {
  validateBuilderLock(lock);
  if (lock.state !== 'locked' || !lock.release) throw new Error('Builder release is not locked.');
  if (!isObject(attestation) || attestation.schemaVersion !== 1) throw new Error('Unknown release attestation schema.');
  requireFields(attestation, ['buildRunId', 'archiveSha256', 'binarySha256', 'pbfSha256', 'scenarioReportSha256'], 'Release attestation');
  requireSha256(attestation.archiveSha256, 'Release attestation archive SHA-256');
  requireSha256(attestation.binarySha256, 'Release attestation binary SHA-256');
  requireSha256(attestation.pbfSha256, 'Release attestation PBF SHA-256');
  requireSha256(attestation.scenarioReportSha256, 'Release attestation scenario report SHA-256');
  if (attestation.buildRunId !== lock.release.buildRunId) throw new Error('Release attestation build run differs from lock.');
  if (attestation.archiveSha256 !== lock.release.archiveSha256) throw new Error('Release attestation archive SHA-256 differs from lock.');
  if (attestation.binarySha256 !== lock.release.binarySha256) throw new Error('Release attestation binary SHA-256 differs from lock.');
  if (attestation.pbfSha256 !== lock.release.pbfSha256) throw new Error('Release attestation PBF SHA-256 differs from lock.');
  if (attestation.scenarioReportSha256 !== lock.release.scenarioReportSha256) throw new Error('Release attestation scenario report SHA-256 differs from lock.');
  return attestation;
}

function validateBuilderLock(lock) {
  if (!isObject(lock) || lock.schemaVersion !== 1) throw new Error('Unknown builder lock schema.');
  if (lock.state !== 'probe' && lock.state !== 'locked') throw new Error('Builder lock state must be probe or locked.');
  requireFields(lock.source, ['motisVersion', 'motisCommit', 'osrCommit'], 'Builder lock source');
  requireFields(lock.patch, ['id', 'file', 'sha256'], 'Builder lock patch');
  requireSha256(lock.patch.sha256, 'Builder lock patch SHA-256');
  if (!isObject(lock.artifact) || lock.artifact.format !== 'zip' || lock.artifact.manifestSchemaVersion !== 2) {
    throw new Error('Builder lock artifact must declare ZIP manifest schema 2.');
  }
  if (lock.state === 'locked') {
    requireFields(lock.toolchain, lockedToolchainFields, 'Locked builder toolchain');
    if (lock.toolchain.compilerFamily !== 'MSVC' || lock.toolchain.generator !== 'Ninja') {
      throw new Error('Custom MOTIS requires MSVC with Ninja.');
    }
    if (lock.release !== undefined) {
      if (!isObject(lock.release)) throw new Error('Locked builder release is invalid.');
      requireFields(lock.release, ['buildRunId', 'archiveSha256', 'binarySha256', 'pbfSha256', 'scenarioReportSha256'], 'Locked builder release');
      requireSha256(lock.release.archiveSha256, 'Locked builder archive SHA-256');
      requireSha256(lock.release.binarySha256, 'Locked builder binary SHA-256');
      requireSha256(lock.release.pbfSha256, 'Locked builder PBF SHA-256');
      requireSha256(lock.release.scenarioReportSha256, 'Locked builder scenario report SHA-256');
    }
  }
}

function requireFields(value, fields, label) {
  if (!isObject(value)) throw new Error(`${label} is required.`);
  for (const field of fields) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw new Error(`${label} ${displayName(field)} is required.`);
  }
}

function requireSha256(value, label) {
  if (!sha256Pattern.test(value)) throw new Error(`${label} must be a SHA-256 hash.`);
}

function displayName(field) {
  return ({ windowsSdkVersion: 'Windows SDK', cmakeVersion: 'CMake', ninjaVersion: 'Ninja', runnerImage: 'runner image' })[field] ?? field;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main() {
  const [lockPath = fileURLToPath(new URL('./motis-builder-lock.json', import.meta.url))] = process.argv.slice(2);
  await readBuilderLock(lockPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
