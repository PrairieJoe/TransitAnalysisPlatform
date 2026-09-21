import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import ScenarioComparisonPanel from './ScenarioComparisonPanel';
import ScenarioDemandPanel from './ScenarioDemandPanel';
import ScenarioExecutionPanel from './ScenarioExecutionPanel';
import ScenarioJourneyComparison from './ScenarioJourneyComparison';
import type { SyntheticWorkflowStep } from './synthetic-gtfs-workflow';
import type { ODDemandResult, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioExecutionManifest, ScenarioJourneyExecutionManifest } from '../shared/types';

export interface SyntheticScenarioToolsProps {
  projectId: string;
  demand?: ODDemandResult;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  activeStep: SyntheticWorkflowStep;
  initialExecutionManifests?: ScenarioExecutionManifest[];
  initialJourneyManifests?: ScenarioJourneyExecutionManifest[];
}

export default function SyntheticScenarioTools({ projectId, demand, routeStops, serviceConfigs, scenarioDefinitions, activeStep, initialExecutionManifests = [], initialJourneyManifests = [] }: SyntheticScenarioToolsProps): JSX.Element {
  const [executionManifests, setExecutionManifests] = useState<ScenarioExecutionManifest[]>(initialExecutionManifests);
  const [journeyManifests, setJourneyManifests] = useState<ScenarioJourneyExecutionManifest[]>(initialJourneyManifests);
  const showExecutionTools = activeStep === 'motis' || activeStep === 'batch';

  useEffect(() => { setExecutionManifests(initialExecutionManifests); }, [initialExecutionManifests]);
  useEffect(() => { setJourneyManifests(initialJourneyManifests); }, [initialJourneyManifests]);

  return <details className="synthetic-scenario-tools">
    <summary>고급 다중 노선·레거시 실증 도구 <span>기본 현행·개편안 비교와 별도</span></summary>
    <div className="synthetic-scenario-tools-content">
      {!showExecutionTools
        ? <div className="synthetic-locked-step"><strong>시나리오 실증 도구는 아직 잠겨 있습니다.</strong><span>GTFS 생성 결과를 만든 뒤 MOTIS 여정 검증 단계에서 사용할 수 있습니다.</span></div>
        : <>
          <ScenarioExecutionPanel projectId={projectId} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={scenarioDefinitions} onExecutionSaved={(manifest) => setExecutionManifests((current) => [...current.filter((item) => item.executionId !== manifest.executionId), manifest])} />
          <ScenarioJourneyComparison projectId={projectId} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={scenarioDefinitions} scenarioJourneyManifests={journeyManifests} onJourneySaved={(manifest) => setJourneyManifests((current) => [...current.filter((item) => item.executionId !== manifest.executionId), manifest])} />
          <ScenarioComparisonPanel projectId={projectId} routeStops={routeStops} serviceConfigs={serviceConfigs} scenarioDefinitions={scenarioDefinitions} scenarioExecutionManifests={executionManifests} />
          {activeStep === 'batch' && <ScenarioDemandPanel projectId={projectId} demand={demand} routeStops={routeStops} scenarioDefinitions={scenarioDefinitions} scenarioExecutionManifests={executionManifests} />}
        </>}
    </div>
  </details>;
}
