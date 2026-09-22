import { describe, expect, it } from 'vitest';
import { buildRouteSearchMapModel, validateRouteSearchEndpoints } from '../../src/core/route-search-map';
import type { NormalizedJourney } from '../../src/core/transit-comparison';
import type { ScenarioJourneyEndpoint } from '../../src/shared/types';

function journey(legs: NormalizedJourney['legs']): NormalizedJourney {
  return {
    found: true, totalSeconds: 900, accessWalkSeconds: 0, egressWalkSeconds: 0, initialWaitSeconds: 0, transferWaitSeconds: 0,
    transferWalkSeconds: 0, accessWalkMeters: 0, transferWalkMeters: 0, egressWalkMeters: 0, directWalkSeconds: 0, directWalkMeters: 0,
    transferCount: 0, inVehicleSeconds: 900, walkMeters: 0, legs, warnings: []
  };
}

const stopCoordinates = new Map([
  ['S1', { latitude: 37.1, longitude: 127.1 }],
  ['S2', { latitude: 37.2, longitude: 127.2 }]
]);

describe('route search map model', () => {
  it('uses returned geometry for route overlays and preserves alternatives', () => {
    const origin: ScenarioJourneyEndpoint = { kind: 'stop', stopId: 'S1' };
    const destination: ScenarioJourneyEndpoint = { kind: 'stop', stopId: 'S2' };
    const model = buildRouteSearchMapModel({
      journeys: [
        journey([{ mode: 'BUS', routeId: 'R1', boardStopId: 'S1', alightStopId: 'S2', rideSeconds: 900, waitSeconds: 0, walkSeconds: 0, walkMeters: 0, geometry: [{ latitude: 37.1, longitude: 127.1 }, { latitude: 37.15, longitude: 127.15 }, { latitude: 37.2, longitude: 127.2 }] }]),
        journey([{ mode: 'BUS', routeId: 'R2', boardStopId: 'S1', alightStopId: 'S2', rideSeconds: 900, waitSeconds: 0, walkSeconds: 0, walkMeters: 0 }])
      ],
      origin,
      destination,
      stopCoordinates
    });

    expect(model.routes).toHaveLength(2);
    expect(model.routes[0].legs[0].geometrySource).toBe('motis');
    expect(model.routes[0].legs[0].points).toHaveLength(3);
    expect(model.routes[1].legs[0].geometrySource).toBe('stop-coordinates');
    expect(model.routes[1].legs[0].qualityMessage).toContain('정류장 좌표 연결선');
    expect(model.selectedRouteId).toBe(model.routes[0].id);
  });

  it('rejects missing or identical endpoints before MOTIS runs', () => {
    expect(validateRouteSearchEndpoints(undefined, { kind: 'stop', stopId: 'S2' })).toContain('출발지');
    expect(validateRouteSearchEndpoints({ kind: 'stop', stopId: 'S1' }, { kind: 'stop', stopId: 'S1' })).toContain('달라야');
    expect(validateRouteSearchEndpoints({ kind: 'coordinate', latitude: 37.1, longitude: 127.1 }, { kind: 'coordinate', latitude: 37.1, longitude: 127.1 })).toContain('달라야');
  });
});
