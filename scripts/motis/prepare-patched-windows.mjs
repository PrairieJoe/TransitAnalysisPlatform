import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import extract from 'extract-zip';

import { MOTIS_RELEASE_CONFIG } from './motis-release-config.mjs';
import { verifyPatchedBuild } from './verify-patched-build.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDirectory = path.join(rootDir, 'vendor', 'motis', 'patched-windows');

function fail(message) {
  throw new Error(message);
}

function resolveOption(options, key, environmentKey, fallback) {
  return options[key] ?? process.env[environmentKey] ?? fallback;
}

function resolveInside(directory, relativePath, description) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    fail(`${description} 경로가 배포 디렉터리 내부의 상대 경로가 아닙니다.`);
  }
  const base = path.resolve(directory);
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(base, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${description} 경로가 배포 디렉터리 밖을 가리킵니다: ${relativePath}`);
  }
  return resolved;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const content = await readFile(filePath);
  hash.update(content);
  return hash.digest('hex');
}

async function assertDistribution(directory, options = {}) {
  const manifestPath = path.join(directory, 'motis-manifest.json');
  if (!existsSync(manifestPath)) fail(`MOTIS 매니페스트가 없습니다: ${manifestPath}`);

  const result = await verifyPatchedBuild(manifestPath);
  const expectedBinarySha256 = options.expectedBinarySha256 ?? MOTIS_RELEASE_CONFIG.expectedBinarySha256;
  const expectedBinarySizeBytes = options.expectedBinarySizeBytes ?? MOTIS_RELEASE_CONFIG.expectedBinarySizeBytes;

  if (expectedBinarySha256 && result.actualSha256.toLowerCase() !== expectedBinarySha256.toLowerCase()) {
    fail(`MOTIS 실행 파일 SHA-256이 예상값과 다릅니다: expected=${expectedBinarySha256}, actual=${result.actualSha256}`);
  }
  const binarySizeBytes = (await stat(result.binaryPath)).size;
  if (expectedBinarySizeBytes && binarySizeBytes !== Number(expectedBinarySizeBytes)) {
    fail(`MOTIS 실행 파일 크기가 예상값과 다릅니다: expected=${expectedBinarySizeBytes}, actual=${binarySizeBytes}`);
  }

  for (const [relativePath, description] of [['ui', 'MOTIS UI'], ['licenses', 'MOTIS 라이선스']] ) {
    const resolved = resolveInside(directory, relativePath, description);
    if (!existsSync(resolved) || !(await stat(resolved)).isDirectory()) fail(`${description} 디렉터리가 없습니다: ${resolved}`);
  }

  for (const runtimeDll of result.manifest.runtimeDlls ?? []) {
    const resolved = resolveInside(directory, runtimeDll, 'MOTIS runtime DLL');
    if (!existsSync(resolved) || !(await stat(resolved)).isFile()) fail(`MOTIS runtime DLL이 없습니다: ${resolved}`);
  }

  return { ...result, binarySizeBytes, directory };
}

async function findDistributionRoot(extractedDirectory) {
  if (existsSync(path.join(extractedDirectory, 'motis-manifest.json'))) return extractedDirectory;

  const entries = readdirSync(extractedDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
  if (entries.length === 1) {
    const nestedDirectory = path.join(extractedDirectory, entries[0].name);
    if (existsSync(path.join(nestedDirectory, 'motis-manifest.json'))) return nestedDirectory;
  }
  fail('MOTIS Release archive의 최상위에 motis-manifest.json 또는 단일 배포 디렉터리가 없습니다.');
}

async function downloadArchive(url, destination, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') fail('MOTIS Release 다운로드에 사용할 fetch가 없습니다. Node.js 18 이상이 필요합니다.');
  if (!/^https:\/\//i.test(url)) fail(`MOTIS Release URL은 HTTPS만 허용합니다: ${url}`);

  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) fail(`MOTIS Release 다운로드 실패: HTTP ${response.status} ${response.statusText}`);
  if (!response.body) {
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function validateLocalDistribution(directory, options) {
  if (!existsSync(directory)) return undefined;
  try {
    return await assertDistribution(directory, options);
  } catch (error) {
    return { error };
  }
}

export async function prepareMotis(options = {}) {
  const outputDirectory = path.resolve(options.outputDirectory ?? defaultOutputDirectory);
  const expectedBinarySha256 = resolveOption(options, 'expectedBinarySha256', 'TRANSIT_MOTIS_EXPECTED_BINARY_SHA256', MOTIS_RELEASE_CONFIG.expectedBinarySha256);
  const expectedBinarySizeBytes = resolveOption(options, 'expectedBinarySizeBytes', 'TRANSIT_MOTIS_EXPECTED_BINARY_SIZE_BYTES', MOTIS_RELEASE_CONFIG.expectedBinarySizeBytes);
  const local = await validateLocalDistribution(outputDirectory, { expectedBinarySha256, expectedBinarySizeBytes });
  if (local && !local.error) return { source: 'local', ...local };

  const archivePath = options.archivePath;
  const offline = options.offline ?? process.env.TRANSIT_MOTIS_OFFLINE === '1';
  if (offline) {
    const reason = local?.error instanceof Error ? ` 기존 배포본 검증 실패: ${local.error.message}` : '';
    fail(`오프라인 MOTIS 준비에 사용할 검증된 로컬 배포본이 없습니다.${reason}`);
  }

  let downloadedDirectory;
  let sourceArchive = archivePath ? path.resolve(archivePath) : undefined;
  try {
    if (!sourceArchive) {
      downloadedDirectory = await mkdtemp(path.join(tmpdir(), 'tap-motis-release-'));
      sourceArchive = path.join(downloadedDirectory, MOTIS_RELEASE_CONFIG.assetName);
      const url = resolveOption(options, 'releaseUrl', 'TRANSIT_MOTIS_RELEASE_URL', MOTIS_RELEASE_CONFIG.assetUrl);
      console.log(`Downloading verified Custom MOTIS asset: ${url}`);
      await downloadArchive(url, sourceArchive, options.fetchImpl);
    }

    if (!existsSync(sourceArchive)) fail(`MOTIS Release archive를 찾을 수 없습니다: ${sourceArchive}`);
    const archiveSha256 = options.archiveSha256 ?? process.env.TRANSIT_MOTIS_ARCHIVE_SHA256 ?? MOTIS_RELEASE_CONFIG.archiveSha256;
    if (archiveSha256) {
      const actualArchiveSha256 = await sha256File(sourceArchive);
      if (actualArchiveSha256.toLowerCase() !== archiveSha256.toLowerCase()) {
        fail(`MOTIS Release archive SHA-256이 예상값과 다릅니다: expected=${archiveSha256}, actual=${actualArchiveSha256}`);
      }
    }

    const stagingDirectory = `${outputDirectory}.staging-${process.pid}-${Date.now()}`;
    await rm(stagingDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
    try {
      await extract(sourceArchive, { dir: stagingDirectory });
      const extractedRoot = await findDistributionRoot(stagingDirectory);
      let packageRoot = extractedRoot;
      if (extractedRoot !== stagingDirectory) {
        packageRoot = path.join(stagingDirectory, '__normalized__');
        await cp(extractedRoot, packageRoot, { recursive: true });
      }
      const verified = await assertDistribution(packageRoot, { expectedBinarySha256, expectedBinarySizeBytes });
      await mkdir(path.dirname(outputDirectory), { recursive: true });
      await rm(outputDirectory, { recursive: true, force: true });
      await rename(packageRoot, outputDirectory);
      return { source: archivePath ? 'archive' : 'download', ...verified, directory: outputDirectory };
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  } finally {
    if (downloadedDirectory) await rm(downloadedDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--offline') options.offline = true;
    else if (argument === '--output') options.outputDirectory = argv[++index];
    else if (argument === '--archive') options.archivePath = argv[++index];
    else if (argument === '--archive-sha256') options.archiveSha256 = argv[++index];
    else throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = await prepareMotis(parseArguments(process.argv.slice(2)));
    console.log(`Custom MOTIS ready (${result.source}): ${result.directory}`);
  } catch (error) {
    console.error(`Custom MOTIS 준비 실패: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
