import type { RouteStopMasterRecord } from '../shared/types';

export type ScenarioStopChange = 'unchanged' | 'added' | 'removed' | 'moved';

export interface ScenarioStopRow {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  sequence: number;
  change: ScenarioStopChange;
}

export interface ScenarioRouteEditState {
  routeId: string;
  routeName: string;
  transportMode: string;
  baseStopIds: string[];
  scenarioStopIds: string[];
  label: string;
}

function routeStopsById(routeStops: RouteStopMasterRecord[], routeId: string): Map<string, RouteStopMasterRecord> {
  const records = routeStops
    .filter((stop) => stop.routeId === routeId)
    .sort((left, right) => left.stationSequence - right.stationSequence || left.stationId.localeCompare(right.stationId, 'ko'));
  const byId = new Map<string, RouteStopMasterRecord>();
  for (const record of records) if (!byId.has(record.stationId)) byId.set(record.stationId, record);
  return byId;
}

export function buildScenarioStopRows(routeStops: RouteStopMasterRecord[], routeId: string, baseStopIds: string[], scenarioStopIds: string[]): ScenarioStopRow[] {
  const byId = routeStopsById(routeStops, routeId);
  const baseIndexes = new Map(baseStopIds.map((stationId, index) => [stationId, index]));
  const rows = scenarioStopIds.flatMap((stationId, index) => {
    const record = byId.get(stationId);
    if (!record) return [];
    const baseIndex = baseIndexes.get(stationId);
    const change: ScenarioStopChange = baseIndex === undefined ? 'added' : baseIndex === index ? 'unchanged' : 'moved';
    return [{ stationId, stationName: record.stationName, latitude: record.latitude, longitude: record.longitude, sequence: index + 1, change }];
  });
  const removedRows = baseStopIds.flatMap((stationId, index) => {
    if (scenarioStopIds.includes(stationId)) return [];
    const record = byId.get(stationId);
    if (!record) return [];
    return [{ stationId, stationName: record.stationName, latitude: record.latitude, longitude: record.longitude, sequence: index + 1, change: 'removed' as const }];
  });
  return [...rows, ...removedRows];
}

export function applyScenarioStopEdit(state: ScenarioRouteEditState, action: { type: 'add' | 'remove' | 'move'; stationId: string; targetIndex?: number }): ScenarioRouteEditState {
  const current = state.scenarioStopIds;
  if (action.type === 'add') {
    if (current.includes(action.stationId)) return state;
    return { ...state, scenarioStopIds: [...current, action.stationId] };
  }
  const currentIndex = current.indexOf(action.stationId);
  if (currentIndex < 0) return state;
  if (action.type === 'remove') return { ...state, scenarioStopIds: current.filter((stationId) => stationId !== action.stationId) };
  const requestedIndex = Number.isInteger(action.targetIndex) ? action.targetIndex as number : currentIndex;
  const targetIndex = Math.max(0, Math.min(current.length - 1, requestedIndex));
  if (targetIndex === currentIndex) return state;
  const next = [...current];
  next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, action.stationId);
  return { ...state, scenarioStopIds: next };
}

export function validateScenarioRouteEdit(routeStops: RouteStopMasterRecord[], state: ScenarioRouteEditState): string[] {
  const errors: string[] = [];
  const availableIds = new Set(routeStops.filter((stop) => stop.routeId === state.routeId).map((stop) => stop.stationId));
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const duplicates = new Set<string>();
  for (const stationId of state.scenarioStopIds) {
    if (!availableIds.has(stationId)) unknown.add(stationId);
    if (seen.has(stationId)) duplicates.add(stationId);
    seen.add(stationId);
  }
  if (unknown.size) errors.push(`알 수 없는 정류장 ID가 있습니다: ${[...unknown].join(', ')}`);
  if (duplicates.size) errors.push(`정류장 ID가 중복되었습니다: ${[...duplicates].join(', ')}`);
  if (state.scenarioStopIds.length < 2) errors.push('개편안 정류장은 2개 이상이어야 합니다.');
  return errors;
}

export function defaultScenarioLabel(routeName: string, _scenarioStopIds: string[], _baseStopIds: string[]): string {
  return `${routeName.trim() || '노선'} 정류장 개편안`;
}
