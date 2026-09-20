import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const EXPECTED = Object.freeze({
  motisVersion: 'v2.11.3',
  motisCommit: 'b228a4519d196d9dd01b5ce80be46e642abc953e',
  osrCommit: 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7',
  patchId: 'osr-max-ways-per-node-32',
  baseMaxWaysPerNode: 16,
  maxWaysPerNode: 32,
});

function fail(message) {
  throw new Error(message);
}

function readManifest(manifestPath) {
  let source;
  try {
    source = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    fail(`Unable to read manifest ${manifestPath}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Manifest is not valid JSON: ${error.message}`);
  }
}

function assertExact(manifest, field, expected, description = field) {
  if (manifest[field] !== expected) {
    fail(`Manifest ${description} must be ${JSON.stringify(expected)}; got ${JSON.stringify(manifest[field])}.`);
  }
}

function resolveDistributionPath(manifestPath, value, description) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`Manifest ${description} path must be a non-empty relative path.`);
  }
  if (isAbsolute(value)) {
    fail(`Manifest ${description} path must be relative to the manifest.`);
  }

  const manifestDirectory = resolve(manifestPath, '..');
  const resolvedPath = resolve(manifestDirectory, value);
  const relativePath = relative(manifestDirectory, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    fail(`Manifest ${description} path must stay inside the distribution directory.`);
  }
  return resolvedPath;
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

export async function verifyPatchedBuild(manifestPath) {
  const manifest = readManifest(manifestPath);
  assertExact(manifest, 'motisVersion', EXPECTED.motisVersion, 'MOTIS version');
  assertExact(manifest, 'motisCommit', EXPECTED.motisCommit, 'MOTIS source commit');
  assertExact(manifest, 'osrCommit', EXPECTED.osrCommit, 'OSR source commit');
  assertExact(manifest, 'patchId', EXPECTED.patchId, 'custom patch id');
  assertExact(manifest, 'baseMaxWaysPerNode', EXPECTED.baseMaxWaysPerNode, 'base maxWaysPerNode');
  assertExact(manifest, 'maxWaysPerNode', EXPECTED.maxWaysPerNode, 'custom patch metadata maxWaysPerNode');

  if (!manifest.binary || typeof manifest.binary !== 'object') {
    fail('Manifest must contain binary metadata.');
  }
  assertExact(manifest.binary, 'path', 'motis.exe', 'binary path');
  if (!/^[0-9a-f]{64}$/i.test(manifest.binary.sha256 ?? '')) {
    fail('Manifest binary SHA-256 must be a 64-character hexadecimal string.');
  }

  const binaryPath = resolveDistributionPath(manifestPath, manifest.binary.path, 'binary');
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    fail(`MOTIS binary does not exist: ${binaryPath}`);
  }

  assertExact(manifest, 'tilesProfiles', 'tiles-profiles', 'tiles-profiles path');
  const tilesProfilesPath = resolveDistributionPath(manifestPath, manifest.tilesProfiles, 'tiles-profiles');
  if (!existsSync(tilesProfilesPath) || !statSync(tilesProfilesPath).isDirectory()) {
    fail(`tiles-profiles directory does not exist: ${tilesProfilesPath}`);
  }

  const actualSha256 = await sha256(binaryPath);
  if (actualSha256.toLowerCase() !== manifest.binary.sha256.toLowerCase()) {
    fail(`MOTIS binary SHA-256 mismatch: manifest=${manifest.binary.sha256}, actual=${actualSha256}.`);
  }

  return { manifest, binaryPath, tilesProfilesPath, actualSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node scripts/motis/verify-patched-build.mjs <manifest-path>');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyPatchedBuild(resolve(manifestPath));
      console.log(
        `Verified custom MOTIS build: ${result.manifest.motisVersion} | ` +
        `OSR ${result.manifest.osrCommit} | ` +
        `${result.manifest.baseMaxWaysPerNode} -> ${result.manifest.maxWaysPerNode} | ` +
        `motis.exe sha256 ${result.actualSha256}`,
      );
    } catch (error) {
      console.error(`MOTIS custom build verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
