import { describe, expect, it, vi } from 'vitest';
import { createJobManager } from '../../src/main/job-manager';
import { createScenarioJourneyJobHandlers, type ScenarioJourneyJobRequest } from '../../src/main/scenario-journey-job';
import type { ScenarioJourneyEnvironment, ScenarioJourneyExecutionManifest, ScenarioJourneyResult } from '../../src/core/scenario-journey';
import type { MotisSidecarOptions } from '../../src/main/motis-sidecar';
import type { JobProgress } from '../../src/shared/job-types';
import type { RouteStopMasterRecord, ScenarioJourneyEndpoint } from '../../src/shared/types';

const stops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '1번', transportMode: 'bus', stationSequence: 1, stationId: 'S1', stationName: '출발', latitude: 34.7, longitude: 127.7 },
  { routeId: 'R1', routeName: '1번', transportMode: 'bus', stationSequence: 2, stationId: 'S2', stationName: '도착', latitude: 34.71, longitude: 127.71 }
];

const endpoint = (latitude: number, longitude: number): ScenarioJourneyEndpoint => ({ kind: 'coordinate', latitude, longitude });

const request = (overrides: Partial<ScenarioJourneyJobRequest> = {}): ScenarioJourneyJobRequest => ({
  jobId: 'journey-job-1',
  executionId: 'journey-execution-1',
  projectId: 'project-1',
  before: { kind: 'current' },
  after: { kind: 'scenario', scenarioId: 'scenario-1' },
  routeStops: stops,
  serviceConfigs: [],
  scenarioDefinitions: [{
    scenarioSchemaVersion: 2,
    scenarioId: 'scenario-1',
    label: 'After',
    routeChanges: [{
      routeId: 'R1',
      baseStopIds: ['S1', 'S2'],
      scenarioStopIds: ['S1', 'S2'],
      beforeOperation: { serviceDays: [1], firstDeparture: '06:00', lastDeparture: '22:00', headwayMinutes: 20, vehicleCount: 1, dwellSeconds: 20, startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: false, travelTimeModel: { modelVersion: 'test', speedsKph: { unknown: 15 }, intersectionDelaySeconds: 0, turnDelaySeconds: 0, minimumSegmentSeconds: 1 } },
      afterOperation: { serviceDays: [1], firstDeparture: '06:00', lastDeparture: '22:00', headwayMinutes: 10, vehicleCount: 1, dwellSeconds: 20, startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: false, travelTimeModel: { modelVersion: 'test', speedsKph: { unknown: 15 }, intersectionDelaySeconds: 0, turnDelaySeconds: 0, minimumSegmentSeconds: 1 } }
    }],
    source: { assumptions: [], warnings: [], modelVersions: ['test'] },
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z'
  }],
  queries: [{ origin: endpoint(34.7, 127.7), destination: endpoint(34.71, 127.71), departureDateTime: '2026-09-21T08:00' }],
  osmPbfPath: 'C:\\data\\yeosu.osm.pbf',
  now: '2026-09-21T00:00:00.000Z',
  ...overrides
});

function journeyResponse(totalSeconds = 900): unknown {
  return { itineraries: [{ duration: totalSeconds, transfers: 0, legs: [{ mode: 'BUS', duration: totalSeconds, from: { stopId: 'S1' }, to: { stopId: 'S2' } }] }] };
}

function dependencies() {
  const events: Array<{ side: string; action: string }> = [];
  const progress: JobProgress[] = [];
  const saved: ScenarioJourneyExecutionManifest[] = [];
  const results = new Map<string, ScenarioJourneyResult>();
  let side = 'unknown';
  const store = {
    listScenarioJourneyManifests: vi.fn(async () => saved),
    saveScenarioJourney: vi.fn(async (payload: { manifest: ScenarioJourneyExecutionManifest; result: ScenarioJourneyResult }) => {
      saved.push(payload.manifest);
      results.set(payload.manifest.executionId, payload.result);
      return payload.manifest;
    }),
    readScenarioJourney: vi.fn(async (payload: { executionId: string }) => results.get(payload.executionId)!)
  };
  const motisFactory = vi.fn(() => ({
    start: vi.fn(async (_options: MotisSidecarOptions) => { events.push({ side, action: 'start' }); return { state: 'ready' as const }; }),
    request: vi.fn(async () => { events.push({ side, action: 'request' }); return journeyResponse(); }),
    stop: vi.fn(async () => { events.push({ side, action: 'stop' }); })
  }));
  const prepareSnapshot = vi.fn(async (input: { side: string }) => { side = input.side; events.push({ side, action: 'prepare' }); return {} as MotisSidecarOptions; });
  const resolveEnvironment = vi.fn(async (): Promise<ScenarioJourneyEnvironment> => ({
    osmPbfSha256: 'pbf-hash',
    motisBinarySha256: 'binary-hash',
    motisManifestSchemaVersion: 2,
    pedestrianProfile: 'FOOT',
    maxTransfers: 3,
    maxPreTransitTimeSeconds: 900,
    maxPostTransitTimeSeconds: 900,
    maxMatchingDistanceMeters: 250
  }));
  const jobs = createJobManager({ emit: (nextProgress) => progress.push(nextProgress) });
  return { events, progress, saved, results, store, motisFactory, prepareSnapshot, resolveEnvironment, jobs };
}

