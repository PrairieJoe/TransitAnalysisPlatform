import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import extract from 'extract-zip';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'node_modules/electron/package.json'), 'utf8'));
const rootPackage = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const electronVersion = packageJson.version;
const electronZipName = `electron-v${electronVersion}-win32-x64.zip`;
const localAppData = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
const outputDirectoryName = rootPackage.build?.directories?.output ?? 'release';
const outputDirectory = path.resolve(rootDir, outputDirectoryName);
const installerArtifactName = (rootPackage.build?.win?.artifactName ?? `TransitAnalysisPlatform-${rootPackage.version}-setup.exe`)
  .replaceAll('${version}', rootPackage.version)
  .replaceAll('${ext}', 'exe');

function findFile(directory, fileName) {
  if (!existsSync(directory)) return undefined;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) return entryPath;
    if (entry.isDirectory()) {
      const match = findFile(entryPath, fileName);
      if (match) return match;
    }
  }

  return undefined;
}

async function prepareElectronDistribution() {
  const zipPath = findFile(path.join(localAppData, 'electron', 'Cache'), electronZipName);
  if (!zipPath) return undefined;

  const distributionDir = path.join(tmpdir(), 'TransitAnalysisPlatform', `electron-v${electronVersion}-win32-x64`);
  if (existsSync(path.join(distributionDir, 'electron.exe'))) return distributionDir;

  rmSync(distributionDir, { recursive: true, force: true });
  mkdirSync(distributionDir, { recursive: true });
  await extract(zipPath, { dir: distributionDir });
  return distributionDir;
}

const electronDist = await prepareElectronDistribution();
rmSync(path.join(rootDir, 'out', 'electron-dist'), { recursive: true, force: true });
const temporaryUnpackedDir = path.join(outputDirectory, 'win-unpacked.tmp');
const electronBuilderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const builderArgs = ['electron-builder', '--win', `--config.directories.output=${outputDirectoryName}`];
if (electronDist) builderArgs.push(`--config.electronDist=${electronDist}`);

const bundledMotisDistribution = path.join(rootDir, 'vendor', 'motis', 'patched-windows');
const configuredMotisDistribution = process.env.TRANSIT_MOTIS_DIST_DIR?.trim();

if (!configuredMotisDistribution) {
  const prepareMotisScript = path.join(rootDir, 'scripts', 'motis', 'prepare-patched-windows.mjs');
  execFileSync(process.execPath, [prepareMotisScript], { cwd: rootDir, stdio: 'inherit' });
}

const motisDistribution = configuredMotisDistribution
  ? path.resolve(configuredMotisDistribution)
  : existsSync(bundledMotisDistribution)
    ? bundledMotisDistribution
    : undefined;

function assertMotisDistribution(directory) {
  const requiredPaths = [
    path.join(directory, 'motis.exe'),
    path.join(directory, 'tiles-profiles'),
    path.join(directory, 'ui'),
    path.join(directory, 'licenses'),
  ];
  const missingPaths = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));
  if (missingPaths.length) {
    throw new Error(`MOTIS 배포 파일이 불완전합니다: ${missingPaths.join(', ')}`);
  }
}

function assertCustomMotisManifest(directory) {
  const manifestPath = path.join(directory, 'motis-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`커스텀 MOTIS 매니페스트가 없습니다: ${manifestPath}`);
  }
  const verifierPath = path.join(rootDir, 'scripts', 'motis', 'verify-patched-build.mjs');
  const verificationMode = 'candidate';
  execFileSync(process.execPath, [verifierPath, manifestPath, '--mode', verificationMode], { cwd: rootDir, stdio: 'inherit' });
}

let temporaryMotisConfig;
if (motisDistribution) {
  assertMotisDistribution(motisDistribution);
  assertCustomMotisManifest(motisDistribution);
  mkdirSync(outputDirectory, { recursive: true });
  temporaryMotisConfig = path.join(outputDirectory, 'electron-builder.motis.json');
  writeFileSync(temporaryMotisConfig, JSON.stringify({ ...rootPackage.build, extraResources: [{ from: motisDistribution, to: 'motis' }] }, null, 2));
  builderArgs.push(`--config=${temporaryMotisConfig}`);
  console.log(`Including bundled MOTIS sidecar distribution from ${motisDistribution}`);
} else {
  throw new Error(
    '검증된 커스텀 MOTIS 배포 파일을 찾을 수 없습니다. ' +
      'vendor/motis/patched-windows를 먼저 빌드하세요.',
  );
}

try {
  execFileSync(process.execPath, [electronBuilderCli, ...builderArgs.slice(1)], { cwd: rootDir, stdio: 'inherit' });
  const requiredPackageOutputs = [
    path.join(outputDirectory, 'win-unpacked', 'resources', 'motis', 'motis.exe'),
    path.join(outputDirectory, 'win-unpacked', 'resources', 'motis', 'tiles-profiles'),
    path.join(outputDirectory, installerArtifactName)
  ];
  const missingPackageOutputs = requiredPackageOutputs.filter((requiredPath) => !existsSync(requiredPath));
  if (missingPackageOutputs.length) {
    throw new Error(`Windows package smoke assertion failed. Missing required output(s): ${missingPackageOutputs.join(', ')}`);
  }
  console.log(`Windows package smoke assertions passed: ${requiredPackageOutputs.join(', ')}`);
} finally {
  if (temporaryMotisConfig) rmSync(temporaryMotisConfig, { force: true });
}
rmSync(temporaryUnpackedDir, { recursive: true, force: true });
