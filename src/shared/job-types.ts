export type JobOperation = 'analysis' | 'alighting' | 'import' | 'scenario-journey';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface JobRequest {
  jobId: string;
  operation: JobOperation;
}

export interface JobProgress {
  jobId: string;
  operation: JobOperation;
  executionId?: string;
  status: JobStatus;
  phase?: string;
  completed?: number;
  total?: number;
  message?: string;
}

export type JobProgressUpdate = Omit<JobProgress, 'jobId' | 'operation' | 'status'>;

export interface JobCancellationResult {
  jobId: string;
  accepted: boolean;
}
