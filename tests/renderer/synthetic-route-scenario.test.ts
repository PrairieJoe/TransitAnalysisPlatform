import { describe, expect, it } from 'vitest';
import type { RouteStopMasterRecord } from '../../src/shared/types';
import { applyScenarioStopEdit, buildScenarioStopRows, defaultScenarioLabel, validateScenarioRouteEdit, type ScenarioRouteEditState } from '../../src/renderer/synthetic-route-scenario';

const fixtureStops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 1, stationId: 'A', stationName: 'A 정류장', latitude: 37.1, longitude: 127.1 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 2, stationId: 'B', stationName: 'B 정류장', latitude: 37.2, longitude: 127.2 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 3, stationId: 'C', stationName: 'C 정류장', latitude: 37.3, longitude: 127.3 },
  { routeId: 'R1', routeName: '101번', transportMode: '버스', stationSequence: 4, stationId: 'D', stationName: 'D 정류장', latitude: 37.4, longitude: 127.4 },
  { routeId: 'R2', routeName: '202번', transportMode: '버스', stationSequence: 1, stationId: 'X', stationName: 'X 정류장', latitude: 38.1, longitude: 128.1 }
];

const state: ScenarioRouteEditState = {
  routeId: 'R1',
  routeName: '101번',
  transportMode: '버스',
  baseStopIds: ['A', 'B', 'C'],
  scenarioStopIds: ['A', 'B', 'C'],
  label: ''
};

describe('synthetic route scenario model', () => {
  it('marks a stop moved when its order changes', () => {
    const rows = buildScenarioStopRows(fixtureStops, 'R1', ['A', 'B', 'C'], ['B', 'A', 'C']);

    expect(rows.map((row) => row.change)).toEqual(['moved', 'moved', 'unchanged']);
    expect(rows.map((row) => row.stationId)).toEqual(['B', 'A', 'C']);
  });

  it('marks additions and appends removed base stops after active scenario rows', () => {
    const rows = buildScenarioStopRows(fixtureStops, 'R1', ['A', 'B', 'C'], ['A', 'D', 'C']);

    expect(rows.map((row) => [row.stationId, row.change])).toEqual([
      ['A', 'unchanged'],
      ['D', 'added'],
      ['C', 'unchanged'],
      ['B', 'removed']
    ]);
  });

  it('supports add, remove, and bounded move actions without mutating state', () => {
    const added = applyScenarioStopEdit(state, { type: 'add', stationId: 'D' });
    const moved = applyScenarioStopEdit(added, { type: 'move', stationId: 'D', targetIndex: 1 });
    const removed = applyScenarioStopEdit(moved, { type: 'remove', stationId: 'B' });

    expect(state.scenarioStopIds).toEqual(['A', 'B', 'C']);
    expect(removed.scenarioStopIds).toEqual(['A', 'D', 'C']);
    expect(applyScenarioStopEdit(state, { type: 'add', stationId: 'A' })).toBe(state);
  });

  it('validates unknown IDs, duplicates, and too-short scenarios', () => {
    const errors = validateScenarioRouteEdit(fixtureStops, { ...state, scenarioStopIds: ['A', 'A', 'UNKNOWN'] });
    const shortErrors = validateScenarioRouteEdit(fixtureStops, { ...state, scenarioStopIds: ['A'] });

    expect(errors.some((error) => error.includes('알 수 없는'))).toBe(true);
    expect(errors.some((error) => error.includes('중복'))).toBe(true);
    expect(shortErrors.some((error) => error.includes('2개'))).toBe(true);
  });

  it('returns an automatic label for a blank scenario label', () => {
    expect(defaultScenarioLabel('101번', ['A', 'X', 'C'], ['A', 'B', 'C'])).toBe('101번 정류장 개편안');
  });
});
