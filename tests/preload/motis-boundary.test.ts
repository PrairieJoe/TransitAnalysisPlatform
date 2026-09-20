import { describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(async () => undefined);

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke }
}));

describe('renderer MOTIS bridge', () => {
  it('does not forward renderer-supplied sidecar options to start', async () => {
    await import('../../src/preload/index');
    const bridge = exposeInMainWorld.mock.calls[0][1] as {
      startMotis: () => Promise<unknown>;
    };

    await bridge.startMotis();

    expect(invoke).toHaveBeenCalledWith('motis:start');
  });

  it('exposes scenario execution storage without exposing filesystem access', async () => {
    vi.resetModules();
    await import('../../src/preload/index');
    const bridge = exposeInMainWorld.mock.calls[0][1] as {
      saveScenarioExecution: (payload: unknown) => Promise<unknown>;
      readScenarioExecution: (payload: unknown) => Promise<unknown>;
      listScenarioExecutionManifests: (projectId: string) => Promise<unknown>;
    };

    await bridge.saveScenarioExecution({ projectId: 'p-1' });
    await bridge.readScenarioExecution({ projectId: 'p-1', executionId: 'e-1' });
    await bridge.listScenarioExecutionManifests('p-1');

    expect(invoke).toHaveBeenCalledWith('scenario-execution:save', { projectId: 'p-1' });
    expect(invoke).toHaveBeenCalledWith('scenario-execution:read', { projectId: 'p-1', executionId: 'e-1' });
    expect(invoke).toHaveBeenCalledWith('scenario-execution:list', 'p-1');
  });
});
