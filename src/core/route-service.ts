import { HOURS, type RouteServiceConfig } from '../shared/types';

function normalizedTrips(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function applyTripsToAllRoutes(configs: RouteServiceConfig[], routeIds: string[], trips: number): RouteServiceConfig[] {
  const tripCount = normalizedTrips(trips);
  const targetIds = new Set(routeIds);
  const tripsByHour = Object.fromEntries(HOURS.map((hour) => [String(hour), tripCount]));
  const existingIds = new Set(configs.map((config) => config.routeId));
  const updated = configs.map((config) => targetIds.has(config.routeId)
    ? { ...config, tripsByHour: { ...tripsByHour } }
    : config);

  for (const routeId of routeIds) {
    if (!existingIds.has(routeId)) updated.push({ routeId, vehicleCapacity: 0, tripsByHour: { ...tripsByHour } });
  }
  return updated;
}
