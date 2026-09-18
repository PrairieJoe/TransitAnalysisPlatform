import { describe, expect, it } from 'vitest';
import { analyzeRouteDemandRows, analyzeRouteRecords } from '../../src/core/route-analysis';
import { classifyDataQuality } from '../../src/core/data-quality';
import type { NormalizedRecord, RouteDemandRow, RouteServiceConfig, RouteStopMasterRecord } from '../../src/shared/types';

const stops: RouteStopMasterRecord[] = [
  { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 0, stationId: 'A', stationName: '정류장A', latitude: 34.75, longitude: 127.73, cumulativeDistance: 0 },
  { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 1, stationId: 'B', stationName: '정류장B', latitude: 34.76, longitude: 127.74, cumulativeDistance: 1.2 },
  { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 2, stationId: 'C', stationName: '정류장C', latitude: 34.77, longitude: 127.75, cumulativeDistance: 2.5 },
  { routeId: 'R1', routeName: '노선1', transportMode: 'B', stationSequence: 3, stationId: 'D', stationName: '정류장D', latitude: 34.78, longitude: 127.76, cumulativeDistance: 3.8 }
];

const serviceConfig = (capacity = 10, trips = 2): RouteServiceConfig => ({ routeId: 'R1', vehicleCapacity: capacity, tripsByHour: { '7': trips, '8': trips } });
const config = { filter: { from: '2024-04-15', to: '2024-04-16' }, denominator: 'observed' as const, hour: 7 as const };
const circularStops: RouteStopMasterRecord[] = [
  { routeId: 'C1', routeName: '순환1', transportMode: 'B', stationSequence: 0, stationId: 'A', stationName: '정류장A', latitude: 34.75, longitude: 127.73, cumulativeDistance: 0 },
  { routeId: 'C1', routeName: '순환1', transportMode: 'B', stationSequence: 1, stationId: 'B', stationName: '정류장B', latitude: 34.76, longitude: 127.74, cumulativeDistance: 1.2 },
  { routeId: 'C1', routeName: '순환1', transportMode: 'B', stationSequence: 2, stationId: 'C', stationName: '정류장C', latitude: 34.77, longitude: 127.75, cumulativeDistance: 2.5 },
  { routeId: 'C1', routeName: '순환1', transportMode: 'B', stationSequence: 3, stationId: 'A', stationName: '정류장A', latitude: 34.75, longitude: 127.73, cumulativeDistance: 3.8 }
];

