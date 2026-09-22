import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { MotisOsmPbfMetadata, MotisStatus } from '../shared/types';
import { inspectOsmPbf } from './motis-osm';
import { type MotisPreparationResult, type MotisSidecar, type MotisSidecarOptions } from './motis-sidecar';

export interface MotisBinaryIdentity {
  sha256: string;
  manifestSchemaVersion: number;
}

export interface MotisPreparationFingerprintInput {
  pbfSha256: string;
  gtfsSha256: string;
  binary: MotisBinaryIdentity;
  disableTiles?: boolean;
  environment?: NodeJS.ProcessEnv;
  preparationSchemaVersion?: number;
  port?: number;
}

export interface MotisPreparationCacheResult extends MotisPreparationResult {
  fingerprint: string;
  cacheHit: boolean;
  dataDirectory: string;
}

export interface MotisPreparationCacheDependencies {
  prepare: (options: MotisSidecarOptions, files: GtfsFileSet, onProgress?: (phase: 'configuring' | 'importing') => void) => Promise<MotisPreparationResult>;
  inspectPbf?: (path: string) => Promise<MotisOsmPbfMetadata>;
  binaryIdentity?: () => Promise<MotisBinaryIdentity>;
  sidecar: Pick<MotisSidecar, 'getStatus' | 'stop'>;
}

interface ActivePreparationMarker {
  schemaVersion: 1;
  fingerprint: string;
  stageDirectory: string;
  updatedAt: string;
}

const PREPARATION_SCHEMA_VERSION = 1;
const ACTIVE_MARKER_FILE = 'active-preparation.json';

function stableEnvironment(environment?: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(environment ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string').sort(([left], [right]) => left.localeCompare(right)));
}

export function hashGtfsFileSet(files: GtfsFileSet): string {
  const hash = createHash('sha256');
  for (const [name, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(name);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex').toUpperCase();
}

export function buildMotisPreparationFingerprint(input: MotisPreparationFingerprintInput): string {
  const canonical = JSON.stringify({
    schemaVersion: input.preparationSchemaVersion ?? PREPARATION_SCHEMA_VERSION,
    pbfSha256: input.pbfSha256,
    gtfsSha256: input.gtfsSha256,
    motis: input.binary,
    preparation: {
      disableTiles: Boolean(input.disableTiles),
      environment: stableEnvironment(input.environment)
    }
  });
  return createHash('sha256').update(canonical).digest('hex').toUpperCase();
}

function isInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}\\`);
}

async function pathIsReady(stageDirectory: string): Promise<boolean> {
  try {
    const [config, archive, data] = await Promise.all([
      stat(join(stageDirectory, 'config.yml')),
      stat(join(stageDirectory, 'tap-synthetic-gtfs.zip')),
      stat(join(stageDirectory, 'data'))
    ]);
    return config.isFile() && archive.isFile() && data.isDirectory();
  } catch {
    return false;
  }
}

async function readMarker(markerPath: string): Promise<ActivePreparationMarker | undefined> {
  try {
    const value = JSON.parse(await readFile(markerPath, 'utf8')) as Partial<ActivePreparationMarker>;
    if (value.schemaVersion !== 1 || typeof value.fingerprint !== 'string' || !/^[A-F0-9]{64}$/.test(value.fingerprint) || typeof value.stageDirectory !== 'string' || typeof value.updatedAt !== 'string') return undefined;
    return value as ActivePreparationMarker;
  } catch {
    return undefined;
  }
}

async function writeMarker(markerPath: string, marker: ActivePreparationMarker): Promise<void> {
  const temporaryPath = `${markerPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, markerPath);
}

export function createMotisPreparationCache(dependencies: MotisPreparationCacheDependencies) {
  let inFlight: Promise<unknown> | undefined;
  let activeFingerprint: string | undefined;

  const prepare = (options: MotisSidecarOptions, files: GtfsFileSet, onProgress?: (phase: 'configuring' | 'importing') => void): Promise<MotisPreparationCacheResult> => {
    const operation = (inFlight ?? Promise.resolve()).then(() => prepareInternal(options, files, onProgress));
    inFlight = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const prepareInternal = async (options: MotisSidecarOptions, files: GtfsFileSet, onProgress?: (phase: 'configuring' | 'importing') => void): Promise<MotisPreparationCacheResult> => {
    const pbf = await (dependencies.inspectPbf ?? inspectOsmPbf)(options.osmPbfPath);
    const binary = await (dependencies.binaryIdentity ?? (async () => ({ sha256: 'UNVERIFIED', manifestSchemaVersion: 0 })) )();
    const fingerprint = buildMotisPreparationFingerprint({
      pbfSha256: pbf.sha256,
      gtfsSha256: hashGtfsFileSet(files),
      binary,
      disableTiles: options.disableTiles,
      environment: options.environment
    });
    const preparedRoot = join(options.dataDirectory, 'prepared');
    const stageDirectory = join(preparedRoot, fingerprint);
    const markerPath = join(options.dataDirectory, ACTIVE_MARKER_FILE);
    const activeMarker = await readMarker(markerPath);
    const markerStageDirectory = activeMarker?.fingerprint === fingerprint && isInside(preparedRoot, activeMarker.stageDirectory)
      ? activeMarker.stageDirectory
      : stageDirectory;

    if (activeMarker?.fingerprint === fingerprint && markerStageDirectory === stageDirectory && await pathIsReady(stageDirectory)) {
      if (dependencies.sidecar.getStatus().state !== 'stopped' && activeFingerprint !== fingerprint) await dependencies.sidecar.stop();
      activeFingerprint = fingerprint;
      return {
        archivePath: join(stageDirectory, 'tap-synthetic-gtfs.zip'),
        message: '기존 MOTIS 준비 결과를 재사용합니다.',
        fingerprint,
        cacheHit: true,
        dataDirectory: stageDirectory
      };
    }

    if (dependencies.sidecar.getStatus().state !== 'stopped') await dependencies.sidecar.stop();
    await mkdir(preparedRoot, { recursive: true });
    await rm(stageDirectory, { recursive: true, force: true });
    try {
      const result = await dependencies.prepare({ ...options, dataDirectory: stageDirectory }, files, onProgress);
      if (!await pathIsReady(stageDirectory)) throw new Error('MOTIS 준비 결과 검증에 실패했습니다. config.yml, data, GTFS archive를 확인하세요.');
      await writeMarker(markerPath, {
        schemaVersion: 1,
        fingerprint,
        stageDirectory,
        updatedAt: new Date().toISOString()
      });
      activeFingerprint = fingerprint;
      return { ...result, fingerprint, cacheHit: false, dataDirectory: stageDirectory };
    } catch (error) {
      await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  };

  return { prepare };
}
