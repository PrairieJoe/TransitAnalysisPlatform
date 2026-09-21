import type { JSX } from 'react';
import ScenarioDefinitionEditor from './ScenarioDefinitionEditor';
import type { ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition } from '../shared/types';

export interface SyntheticScenarioStepProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  onSaveScenarioDefinition: (definition: ScenarioDefinition) => Promise<void>;
}

export default function SyntheticScenarioStep({ project, routeStops, serviceConfigs, onSaveScenarioDefinition }: SyntheticScenarioStepProps): JSX.Element {
  return <section className="synthetic-step-panel synthetic-scenario-step">
    <div className="synthetic-step-panel-heading"><div><strong>시나리오 설정</strong><span>현재 노선과 사용자가 바꿀 정류장 순서를 정하고 저장합니다.</span></div></div>
    <ScenarioDefinitionEditor project={project} routeStops={routeStops} serviceConfigs={serviceConfigs} showAnalysisPanels={false} onSaveScenarioDefinition={onSaveScenarioDefinition} />
  </section>;
}
