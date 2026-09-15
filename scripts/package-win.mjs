import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import extract from 'extract-zip';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'node_modules/electron/package.json'), 'utf8'));
const electronVersion = packageJson.version;
const electronZipName = `electron-v${electronVersion}-win32-x64.zip`;
const localAppData = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');

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
const temporaryUnpackedDir = path.join(rootDir, 'release', 'win-unpacked.tmp');
const electronBuilderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const builderArgs = ['electron-builder', '--win', '--config.directories.output=release'];
if (electronDist) builderArgs.push(`--config.electronDist=${electronDist}`);

execFileSync(process.execPath, [electronBuilderCli, ...builderArgs.slice(1)], { cwd: rootDir, stdio: 'inherit' });
rmSync(temporaryUnpackedDir, { recursive: true, force: true });
