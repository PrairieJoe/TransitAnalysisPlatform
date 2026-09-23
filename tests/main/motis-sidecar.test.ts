import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MotisSidecar, prepareMotisData, type MotisSidecarOptions } from '../../src/main/motis-sidecar';
import type { GtfsFileSet } from '../../src/core/synthetic-gtfs/types';
import type { MotisRuntimeDefaults } from '../../src/shared/types';

class FakeChild extends EventEmitter {
  killed = false;
  constructor(private readonly autoExit = true) { super(); }
  kill(): boolean { this.killed = true; if (this.autoExit) queueMicrotask(() => this.emit('exit', 0, null)); return true; }
}

const options: MotisSidecarOptions = {
  executablePath: 'C:\\motis\\motis.exe', dataDirectory: 'C:\\motis\\data', osmPbfPath: 'C:\\osm\\region.osm.pbf', port: 8080,
  args: ['server'], healthPath: '/api/v1/health', startupTimeoutMs: 1000
};

describe('MotisSidecar', () => {
  it('runs import with relative paths from the data directory for Windows-safe config handling', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'tap-motis-sidecar-'));
    const osmPbfPath = join(dataDirectory, 'region.osm.pbf');
    await writeFile(osmPbfPath, 'test');
    const calls: Array<{ args: string[]; cwd: string; environment?: NodeJS.ProcessEnv }> = [];
    const files = {
      'agency.txt': '', 'stops.txt': '', 'routes.txt': '', 'trips.txt': '', 'stop_times.txt': '', 'calendar.txt': '',
      'tap-motis-config.json': '{}', 'tap-provenance.json': '{}', 'tap-validation.json': '{}'
    } as GtfsFileSet;
    try {
      await prepareMotisData({ ...options, executablePath: 'C:\\motis\\motis.exe', dataDirectory, osmPbfPath, environment: { TBB_NUM_THREADS: '1' }, disableTiles: true }, files, {
        runCommand: async (_executablePath, args, cwd, environment) => {
          calls.push({ args, cwd, environment });
          if (args[0] === 'config') await writeFile(join(dataDirectory, 'config.yml'), 'osm: region.osm.pbf\ntiles:\n  profile: tiles-profiles/full.lua\ntimetable:\n  first_day: TODAY\n');
        }
      });
      expect(calls).toEqual([
        { args: ['config', osmPbfPath, join(dataDirectory, 'tap-synthetic-gtfs.zip')], cwd: dataDirectory, environment: { TBB_NUM_THREADS: '1' } },
        { args: ['import', '-c', 'config.yml', '-d', 'data'], cwd: dataDirectory, environment: { TBB_NUM_THREADS: '1' } }
      ]);
      const generatedConfig = await readFile(join(dataDirectory, 'config.yml'), 'utf8');
      expect(generatedConfig).not.toContain('tiles:');
      expect(generatedConfig).toContain('timetable:');
      expect(generatedConfig).toContain('server:\n  host: 127.0.0.1\n  port: 8080');
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  it('spawns without a shell and becomes ready after health succeeds', async () => {
    const child = new FakeChild(false);
    let clock = 0;
    const spawnProcess = vi.fn(() => child as never);
    let healthCalls = 0;
    const sidecar = new MotisSidecar({
      spawn: spawnProcess,
      fetch: vi.fn(async () => { healthCalls += 1; return { ok: healthCalls > 1, status: healthCalls > 1 ? 200 : 503 } as Response; }),
      sleep: async () => { clock += 100; },
      now: () => clock
    });
    const status = await sidecar.start(options);
    expect(status.state).toBe('ready');
    expect(spawnProcess).toHaveBeenCalledWith(options.executablePath, options.args, expect.objectContaining({ cwd: options.dataDirectory, shell: false, windowsHide: true }));
    expect(healthCalls).toBe(2);
  });

  it('uses managed runtime defaults for the process cwd and selected loopback URL', async () => {
    const child = new FakeChild();
    const managedDefaults: MotisRuntimeDefaults = {
      executablePath: 'C:\\Program Files\\Transit Analysis Platform\\resources\\motis\\motis.exe',
      dataDirectory: 'C:\\Users\\User\\AppData\\Local\\Transit Analysis Platform\\motis-data',
      port: 18765
    };
    const spawnProcess = vi.fn(() => child as never);
    const healthUrls: string[] = [];
    const sidecar = new MotisSidecar({
      spawn: spawnProcess,
      fetch: vi.fn(async (url) => { healthUrls.push(url); return { ok: true, status: 200 } as Response; })
    });

    const status = await sidecar.start({ ...options, ...managedDefaults });

    expect(spawnProcess).toHaveBeenCalledWith(managedDefaults.executablePath, options.args, expect.objectContaining({ cwd: managedDefaults.dataDirectory }));
    expect(healthUrls).toEqual([`http://127.0.0.1:${managedDefaults.port}/api/v1/health`]);
    expect(status.baseUrl).toBe(`http://127.0.0.1:${managedDefaults.port}`);
    await sidecar.stop();
  });

  it('restarts a ready server when the prepared network fingerprint changes', async () => {
    const children: FakeChild[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child as never;
    });
    const sidecar = new MotisSidecar({ spawn: spawnProcess, fetch: async () => ({ ok: true, status: 200 }) });

    await sidecar.start({ ...options, preparationFingerprint: 'A' });
    await sidecar.start({ ...options, preparationFingerprint: 'B' });

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(children[0].killed).toBe(true);
    expect(sidecar.getStatus()).toEqual(expect.objectContaining({ state: 'ready', preparationFingerprint: 'B' }));
    await sidecar.stop();
  });

  it('reports a missing embedded MOTIS component when the internal executable path is empty', async () => {
    const sidecar = new MotisSidecar({ spawn: () => new FakeChild() as never });

    const status = await sidecar.start({ ...options, executablePath: '' });

    expect(status).toEqual(expect.objectContaining({
      state: 'failed',
      message: '앱 내장 MOTIS 구성요소를 찾을 수 없습니다. 앱을 다시 설치하세요.'
    }));
  });

  it('reports a missing embedded MOTIS component when prepare/import cannot spawn the executable', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'tap-motis-sidecar-missing-'));
    const osmPbfPath = join(dataDirectory, 'region.osm.pbf');
    const missingExecutablePath = join(dataDirectory, 'missing-motis.exe');
    await writeFile(osmPbfPath, 'test');
    const files = {
      'agency.txt': '', 'stops.txt': '', 'routes.txt': '', 'trips.txt': '', 'stop_times.txt': '', 'calendar.txt': '',
      'tap-motis-config.json': '{}', 'tap-provenance.json': '{}', 'tap-validation.json': '{}'
    } as GtfsFileSet;
    try {
      await expect(prepareMotisData({ ...options, executablePath: missingExecutablePath, dataDirectory, osmPbfPath }, files)).rejects.toThrow('앱 내장 MOTIS 구성요소를 찾을 수 없습니다. 앱을 다시 설치하세요.');
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  it('passes the configured environment to the MOTIS server', async () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as never);
    const sidecar = new MotisSidecar({ spawn: spawnProcess, fetch: async () => ({ ok: true, status: 200 } as Response) });
    await sidecar.start({ ...options, environment: { TBB_NUM_THREADS: '1' } });
    expect(spawnProcess).toHaveBeenCalledWith(options.executablePath, options.args, expect.objectContaining({ env: expect.objectContaining({ TBB_NUM_THREADS: '1' }) }));
    await sidecar.stop();
  });

  it('returns an actionable failure on readiness timeout', async () => {
    const child = new FakeChild();
    let clock = 0;
    const sidecar = new MotisSidecar({ spawn: () => child as never, fetch: async () => ({ ok: false, status: 503 } as Response), sleep: async () => { clock += 100; }, now: () => clock });
    const status = await sidecar.start({ ...options, startupTimeoutMs: 500 });
    expect(status.state).toBe('failed');
    expect(status.message).toContain('readiness');
  });

  it('reports process errors and rejects HTTP errors', async () => {
    const child = new FakeChild();
    const sidecar = new MotisSidecar({ spawn: () => child as never, fetch: async () => ({ ok: false, status: 500, text: async () => 'bad request' } as Response), sleep: async () => undefined, now: (() => { let clock = 0; return () => { clock += 100; return clock; }; })() });
    const startPromise = sidecar.start(options);
    await Promise.resolve();
    child.emit('error', Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }));
    const status = await startPromise;
    expect(status.state).toBe('failed');
    await expect(sidecar.request('/api/v6/plan')).rejects.toThrow('준비되지 않았습니다');
  });

  it('parses successful requests and stops idempotently', async () => {
    const child = new FakeChild();
    let clock = 0;
    const sidecar = new MotisSidecar({ spawn: () => child as never, fetch: async (url) => url.includes('health') ? ({ ok: true, status: 200 } as Response) : ({ ok: true, status: 200, text: async () => '{"itineraries":[]}' } as Response), sleep: async () => { clock += 10; }, now: () => clock });
    await sidecar.start(options);
    await expect(sidecar.request('/api/v6/plan')).resolves.toEqual({ itineraries: [] });
    await sidecar.stop();
    await sidecar.stop();
    expect(child.killed).toBe(true);
    expect(sidecar.getStatus().state).toBe('stopped');
  });

  it('rejects protocol-relative and external absolute request URLs before fetching', async () => {
    const child = new FakeChild();
    const fetchImpl = vi.fn(async (url) => url.includes('health')
      ? ({ ok: true, status: 200 } as Response)
      : ({ ok: true, status: 200, text: async () => '{"itineraries":[]}' } as Response));
    const sidecar = new MotisSidecar({ spawn: () => child as never, fetch: fetchImpl });
    await sidecar.start(options);

    await expect(sidecar.request('//external.example/api/v6/plan')).rejects.toThrow('로컬 API');
    await expect(sidecar.request('https://external.example/api/v6/plan')).rejects.toThrow('로컬 API');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('waits for the child exit event before resolving stop', async () => {
    const child = new FakeChild(false);
    const sidecar = new MotisSidecar({
      spawn: () => child as never,
      fetch: async () => ({ ok: true, status: 200 } as Response)
    });
    await sidecar.start(options);

    let resolved = false;
    const stopping = sidecar.stop().then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    child.emit('exit', 0, null);
    await stopping;
    expect(resolved).toBe(true);
  });
});
