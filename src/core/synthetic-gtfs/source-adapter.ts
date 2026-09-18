import type { RouteServiceConfig, RouteStopMasterRecord } from '../../shared/types';
import { createProvenance, withAssumptions } from './provenance';
import type { SyntheticDirection, SyntheticRoute, SyntheticServicePlan, SyntheticSourceAdapterOptions, SyntheticStop } from './types';

const TIME_PATTERN = /^\d{1,2}:\d{2}$/;

function assertTime(value: string, label: string): void {
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!TIME_PATTERN.test(value) || !Number.isInteger(hours) || hours < 0 || hours > 47 || minutes < 0 || minutes > 59) {
    throw new Error(`${label} 시간이 유효하지 않습니다: ${value}`);
  }
}

function assertSourceOptions(options: SyntheticSourceAdapterOptions): void {
  if (!options.agencyId.trim() || !options.agencyName.trim()) throw new Error('기관 ID와 기관명은 필수입니다.');
  if (!options.sourceName.trim()) throw new Error('원천자료명이 필요합니다.');
  if (!options.serviceDays.length || options.serviceDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('운행 요일이 유효하지 않습니다.');
  }
  assertTime(options.firstDeparture, '첫차');
  assertTime(options.lastDeparture, '막차');
  if (options.headwayMinutes !== undefined && (!Number.isFinite(options.headwayMinutes) || options.headwayMinutes <= 0)) {
    throw new Error('배차간격은 0보다 커야 합니다.');
  }
  if (options.headwayMinutes !== undefined && !Number.isInteger(options.headwayMinutes)) {
    throw new Error('배차간격은 1분 이상의 정수여야 합니다.');
  }
  if (options.vehicleCount !== undefined && (!Number.isInteger(options.vehicleCount) || options.vehicleCount <= 0)) {
    throw new Error('운행대수는 1 이상의 정수여야 합니다.');
  }
}

function fleetAssumption(vehicleCount: number | undefined): string | undefined {
  return vehicleCount === undefined ? undefined : `운행대수 ${vehicleCount}대는 사용자 입력 가정이며 실제 차량별 배차·회차는 검증하지 않았습니다.`;
}

function transportMode(value: string): 'BUS' | 'COACH' {
  const normalized = value.trim().toLowerCase();
  return /coach|고속|시외/.test(normalized) ? 'COACH' : 'BUS';
}

function assertStop(stop: RouteStopMasterRecord): void {
  if (!stop.routeId.trim()) throw new Error('노선 ID가 비어 있습니다.');
  if (!stop.stationId.trim()) throw new Error('정류장 ID가 비어 있습니다.');
  if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude) || stop.latitude < -90 || stop.latitude > 90 || stop.longitude < -180 || stop.longitude > 180) {
    throw new Error(`정류장 ${stop.stationId}의 좌표가 유효하지 않습니다.`);
  }
  if (!Number.isInteger(stop.stationSequence) || stop.stationSequence < 0) throw new Error(`정류장 ${stop.stationId}의 순번이 유효하지 않습니다.`);
}

function serviceCount(routeId: string, serviceConfigs: RouteServiceConfig[], options: SyntheticSourceAdapterOptions): { count: number; provenance: ReturnType<typeof createProvenance> } {
  const explicitCount = options.departureCountByRoute[routeId];
  if (explicitCount !== undefined) {
    if (!Number.isInteger(explicitCount) || explicitCount < 0) throw new Error(`${routeId} 운행횟수는 0 이상의 정수여야 합니다.`);
    return {
      count: explicitCount,
      provenance: createProvenance(options.serviceSourceType === 'OFFICIAL' ? 'OFFICIAL' : 'USER_INPUT', 'medium', {
        sourceName: options.sourceName,
        assumptions: ['방향별 편도 출발횟수로 입력했습니다.', ...(fleetAssumption(options.vehicleCount) ? [fleetAssumption(options.vehicleCount)!] : [])]
      })
    };
  }

  const config = serviceConfigs.find((item) => item.routeId === routeId);
  const count = config ? Object.values(config.tripsByHour).reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0), 0) : 0;
  return {
    count,
    provenance: createProvenance('DERIVED', count > 0 ? 'medium' : 'low', {
      sourceName: config ? 'RouteServiceConfig' : undefined,
      assumptions: config ? ['기존 시간대별 운행횟수 합계에서 방향별 일 운행횟수를 파생했습니다.'] : ['운행횟수 자료가 없어 0회로 두었습니다.']
    })
  };
}

function createServicePlan(routeId: string, directionId: string, count: number, countProvenance: ReturnType<typeof createProvenance>, options: SyntheticSourceAdapterOptions, derivedReverse: boolean): SyntheticServicePlan {
  const provenance = derivedReverse
    ? withAssumptions(countProvenance, '원본 방향의 운행계획을 역방향에 파생했습니다.')
    : countProvenance;
  return {
    serviceId: `${routeId}-${directionId}-service`,
    serviceDays: [...options.serviceDays],
    firstDeparture: options.firstDeparture,
    lastDeparture: options.lastDeparture,
    headwayMinutes: options.headwayMinutes,
    departureCount: count,
    sourceType: derivedReverse ? 'INFERRED' : options.serviceSourceType ?? 'USER_INPUT',
    provenance
  };
}

