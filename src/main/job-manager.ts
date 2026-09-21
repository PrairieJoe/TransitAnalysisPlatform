import type {
  JobCancellationResult,
  JobProgress,
  JobProgressUpdate,
  JobRequest,
  JobStatus
} from '../shared/job-types';

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled`);
    this.name = 'JobCancelledError';
  }
}

export interface JobExecutionContext {
  readonly jobId: string;
  readonly operation: JobRequest['operation'];
  report(update: JobProgressUpdate): void;
  throwIfCancelled(): void;
  beginCommit(): void;
}

interface ActiveJob {
  request: JobRequest;
  status: JobStatus;
  cancellationRequested: boolean;
  cancellable: boolean;
  executionId?: string;
}

export interface JobManager {
  start<T>(request: JobRequest, work: (context: JobExecutionContext) => Promise<T>): Promise<T>;
  cancel(jobId: string): JobCancellationResult;
}

export function createJobManager({ emit }: { emit: (progress: JobProgress) => void }): JobManager {
  const activeJobs = new Map<string, ActiveJob>();

  const publish = (job: ActiveJob, update: JobProgressUpdate = {}) => {
    emit({
      jobId: job.request.jobId,
      operation: job.request.operation,
      ...(job.executionId ? { executionId: job.executionId } : {}),
      status: job.status,
      ...update
    });
  };

  return {
    async start<T>(request: JobRequest, work: (context: JobExecutionContext) => Promise<T>) {
      if (activeJobs.has(request.jobId)) {
        throw new Error(`Job id is already active: ${request.jobId}`);
      }

      const job: ActiveJob = { request, status: 'queued', cancellationRequested: false, cancellable: true };
      activeJobs.set(request.jobId, job);
      publish(job);

      const context: JobExecutionContext = {
        jobId: request.jobId,
        operation: request.operation,
        report(update) {
          if (update.executionId) job.executionId = update.executionId;
          publish(job, update);
        },
        throwIfCancelled() {
          if (job.cancellationRequested) throw new JobCancelledError(request.jobId);
        },
        beginCommit() {
          if (job.cancellationRequested) throw new JobCancelledError(request.jobId);
          job.cancellable = false;
        }
      };

      try {
        job.status = 'running';
        publish(job);
        context.throwIfCancelled();
        const result = await work(context);
        context.throwIfCancelled();
        job.status = 'completed';
        publish(job);
        return result;
      } catch (error) {
        if (error instanceof JobCancelledError) {
          job.status = 'cancelled';
          publish(job, { message: error.message });
        } else {
          job.status = 'failed';
          publish(job, { message: error instanceof Error ? error.message : String(error) });
        }
        throw error;
      } finally {
        activeJobs.delete(request.jobId);
      }
    },

    cancel(jobId) {
      const job = activeJobs.get(jobId);
      if (!job || !job.cancellable || job.cancellationRequested || (job.status !== 'queued' && job.status !== 'running')) {
        return { jobId, accepted: false };
      }

      job.cancellationRequested = true;
      job.status = 'cancelling';
      publish(job);
      return { jobId, accepted: true };
    }
  };
}