describe('route onboard-load analysis', () => {
  it('calculates onboard load in route sequence order and excludes reverse-order trips', () => {
    const records = classifyDataQuality([
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'R1', vehicleId: 'V1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 5, route: 'R1', vehicleId: 'V1', stationId: 'B', destinationStationId: 'D', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 2, route: 'R1', vehicleId: 'V2', stationId: 'D', destinationStationId: 'A', boardingHour: 7 }
    ], [], stops);
    const result = analyzeRouteRecords(records, stops, [serviceConfig(4)], config);

    const forward = result.stopMetrics.filter((metric) => metric.direction === 'forward');
    expect(forward.map((metric) => [metric.stationId, metric.previousOnboard, metric.boardings, metric.alightings, metric.peakOnboardPassengers])).toEqual([
      ['A', 0, 3, 0, 3],
      ['B', 3, 5, 0, 8],
      ['C', 8, 0, 3, 5],
      ['D', 5, 0, 5, 0]
    ]);
    expect(result.metrics.every((metric) => metric.direction === 'forward')).toBe(true);
    expect(result.summaries[0]).toMatchObject({ routeId: 'R1', direction: 'forward', stationLabel: '정류장B', peakOnboardPassengers: 8, congestionPercent: 200 });
    expect(result.totalBoardings).toBe(8);
    expect(result.excludedRows).toBe(1);
    expect(result.loadBasis).toBe('vehicle');
  });

  it('takes the maximum profile across dates and applies the selected boarding hour', () => {
    const result = analyzeRouteRecords([
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'R1', vehicleId: 'V1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-16', boardingCount: 8, route: 'R1', vehicleId: 'V2', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 99, route: 'R1', vehicleId: 'V1', stationId: 'A', destinationStationId: 'C', boardingHour: 8 }
    ], stops, [serviceConfig(10)], config);

    const atB = result.stopMetrics.find((metric) => metric.direction === 'forward' && metric.stationId === 'B');
    expect(atB?.peakOnboardPassengers).toBe(8);
    expect(atB?.averageOnboardPassengers).toBeCloseTo(5.5);
    expect(atB?.congestionPercent).toBe(80);
    expect(result.totalBoardings).toBe(11);
  });

  it('uses the configured trip count to estimate a vehicle load when vehicle ID is unavailable', () => {
    const result = analyzeRouteRecords([
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 5, route: 'R1', stationId: 'B', destinationStationId: 'D', boardingHour: 7 }
    ], stops, [serviceConfig(10, 2)], { ...config, filter: { ...config.filter, to: '2024-04-15' } });
    const atB = result.stopMetrics.find((metric) => metric.direction === 'forward' && metric.stationId === 'B');
    expect(atB?.peakOnboardPassengers).toBe(7.5);
    expect(atB?.averageOnboardPassengers).toBe(7.5);
    expect(atB?.congestionPercent).toBe(75);
    expect(result.loadBasis).toBe('estimated-average');
    expect(result.warnings.join(' ')).toContain('차량 ID');
  });

  it('uses the selected inferred alighting layer for route load', () => {
    const records: NormalizedRecord[] = [
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', vehicleId: 'V1', stationId: 'A', inferredDestinationStationId: 'C', alightingInference: { status: 'inferred-high', method: 'next-boarding', confidence: 0.9 }, boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 5, route: 'R1', vehicleId: 'V1', stationId: 'B', destinationStationId: 'D', boardingHour: 7 }
    ];
    const observed = analyzeRouteRecords(records, stops, [serviceConfig()], { ...config, alightingMode: 'observed' });
    const inferred = analyzeRouteRecords(records, stops, [serviceConfig()], { ...config, alightingMode: 'high-confidence' });

    expect(observed.totalBoardings).toBe(5);
    expect(inferred.totalBoardings).toBe(15);
    expect(inferred.stopMetrics.find((metric) => metric.stationId === 'C')?.totalAlightings).toBe(10);
  });

  it('averages estimated daily profiles once across multiple dates', () => {
    const result = analyzeRouteRecords([
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-16', boardingCount: 6, route: 'R1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 }
    ], stops, [serviceConfig(10, 2)], config);
    const atB = result.stopMetrics.find((metric) => metric.direction === 'forward' && metric.stationId === 'B');
    expect(atB?.averageOnboardPassengers).toBe(4);
    expect(atB?.peakOnboardPassengers).toBe(5);
  });

  it('keeps load data with missing capacity or invalid rows and warns', () => {
    const result = analyzeRouteRecords([
      { serviceDate: '2024-04-15', boardingCount: 10, route: 'R1', stationId: 'A', destinationStationId: 'B', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 4, route: 'R1', stationId: 'UNKNOWN', destinationStationId: 'B', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'R1', stationId: 'A', destinationStationId: 'B' },
      { serviceDate: '2024-04-15', boardingCount: 2, route: 'R1', stationId: 'A', destinationStationId: 'B', boardingHour: 7 }
    ], stops, [], { ...config, filter: { ...config.filter, to: '2024-04-15' } });
    expect(result.stopMetrics.find((metric) => metric.stationId === 'A')?.congestionPercent).toBeNull();
    expect(result.stopMetrics).toHaveLength(4);
    expect(result.excludedRows).toBe(2);
    expect(result.warnings.join(' ')).toContain('차량 정원');
    expect(result.warnings.join(' ')).toContain('경로에 없어');
    expect(result.warnings.join(' ')).toContain('시간');
  });

  it('resolves circular routes by ordered stop occurrence instead of station ID alone', () => {
    const records = classifyDataQuality([
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'C1', vehicleId: 'V1', stationId: 'B', destinationStationId: 'A', boardingHour: 7 }
    ], [], circularStops);
    const result = analyzeRouteRecords(records, circularStops, [{ routeId: 'C1', vehicleCapacity: 10, tripsByHour: { '7': 1 } }], { ...config, filter: { ...config.filter, to: '2024-04-15' } });

    expect(result.excludedRows).toBe(0);
    expect(result.stopMetrics.filter((metric) => metric.direction === 'reverse')).toHaveLength(0);
    expect(result.stopMetrics.find((metric) => metric.direction === 'forward' && metric.stationSequence === 1)).toMatchObject({ onboardPassengers: 3, peakOnboardPassengers: 3 });
    expect(result.warnings.some((warning) => warning.includes('실제 순번을 특정할 수 없어'))).toBe(false);
  });

  it('silently uses the shortest sequence when repeated stops make a transaction ambiguous', () => {
    const repeatedPath: RouteStopMasterRecord[] = [
      { ...circularStops[0], routeId: 'C2', stationSequence: 0 },
      { ...circularStops[1], routeId: 'C2', stationSequence: 1 },
      { ...circularStops[2], routeId: 'C2', stationSequence: 2 },
      { ...circularStops[0], routeId: 'C2', stationSequence: 3 },
      { ...circularStops[1], routeId: 'C2', stationSequence: 4 }
    ];
    const result = analyzeRouteRecords([
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'C2', vehicleId: 'V1', stationId: 'A', destinationStationId: 'B', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 2, route: 'C2', vehicleId: 'V1', stationId: 'A', destinationStationId: 'B', boardingHour: 7 }
    ], repeatedPath, [{ ...serviceConfig(), routeId: 'C2' }], { ...config, filter: { ...config.filter, to: '2024-04-15' } });

    expect(result.warnings.some((warning) => warning.includes('실제 탑승 순번을 특정할 수 없어'))).toBe(false);
    expect(result.totalBoardings).toBe(5);
  });

  it('does not emit repeated-stop warnings for grouped demand rows', () => {
    const repeatedPath: RouteStopMasterRecord[] = [
      { ...circularStops[0], routeId: 'C3', stationSequence: 0 },
      { ...circularStops[1], routeId: 'C3', stationSequence: 1 },
      { ...circularStops[2], routeId: 'C3', stationSequence: 2 },
      { ...circularStops[0], routeId: 'C3', stationSequence: 3 },
      { ...circularStops[1], routeId: 'C3', stationSequence: 4 }
    ];
    const result = analyzeRouteDemandRows([
      { serviceDate: '2024-04-15', routeId: 'C3', vehicleId: 'V1', originStationId: 'A', destinationStationId: 'B', hour: 7, total: 5, rowCount: 3 } as RouteDemandRow
    ], repeatedPath, [{ ...serviceConfig(), routeId: 'C3' }], { ...config, filter: { ...config.filter, to: '2024-04-15' } });

    expect(result.warnings.some((warning) => warning.includes('실제 탑승 순번을 특정할 수 없어'))).toBe(false);
  });

  it('excludes sequence-error transactions from onboard-load analysis', () => {
    const classified = classifyDataQuality([
      { serviceDate: '2024-04-15', boardingCount: 3, route: 'R1', stationId: 'A', destinationStationId: 'C', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 7, route: 'R1', stationId: 'C', destinationStationId: 'A', boardingHour: 7 },
      { serviceDate: '2024-04-15', boardingCount: 11, route: 'R1', stationId: 'A', destinationStationId: 'A', boardingHour: 7 }
    ], [], stops);
    const result = analyzeRouteRecords(classified, stops, [serviceConfig()], { ...config, filter: { ...config.filter, to: '2024-04-15' } });

    expect(classified.map((record) => record.qualityErrors)).toEqual([[], ['경유정류장순번오류'], ['경유정류장순번오류']]);
    expect(result.totalBoardings).toBe(3);
    expect(result.excludedRows).toBe(2);
  });
});
