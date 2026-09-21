import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required.`);
  return value;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

export async function createBuildProofEnvelope(options) {
  const lock = await readJson(options.lockPath, 'builder lock');
  const toolchain = await readJson(options.observationPath, 'builder observation');
  const candidate = await readJson(options.candidateMetadataPath, 'candidate metadata');
  const artifactAttestation = options.attestationReceiptPath
    ? await readJson(options.attestationReceiptPath, 'verified artifact attestation receipt')
    : { schemaVersion: 1, status: 'pending' };
  const proof = {
    schemaVersion: 1,
    provenance: {
      repository: required(options.repository, 'Repository'),
      workflowPath: required(options.workflowPath, 'Workflow path'),
      workflowSha: required(options.workflowSha, 'Workflow SHA'),
      headSha: required(options.headSha, 'Head SHA'),
      runId: required(options.runId, 'Workflow run ID'),
      runAttempt: Number(options.runAttempt),
      runnerImage: required(toolchain.runnerImage, 'Runner image'),
      runnerImageVersion: required(options.runnerImageVersion, 'Runner image version')
    },
    artifact: {
      id: required(options.artifactId, 'Artifact ID'),
      name: required(options.artifactName, 'Artifact name'),
      digestSha256: required(options.artifactDigestSha256, 'Artifact digest').replace(/^sha256:/, '')
    },
    source: lock.source,
    patch: lock.patch,
    toolchain,
    buildInputs: {
      configuration: 'Release',
      platform: 'windows-x64',
      generator: 'Ninja',
      parallelism: 4,
      cmakeDefinitions: [
        'CMAKE_C_FLAGS=/Brepro',
        'CMAKE_CXX_FLAGS=/Brepro',
        'CMAKE_EXE_LINKER_FLAGS=/Brepro',
        'MOTIS_MIMALLOC=ON',
        'NO_BUILDCACHE=ON'
      ]
    },
    outputs: {
      binarySha256: candidate.binarySha256,
      payloadTreeSha256: candidate.payloadTreeSha256,
      archiveSha256: candidate.archiveSha256
    },
    artifactAttestation
  };
  await writeFile(options.outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return proof;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  const env = process.env;
  return {
    lockPath: values['--lock'], observationPath: values['--observation'], candidateMetadataPath: values['--candidate-metadata'],
    outputPath: values['--output'], attestationReceiptPath: values['--attestation-receipt'],
    repository: env.GITHUB_REPOSITORY, workflowPath: env.MOTIS_WORKFLOW_PATH, workflowSha: env.MOTIS_WORKFLOW_SHA,
    headSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    runnerImageVersion: env.ImageVersion, artifactId: env.MOTIS_ARTIFACT_ID, artifactName: env.MOTIS_ARTIFACT_NAME,
    artifactDigestSha256: env.MOTIS_ARTIFACT_DIGEST
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArguments(process.argv.slice(2));
  if (!options.lockPath || !options.observationPath || !options.candidateMetadataPath || !options.outputPath) {
    throw new Error('Usage: node scripts/motis/create-build-proof-envelope.mjs --lock <json> --observation <json> --candidate-metadata <json> --output <json> [--attestation-receipt <json>]');
  }
  createBuildProofEnvelope(options).catch((error) => {
    console.error(`Build proof envelope creation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
