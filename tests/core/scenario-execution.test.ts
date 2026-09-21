import { describe, expect, it } from 'vitest';
import type {
  RouteServiceConfig,
  RouteStopMasterRecord,
  ScenarioDefinition,
  ScenarioOperationPlan,
  ScenarioTravelTimeModel,
  StationMasterRecord
} from '../../src/shared/types';
import { buildScenarioInputFingerprint, materializeScenarioNetworks } from '../../src/core/scenario-execution';

const travelTimeModel: ScenarioTravelTimeModel = {
  modelVersion: 'test-model-1',
  speedsKph: { unknown: 20 },
  intersectionDelaySeconds: 5,
  turnDelaySeconds: 10,
  minimumSegmentSeconds: 30
};

const operation = (headwayMinutes = 20): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '23:00',
  headwayMinutes,
  vehicleCount: 8,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel
});

const stop = (routeId: string, stationId: string, stationSequence: number, latitude: number, longitude: number, serviceDate?: string): RouteStopMasterRecord => ({
  ...(serviceDate ? { serviceDate } : {}),
  routeId,
  routeName: `노선-${routeId}`,
  transportMode: 'BUS',
  stationSequence,
  stationId,
  stationName: `정류장-${stationId}`,
  latitude,
  longitude
});

const serviceConfig = (routeId: string): RouteServiceConfig => ({
  routeId,
  vehicleCapacity: 40,
  tripsByHour: { '07': 4, '08': 5 }
});

const station = (stationId: string): StationMasterRecord => ({
  stationId,
  stationName: `정류장-${stationId}`,
  latitude: 34.758,
  longitude: 127.738
});

const currentStops: RouteStopMasterRecord[] = [
  stop('A', 'a-1', 0, 34.750, 127.730),
  stop('A', 'a-2', 1, 34.755, 127.735),
  stop('A', 'a-3', 2, 34.760, 127.740),
  stop('B', 'b-1', 0, 34.760, 127.740),
  stop('B', 'b-2', 1, 34.765, 127.745),
  stop('C', 'c-1', 0, 34.770, 127.750),
  stop('C', 'c-2', 1, 34.775, 127.755),
  stop('A', 'a-4', 3, 34.765, 127.745)
];

const changedDefinition: ScenarioDefinition = {
  scenarioSchemaVersion: 1,
  scenarioId: 's-1',
  label: 'A와 B 변경',
  routeChanges: [
    {
      routeId: 'A',
      routeName: '노선-A',
      transportMode: 'BUS',
      baseStopIds: ['a-1', 'a-2', 'a-3'],
      scenarioStopIds: ['a-1', 'a-3', 'a-4'],
      beforeOperation: operation(20),
      afterOperation: operation(15)
    },
    {
      routeId: 'B',
      routeName: '노선-B 변경',
      transportMode: 'BUS',
      baseStopIds: ['b-1', 'b-2'],
      scenarioStopIds: ['b-2', 'b-1'],
      beforeOperation: operation(20),
      afterOperation: operation(30)
    }
  ],
  source: { assumptions: [], warnings: [], modelVersions: ['test-model-1'] },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T01:00:00.000Z'
};

