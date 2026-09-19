import { describe, expect, it } from 'vitest';
import { jobProgressPercent, jobStateReducer, type JobUiState } from '../../src/renderer/job-state';

const idle: JobUiState = { active: null };

describe('renderer job state', () => {
  it('applies progress only to the latest active job', () => {
    const started = jobStateReducer(idle, { type: 'start', jobId: 'latest', operation: 'analysis' });
    const stale = jobStateReducer(started, {
      type: 'progress',
      progress: { jobId: 'old', operation: 'analysis', status: 'running', phase: 'old' }
    });
    const current = jobStateReducer(stale, {
      type: 'progress',
      progress: { jobId: 'latest', operation: 'analysis', status: 'running', phase: 'analyze', completed: 1, total: 2 }
    });

    expect(stale).toBe(started);
    expect(current.active).toMatchObject({ jobId: 'latest', phase: 'analyze', completed: 1, total: 2 });
  });

  it('marks cancellation once and clears terminal jobs', () => {
    const started = jobStateReducer(idle, { type: 'start', jobId: 'job-1', operation: 'import' });
    const cancelling = jobStateReducer(started, { type: 'cancel-requested', jobId: 'job-1' });
    const repeated = jobStateReducer(cancelling, { type: 'cancel-requested', jobId: 'job-1' });
    const completed = jobStateReducer(cancelling, {
      type: 'progress',
      progress: { jobId: 'job-1', operation: 'import', status: 'cancelled' }
    });

    expect(cancelling.active?.status).toBe('cancelling');
    expect(repeated).toBe(cancelling);
    expect(completed.active).toBeNull();
  });

  it('returns no percentage for unknown totals and clamps known progress', () => {
    expect(jobProgressPercent({ jobId: 'a', operation: 'analysis', status: 'running' })).toBeNull();
    expect(jobProgressPercent({ jobId: 'a', operation: 'analysis', status: 'running', completed: 7, total: 5 })).toBe(100);
    expect(jobProgressPercent({ jobId: 'a', operation: 'analysis', status: 'running', completed: 1, total: 4 })).toBe(25);
  });
});
