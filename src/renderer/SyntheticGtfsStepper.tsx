import type { JSX } from 'react';
import { type SyntheticWorkflowStep, type SyntheticWorkflowStepStatus } from './synthetic-gtfs-workflow';

export interface SyntheticGtfsStepperProps {
  activeStep: SyntheticWorkflowStep;
  statuses: Record<SyntheticWorkflowStep, SyntheticWorkflowStepStatus>;
  onSelectStep: (step: SyntheticWorkflowStep) => void;
}

const STEP_ORDER: SyntheticWorkflowStep[] = ['scenario', 'generation', 'motis', 'batch'];

function statusLabel(status: SyntheticWorkflowStepStatus): string {
  if (status.isStale) return '다시 실행 필요';
  if (status.isComplete) return '완료';
  if (!status.isAvailable) return '잠김';
  return '진행 가능';
}

export default function SyntheticGtfsStepper({ activeStep, statuses, onSelectStep }: SyntheticGtfsStepperProps): JSX.Element {
  return <nav className="synthetic-stepper" aria-label="Synthetic GTFS 작업 단계">
    <ol>
      {STEP_ORDER.map((step, index) => {
        const status = statuses[step];
        const isActive = activeStep === step;
        return <li className={`synthetic-step synthetic-step-${step}${isActive ? ' is-active' : ''}${status.isComplete ? ' is-complete' : ''}${!status.isAvailable ? ' is-locked' : ''}${status.isStale ? ' is-stale' : ''}`} key={step}>
          <button
            type="button"
            aria-current={isActive ? 'step' : undefined}
            aria-disabled={!status.isAvailable}
            disabled={!status.isAvailable}
            onClick={() => { if (status.isAvailable) onSelectStep(step); }}
          >
            <span className="synthetic-step-number">{status.isComplete ? '✓' : index + 1}</span>
            <span className="synthetic-step-copy"><strong>{status.label}</strong><small>{status.description}</small></span>
            <span className="synthetic-step-status">{statusLabel(status)}</span>
          </button>
          {index < STEP_ORDER.length - 1 && <span className="synthetic-stepper-line" aria-hidden="true" />}
        </li>;
      })}
    </ol>
  </nav>;
}