describe('scenario execution materialization', () => {
  it('keeps a new route out of before and includes it in after', () => {
    const definition: ScenarioDefinition = {
      ...changedDefinition,
      scenarioSchemaVersion: 3,
      scenarioId: 's-new',
      routeChanges: [],
      addedRoutes: [{
        routeId: 'N-1',
        routeName: '신규 노선',
        transportMode: 'BUS',
        stopIds: ['a-1', 'a-2'],
        afterOperation: operation(12)
      }]
    };
    const result = materializeScenarioNetworks({
      target: { kind: 'scenario', scenarioId: 's-new' },
      routeStops: currentStops,
      stationMaster: [],
      serviceConfigs: [],
      scenarioDefinition: definition
    });

    expect(result.before.routes.some((route) => route.routeId === 'N-1')).toBe(false);
    expect(result.after.routes.find((route) => route.routeId === 'N-1')?.source).toBe('scenario-after');
  });

  it('resolves scenario route changes through stationMaster and addedStations', () => {
    const definition: ScenarioDefinition = {
      ...changedDefinition,
      scenarioSchemaVersion: 3,
      scenarioId: 's-add',
      routeChanges: [{
        ...changedDefinition.routeChanges[0],
        routeId: 'A',
        baseStopIds: ['a-1', 'a-2', 'a-3'],
        scenarioStopIds: ['a-1', 'S4', 'a-2']
      }]
    };
    const result = materializeScenarioNetworks({
      target: { kind: 'scenario', scenarioId: 's-add' },
      routeStops: currentStops,
      stationMaster: [station('S4')],
      serviceConfigs: [],
      scenarioDefinition: definition
    });

    expect(result.after.routes.find((route) => route.routeId === 'A')?.stopRecords.map((stop) => stop.stationId)).toEqual(['a-1', 'S4', 'a-2']);
  });

  it('materializes all routes and applies a multi-route scenario to Before and After', () => {
    const result = materializeScenarioNetworks({
      target: { kind: 'scenario', scenarioId: 's-1' },
      routeStops: currentStops,
      serviceConfigs: [serviceConfig('A'), serviceConfig('B'), serviceConfig('C')],
      scenarioDefinition: changedDefinition
    });

    expect(result.before.routes.map((route) => route.routeId)).toEqual(['A', 'B', 'C']);
    expect(result.before.routes.find((route) => route.routeId === 'A')?.stopRecords.map((item) => item.stationId))
      .toEqual(['a-1', 'a-2', 'a-3']);
    expect(result.after.routes.find((route) => route.routeId === 'A')?.stopRecords.map((item) => item.stationId))
      .toEqual(['a-1', 'a-3', 'a-4']);
    expect(result.after.routes.find((route) => route.routeId === 'B')?.operation.headwayMinutes).toBe(30);
    expect(result.after.routes.find((route) => route.routeId === 'C')?.source).toBe('current');
  });

  it('uses a static representative path before dated paths', () => {
    const datedStops = [
      stop('A', 'dated-1', 0, 34.750, 127.730, '2026-01-01'),
      stop('A', 'dated-2', 1, 34.755, 127.735, '2026-01-01'),
      stop('A', 'static-1', 0, 34.760, 127.740),
      stop('A', 'static-2', 1, 34.765, 127.745)
    ];
    const result = materializeScenarioNetworks({ target: { kind: 'current' }, routeStops: datedStops, serviceConfigs: [serviceConfig('A')] });

    expect(result.before.routes[0].stopRecords.map((item) => item.stationId)).toEqual(['static-1', 'static-2']);
  });

  it('resolves a scenario stop from the route master even when it is only present on a dated path', () => {
    const routeMaster = [
      stop('A', 'a-1', 0, 34.750, 127.730),
      stop('A', 'a-2', 1, 34.755, 127.735),
      stop('A', 'dated-only', 0, 34.760, 127.740, '2026-01-01'),
      stop('A', 'dated-end', 1, 34.765, 127.745, '2026-01-01')
    ];
    const definition = { ...changedDefinition, routeChanges: [{ ...changedDefinition.routeChanges[0], baseStopIds: ['a-1', 'a-2'], scenarioStopIds: ['a-1', 'dated-only'] }] };

    const result = materializeScenarioNetworks({ target: { kind: 'scenario', scenarioId: 's-1' }, routeStops: routeMaster, serviceConfigs: [], scenarioDefinition: definition });

    expect(result.after.routes[0].stopRecords.map((item) => item.stationId)).toEqual(['a-1', 'dated-only']);
  });

  it('marks missing current operations as model-estimated instead of official', () => {
    const result = materializeScenarioNetworks({ target: { kind: 'current' }, routeStops: currentStops.slice(0, 3), serviceConfigs: [] });

    expect(result.before.routes[0].warnings.some((warning) => warning.includes('MODEL_ESTIMATED'))).toBe(true);
    expect(result.before.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a scenario route or stop that is not present in the route master', () => {
    const invalidDefinition = {
      ...changedDefinition,
      routeChanges: [{ ...changedDefinition.routeChanges[0], scenarioStopIds: ['a-1', 'missing-stop'] }]
    };

    expect(() => materializeScenarioNetworks({
      target: { kind: 'scenario', scenarioId: 's-1' },
      routeStops: currentStops,
      serviceConfigs: [],
      scenarioDefinition: invalidDefinition
    })).toThrow(/정류장|노선/);
  });

  it('uses the same fingerprint for reordered input arrays and changes it for environment or coordinate changes', () => {
    const baseInput = {
      target: { kind: 'scenario' as const, scenarioId: 's-1' },
      routeStops: currentStops,
      serviceConfigs: [serviceConfig('B'), serviceConfig('A'), serviceConfig('C')],
      scenarioDefinition: changedDefinition,
      environment: {
        osmPbfFileName: 'yeosu.osm.pbf',
        osmPbfSha256: 'sha-1',
        routingProfile: 'bus' as const,
        travelTimeModelVersion: 'test-model-1',
        motisVersion: '2.11.3'
      }
    };
    const reorderedInput = {
      ...baseInput,
      routeStops: [...currentStops].reverse(),
      serviceConfigs: [...baseInput.serviceConfigs].reverse()
    };

    expect(buildScenarioInputFingerprint(baseInput)).toBe(buildScenarioInputFingerprint(reorderedInput));
    expect(buildScenarioInputFingerprint({ ...baseInput, environment: { ...baseInput.environment, osmPbfSha256: 'sha-2' } }))
      .not.toBe(buildScenarioInputFingerprint(baseInput));
    expect(buildScenarioInputFingerprint({ ...baseInput, stationMaster: [station('S4')] }))
      .not.toBe(buildScenarioInputFingerprint(baseInput));
    expect(buildScenarioInputFingerprint({ ...baseInput, routeStops: currentStops.map((item) => item.stationId === 'a-2' ? { ...item, latitude: item.latitude + 0.001 } : item) }))
      .not.toBe(buildScenarioInputFingerprint(baseInput));
    const overlayInput = {
      ...baseInput,
      scenarioDefinition: {
        ...changedDefinition,
        scenarioSchemaVersion: 3 as const,
        addedStations: [{ stationId: 'S-new', stationName: '신규', latitude: 34.8, longitude: 127.8 }],
        stationOverrides: [{ stationId: 'a-1', latitude: 34.751 }],
        addedRoutes: [{ routeId: 'N-1', routeName: '신규', transportMode: 'BUS', stopIds: ['a-1', 'a-2'], afterOperation: operation() }]
      }
    };
    expect(buildScenarioInputFingerprint(overlayInput)).not.toBe(buildScenarioInputFingerprint(baseInput));
  });
});
