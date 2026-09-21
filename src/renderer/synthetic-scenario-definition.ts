import { createScenarioDefinition } from '../core/scenario-contract';
import { selectRepresentativeRouteStopIds, upsertScenarioDefinition } from '../core/scenario-editor';
import type { RouteStopMasterRecord, ScenarioDefinition, ScenarioOperationPlan } from '../shared/types';
import { defaultScenarioLabel } from './synthetic-route-scenario';

export interface PrimaryScenarioDefinitionInput {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  routeId: string;
  label: string;
  scenarioStopIds: string[];
  beforeOperation: ScenarioOperationPlan;
  afterOperation: ScenarioOperationPlan;
}

function newScenarioId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildPrimaryScenarioDefinition(input: PrimaryScenarioDefinitionInput): ScenarioDefinition {
  const routeId = input.routeId.trim();
  const routeRecords = input.routeStops
    .filter((stop) => stop.routeId === routeId)
    .sort((left, right) => left.stationSequence - right.stationSequence || left.stationId.localeCompare(right.stationId, 'ko'));
  const firstStop = routeRecords[0];
  const baseStopIds = selectRepresentativeRouteStopIds(input.routeStops, routeId);
  const scenarioStopIds = input.scenarioStopIds.map((stationId) => stationId.trim()).filter(Boolean);
  const routeName = firstStop?.routeName ?? routeId;
  const modelVersions = [...new Set([input.beforeOperation.travelTimeModel.modelVersion, input.afterOperation.travelTimeModel.modelVersion])];

  return createScenarioDefinition({
    scenarioId: newScenarioId(),
    label: input.label.trim() || defaultScenarioLabel(routeName, scenarioStopIds, baseStopIds),
    routeChanges: [{
      routeId,
      ...(firstStop?.routeName ? { routeName: firstStop.routeName } : {}),
      ...(firstStop?.transportMode ? { transportMode: firstStop.transportMode } : {}),
      baseStopIds,
      scenarioStopIds,
      beforeOperation: input.beforeOperation,
      afterOperation: input.afterOperation
    }],
    source: {
      ...(input.projectId.trim() ? { projectId: input.projectId.trim() } : {}),
      assumptions: ['선택 노선의 대표 정류장 경로를 현행 기준으로 사용했습니다.'],
      warnings: [],
      modelVersions
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export function preserveLegacyScenarioDefinitions(existing: ScenarioDefinition[], next: ScenarioDefinition): ScenarioDefinition[] {
  return upsertScenarioDefinition(existing, next);
}
