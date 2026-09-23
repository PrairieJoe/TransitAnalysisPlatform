import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMotisIpcHandlers } from '../../src/main/motis-ipc';
import type { GtfsFileSet } from '../../src/core/synthetic-gtfs/types';
import type { MotisOsmPbfResolution, MotisRuntimeDefaults, MotisStatus } from '../../src/shared/types';
import type { MotisSidecarOptions } from '../../src/main/motis-sidecar';

const files = {
  'agency.txt': '', 'stops.txt': '', 'routes.txt': '', 'trips.txt': '', 'stop_times.txt': '', 'calendar.txt': '',
  'tap-motis-config.json': '{}', 'tap-provenance.json': '{}', 'tap-validation.json': '{}'
} as GtfsFileSet;

describe('managed MOTIS IPC boundary', () => {
  it('exposes bounded automatic PBF resolution and explicit rescan', async () => {
    const resolution: MotisOsmPbfResolution = {
      status: 'missing',
      geofabrikUrl: 'https://download.geofabrik.de/asia/south-korea.html',
      expectedFileName: 'south-korea-latest.osm.pbf',
      recommendedPath: 'C:\\managed\\routing\\south-korea-latest.osm.pbf',
      message: 'PBF가 없습니다.'
    };
    const resolveOsmPbf = vi.fn(async (_forceRescan: boolean) => resolution);
    const handlers = createMotisIpcHandlers({
      buildDefaults: async () => ({ executablePath: 'managed.exe', dataDirectory: 'managed-data', port: 18765 }),
      prepare: vi.fn(),
      sidecar: { start: vi.fn(), request: vi.fn(), stop: vi.fn(async () => undefined), getStatus: vi.fn(() => ({ state: 'stopped' as const })) },
      resolveOsmPbf
    });

    await expect(handlers.resolveOsmPbf()).resolves.toEqual(resolution);
    await expect(handlers.resolveOsmPbf(true)).resolves.toEqual(resolution);
    expect(resolveOsmPbf).toHaveBeenNthCalledWith(1, false);
    expect(resolveOsmPbf).toHaveBeenNthCalledWith(2, true);
  });

  it('emits operation-scoped preparation, startup, and query progress', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'tap-motis-ipc-progress-'));
    let status: MotisStatus = { state: 'stopped' };
    const progress = vi.fn();
    const prepare = vi.fn(async (preparedOptions: MotisSidecarOptions, _files: GtfsFileSet, onProgress?: (phase: 'configuring' | 'importing') => void) => {
      await mkdir(join(preparedOptions.dataDirectory, 'data'), { recursive: true });
      await writeFile(join(preparedOptions.dataDirectory, 'config.yml'), 'config');
      await writeFile(join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), 'zip');
      onProgress?.('configuring');
      onProgress?.('importing');
      return { archivePath: join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), message: 'prepared' };
    });
    const sidecar = {
      start: vi.fn(async (options: MotisSidecarOptions): Promise<MotisStatus> => { status = { state: 'ready', baseUrl: 'http://127.0.0.1:18765', preparationFingerprint: options.preparationFingerprint }; return status; }),
      request: vi.fn(async () => ({ itineraries: [] })),
      stop: vi.fn(async () => { status = { state: 'stopped' }; }),
      getStatus: vi.fn(() => status)
    };
    const handlers = createMotisIpcHandlers({
      buildDefaults: async () => ({ executablePath: 'managed.exe', dataDirectory, port: 18765 }),
      prepare,
      sidecar,
      inspectPbf: async (path) => ({ path, fileName: 'region.osm.pbf', sizeBytes: 1, sha256: 'PBF-A' }),
      binaryIdentity: async () => ({ sha256: 'BINARY-A', manifestSchemaVersion: 2 }),
      emitProgress: progress
    });

    await handlers.prepare({ operationId: 'op-1', osmPbfPath: 'region.osm.pbf', files });
    await handlers.start('op-1');
    await handlers.request('/api/v6/plan', undefined, 'op-1');

    expect(progress.mock.calls.map(([event]) => [event.operationId, event.phase])).toEqual([
      ['op-1', 'checking'], ['op-1', 'configuring'], ['op-1', 'importing'], ['op-1', 'ready'], ['op-1', 'starting'], ['op-1', 'ready'], ['op-1', 'querying']
    ]);
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it('constructs all executable and lifecycle options in main before prepare/start', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'tap-motis-ipc-'));
    const managedDefaults: MotisRuntimeDefaults = {
      executablePath: 'C:\\managed\\motis.exe',
      dataDirectory,
      port: 18765
    };
    const prepare = vi.fn(async (preparedOptions: MotisSidecarOptions) => {
      await mkdir(join(preparedOptions.dataDirectory, 'data'), { recursive: true });
      await writeFile(join(preparedOptions.dataDirectory, 'config.yml'), 'config');
      await writeFile(join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), 'zip');
      return { archivePath: join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), message: 'prepared' };
    });
    const start = vi.fn(async (): Promise<MotisStatus> => ({ state: 'ready', baseUrl: 'http://127.0.0.1:18765' }));
    const sidecar = {
      start,
      request: vi.fn(),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn((): MotisStatus => ({ state: 'stopped' }))
    };
    const handlers = createMotisIpcHandlers({
      buildDefaults: async () => managedDefaults,
      prepare,
      sidecar,
      inspectPbf: async (path) => ({ path, fileName: 'region.osm.pbf', sizeBytes: 1, sha256: 'PBF-A' }),
      binaryIdentity: async () => ({ sha256: 'BINARY-A', manifestSchemaVersion: 2 })
    });

    await handlers.prepare({
      osmPbfPath: 'C:\\user-controlled\\region.osm.pbf',
      files,
      options: {
        executablePath: 'C:\\renderer-controlled\\evil.exe',
        dataDirectory: 'C:\\renderer-controlled',
        port: 9,
        args: ['--evil'],
        environment: { EVIL: '1' },
        disableTiles: false
      }
    });
    await handlers.start();

    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: managedDefaults.executablePath,
      dataDirectory: expect.stringContaining(join(dataDirectory, 'prepared')),
      osmPbfPath: 'C:\\user-controlled\\region.osm.pbf',
      port: managedDefaults.port,
      args: ['server'],
      environment: { TBB_NUM_THREADS: '1' },
      disableTiles: true,
      healthPath: '/api/v1/health',
      startupTimeoutMs: 30000
    }), files, expect.any(Function));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: managedDefaults.executablePath,
      dataDirectory: prepare.mock.calls[0][0].dataDirectory,
      port: managedDefaults.port,
      args: ['server'],
      environment: { TBB_NUM_THREADS: '1' },
      disableTiles: true
    }));
    expect(start.mock.calls[0][0]).not.toEqual(expect.objectContaining({ executablePath: 'C:\\renderer-controlled\\evil.exe' }));
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it('rejects external request URLs at the main IPC boundary', async () => {
    const sidecar = {
      start: vi.fn(),
      request: vi.fn(),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn((): MotisStatus => ({ state: 'ready', baseUrl: 'http://127.0.0.1:18765' }))
    };
    const handlers = createMotisIpcHandlers({
      buildDefaults: async () => ({ executablePath: 'managed.exe', dataDirectory: 'managed-data', port: 18765 }),
      prepare: vi.fn(),
      sidecar
    });

    await expect(handlers.request('//external.example/api/v6/plan')).rejects.toThrow('로컬 API');
    await expect(handlers.request('https://external.example/api/v6/plan')).rejects.toThrow('로컬 API');
    expect(sidecar.request).not.toHaveBeenCalled();
  });

  it('does not allow start to reuse an older prepared network after a new preparation fails', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'tap-motis-ipc-failure-'));
    const prepare = vi.fn(async (preparedOptions: MotisSidecarOptions) => {
      if (preparedOptions.osmPbfPath.includes('network-b')) throw new Error('import failed');
      await mkdir(join(preparedOptions.dataDirectory, 'data'), { recursive: true });
      await writeFile(join(preparedOptions.dataDirectory, 'config.yml'), 'config');
      await writeFile(join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), 'zip');
      return { archivePath: join(preparedOptions.dataDirectory, 'tap-synthetic-gtfs.zip'), message: 'prepared' };
    });
    const sidecar = {
      start: vi.fn(async (): Promise<MotisStatus> => ({ state: 'ready' })),
      request: vi.fn(),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn((): MotisStatus => ({ state: 'stopped' }))
    };
    const handlers = createMotisIpcHandlers({
      buildDefaults: async () => ({ executablePath: 'managed.exe', dataDirectory, port: 18765 }),
      prepare,
      sidecar,
      inspectPbf: async (path) => ({ path, fileName: 'region.osm.pbf', sizeBytes: 1, sha256: path.includes('network-b') ? 'PBF-B' : 'PBF-A' }),
      binaryIdentity: async () => ({ sha256: 'BINARY-A', manifestSchemaVersion: 2 })
    });

    await handlers.prepare({ osmPbfPath: 'network-a.osm.pbf', files });
    await expect(handlers.start()).resolves.toEqual(expect.objectContaining({ state: 'ready' }));
    await expect(handlers.prepare({ osmPbfPath: 'network-b.osm.pbf', files })).rejects.toThrow('import failed');
    await expect(handlers.start()).rejects.toThrow('먼저 Synthetic GTFS');
    await rm(dataDirectory, { recursive: true, force: true });
  });
});
