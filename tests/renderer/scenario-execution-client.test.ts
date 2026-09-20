import { describe, expect, it, vi } from 'vitest';
import { runScenarioExecution } from '../../src/renderer/scenario-execution-client';
import type { RouteServiceConfig, RouteStopMasterRecord, ScenarioExecutionManifest } from '../../src/shared/types';

const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 0, stationId: 'A-1', stationName: 'A-1', latitude: 34.75, longitude: 127.73 },
  { routeId: 'A', routeName: '노선-A', transportMode: 'BUS', stationSequence: 1, stationId: 'A-2', stationName: 'A-2', latitude: 34.76, longitude: 127.74 }
];
const serviceConfigs: RouteServiceConfig[] = [{ routeId: 'A', vehicleCapacity: 40, tripsByHour: { '7': 4 } }];
const input = { projectId: 'project-1', target: { kind: 'current' as const }, routeStops, serviceConfigs, now: '2026-09-20T03:00:00.000Z' };

function makeApi() {
  const saved: ScenarioExecutionManifest[] = [];
  const api = {
    selectMotisOsmPbf: vi.fn(async () => ({ path: 'C:\\data\\yeosu.osm.pbf', fileName: 'yeosu.osm.pbf', sizeBytes: 10, sha256: 'sha-1' })),
    listScenarioExecutionManifests: vi.fn(async () => saved),
    prepareMotis: vi.fn(async () => ({ archivePath: 'archive', message: 'prepared' })),
    startMotis: vi.fn(async () => ({ state: 'ready' as const, message: 'ready' })),
    requestMotis: vi.fn(async (_path: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { way: 123 }, geometry: { type: 'LineString', coordinates: [[body.start.lng, body.start.lat], [(body.start.lng + body.destination.lng) / 2, (body.start.lat + body.destination.lat) / 2], [body.destination.lng, body.destination.lat]] } }] };
    }),
    stopMotis: vi.fn(async () => ({ state: 'stopped' as const })),
    saveScenarioExecution: vi.fn(async (payload: { manifest: ScenarioExecutionManifest }) => { saved.push(payload.manifest); return payload.manifest; })
  };
  return { api, saved };
}

describe('scenario execution client', () => {
  it('checks environment, prepares both snapshots, routes them, and saves one result', async () => {
    const { api } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    const progress: string[] = [];
    try {
      const result = await runScenarioExecution(input, (item) => progress.push(item.phase));

      expect(api.selectMotisOsmPbf).toHaveBeenCalledTimes(1);
      expect(api.prepareMotis).toHaveBeenCalledTimes(2);
      expect(api.startMotis).toHaveBeenCalledTimes(2);
      expect(api.requestMotis).toHaveBeenCalled();
      expect(api.saveScenarioExecution).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('complete');
      expect(progress).toEqual(['validating', 'preparing-before', 'routing-before', 'preparing-after', 'routing-after', 'saving', 'complete']);
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('reuses a complete matching manifest without preparing MOTIS again', async () => {
    const { api, saved } = makeApi();
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: api } });
    try {
      const first = await runScenarioExecution(input);
      const prepareCount = api.prepareMotis.mock.calls.length;
      api.listScenarioExecutionManifests.mockResolvedValue(saved);
      const second = await runScenarioExecution(input);

      expect(second).toEqual(first);
      expect(api.prepareMotis).toHaveBeenCalledTimes(prepareCount);
      expect(api.saveScenarioExecution).toHaveBeenCalledTimes(1);
    } finally { Object.assign(globalThis, { window: previous }); }
  });

  it('rejects outside the desktop runtime without pretending a path was generated', async () => {
    const previous = globalThis.window;
    Object.assign(globalThis, { window: { transitDesktop: undefined } });
    try {
      await expect(runScenarioExecution(input)).rejects.toThrow(/데스크톱|MOTIS/);
    } finally { Object.assign(globalThis, { window: previous }); }
  });
});
