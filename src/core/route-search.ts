import { materializeScenarioNetworks } from './scenario-execution';
import { buildSyntheticGtfsNetwork } from './synthetic-gtfs/network-builder';
import type { SyntheticGtfsBuildResult } from './synthetic-gtfs/types';
import type { RouteServiceConfig, RouteStopMasterRecord, StationMasterRecord } from '../shared/types';

export interface CurrentRouteSearchGtfsInput {
  routeStops: RouteStopMasterRecord[];
  stationMaster?: StationMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
}

export function buildCurrentRouteSearchGtfs(input: CurrentRouteSearchGtfsInput): SyntheticGtfsBuildResult {
  const networks = materializeScenarioNetworks({
    target: { kind: 'current' },
    routeStops: input.routeStops,
    stationMaster: input.stationMaster,
    serviceConfigs: input.serviceConfigs
  });
  return buildSyntheticGtfsNetwork({
    routes: networks.before.routes,
    agencyId: 'tap-route-search',
    agencyName: '현행 네트워크 경로탐색',
    sourceName: '프로젝트 현행 노선정보'
  });
}
