import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import extract from 'extract-zip';

import { verifyPatchedBuild } from '../motis/verify-patched-build.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256Pattern = /^[a-f0-9]{64}$/i;

function fail(message) {
  throw new Error(message);
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function requireFile(filePath, description) {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) fail(`${description} is missing: ${filePath}`);
}

async function findManifest(root) {
  const direct = path.join(root, 'motis-manifest.json');
  if ((await stat(direct).catch(() => undefined))?.isFile()) return direct;
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
  if (entries.length === 1) {
    const nested = path.join(root, entries[0].name, 'motis-manifest.json');
    if ((await stat(nested).catch(() => undefined))?.isFile()) return nested;
  }
  fail(`Custom MOTIS artifact has no manifest: ${root}`);
}

export async function verifyCustomMotisArtifact({ archivePath, distributionPath, packagedBinaryPath } = {}) {
  if (!archivePath || !distributionPath || !packagedBinaryPath) fail('archivePath, distributionPath, and packagedBinaryPath are required.');
  await requireFile(archivePath, 'Custom MOTIS archive');
  const distributionManifestPath = path.join(distributionPath, 'motis-manifest.json');
  await requireFile(distributionManifestPath, 'Custom MOTIS distribution manifest');
  await requireFile(packagedBinaryPath, 'packaged Custom MOTIS binary');

  const distribution = await verifyPatchedBuild(distributionManifestPath, { mode: 'candidate' });
  const archiveSha256 = await sha256(archivePath);
  const distributionBinarySha256 = await sha256(distribution.binaryPath);
  if (distributionBinarySha256 !== distribution.actualSha256) fail('Distribution binary hash differs from its manifest.');

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tap-motis-artifact-'));
  try {
    await extract(archivePath, { dir: temporaryDirectory });
    const archiveManifestPath = await findManifest(temporaryDirectory);
    const archiveDistribution = await verifyPatchedBuild(archiveManifestPath, { mode: 'candidate' });
    if (archiveDistribution.actualSha256 !== distribution.actualSha256) fail('Archive and distribution contain different MOTIS binaries.');
    const packagedBinarySha256 = await sha256(packagedBinaryPath);
    if (packagedBinarySha256 !== distribution.actualSha256) fail('Packaged app does not contain the verified Custom MOTIS binary.');
    if (!sha256Pattern.test(archiveSha256)) fail('Custom MOTIS archive hash is invalid.');
    return {
      schemaVersion: 1,
      status: 'passed',
      archivePath: path.relative(rootDirectory, path.resolve(archivePath)).split(path.sep).join('/'),
      archiveSha256,
      distributionPath: path.relative(rootDirectory, path.resolve(distributionPath)).split(path.sep).join('/'),
      manifestPath: path.relative(rootDirectory, distributionManifestPath).split(path.sep).join('/'),
      binarySha256: distribution.actualSha256,
      packagedBinaryPath: path.relative(rootDirectory, path.resolve(packagedBinaryPath)).split(path.sep).join('/'),
      packagedBinarySha256,
      manifestVerified: true,
      archiveMatchesDistribution: true,
      packagedBinaryMatches: true
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const values = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  const result = await verifyCustomMotisArtifact({
    archivePath: path.resolve(values['--archive'] ?? ''),
    distributionPath: path.resolve(values['--distribution'] ?? ''),
    packagedBinaryPath: path.resolve(values['--packaged-binary'] ?? '')
  });
  if (values['--output']) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.resolve(values['--output']), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Custom MOTIS artifact verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