function createStops(records: RouteStopMasterRecord[], sourceName: string, sequenceAssumption?: string): SyntheticStop[] {
  return records.map((record) => ({
    stopId: record.stationId,
    stopName: record.stationName,
    latitude: record.latitude,
    longitude: record.longitude,
    stopSequence: record.stationSequence,
    timepoint: record.stationSequence === 1 || record.stationSequence === records.length,
    provenance: createProvenance('OFFICIAL', 'high', {
      sourceName,
      assumptions: ['정류장 좌표와 순서는 원천 노선자료를 사용했습니다.', ...(sequenceAssumption ? [sequenceAssumption] : [])]
    })
  }));
}

export function adaptRouteMasterToSynthetic(
  routeStops: RouteStopMasterRecord[],
  serviceConfigs: RouteServiceConfig[],
  options: SyntheticSourceAdapterOptions
): SyntheticRoute[] {
  assertSourceOptions(options);
  const grouped = new Map<string, RouteStopMasterRecord[]>();
  for (const record of routeStops) {
    assertStop(record);
    const current = grouped.get(record.routeId) ?? [];
    current.push(record);
    grouped.set(record.routeId, current);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([routeId, records]) => {
    const sorted = [...records].sort((left, right) => left.stationSequence - right.stationSequence);
    if (sorted.length < 2) throw new Error(`${routeId} 노선의 정류장이 2개 미만입니다.`);
    if (new Set(sorted.map((record) => record.stationSequence)).size !== sorted.length) throw new Error(`${routeId} 노선의 정류장 순번이 중복되었습니다.`);
    const zeroBasedSequence = sorted[0].stationSequence === 0;
    const sequenceAssumption = zeroBasedSequence ? '기존 노선자료의 0-based 정류장 순번을 1-based로 정규화했습니다.' : undefined;
    const normalized = zeroBasedSequence ? sorted.map((record) => ({ ...record, stationSequence: record.stationSequence + 1 })) : sorted;
    const stationRecords = new Map<string, RouteStopMasterRecord>();
    const repeatedStationIds = new Set<string>();
    for (const record of sorted) {
      const first = stationRecords.get(record.stationId);
      if (first && (first.stationName !== record.stationName || first.latitude !== record.latitude || first.longitude !== record.longitude)) {
        throw new Error(`${routeId} 노선의 정류장 ID ${record.stationId} 정보가 일치하지 않습니다.`);
      }
      if (first) repeatedStationIds.add(record.stationId);
      else stationRecords.set(record.stationId, record);
    }
    const repeatedStationAssumption = repeatedStationIds.size
      ? `동일 정류장 ID ${repeatedStationIds.size}개가 경로 순서상 반복되어 stop_times에 순서별로 유지했습니다.`
      : undefined;

    const { count, provenance: countProvenance } = serviceCount(routeId, serviceConfigs, options);
    const routeSourceType = options.routeSourceType ?? 'OFFICIAL';
    const routeProvenance = createProvenance(routeSourceType, routeSourceType === 'OFFICIAL' ? 'high' : 'medium', {
      sourceName: options.sourceName,
      assumptions: ['노선·정류장 자료를 Synthetic 입력 모델로 변환했습니다.', ...(options.routeAssumptions ?? []), ...(fleetAssumption(options.vehicleCount) ? [fleetAssumption(options.vehicleCount)!] : []), ...(repeatedStationAssumption ? [repeatedStationAssumption] : [])]
    });
    const forwardStops = createStops(normalized, options.sourceName, sequenceAssumption);
    const forward: SyntheticDirection = {
      directionId: `${routeId}-forward`,
      directionLabel: '상행',
      stops: forwardStops,
      servicePlans: [createServicePlan(routeId, 'forward', count, countProvenance, options, false)],
      provenance: routeProvenance
    };
    const directions = [forward];
    if (options.deriveReverseDirection) {
      const reverseProvenance = createProvenance('DERIVED', 'low', {
        sourceName: options.sourceName,
        assumptions: ['원본 방향 정보가 없어 정류장 순서를 역순으로 파생했습니다.']
      });
      const reverse: SyntheticDirection = {
        directionId: `${routeId}-reverse`,
        directionLabel: '하행(파생)',
        stops: [...forwardStops].reverse().map((stop, index, stops) => ({
          ...stop,
          stopSequence: index + 1,
          timepoint: index === 0 || index === stops.length - 1,
          provenance: withAssumptions(stop.provenance, '정류장 순서를 역방향으로 파생했습니다.')
        })),
        servicePlans: [createServicePlan(routeId, 'reverse', count, countProvenance, options, true)],
        provenance: reverseProvenance
      };
      directions.push(reverse);
    }
    return {
      routeId,
      routeName: normalized[0].routeName,
      transportMode: transportMode(normalized[0].transportMode),
      directions,
      provenance: sequenceAssumption ? withAssumptions(routeProvenance, sequenceAssumption) : routeProvenance
    };
  });
}
