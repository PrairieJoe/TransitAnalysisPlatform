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
});
