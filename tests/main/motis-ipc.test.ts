import { describe, expect, it, vi } from 'vitest';
import { createMotisIpcHandlers } from '../../src/main/motis-ipc';
import type { GtfsFileSet } from '../../src/core/synthetic-gtfs/types';
import type { MotisRuntimeDefaults, MotisStatus } from '../../src/shared/types';

const files = {
  'agency.txt': '', 'stops.txt': '', 'routes.txt': '', 'trips.txt': '', 'stop_times.txt': '', 'calendar.txt': '',
  'tap-motis-config.json': '{}', 'tap-provenance.json': '{}', 'tap-validation.json': '{}'
} as GtfsFileSet;

describe('managed MOTIS IPC boundary', () => {
  it('constructs all executable and lifecycle options in main before prepare/start', async () => {
    const managedDefaults: MotisRuntimeDefaults = {
      executablePath: 'C:\\managed\\motis.exe',
      dataDirectory: 'C:\\Users\\User\\AppData\\Local\\Transit Analysis Platform\\motis-data',
      port: 18765
    };
    const prepare = vi.fn(async () => ({ archivePath: 'managed.zip', message: 'prepared' }));
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
      sidecar
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
      dataDirectory: managedDefaults.dataDirectory,
      osmPbfPath: 'C:\\user-controlled\\region.osm.pbf',
      port: managedDefaults.port,
      args: ['server'],
      environment: { TBB_NUM_THREADS: '1' },
      disableTiles: true,
      healthPath: '/api/v1/health',
      startupTimeoutMs: 30000
    }), files);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: managedDefaults.executablePath,
      dataDirectory: managedDefaults.dataDirectory,
      port: managedDefaults.port,
      args: ['server'],
      environment: { TBB_NUM_THREADS: '1' },
      disableTiles: true
    }));
    expect(start.mock.calls[0][0]).not.toEqual(expect.objectContaining({ executablePath: 'C:\\renderer-controlled\\evil.exe' }));
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
});
