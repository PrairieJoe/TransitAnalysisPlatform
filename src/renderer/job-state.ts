import type { JobOperation, JobProgress } from '../shared/job-types';

export interface JobUiState {
  active: JobProgress | null;
}

export type JobUiAction =
  | { type: 'start'; jobId: string; operation: JobOperation }
  | { type: 'cancel-requested'; jobId: string }
  | { type: 'progress'; progress: JobProgress }
  | { type: 'clear'; jobId: string };

const TERMINAL = new Set<JobProgress['status']>(['completed', 'cancelled', 'failed']);

export function jobStateReducer(state: JobUiState, action: JobUiAction): JobUiState {
  if (action.type === 'start') {
    return { active: { jobId: action.jobId, operation: action.operation, status: 'queued' } };
  }
  const actionJobId = action.type === 'progress' ? action.progress.jobId : action.jobId;
  if (!state.active || state.active.jobId !== actionJobId) return state;
  if (action.type === 'clear') return { active: null };
  if (action.type === 'cancel-requested') {
    if (state.active.status === 'cancelling') return state;
    return { active: { ...state.active, status: 'cancelling' } };
  }
  if (TERMINAL.has(action.progress.status)) return { active: null };
  return { active: action.progress };
}

export function jobProgressPercent(progress: JobProgress): number | null {
  if (!progress.total || progress.completed === undefined) return null;
  return Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100)));
}
