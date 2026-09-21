import { createScenarioDefinition } from '../core/scenario-contract';
import { selectRepresentativeRouteStopIds, upsertScenarioDefinition } from '../core/scenario-editor';
import type { RouteStopMasterRecord, ScenarioAddedRoute, ScenarioAddedStation, ScenarioDefinition, ScenarioOperationPlan, ScenarioRouteChange, ScenarioStationOverride } from '../shared/types';
import { defaultScenarioLabel } from './synthetic-route-scenario';

export interface PrimaryScenarioDefinitionInput {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  routeId: string;
  label: string;
  scenarioStopIds: string[];
  routeChanges?: ScenarioRouteChange[];
  addedStations?: ScenarioAddedStation[];
  stationOverrides?: ScenarioStationOverride[];
  addedRoutes?: ScenarioAddedRoute[];
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
  const routeChanges = input.routeChanges ?? (routeId ? [{
    routeId,
    ...(firstStop?.routeName ? { routeName: firstStop.routeName } : {}),
    ...(firstStop?.transportMode ? { transportMode: firstStop.transportMode } : {}),
    baseStopIds,
    scenarioStopIds,
    beforeOperation: input.beforeOperation,
    afterOperation: input.afterOperation
  }] : []);
  const modelVersions = [...new Set([
    input.beforeOperation.travelTimeModel.modelVersion,
    input.afterOperation.travelTimeModel.modelVersion,
    ...(input.addedRoutes ?? []).map((route) => route.afterOperation.travelTimeModel.modelVersion)
  ])];

  return createScenarioDefinition({
    scenarioId: newScenarioId(),
    label: input.label.trim() || defaultScenarioLabel(input.addedRoutes?.[0]?.routeName ?? routeName, scenarioStopIds, baseStopIds),
    routeChanges,
    ...(input.addedStations?.length ? { addedStations: input.addedStations.map((station) => ({ ...station })) } : {}),
    ...(input.stationOverrides?.length ? { stationOverrides: input.stationOverrides.map((override) => ({ ...override })) } : {}),
    ...(input.addedRoutes?.length ? { addedRoutes: input.addedRoutes.map((route) => ({ ...route, stopIds: [...route.stopIds] })) } : {}),
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
