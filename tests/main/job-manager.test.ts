import { describe, expect, it, vi } from 'vitest';
import { createJobManager, JobCancelledError } from '../../src/main/job-manager';
import type { JobProgress } from '../../src/shared/job-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('job manager', () => {
  it('emits queued, running, reported progress, and completed states', async () => {
    const events: JobProgress[] = [];
    const manager = createJobManager({ emit: (event) => events.push(event) });

    const result = await manager.start(
      { jobId: 'job-1', operation: 'analysis' },
      async (context) => {
        context.report({ phase: 'analyze', completed: 1, total: 2, message: '집계 중' });
        return 42;
      }
    );

    expect(result).toBe(42);
    expect(events.map(({ status }) => status)).toEqual(['queued', 'running', 'running', 'completed']);
    expect(events[2]).toMatchObject({ jobId: 'job-1', phase: 'analyze', completed: 1, total: 2 });
  });

  it('rejects a duplicate active job id without replacing the first job', async () => {
    const gate = deferred<void>();
    const firstWork = vi.fn(async () => gate.promise);
    const replacementWork = vi.fn(async () => 'replacement');
    const manager = createJobManager({ emit: () => {} });

    const first = manager.start({ jobId: 'same-id', operation: 'import' }, firstWork);
    await expect(manager.start({ jobId: 'same-id', operation: 'analysis' }, replacementWork))
      .rejects.toThrow('same-id');
    expect(replacementWork).not.toHaveBeenCalled();

    gate.resolve();
    await first;
  });

  it('cooperatively cancels through the context used by the active work', async () => {
    const events: JobProgress[] = [];
    const entered = deferred<void>();
    const continueWork = deferred<void>();
    const manager = createJobManager({ emit: (event) => events.push(event) });

    const running = manager.start(
      { jobId: 'cancel-me', operation: 'alighting' },
      async (context) => {
        entered.resolve();
        await continueWork.promise;
        context.throwIfCancelled();
        return 'unreachable';
      }
    );
    await entered.promise;

    expect(manager.cancel('cancel-me')).toEqual({ jobId: 'cancel-me', accepted: true });
    expect(manager.cancel('cancel-me')).toEqual({ jobId: 'cancel-me', accepted: false });
    continueWork.resolve();

    await expect(running).rejects.toBeInstanceOf(JobCancelledError);
    expect(events.map(({ status }) => status)).toEqual(['queued', 'running', 'cancelling', 'cancelled']);
  });

  it('rejects cancellation after completion or for an unknown job', async () => {
    const manager = createJobManager({ emit: () => {} });
    await manager.start({ jobId: 'done', operation: 'analysis' }, async () => undefined);

    expect(manager.cancel('done')).toEqual({ jobId: 'done', accepted: false });
    expect(manager.cancel('missing')).toEqual({ jobId: 'missing', accepted: false });
  });

  it('rejects cancellation after an atomic commit boundary begins', async () => {
    const enteredCommit = deferred<void>();
    const releaseCommit = deferred<void>();
    const manager = createJobManager({ emit: () => {} });
    const running = manager.start({ jobId: 'committing', operation: 'import' }, async (context) => {
      context.beginCommit();
      enteredCommit.resolve();
      await releaseCommit.promise;
      return 'saved';
    });
    await enteredCommit.promise;

    expect(manager.cancel('committing')).toEqual({ jobId: 'committing', accepted: false });
    releaseCommit.resolve();
    await expect(running).resolves.toBe('saved');
  });

  it('emits a failed terminal state and preserves the work error', async () => {
    const events: JobProgress[] = [];
    const manager = createJobManager({ emit: (event) => events.push(event) });

    await expect(manager.start(
      { jobId: 'broken', operation: 'import' },
      async () => { throw new Error('broken work'); }
    )).rejects.toThrow('broken work');

    expect(events.at(-1)).toMatchObject({
      jobId: 'broken',
      status: 'failed',
      message: 'broken work'
    });
  });
});
