import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobProgress } from '../../src/shared/job-types';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn(async () => undefined);
const on = vi.fn();
const removeListener = vi.fn();
const getPathForFile = vi.fn(() => 'C:\\data\\rides.csv');

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
  webUtils: { getPathForFile }
}));

describe('renderer job boundary', () => {
  beforeEach(() => {
    exposeInMainWorld.mockClear();
    invoke.mockClear();
    on.mockClear();
    removeListener.mockClear();
    getPathForFile.mockClear();
  });

  it('exposes only named job, file, and project operations', async () => {
    vi.resetModules();
    await import('../../src/preload/index');
    const bridge = exposeInMainWorld.mock.calls[0][1] as {
      cancelJob: (jobId: string) => Promise<unknown>;
      getFilePath: (file: File) => string;
      openProject: (id: string) => Promise<unknown>;
      runScenarioJourney: (request: unknown) => Promise<unknown>;
      getScenarioJourneySummary: (payload: unknown) => Promise<unknown>;
      getScenarioJourneyResult: (payload: unknown) => Promise<unknown>;
    };
    const file = {} as File;

    await bridge.cancelJob('job-7');
    await bridge.openProject('project-3');
    await bridge.runScenarioJourney({ jobId: 'journey-1', executionId: 'execution-1' });
    await bridge.getScenarioJourneySummary({ projectId: 'project-3', executionId: 'journey-1' });
    await bridge.getScenarioJourneyResult({ projectId: 'project-3', executionId: 'journey-1' });

    expect(invoke).toHaveBeenCalledWith('job:cancel', 'job-7');
    expect(invoke).toHaveBeenCalledWith('project:open', 'project-3');
    expect(invoke).toHaveBeenCalledWith('scenario-journey:run', { jobId: 'journey-1', executionId: 'execution-1' });
    expect(invoke).toHaveBeenCalledWith('scenario-journey:summary', { projectId: 'project-3', executionId: 'journey-1' });
    expect(invoke).toHaveBeenCalledWith('scenario-journey:result', { projectId: 'project-3', executionId: 'journey-1' });
    expect(bridge.getFilePath(file)).toBe('C:\\data\\rides.csv');
    expect(getPathForFile).toHaveBeenCalledWith(file);
    expect(bridge).not.toHaveProperty('invoke');
  });

  it('wraps progress events and removes the exact wrapper on unsubscribe', async () => {
    vi.resetModules();
    await import('../../src/preload/index');
    const bridge = exposeInMainWorld.mock.calls[0][1] as {
      onJobProgress: (listener: (progress: JobProgress) => void) => () => void;
    };
    const listener = vi.fn();

    const unsubscribe = bridge.onJobProgress(listener);
    expect(on).toHaveBeenCalledOnce();
    expect(on.mock.calls[0][0]).toBe('job:progress');
    const wrapper = on.mock.calls[0][1] as (_event: unknown, progress: JobProgress) => void;
    const progress: JobProgress = { jobId: 'job-1', operation: 'analysis', status: 'running' };
    wrapper({}, progress);
    unsubscribe();

    expect(listener).toHaveBeenCalledWith(progress);
    expect(removeListener).toHaveBeenCalledWith('job:progress', wrapper);
  });
});
