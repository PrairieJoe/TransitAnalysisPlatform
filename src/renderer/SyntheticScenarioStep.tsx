import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { buildRoutePathIndex, routeOptions } from '../core/route-master';
import { selectRepresentativeRouteStopIds } from '../core/scenario-editor';
import { DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../core/synthetic-gtfs/draft-builder';
import ScenarioDefinitionEditor from './ScenarioDefinitionEditor';
import SyntheticRouteScenarioEditor from './SyntheticRouteScenarioEditor';
import { buildPrimaryScenarioDefinition } from './synthetic-scenario-definition';
import type { ProjectManifest, RouteServiceConfig, RouteStopMasterRecord, ScenarioDefinition, ScenarioOperationPlan } from '../shared/types';

export interface SyntheticScenarioStepProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  onSaveScenarioDefinition: (definition: ScenarioDefinition) => Promise<void>;
  selectedRouteId?: string;
  scenarioStopIds?: string[];
  scenarioLabel?: string;
  onRouteChange?: (routeId: string) => void;
  onScenarioStopIdsChange?: (stopIds: string[]) => void;
  onScenarioLabelChange?: (label: string) => void;
  onScenarioSaved?: (definition: ScenarioDefinition) => void;
}

const DEFAULT_PRIMARY_OPERATION: ScenarioOperationPlan = {
  serviceDays: [0, 1, 2, 3, 4],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: 10,
  vehicleCount: 4,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: { ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS, speedsKph: { ...DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS.speedsKph } }
};

export default function SyntheticScenarioStep({ project, routeStops, serviceConfigs, onSaveScenarioDefinition, selectedRouteId: controlledRouteId, scenarioStopIds: controlledScenarioStopIds, scenarioLabel: controlledScenarioLabel, onRouteChange, onScenarioStopIdsChange, onScenarioLabelChange, onScenarioSaved }: SyntheticScenarioStepProps): JSX.Element {
  const options = useMemo(() => routeOptions(buildRoutePathIndex(routeStops)), [routeStops]);
  const [localRouteId, setLocalRouteId] = useState(() => controlledRouteId ?? options[0]?.routeId ?? '');
  const [localScenarioStopIds, setLocalScenarioStopIds] = useState(() => controlledScenarioStopIds ?? (localRouteId ? selectRepresentativeRouteStopIds(routeStops, localRouteId) : []));
  const [localScenarioLabel, setLocalScenarioLabel] = useState(controlledScenarioLabel ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const isControlled = controlledRouteId !== undefined && controlledScenarioStopIds !== undefined && controlledScenarioLabel !== undefined;
  const selectedRouteId = controlledRouteId ?? localRouteId;
  const scenarioStopIds = controlledScenarioStopIds ?? localScenarioStopIds;
  const scenarioLabel = controlledScenarioLabel ?? localScenarioLabel;

  function changeRoute(routeId: string): void {
    if (onRouteChange) onRouteChange(routeId);
    if (!isControlled) {
      setLocalRouteId(routeId);
      setLocalScenarioStopIds(selectRepresentativeRouteStopIds(routeStops, routeId));
      setLocalScenarioLabel('');
    }
  }

  function changeScenarioStopIds(stopIds: string[]): void {
    if (onScenarioStopIdsChange) onScenarioStopIdsChange(stopIds);
    if (!isControlled) setLocalScenarioStopIds(stopIds);
  }

  function changeScenarioLabel(label: string): void {
    if (onScenarioLabelChange) onScenarioLabelChange(label);
    if (!isControlled) setLocalScenarioLabel(label);
  }

  async function savePrimaryScenario(): Promise<void> {
    try {
      setSaveError(undefined);
      const definition = buildPrimaryScenarioDefinition({ projectId: project.id, routeStops, routeId: selectedRouteId, label: scenarioLabel, scenarioStopIds, beforeOperation: DEFAULT_PRIMARY_OPERATION, afterOperation: DEFAULT_PRIMARY_OPERATION });
      await onSaveScenarioDefinition(definition);
      onScenarioSaved?.(definition);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '시나리오를 저장하지 못했습니다.');
    }
  }

  return <section className="synthetic-step-panel synthetic-scenario-step">
    <div className="synthetic-step-panel-heading"><div><strong>노선 개편 시나리오</strong><span>현행 노선을 기준으로 정류장을 바꾼 개편안을 만들고, 같은 조건에서 전후 결과를 비교합니다.</span></div></div>
    <div className="scenario-primary-summary" role="note"><strong>현행 경로를 기준으로 시작합니다.</strong><span>정류장 추가·제거·순서 변경만 먼저 정하고, 운행조건은 필요할 때만 펼쳐서 조정할 수 있습니다.</span></div>
    <SyntheticRouteScenarioEditor routeOptions={options} routeStops={routeStops} selectedRouteId={selectedRouteId} scenarioStopIds={scenarioStopIds} scenarioLabel={scenarioLabel} onRouteChange={changeRoute} onScenarioStopIdsChange={changeScenarioStopIds} onScenarioLabelChange={changeScenarioLabel} onSave={savePrimaryScenario} />
    {saveError && <div className="error-box" role="alert">⚠ {saveError}</div>}
    <details className="scenario-operation-disclosure"><summary>운행조건 변경 <span>선택 사항 · 기본 조건을 먼저 사용합니다</span></summary><div className="scenario-operation-disclosure-body"><p>기본 운행조건으로 시나리오를 저장합니다. 여러 노선·좌표 여정·세부 운행조건을 직접 정의해야 할 때는 아래 고급 편집기를 사용하세요.</p></div></details>
    <details className="scenario-legacy-disclosure" onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}><summary>고급: 여러 노선·좌표 여정 시나리오 <span>기존 상세 편집기</span></summary>{advancedOpen && <ScenarioDefinitionEditor project={project} routeStops={routeStops} serviceConfigs={serviceConfigs} showAnalysisPanels={false} onSaveScenarioDefinition={onSaveScenarioDefinition} />}</details>
  </section>;
}
