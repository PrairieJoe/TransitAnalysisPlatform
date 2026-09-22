import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GEOFABRIK_SOUTH_KOREA_URL, inspectOsmPbf } from './motis-osm';
import type { MotisOsmPbfMetadata, MotisOsmPbfResolution, MotisOsmPbfResolutionSource } from '../shared/types';

export const ROUTING_ASSET_STORE_FILE = 'routing-assets.json';
export const ROUTING_ASSET_EXPECTED_FILE_NAME = 'south-korea-latest.osm.pbf';

export interface RoutingAssetSearchContext {
  userDataPath: string;
  appPath?: string;
  downloadsPath?: string;
  projectRoutingDirectories?: string[];
  forceRescan?: boolean;
}

interface RoutingAssetStore {
  schemaVersion: 1;
  lastKnown?: MotisOsmPbfMetadata & { verifiedAt: string };
}

interface CandidateDirectory {
  source: MotisOsmPbfResolutionSource;
  directory: string;
}

function storePath(context: RoutingAssetSearchContext): string {
  return join(context.userDataPath, ROUTING_ASSET_STORE_FILE);
}

function recommendedPath(context: RoutingAssetSearchContext): string {
  return join(context.userDataPath, 'routing', ROUTING_ASSET_EXPECTED_FILE_NAME);
}

function isPbfFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pbf');
}

async function loadStore(context: RoutingAssetSearchContext): Promise<RoutingAssetStore | undefined> {
  try {
    const parsed = JSON.parse(await readFile(storePath(context), 'utf8')) as Partial<RoutingAssetStore>;
    if (parsed.schemaVersion !== 1 || !parsed.lastKnown || typeof parsed.lastKnown.path !== 'string') return undefined;
    return parsed as RoutingAssetStore;
  } catch {
    return undefined;
  }
}

async function persistStore(context: RoutingAssetSearchContext, metadata: MotisOsmPbfMetadata): Promise<void> {
  await mkdir(context.userDataPath, { recursive: true });
  const target = storePath(context);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const next: RoutingAssetStore = { schemaVersion: 1, lastKnown: { ...metadata, verifiedAt: new Date().toISOString() } };
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await rename(temporary, target);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* best-effort cleanup only */ }
    throw error;
  }
}

async function listCandidates(directory: CandidateDirectory): Promise<Array<{ source: MotisOsmPbfResolutionSource; path: string }>> {
  try {
    const entries = await readdir(directory.directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && isPbfFile(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => {
        const expectedLeft = left === ROUTING_ASSET_EXPECTED_FILE_NAME ? 0 : 1;
        const expectedRight = right === ROUTING_ASSET_EXPECTED_FILE_NAME ? 0 : 1;
        return expectedLeft - expectedRight || left.localeCompare(right);
      });
    return files.map((fileName) => ({ source: directory.source, path: join(directory.directory, fileName) }));
  } catch {
    return [];
  }
}

function candidateDirectories(context: RoutingAssetSearchContext): CandidateDirectory[] {
  const directories: CandidateDirectory[] = [];
  for (const directory of context.projectRoutingDirectories ?? []) directories.push({ source: 'project', directory });
  if (context.appPath) directories.push({ source: 'app', directory: join(context.appPath, 'data', 'osm') });
  directories.push({ source: 'project', directory: join(context.userDataPath, 'routing') });
  directories.push({ source: 'project', directory: join(context.userDataPath, 'motis-data') });
  if (context.downloadsPath) directories.push({ source: 'downloads', directory: context.downloadsPath });
  if (context.appPath) directories.push({ source: 'development', directory: join(context.appPath, 'data', 'osm') });
  return directories.filter((candidate, index, all) => all.findIndex((other) => resolve(other.directory) === resolve(candidate.directory)) === index);
}

function resolutionBase(context: RoutingAssetSearchContext): Pick<MotisOsmPbfResolution, 'geofabrikUrl' | 'expectedFileName' | 'recommendedPath'> {
  return {
    geofabrikUrl: GEOFABRIK_SOUTH_KOREA_URL,
    expectedFileName: ROUTING_ASSET_EXPECTED_FILE_NAME,
    recommendedPath: recommendedPath(context)
  };
}

export async function resolveRoutingAsset(context: RoutingAssetSearchContext): Promise<MotisOsmPbfResolution> {
  const base = resolutionBase(context);
  const store = await loadStore(context);
  const persisted = store?.lastKnown;

  if (persisted && !context.forceRescan) {
    try {
      const current = await inspectOsmPbf(persisted.path);
      if (current.sha256 === persisted.sha256 && current.sizeBytes === persisted.sizeBytes) {
        return { ...base, status: 'ready', source: 'persisted', metadata: current, message: '저장된 PBF를 자동으로 확인했습니다.' };
      }
      return {
        ...base,
        status: 'stale',
        metadata: current,
        previousMetadata: persisted,
        message: '저장된 PBF가 변경되었습니다. 다시 찾기를 실행해 새 fingerprint를 확인하세요.'
      };
    } catch {
      // The persisted path may have been moved or deleted; continue with bounded discovery.
    }
  }

  const candidates = new Map<string, { source: MotisOsmPbfResolutionSource; path: string }>();
  if (persisted) candidates.set(resolve(persisted.path), { source: 'persisted', path: persisted.path });
  for (const directory of candidateDirectories(context)) {
    for (const candidate of await listCandidates(directory)) {
      if (!candidates.has(resolve(candidate.path))) candidates.set(resolve(candidate.path), candidate);
    }
  }

  for (const candidate of candidates.values()) {
    try {
      const metadata = await inspectOsmPbf(candidate.path);
      await persistStore(context, metadata);
      return { ...base, status: 'ready', source: candidate.source, metadata, message: 'OSM PBF를 자동으로 준비했습니다.' };
    } catch {
      // A candidate can disappear between directory listing and inspection; continue bounded discovery.
    }
  }

  return { ...base, status: 'missing', message: `OSM PBF가 없습니다. Geofabrik에서 ${ROUTING_ASSET_EXPECTED_FILE_NAME}을 다운로드한 뒤 다시 찾기를 실행하세요.` };
}
