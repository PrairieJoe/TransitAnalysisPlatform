import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuilderLock, verifyBuilderObservation } from './builder-lock.mjs';
import { missingRequiredMsvcCrtDlls } from './msvc-runtime.mjs';

const manifestName = 'motis-manifest.json';
const defaultLockPath = fileURLToPath(new URL('./motis-builder-lock.json', import.meta.url));
const requiredLicenseFiles = ['licenses/MOTIS-MIT.txt', 'licenses/OSR-MIT.txt'];

function fail(message) {
  throw new Error(message);
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', rejectHash);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function readJson(filePath, description) {
  try {
    return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`Unable to read ${description} ${filePath}: ${error.message}`);
  }
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (entry.isSymbolicLink()) fail(`Distribution must not contain symbolic links: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolutePath));
    else if (entry.isFile() && relativePath !== manifestName) files.push(relativePath);
    else if (!entry.isFile()) fail(`Distribution contains an unsupported filesystem entry: ${relativePath}`);
  }
  return files;
}

function requireFile(filesByPath, relativePath, description) {
  const file = filesByPath.get(relativePath);
  if (!file) fail(`Required ${description} is missing: ${relativePath}`);
  return file;
}

function requireDirectoryPayload(files, prefix, description) {
  if (!files.some((file) => file.path.startsWith(`${prefix}/`))) {
    fail(`Required ${description} directory is missing or empty: ${prefix}`);
  }
}

export async function createReleaseCandidate(distributionDirectory, options = {}) {
  const root = path.resolve(distributionDirectory);
  const rootInfo = await lstat(root).catch(() => undefined);
  if (!rootInfo?.isDirectory()) fail(`Staged MOTIS distribution does not exist: ${root}`);

  const lock = await readBuilderLock(path.resolve(options.lockPath ?? defaultLockPath));
  const observationPath = path.join(root, 'builder-observation.json');
  const observation = await readJson(observationPath, 'builder observation');
  verifyBuilderObservation(lock, observation, { requireLocked: false });

  const relativePaths = (await listFiles(root)).sort(comparePaths);
  const files = await Promise.all(relativePaths.map(async (relativePath) => {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    const fileInfo = await stat(absolutePath);
    return { path: relativePath, sha256: await sha256(absolutePath), sizeBytes: fileInfo.size };
  }));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const binary = requireFile(filesByPath, 'motis.exe', 'MOTIS executable');
  requireFile(filesByPath, 'builder-observation.json', 'builder observation');
  for (const licenseFile of requiredLicenseFiles) requireFile(filesByPath, licenseFile, 'license file');
  requireDirectoryPayload(files, 'tiles-profiles', 'tiles-profiles');
  requireDirectoryPayload(files, 'ui', 'UI');

  const runtimeDlls = files
    .map((file) => file.path)
    .filter((relativePath) => !relativePath.includes('/') && relativePath.toLowerCase().endsWith('.dll'))
    .sort(comparePaths);
  const missingCrtDlls = missingRequiredMsvcCrtDlls(runtimeDlls);
  if (missingCrtDlls.length) fail(`Required MSVC CRT DLL is missing: ${missingCrtDlls.join(', ')}`);

  const manifest = {
    schemaVersion: 2,
    motisVersion: lock.source.motisVersion,
    motisCommit: lock.source.motisCommit,
    osrCommit: lock.source.osrCommit,
    patchId: lock.patch.id,
    patchSha256: lock.patch.sha256,
    baseMaxWaysPerNode: 16,
    maxWaysPerNode: 32,
    platform: 'windows-x64',
    builder: observation,
    sourceDiff: { changedFiles: ['include/osr/types.h'] },
    binary: { path: binary.path, sha256: binary.sha256, sizeBytes: binary.sizeBytes },
    tilesProfiles: 'tiles-profiles',
    ui: 'ui',
    runtimeDlls,
    licenseFiles: requiredLicenseFiles,
    validation: {
      status: 'unvalidated',
      pbfSha256: null,
      supportedMaxWaysPerNode: 32,
      nodesAboveMaxWaysPerNode: 'unsupported'
    },
    files
  };

  const manifestPath = path.resolve(options.manifestPath ?? path.join(root, manifestName));
  if (path.dirname(manifestPath) !== root) fail('Release candidate manifest must be written at the distribution root.');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestPath };
}

async function main() {
  const [distributionDirectory, lockPath] = process.argv.slice(2);
  if (!distributionDirectory) throw new Error('Usage: node scripts/motis/create-release-candidate.mjs <distribution-directory> [builder-lock-path]');
  const result = await createReleaseCandidate(distributionDirectory, lockPath ? { lockPath } : undefined);
  console.log(`Created Custom MOTIS manifest v2: ${result.manifestPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`MOTIS release candidate creation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
