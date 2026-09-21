import { createHash } from 'node:crypto';

const sha256Pattern = /^[a-f0-9]{64}$/i;
const gitObjectPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const toolchainFields = ['compilerFamily', 'compilerVersion', 'windowsSdkVersion', 'cmakeVersion', 'ninjaVersion', 'generator', 'runnerImage'];

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} is required.`);
  return value;
}

function requireSha256(value, label) {
  if (!sha256Pattern.test(value)) fail(`${label} must be a SHA-256 hash.`);
  return value.toLowerCase();
}

function requireGitObject(value, label) {
  if (!gitObjectPattern.test(value)) fail(`${label} must be a Git object SHA.`);
  return value.toLowerCase();
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function proofEnvelopeSha256(proof) {
  return createHash('sha256').update(canonicalJson(proof)).digest('hex');
}

export function validateBuildProofEnvelope(proof) {
  if (!isObject(proof) || proof.schemaVersion !== 1) fail('Unknown build proof envelope schema.');
  const provenance = proof.provenance;
  if (!isObject(provenance)) fail('Build proof provenance is required.');
  for (const field of ['repository', 'workflowPath', 'runId', 'runnerImage', 'runnerImageVersion']) requireString(provenance[field], `Build proof ${field}`);
  requireGitObject(provenance.workflowSha, 'Build proof workflow SHA');
  requireGitObject(provenance.headSha, 'Build proof head SHA');
  if (!Number.isInteger(provenance.runAttempt) || provenance.runAttempt < 1) fail('Build proof run attempt must be a positive integer.');

  if (!isObject(proof.artifact)) fail('Build proof artifact identity is required.');
  for (const field of ['id', 'name']) requireString(proof.artifact[field], `Build proof artifact ${field}`);
  requireSha256(proof.artifact.digestSha256, 'Build proof artifact digest');

  if (!isObject(proof.source)) fail('Build proof source identity is required.');
  for (const field of ['motisVersion', 'motisCommit', 'osrCommit']) requireString(proof.source[field], `Build proof source ${field}`);
  if (!isObject(proof.patch)) fail('Build proof patch identity is required.');
  for (const field of ['id', 'file']) requireString(proof.patch[field], `Build proof patch ${field}`);
  requireSha256(proof.patch.sha256, 'Build proof patch SHA-256');
  if (!isObject(proof.toolchain)) fail('Build proof toolchain is required.');
  for (const field of toolchainFields) requireString(proof.toolchain[field], `Build proof toolchain ${field}`);
  if (proof.toolchain.compilerFamily !== 'MSVC' || proof.toolchain.generator !== 'Ninja') fail('Build proof must use MSVC with Ninja.');

  if (!isObject(proof.buildInputs)) fail('Build proof build inputs are required.');
  for (const field of ['configuration', 'platform', 'generator']) requireString(proof.buildInputs[field], `Build proof input ${field}`);
  if (!Number.isInteger(proof.buildInputs.parallelism) || proof.buildInputs.parallelism < 1) fail('Build proof parallelism must be a positive integer.');
  if (!Array.isArray(proof.buildInputs.cmakeDefinitions) || proof.buildInputs.cmakeDefinitions.some((entry) => typeof entry !== 'string' || !entry)) fail('Build proof CMake definitions are required.');

  if (!isObject(proof.outputs)) fail('Build proof outputs are required.');
  for (const field of ['binarySha256', 'payloadTreeSha256', 'archiveSha256']) requireSha256(proof.outputs[field], `Build proof output ${field}`);

  const receipt = proof.artifactAttestation;
  if (!isObject(receipt) || receipt.schemaVersion !== 1 || receipt.status !== 'verified') fail('Build proof artifact attestation must be verified.');
  for (const field of ['repository', 'workflowPath']) requireString(receipt[field], `Artifact attestation ${field}`);
  requireGitObject(receipt.workflowSha, 'Artifact attestation workflow SHA');
  requireGitObject(receipt.headSha, 'Artifact attestation head SHA');
  requireSha256(receipt.subjectDigestSha256, 'Artifact attestation subject digest');
  requireSha256(receipt.bundleSha256, 'Artifact attestation bundle SHA-256');
  for (const field of ['repository', 'workflowPath', 'workflowSha', 'headSha']) {
    if (receipt[field] !== provenance[field]) fail(`Artifact attestation ${field} differs from proof provenance.`);
  }
  if (receipt.subjectDigestSha256 !== proof.outputs.archiveSha256) fail('Artifact attestation subject digest differs from the deterministic archive.');
  return proof;
}

export function matchingProofInputs(proof) {
  return {
    repository: proof.provenance.repository,
    workflowPath: proof.provenance.workflowPath,
    workflowSha: proof.provenance.workflowSha,
    headSha: proof.provenance.headSha,
    runnerImage: proof.provenance.runnerImage,
    runnerImageVersion: proof.provenance.runnerImageVersion,
    source: proof.source,
    patch: proof.patch,
    toolchain: proof.toolchain,
    buildInputs: proof.buildInputs
  };
}

export function matchingProofOutputs(proof) {
  return {
    binarySha256: proof.outputs.binarySha256,
    payloadTreeSha256: proof.outputs.payloadTreeSha256,
    archiveSha256: proof.outputs.archiveSha256
  };
}
