import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { readBuilderLock, verifyBuilderObservation } from './builder-lock.mjs';
import { missingRequiredMsvcCrtDlls } from './msvc-runtime.mjs';

const manifestName = 'motis-manifest.json';
const defaultLockPath = fileURLToPath(new URL('./motis-builder-lock.json', import.meta.url));
const requiredLicenseFiles = ['licenses/MOTIS-MIT.txt', 'licenses/OSR-MIT.txt'];
const requiredSourceDiff = { changedFiles: ['include/osr/types.h'] };
const requiredValidation = {
  status: 'unvalidated',
  pbfSha256: null,
  supportedMaxWaysPerNode: 32,
  nodesAboveMaxWaysPerNode: 'unsupported'
};
const verificationModes = new Set(['locked', 'candidate']);
const sha256Pattern = /^[0-9a-f]{64}$/i;

function fail(message) {
  throw new Error(message);
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(filePath, description) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    fail(`Unable to read ${description} ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (error) {
    fail(`${description} is not valid JSON: ${error.message}`);
  }
}

function assertObject(value, description) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${description} must be an object.`);
  }
}

function assertExact(container, field, expected, description = field) {
  if (container[field] !== expected) {
    fail(`Manifest ${description} must be ${JSON.stringify(expected)}; got ${JSON.stringify(container[field])}.`);
  }
}

function assertDeepExact(actual, expected, description) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`Manifest ${description} does not match the required Custom MOTIS metadata.`);
  }
}

function validateRelativePath(value, description) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`Manifest ${description} path must be a non-empty relative path.`);
  }
  if (value.includes('\\') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    fail(`Manifest ${description} path must be a normalized relative path inside the distribution.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') || path.posix.normalize(value) !== value) {
    fail(`Manifest ${description} path contains traversal or is not normalized inside the distribution: ${value}`);
  }
  return value;
}

function resolveDistributionPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
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

async function listDistributionFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (entry.isSymbolicLink()) fail(`Distribution must not contain symbolic links: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listDistributionFiles(root, absolutePath));
    else if (entry.isFile() && relativePath !== manifestName) files.push(relativePath);
    else if (!entry.isFile()) fail(`Distribution contains an unsupported filesystem entry: ${relativePath}`);
  }
  return files;
}

function validateFileInventory(files) {
  if (!Array.isArray(files) || files.length === 0) fail('Manifest files inventory must be a non-empty array.');
  const filesByPath = new Map();
  const paths = [];
  for (const [index, file] of files.entries()) {
    assertObject(file, `Manifest files[${index}]`);
    const relativePath = validateRelativePath(file.path, `files[${index}]`);
    if (relativePath === manifestName) fail(`Manifest files inventory must not include ${manifestName}.`);
    const foldedPath = relativePath.toLowerCase();
    if (filesByPath.has(foldedPath)) fail(`Manifest files inventory contains a duplicate path: ${relativePath}`);
    if (!sha256Pattern.test(file.sha256 ?? '')) fail(`Manifest file SHA-256 is invalid: ${relativePath}`);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) fail(`Manifest file size is invalid: ${relativePath}`);
    filesByPath.set(foldedPath, file);
    paths.push(relativePath);
  }
  if (!isDeepStrictEqual(paths, [...paths].sort(comparePaths))) {
    fail('Manifest files inventory must be sorted by path.');
  }
  return filesByPath;
}

function requireInventoryFile(filesByPath, relativePath, description) {
  const file = filesByPath.get(relativePath.toLowerCase());
  if (!file || file.path !== relativePath) fail(`Required ${description} is missing from the manifest files inventory: ${relativePath}`);
  return file;
}

function requireDirectoryPayload(files, prefix, description) {
  if (!files.some((file) => file.path.startsWith(`${prefix}/`))) {
    fail(`Required ${description} directory is missing or empty: ${prefix}`);
  }
}