describe('scenario journey job', () => {
  it('runs Before and After sequentially and persists a complete bounded result', async () => {
    const deps = dependencies();
    const handlers = createScenarioJourneyJobHandlers(deps);
    const started = await handlers.run(request());
    await handlers.waitForIdle(started.jobId);

    expect(deps.events.map((event) => `${event.side}:${event.action}`)).toEqual([
      'before:prepare', 'before:start', 'before:request', 'before:stop',
      'after:prepare', 'after:start', 'after:request', 'after:stop'
    ]);
    expect(deps.store.saveScenarioJourney).toHaveBeenCalledOnce();
    expect(deps.saved[0]).toMatchObject({ status: 'complete', queryCount: 1, foundBeforeCount: 1, foundAfterCount: 1 });
  });

  it('keeps a failed query as a partial result and continues the remaining queries', async () => {
    const deps = dependencies();
    const requestWithTwo = request({ queries: [request().queries[0], { ...request().queries[0], destination: endpoint(34.72, 127.72) }] });
    let calls = 0;
    deps.motisFactory.mockImplementation(() => ({
      start: vi.fn(async () => ({ state: 'ready' as const })),
      request: vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('route unavailable'); return journeyResponse(1200); }),
      stop: vi.fn(async () => undefined)
    }));
    const handlers = createScenarioJourneyJobHandlers(deps);
    const started = await handlers.run(requestWithTwo);
    await handlers.waitForIdle(started.jobId);

    expect(deps.saved[0]).toMatchObject({ status: 'partial', queryCount: 2, foundBeforeCount: 1, foundAfterCount: 2 });
    expect(deps.results.get(deps.saved[0].executionId)?.warnings.join(' ')).toContain('route unavailable');
  });

  it('cancels after a sidecar stops and does not publish a result artifact', async () => {
    const deps = dependencies();
    deps.motisFactory.mockImplementation(() => ({
      start: vi.fn(async () => ({ state: 'ready' as const })),
      request: vi.fn(async () => journeyResponse()),
      stop: vi.fn(async () => { deps.jobs.cancel('journey-job-1'); })
    }));
    const handlers = createScenarioJourneyJobHandlers(deps);
    const started = await handlers.run(request());

    await expect(handlers.waitForIdle(started.jobId)).rejects.toThrow('journey-job-1');
    expect(deps.store.saveScenarioJourney).not.toHaveBeenCalled();
    expect(deps.prepareSnapshot).toHaveBeenCalledOnce();
  });

  it('reuses a complete matching fingerprint without preparing either side again', async () => {
    const deps = dependencies();
    const handlers = createScenarioJourneyJobHandlers(deps);
    await handlers.run(request());
    await handlers.waitForIdle('journey-job-1');
    await handlers.run(request({ jobId: 'journey-job-2' }));
    await handlers.waitForIdle('journey-job-2');

    expect(deps.prepareSnapshot).toHaveBeenCalledTimes(2);
    expect(deps.store.saveScenarioJourney).toHaveBeenCalledOnce();
  });

  it('publishes the reused execution id so the renderer opens the existing artifact', async () => {
    const deps = dependencies();
    const handlers = createScenarioJourneyJobHandlers(deps);
    await handlers.run(request());
    await handlers.waitForIdle('journey-job-1');
    await handlers.run(request({ jobId: 'journey-job-2', executionId: 'journey-execution-2' }));
    await handlers.waitForIdle('journey-job-2');

    const completed = deps.progress.filter((progress) => progress.jobId === 'journey-job-2' && progress.status === 'completed').at(-1);
    expect(completed?.executionId).toBe('journey-execution-1');
  });
});
