import { describe, expect, it } from 'vitest';
import { HOURS, type RouteServiceConfig } from '../../src/shared/types';
import { applyTripsToAllRoutes } from '../../src/core/route-service';

describe('route service configuration', () => {
  it('applies one trip count to every hour of every selected route and preserves capacity', () => {
    const configs: RouteServiceConfig[] = [
      { routeId: 'R1', vehicleCapacity: 45, tripsByHour: { '7': 3 } },
      { routeId: 'R2', vehicleCapacity: 30, tripsByHour: { '7': 2 } },
      { routeId: 'OTHER', vehicleCapacity: 20, tripsByHour: { '7': 1 } }
    ];

    const result = applyTripsToAllRoutes(configs, ['R1', 'R2'], 6);

    expect(result.find((config) => config.routeId === 'R1')).toEqual({
      routeId: 'R1',
      vehicleCapacity: 45,
      tripsByHour: Object.fromEntries(HOURS.map((hour) => [String(hour), 6]))
    });
    expect(result.find((config) => config.routeId === 'R2')?.vehicleCapacity).toBe(30);
    expect(result.find((config) => config.routeId === 'OTHER')).toEqual(configs[2]);
  });

  it('creates missing route configurations and clamps the bulk value to a valid count', () => {
    const result = applyTripsToAllRoutes([], ['R1'], -4.8);

    expect(result).toEqual([{ routeId: 'R1', vehicleCapacity: 0, tripsByHour: Object.fromEntries(HOURS.map((hour) => [String(hour), 0])) }]);
  });
});