function assertStringArray(actual, expected, description) {
  if (!Array.isArray(actual) || !actual.every((value) => typeof value === 'string')) {
    fail(`Manifest ${description} must be an array of paths.`);
  }
  for (const [index, value] of actual.entries()) validateRelativePath(value, `${description}[${index}]`);
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`Manifest ${description} does not match the distribution: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

export async function verifyPatchedBuild(manifestPath, options = {}) {
  const mode = options.mode ?? 'locked';
  if (!verificationModes.has(mode)) fail(`Unknown verification mode: ${JSON.stringify(mode)}.`);
  const requireLockedBuilder = mode === 'locked';
  const resolvedManifestPath = path.resolve(manifestPath);
  const root = path.dirname(resolvedManifestPath);
  const manifest = await readJson(resolvedManifestPath, 'manifest');
  assertObject(manifest, 'Manifest');

  const lock = await readBuilderLock(path.resolve(options.lockPath ?? defaultLockPath));
  assertExact(manifest, 'schemaVersion', 2, 'schema version');
  assertExact(manifest, 'motisVersion', lock.source.motisVersion, 'MOTIS version');
  assertExact(manifest, 'motisCommit', lock.source.motisCommit, 'MOTIS source commit');
  assertExact(manifest, 'osrCommit', lock.source.osrCommit, 'OSR source commit');
  assertExact(manifest, 'patchId', lock.patch.id, 'custom patch id');
  assertExact(manifest, 'patchSha256', lock.patch.sha256, 'custom patch SHA-256');
  assertExact(manifest, 'baseMaxWaysPerNode', 16, 'base maxWaysPerNode');
  assertExact(manifest, 'maxWaysPerNode', 32, 'custom patch metadata maxWaysPerNode');
  assertExact(manifest, 'platform', 'windows-x64', 'platform');
  assertDeepExact(manifest.sourceDiff, requiredSourceDiff, 'source diff');
  assertDeepExact(manifest.validation, requiredValidation, 'validation');

  verifyBuilderObservation(lock, manifest.builder, { requireLocked: requireLockedBuilder });

  const filesByPath = validateFileInventory(manifest.files);
  const actualPaths = (await listDistributionFiles(root)).sort(comparePaths);
  const actualPathsByFold = new Map(actualPaths.map((relativePath) => [relativePath.toLowerCase(), relativePath]));

  for (const actualPath of actualPaths) {
    if (!filesByPath.has(actualPath.toLowerCase())) {
      const payloadType = /\.exe$/i.test(actualPath) ? 'executable' : /\.dll$/i.test(actualPath) ? 'DLL' : 'file';
      fail(`Distribution contains an unlisted ${payloadType} payload: ${actualPath}`);
    }
  }

  for (const file of manifest.files) {
    const actualPath = actualPathsByFold.get(file.path.toLowerCase());
    if (!actualPath) fail(`Listed distribution file is missing: ${file.path}`);
    if (actualPath !== file.path) fail(`Manifest file path casing differs from the distribution: ${file.path} vs ${actualPath}`);
    const absolutePath = resolveDistributionPath(root, file.path);
    const fileInfo = await lstat(absolutePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) fail(`Listed distribution path is not a regular file: ${file.path}`);
    if (fileInfo.size !== file.sizeBytes) {
      fail(`File size mismatch for ${file.path}: manifest=${file.sizeBytes}, actual=${fileInfo.size}.`);
    }
    const actualHash = await sha256(absolutePath);
    if (actualHash.toLowerCase() !== file.sha256.toLowerCase()) {
      fail(`SHA-256 mismatch for ${file.path}: manifest=${file.sha256}, actual=${actualHash}.`);
    }
  }

  assertObject(manifest.binary, 'Manifest binary metadata');
  assertExact(manifest.binary, 'path', 'motis.exe', 'binary path');
  const binary = requireInventoryFile(filesByPath, 'motis.exe', 'MOTIS executable');
  if (!isDeepStrictEqual(manifest.binary, binary)) fail('Manifest binary metadata must match the motis.exe inventory entry.');

  assertExact(manifest, 'tilesProfiles', 'tiles-profiles', 'tiles-profiles path');
  assertExact(manifest, 'ui', 'ui', 'UI path');
  requireDirectoryPayload(manifest.files, manifest.tilesProfiles, 'tiles-profiles');
  requireDirectoryPayload(manifest.files, manifest.ui, 'UI');

  assertStringArray(manifest.licenseFiles, requiredLicenseFiles, 'license files');
  for (const licenseFile of requiredLicenseFiles) requireInventoryFile(filesByPath, licenseFile, 'license file');

  const expectedRuntimeDlls = manifest.files
    .map((file) => file.path)
    .filter((relativePath) => !relativePath.includes('/') && relativePath.toLowerCase().endsWith('.dll'))
    .sort(comparePaths);
  assertStringArray(manifest.runtimeDlls, expectedRuntimeDlls, 'runtime DLLs');
  const missingCrtDlls = missingRequiredMsvcCrtDlls(expectedRuntimeDlls);
  if (missingCrtDlls.length) fail(`Required MSVC CRT DLL is missing: ${missingCrtDlls.join(', ')}`);

  const observationFile = requireInventoryFile(filesByPath, 'builder-observation.json', 'builder observation');
  const observation = await readJson(resolveDistributionPath(root, observationFile.path), 'builder observation');
  verifyBuilderObservation(lock, observation, { requireLocked: requireLockedBuilder });
  if (!isDeepStrictEqual(manifest.builder, observation)) {
    fail('Manifest builder metadata does not match builder-observation.json.');
  }

  const binaryPath = resolveDistributionPath(root, binary.path);
  const tilesProfilesPath = resolveDistributionPath(root, manifest.tilesProfiles);
  const uiPath = resolveDistributionPath(root, manifest.ui);
  return { manifest, binaryPath, tilesProfilesPath, uiPath, actualSha256: binary.sha256 };
}

async function main() {
  const [manifestPath, ...args] = process.argv.slice(2);
  if (!manifestPath || (args.length !== 0 && (args.length !== 2 || args[0] !== '--mode'))) {
    throw new Error('Usage: node scripts/motis/verify-patched-build.mjs <manifest-path> [--mode locked|candidate]');
  }
  const mode = args.length === 0 ? 'locked' : args[1];
  const result = await verifyPatchedBuild(manifestPath, { mode });
  console.log(
    `Verified Custom MOTIS manifest v2: ${result.manifest.motisVersion} | ` +
    `MSVC ${result.manifest.builder.compilerVersion} / ${result.manifest.builder.generator} | ` +
    `OSR ${result.manifest.osrCommit} | motis.exe sha256 ${result.actualSha256}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`MOTIS custom build verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
