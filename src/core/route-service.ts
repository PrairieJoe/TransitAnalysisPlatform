import { HOURS, type RouteServiceConfig } from '../shared/types';

export interface RouteServiceOption {
  routeId: string;
  routeName: string;
  transportMode: string;
}

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

export function filterRouteOptions(options: RouteServiceOption[], query: string): RouteServiceOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  if (!normalizedQuery) return options;
  return options.filter((option) => [option.routeName, option.routeId, option.transportMode]
    .some((value) => value.toLocaleLowerCase('ko-KR').includes(normalizedQuery)));
}
