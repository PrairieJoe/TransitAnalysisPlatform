import type { RouteSegmentMetric } from '../../shared/types';

export function createBenchmarkRouteMetrics(segmentCount: number, routeCount = 1): RouteSegmentMetric[] {
  const safeSegmentCount = Math.max(0, Math.floor(segmentCount));
  const safeRouteCount = Math.max(1, Math.floor(routeCount));
  return Array.from({ length: safeSegmentCount }, (_, index) => {
    const routeIndex = index % safeRouteCount;
    const sequence = Math.floor(index / safeRouteCount) + 1;
    const routeId = `benchmark-${routeIndex + 1}`;
    const fromLatitude = 37 + routeIndex * .01 + sequence * .00005;
    const fromLongitude = 127 + routeIndex * .01 + sequence * .00005;
    return {
      routeId,
      routeName: `Benchmark ${routeIndex + 1}`,
      transportMode: 'bus',
      direction: 'forward',
      directionLabel: '순방향',
      fromSequence: sequence,
      toSequence: sequence + 1,
      fromStationId: `${routeId}-station-${sequence}`,
      toStationId: `${routeId}-station-${sequence + 1}`,
      fromStationName: `정류장 ${sequence}`,
      toStationName: `정류장 ${sequence + 1}`,
      fromLatitude,
      fromLongitude,
      toLatitude: fromLatitude + .00005,
      toLongitude: fromLongitude + .00005,
      segmentDistance: 8,
      previousOnboard: index % 25,
      boardings: 5 + (index % 15),
      alightings: index % 5,
      onboardPassengers: 10 + (index % 90),
      peakOnboardPassengers: 10 + (index % 90),
      averageOnboardPassengers: 8 + (index % 60),
      totalBoardings: 100 + index,
      totalAlightings: 20 + index,
      vehicleCapacity: 60,
      dailyTrips: 20,
      congestionPercent: index % 6 === 0 ? null : index % 100,
      rank: index + 1
    } satisfies RouteSegmentMetric;
  });
}
