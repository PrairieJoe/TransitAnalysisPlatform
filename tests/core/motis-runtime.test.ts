import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { buildMotisRuntimeDefaults, createCachedMotisRuntimeDefaultsLoader, findAvailableLoopbackPort, resolveMotisDataDirectory, resolveMotisExecutablePath } from '../../src/main/motis-runtime';

describe('MOTIS runtime defaults', () => {
  it('uses the packaged resources directory for the bundled sidecar', () => {
    const resourcesPath = 'C:\\Program Files\\Transit Analysis Platform\\resources';

    expect(resolveMotisExecutablePath({
      isPackaged: true,
      resourcesPath,
      projectRoot: 'C:\\workspace',
      exists: (candidate) => candidate === join(resourcesPath, 'motis', 'motis.exe')
    })).toBe(join(resourcesPath, 'motis', 'motis.exe'));
  });

  it('uses the patched workspace sidecar during development', () => {
    const projectRoot = 'C:\\workspace';
    const patchedPath = join(projectRoot, 'vendor', 'motis', 'patched-windows', 'motis.exe');

    expect(resolveMotisExecutablePath({
      isPackaged: false,
      resourcesPath: 'C:\\electron\\resources',
      projectRoot,
      exists: (candidate) => candidate === patchedPath
    })).toBe(patchedPath);
  });

  it('returns a clear expected path when the packaged sidecar is missing', () => {
    const resourcesPath = 'C:\\Program Files\\Transit Analysis Platform\\resources';

    expect(resolveMotisExecutablePath({
      isPackaged: true,
      resourcesPath,
      projectRoot: 'C:\\workspace',
      exists: () => false
    })).toBe(join(resourcesPath, 'motis', 'motis.exe'));
  });

  it('places MOTIS working data under LocalAppData', () => {
    expect(resolveMotisDataDirectory(undefined, 'C:\\Users\\User\\AppData\\Local')).toBe(
      join('C:\\Users\\User\\AppData\\Local', 'Transit Analysis Platform', 'motis-data')
    );
  });

  it('falls back to the parent of the app user-data directory', () => {
    expect(resolveMotisDataDirectory('C:\\Users\\User\\AppData\\Roaming\\Transit Analysis Platform')).toBe(
      join('C:\\Users\\User\\AppData\\Roaming', 'Transit Analysis Platform', 'motis-data')
    );
  });

  it.each(['', '   '])('falls back when LocalAppData is blank or whitespace (%j)', (localAppDataPath) => {
    expect(resolveMotisDataDirectory('C:\\Users\\User\\AppData\\Roaming\\Transit Analysis Platform', localAppDataPath)).toBe(
      join('C:\\Users\\User\\AppData\\Roaming', 'Transit Analysis Platform', 'motis-data')
    );
  });

  it('returns an available loopback port', async () => {
    await expect(findAvailableLoopbackPort(0)).resolves.toBeGreaterThanOrEqual(1024);
  });

  it('does not return an occupied preferred loopback port', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');

    try {
      await expect(findAvailableLoopbackPort(address.port)).resolves.not.toBe(address.port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('includes the executable, data directory, and available port in runtime defaults', async () => {
    const defaults = await buildMotisRuntimeDefaults({
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\Transit Analysis Platform\\resources',
      projectRoot: 'C:\\workspace',
      userDataPath: 'C:\\Users\\User\\AppData\\Roaming\\Transit Analysis Platform',
      localAppDataPath: 'C:\\Users\\User\\AppData\\Local',
      exists: () => true
    });

    expect(defaults.dataDirectory).toBe(join('C:\\Users\\User\\AppData\\Local', 'Transit Analysis Platform', 'motis-data'));
    expect(defaults.executablePath).toBe(join('C:\\Program Files\\Transit Analysis Platform\\resources', 'motis', 'motis.exe'));
    expect(defaults.port).toBeGreaterThanOrEqual(1024);
  });

  it('reuses one managed defaults result for diagnostics and preparation', async () => {
    let loadCount = 0;
    const expected = {
      executablePath: 'C:\\managed\\motis.exe',
      dataDirectory: 'C:\\Users\\User\\AppData\\Local\\Transit Analysis Platform\\motis-data',
      port: 18765
    };
    const loadDefaults = createCachedMotisRuntimeDefaultsLoader(async () => {
      loadCount += 1;
      return expected;
    });

    const [diagnosticDefaults, preparationDefaults] = await Promise.all([loadDefaults(), loadDefaults()]);

    expect(loadCount).toBe(1);
    expect(diagnosticDefaults).toBe(preparationDefaults);
    expect(preparationDefaults.port).toBe(18765);
  });
});
