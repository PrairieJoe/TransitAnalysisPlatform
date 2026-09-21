import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, matchingProofInputs, matchingProofOutputs, proofEnvelopeSha256, validateBuildProofEnvelope } from './build-proof.mjs';

const observationFields = ['compilerFamily', 'compilerVersion', 'windowsSdkVersion', 'cmakeVersion', 'ninjaVersion', 'generator', 'runnerImage'];
const sha256Pattern = /^[0-9a-f]{64}$/i;
const defaultDirectory = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireHash(value, description) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) fail(`${description} must be a SHA-256 hash.`);
  return value.toLowerCase();
}

function validateAttestation(attestation, selectedProof) {
  if (!isObject(attestation) || attestation.schemaVersion !== 1) fail('Validation attestation schema is unknown.');
  for (const field of ['buildRunId', 'archiveSha256', 'binarySha256', 'pbfSha256', 'scenarioReportSha256']) {
    if (typeof attestation[field] !== 'string' || attestation[field].length === 0) fail(`Validation attestation ${field} is required.`);
  }
  for (const field of ['archiveSha256', 'binarySha256', 'pbfSha256', 'scenarioReportSha256']) requireHash(attestation[field], `Validation ${field}`);
  if (attestation.buildRunId !== selectedProof.provenance.runId) fail('Validation attestation build run differs from selected publish proof.');
  if (attestation.archiveSha256 !== selectedProof.outputs.archiveSha256) fail('Validation attestation archive SHA-256 differs from selected publish proof.');
  if (attestation.binarySha256 !== selectedProof.outputs.binarySha256) fail('Validation attestation binary SHA-256 differs from selected publish proof.');
  if (!isObject(attestation.officialControl) || attestation.officialControl.maxWays !== 16 || attestation.officialControl.failedNodeOsmId !== '10729381152' || attestation.officialControl.observedWays !== 18) {
    fail('Validation attestation is missing the official 16-way control result.');
  }
  const requiredChecks = ['import', 'health', 'bus', 'footAtProblemNode', 'coordinateTransit'];
  if (!isObject(attestation.candidate) || requiredChecks.some((field) => attestation.candidate[field] !== 'passed')) fail('Validation attestation candidate checks are not all passed.');
}

function proofReference(proof) {
  return {
    runId: proof.provenance.runId,
    runAttempt: proof.provenance.runAttempt,
    artifactId: proof.artifact.id,
    artifactName: proof.artifact.name,
    artifactDigestSha256: proof.artifact.digestSha256,
    attestationBundleSha256: proof.artifactAttestation.bundleSha256,
    proofEnvelopeSha256: proofEnvelopeSha256(proof)
  };
}

export function lockValidatedCandidate({ currentLock, firstProof, secondProof, attestation, replaceApprovedCandidate = false }) {
  if (!isObject(currentLock) || currentLock.schemaVersion !== 2 || !isObject(currentLock.source) || !isObject(currentLock.patch)) fail('Current builder lock is invalid.');
  validateBuildProofEnvelope(firstProof);
  validateBuildProofEnvelope(secondProof);
  if (firstProof.provenance.runId === secondProof.provenance.runId) fail('Independent proofs require distinct workflow run IDs; rerun attempts do not qualify.');
  if (firstProof.artifact.id === secondProof.artifact.id) fail('Independent proofs require distinct artifact IDs.');
  if (canonicalJson(matchingProofInputs(firstProof)) !== canonicalJson(matchingProofInputs(secondProof))) fail('Independent proof inputs differ.');
  if (canonicalJson(matchingProofOutputs(firstProof)) !== canonicalJson(matchingProofOutputs(secondProof))) fail('Independent proof outputs differ.');
  if (canonicalJson(firstProof.source) !== canonicalJson(currentLock.source)) fail('Build proof source identity differs from the builder lock.');
  if (canonicalJson(firstProof.patch) !== canonicalJson(currentLock.patch)) fail('Build proof patch identity differs from the builder lock.');
  validateAttestation(attestation, firstProof);

  const nextRelease = {
    buildRunId: firstProof.provenance.runId,
    selectedPublishProofRunId: firstProof.provenance.runId,
    archiveSha256: firstProof.outputs.archiveSha256.toLowerCase(),
    binarySha256: firstProof.outputs.binarySha256.toLowerCase(),
    payloadTreeSha256: firstProof.outputs.payloadTreeSha256.toLowerCase(),
    pbfSha256: attestation.pbfSha256.toLowerCase(),
    scenarioReportSha256: attestation.scenarioReportSha256.toLowerCase(),
    proofs: [proofReference(firstProof), proofReference(secondProof)]
  };
  if (currentLock.state === 'locked' && currentLock.release && canonicalJson(currentLock.release) !== canonicalJson(nextRelease) && !replaceApprovedCandidate) {
    fail('A different locked candidate exists; --replace-approved-candidate is required.');
  }
  return {
    lock: { ...currentLock, state: 'locked', source: currentLock.source, patch: currentLock.patch, artifact: currentLock.artifact, toolchain: firstProof.toolchain, release: nextRelease },
    validationReport: attestation
  };
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
  const next = { ...baseConfig, archiveSha256: lock.release.archiveSha256, expectedBinarySha256: lock.release.binarySha256, expectedBinarySizeBytes: baseConfig.expectedBinarySizeBytes ?? null };
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
    if (argument === '--replace-approved-candidate') { replaceApprovedCandidate = true; continue; }
    values[argument] = argv[++index];
  }
  if (!values['--first-proof'] || !values['--second-proof'] || !values['--attestation']) {
    throw new Error('Usage: node scripts/motis/lock-release-candidate.mjs --first-proof <json> --second-proof <json> --attestation <json>');
  }
  const lockPath = values['--lock'] ?? path.join(defaultDirectory, 'motis-builder-lock.json');
  const configPath = values['--config'] ?? path.join(defaultDirectory, 'motis-release-config.mjs');
  const reportPath = values['--report'] ?? path.resolve(defaultDirectory, '../../docs/test-reports/2026-09-20-motis-msvc-validation.json');
  const currentLock = await readJson(lockPath, 'builder lock');
  const firstProof = await readJson(values['--first-proof'], 'first build proof');
  const secondProof = await readJson(values['--second-proof'], 'second build proof');
  const attestation = await readJson(values['--attestation'], 'validation attestation');
  const baseConfig = await import(pathToFileURL(configPath).href).then((module) => module.MOTIS_RELEASE_CONFIG);
  const result = lockValidatedCandidate({ currentLock, firstProof, secondProof, attestation, replaceApprovedCandidate });
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
