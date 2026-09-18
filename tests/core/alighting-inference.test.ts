import { describe, expect, it } from 'vitest';
import { effectiveDestinationStationId, inferAlighting, type AlightingInferenceConfig } from '../../src/core/alighting-inference';
import type { NormalizedRecord, RouteStopMasterRecord, StationMasterRecord } from '../../src/shared/types';

const config: AlightingInferenceConfig = {
  primaryDistanceMeters: 500,
  fallbackDistanceMeters: 1000,
  maxTransferMinutes: 30,
  serviceDayBoundaryHour: 4
};

const stations: StationMasterRecord[] = [
  { stationId: 'A', stationName: 'A', latitude: 37, longitude: 127 },
  { stationId: 'B', stationName: 'B', latitude: 37, longitude: 127.004 },
  { stationId: 'C', stationName: 'C', latitude: 37, longitude: 127.005 },
  { stationId: 'D', stationName: 'D', latitude: 37, longitude: 127.009 }
];

const routeStops: RouteStopMasterRecord[] = ['A', 'B', 'C', 'D'].map((stationId, stationSequence) => {
  const station = stations.find((candidate) => candidate.stationId === stationId)!;
  return {
    routeId: 'R1',
    routeName: '1번',
    transportMode: 'B',
    stationSequence,
    stationId,
    stationName: station.stationName,
    latitude: station.latitude,
    longitude: station.longitude
  };
});

function record(overrides: Partial<NormalizedRecord>): NormalizedRecord {
  return { serviceDate: '2024-01-01', boardingCount: 1, ...overrides };
}

describe('inferAlighting', () => {
  it('links a next boarding across midnight within the same service day', () => {
    const records = [
      record({ boardingTime: '23:50:00', virtualCardId: 'CARD-A', route: 'R1', stationId: 'A' }),
      record({ serviceDate: '2024-01-02', boardingTime: '00:10:00', virtualCardId: 'CARD-A', route: 'R1', stationId: 'C' })
    ];

    const result = inferAlighting(records, stations, routeStops, config);

    expect(result.records[0]).toMatchObject({
      inferredDestinationStationId: 'C',
      alightingInference: {
        status: 'inferred-high',
        method: 'next-boarding',
        sourceRecordIndex: 1,
        timeGapMinutes: 20
      }
    });
    expect(result.summary).toMatchObject({ missingBefore: 2, inferredHigh: 1, inferredExpected: 1, unresolved: 0 });
    expect(result.records[1].alightingInference?.method).toBe('route-terminal');
  });

  it('uses the fallback distance band as expected flow, not high confidence', () => {
    const records = [
      record({ boardingTime: '08:00:00', virtualCardId: 'CARD-A', route: 'R1', stationId: 'A' }),
      record({ boardingTime: '08:15:00', virtualCardId: 'CARD-A', route: 'R1', stationId: 'D' })
    ];

    const result = inferAlighting(records, stations, routeStops, config);

    expect(result.records[0].inferredDestinationStationId).toBe('D');
    expect(result.records[0].alightingInference).toMatchObject({ status: 'inferred-expected', distanceMeters: expect.any(Number) });
    expect(result.summary.inferredHigh).toBe(0);
    expect(result.summary.inferredExpected).toBe(1);
  });

  it('keeps observed destinations unchanged and does not expose card identity in the estimate result', () => {
    const records = [record({ virtualCardId: 'CARD-A', stationId: 'A', destinationStationId: 'C' })];

    const result = inferAlighting(records, stations, routeStops, config);

    expect(result.records[0]).toMatchObject({ destinationStationId: 'C', alightingInference: { status: 'observed' } });
    expect(result.records[0].inferredDestinationStationId).toBeUndefined();
    expect(result.coverageRows[0]).not.toHaveProperty('virtualCardId');
  });

  it('uses a downstream terminal for an end-of-chain trip as expected flow', () => {
    const records = [record({ boardingTime: '18:00:00', virtualCardId: 'CARD-A', route: 'R1', stationId: 'B' })];

    const result = inferAlighting(records, stations, routeStops, config);

    expect(result.records[0]).toMatchObject({ inferredDestinationStationId: 'D', alightingInference: { status: 'inferred-expected', method: 'route-terminal' } });
  });

  it('leaves rows without a virtual card or usable time unresolved', () => {
    const result = inferAlighting([
      record({ stationId: 'A' }),
      record({ boardingTime: '09:00:00', stationId: 'A' })
    ], stations, routeStops, config);

    expect(result.summary.unresolved).toBe(2);
    expect(result.records.every((candidate) => candidate.alightingInference?.status === 'unresolved')).toBe(true);
  });
});

describe('effectiveDestinationStationId', () => {
  it('selects only the requested alighting layer', () => {
    const inferred = record({ destinationStationId: undefined, inferredDestinationStationId: 'C', alightingInference: { status: 'inferred-high', method: 'next-boarding', confidence: 0.9 } });
    const expected = { ...inferred, alightingInference: { ...inferred.alightingInference!, status: 'inferred-expected' as const, confidence: 0.6 } };

    expect(effectiveDestinationStationId(inferred, 'observed')).toBeUndefined();
    expect(effectiveDestinationStationId(inferred, 'high-confidence')).toBe('C');
    expect(effectiveDestinationStationId(expected, 'high-confidence')).toBeUndefined();
    expect(effectiveDestinationStationId(expected, 'expected-flow')).toBe('C');
  });
});
