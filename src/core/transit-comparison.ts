export interface NormalizedJourneyLeg {
  mode: string;
  routeId?: string;
  boardStopId?: string;
  alightStopId?: string;
  geometry?: Array<{ latitude: number; longitude: number }>;
  rideSeconds: number;
  waitSeconds: number;
  walkSeconds: number;
  walkMeters: number;
}

export interface NormalizedJourney {
  found: boolean;
  totalSeconds: number;
  accessWalkSeconds: number;
  egressWalkSeconds: number;
  initialWaitSeconds: number;
  transferWaitSeconds: number;
  transferWalkSeconds: number;
  accessWalkMeters: number;
  transferWalkMeters: number;
  egressWalkMeters: number;
  directWalkSeconds: number;
  directWalkMeters: number;
  transferCount: number;
  inVehicleSeconds: number;
  walkMeters: number;
  legs: NormalizedJourneyLeg[];
  warnings: string[];
}

export type JourneyDelta = Omit<NormalizedJourney, 'legs' | 'warnings' | 'found'> & {
  totalSeconds: number | null;
  accessWalkSeconds: number | null;
  egressWalkSeconds: number | null;
  initialWaitSeconds: number | null;
  transferWaitSeconds: number | null;
  transferWalkSeconds: number | null;
  accessWalkMeters: number | null;
  transferWalkMeters: number | null;
  egressWalkMeters: number | null;
  directWalkSeconds: number | null;
  directWalkMeters: number | null;
  transferCount: number | null;
  inVehicleSeconds: number | null;
  walkMeters: number | null;
};

export interface JourneyComparison {
  before: NormalizedJourney;
  after: NormalizedJourney;
  delta: JourneyDelta;
  causeBreakdown: Record<string, number | null>;
  warnings: string[];
}

const NUMERIC_KEYS = ['totalSeconds', 'accessWalkSeconds', 'egressWalkSeconds', 'initialWaitSeconds', 'transferWaitSeconds', 'transferWalkSeconds', 'accessWalkMeters', 'transferWalkMeters', 'egressWalkMeters', 'directWalkSeconds', 'directWalkMeters', 'transferCount', 'inVehicleSeconds', 'walkMeters'] as const;

function emptyJourney(warning: string): NormalizedJourney {
  return { found: false, totalSeconds: 0, accessWalkSeconds: 0, egressWalkSeconds: 0, initialWaitSeconds: 0, transferWaitSeconds: 0, transferWalkSeconds: 0, accessWalkMeters: 0, transferWalkMeters: 0, egressWalkMeters: 0, directWalkSeconds: 0, directWalkMeters: 0, transferCount: 0, inVehicleSeconds: 0, walkMeters: 0, legs: [], warnings: [warning] };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stopId(value: unknown): string | undefined {
  const object = objectValue(value);
  const candidate = object.stopId ?? object.id;
  return typeof candidate === 'string' && candidate ? candidate : undefined;
}

function timeDifferenceSeconds(start: unknown, end: unknown): number {
  if (typeof start !== 'string' || typeof end !== 'string') return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? (endMs - startMs) / 1000 : 0;
}

function journeyArray(response: unknown): unknown[] {
  const root = objectValue(response);
  for (const key of ['itineraries', 'journeys', 'connections']) {
    if (Array.isArray(root[key])) return root[key];
  }
  return [];
}

function geometryPoints(value: unknown): Array<{ latitude: number; longitude: number }> | undefined {
  const object = objectValue(value);
  const coordinates = object.type === 'LineString' && Array.isArray(object.coordinates) ? object.coordinates : Array.isArray(value) ? value : undefined;
  if (!coordinates) return undefined;
  const points = coordinates.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return [];
    const longitude = coordinate[0];
    const latitude = coordinate[1];
    return typeof latitude === 'number' && Number.isFinite(latitude) && typeof longitude === 'number' && Number.isFinite(longitude)
      ? [{ latitude, longitude }]
      : [];
  });
  return points.length >= 2 ? points : undefined;
}

function normalizeMotisJourneyCandidate(candidate: unknown, requestedTime?: string): NormalizedJourney {
  const journey = objectValue(candidate);
  const rawLegs = Array.isArray(journey.legs) ? journey.legs : [];
  let malformedTiming = false;
  const timedLegs = rawLegs.map((raw, index) => {
    const leg = objectValue(raw);
    const mode = typeof leg.mode === 'string' ? leg.mode : 'UNKNOWN';
    const explicitDuration = numberValue(leg.duration);
    const derivedDuration = timeDifferenceSeconds(leg.startTime, leg.endTime);
    const duration = explicitDuration || derivedDuration;
    if (!explicitDuration && !derivedDuration && (leg.duration !== undefined || leg.startTime !== undefined || leg.endTime !== undefined)) malformedTiming = true;
    const isWalk = /WALK|FOOT/i.test(mode);
    const normalized: NormalizedJourneyLeg = {
      mode,
      routeId: typeof leg.routeId === 'string' ? leg.routeId : undefined,
      boardStopId: stopId(leg.from),
      alightStopId: stopId(leg.to),
      ...(geometryPoints(leg.geometry ?? leg.shape) ? { geometry: geometryPoints(leg.geometry ?? leg.shape) } : {}),
      rideSeconds: isWalk ? 0 : duration,
      waitSeconds: 0,
      walkSeconds: isWalk ? duration : 0,
      walkMeters: isWalk ? numberValue(leg.distance) : 0
    };
    return { normalized, startTime: leg.startTime, endTime: leg.endTime, isWalk, index };
  });
  const legs = timedLegs.map((entry) => entry.normalized);
  const transitIndexes = timedLegs.filter((entry) => !entry.isWalk && entry.normalized.rideSeconds > 0).map((entry) => entry.index);
  const transitLegs = transitIndexes.map((index) => timedLegs[index].normalized);
  const totalSeconds = numberValue(journey.duration) || timeDifferenceSeconds(journey.startTime, journey.endTime);
  const transferCount = typeof journey.transfers === 'number' && Number.isFinite(journey.transfers) ? journey.transfers : Math.max(0, transitLegs.length - 1);
  const firstTransitIndex = transitIndexes[0] ?? -1;
  const lastTransitIndex = transitIndexes.at(-1) ?? -1;
  let accessWalkSeconds = 0;
  let transferWalkSeconds = 0;
  let egressWalkSeconds = 0;
  let accessWalkMeters = 0;
  let transferWalkMeters = 0;
  let egressWalkMeters = 0;
  let directWalkSeconds = 0;
  let directWalkMeters = 0;
  if (firstTransitIndex < 0) {
    for (const entry of timedLegs) {
      if (!entry.isWalk) continue;
      directWalkSeconds += entry.normalized.walkSeconds;
      directWalkMeters += entry.normalized.walkMeters;
    }
  } else {
    for (const entry of timedLegs) {
      if (!entry.isWalk) continue;
      if (entry.index < firstTransitIndex) {
        accessWalkSeconds += entry.normalized.walkSeconds;
        accessWalkMeters += entry.normalized.walkMeters;
      } else if (entry.index > lastTransitIndex) {
        egressWalkSeconds += entry.normalized.walkSeconds;
        egressWalkMeters += entry.normalized.walkMeters;
      } else {
        transferWalkSeconds += entry.normalized.walkSeconds;
        transferWalkMeters += entry.normalized.walkMeters;
      }
    }
  }
  const initialWaitSeconds = firstTransitIndex >= 0 ? Math.max(0, timeDifferenceSeconds(requestedTime, timedLegs[firstTransitIndex].startTime)) : 0;
  let transferWaitSeconds = 0;
  for (let transitPosition = 1; transitPosition < transitIndexes.length; transitPosition += 1) {
    const previousIndex = transitIndexes[transitPosition - 1];
    const currentIndex = transitIndexes[transitPosition];
    const previousTransit = timedLegs[previousIndex];
    const currentTransit = timedLegs[currentIndex];
    const betweenWalkSeconds = timedLegs.slice(previousIndex + 1, currentIndex).filter((entry) => entry.isWalk).reduce((sum, entry) => sum + entry.normalized.walkSeconds, 0);
    transferWaitSeconds += Math.max(0, timeDifferenceSeconds(previousTransit.endTime, currentTransit.startTime) - betweenWalkSeconds);
  }
  const warnings = legs.length ? [] : ['MOTIS 응답에 여정 구간이 없습니다. 원시 응답을 확인하세요.'];
  if (malformedTiming) warnings.push('MOTIS 응답의 일부 구간 시간값을 해석하지 못했습니다.');
  if (firstTransitIndex < 0 && directWalkSeconds > 0) warnings.push('MOTIS 여정에 대중교통 구간이 없어 직접 보행 결과로 분류했습니다.');
  return {
    found: true,
    totalSeconds,
    accessWalkSeconds,
    egressWalkSeconds,
    initialWaitSeconds,
    transferWaitSeconds,
    transferWalkSeconds,
    accessWalkMeters,
    transferWalkMeters,
    egressWalkMeters,
    directWalkSeconds,
    directWalkMeters,
    transferCount,
    inVehicleSeconds: transitLegs.reduce((sum, leg) => sum + leg.rideSeconds, 0),
    walkMeters: legs.reduce((sum, leg) => sum + leg.walkMeters, 0),
    legs,
    warnings
  };
}

export function normalizeMotisJourneys(response: unknown, requestedTime?: string): NormalizedJourney[] {
  return journeyArray(response).map((candidate) => normalizeMotisJourneyCandidate(candidate, requestedTime));
}

export function normalizeMotisJourney(response: unknown, requestedTime?: string): NormalizedJourney {
  return normalizeMotisJourneys(response, requestedTime)[0] ?? emptyJourney('MOTIS가 해당 OD에 대한 여정을 반환하지 않았습니다.');
}

export function compareJourneys(before: NormalizedJourney, after: NormalizedJourney): JourneyComparison {
  const warnings = [...new Set([...before.warnings, ...after.warnings])];
  if (!before.found || !after.found) warnings.push('Before/After 중 한쪽에 여정이 없어 개선·악화 델타를 계산하지 않았습니다.');
  const delta = Object.fromEntries(NUMERIC_KEYS.map((key) => [key, before.found && after.found ? after[key] - before[key] : null])) as JourneyDelta;
  const causeBreakdown: Record<string, number | null> = {
    totalSeconds: delta.totalSeconds,
    inVehicleSeconds: delta.inVehicleSeconds,
    initialWaitSeconds: delta.initialWaitSeconds,
    transferWaitSeconds: delta.transferWaitSeconds,
    transferWalkSeconds: delta.transferWalkSeconds,
    accessWalkMeters: delta.accessWalkMeters,
    transferWalkMeters: delta.transferWalkMeters,
    egressWalkMeters: delta.egressWalkMeters,
    directWalkSeconds: delta.directWalkSeconds,
    directWalkMeters: delta.directWalkMeters,
    accessWalkSeconds: delta.accessWalkSeconds,
    egressWalkSeconds: delta.egressWalkSeconds,
    walkMeters: delta.walkMeters,
    transferCount: delta.transferCount
  };
  return { before, after, delta, causeBreakdown, warnings: [...new Set(warnings)] };
}

export function createScenarioDelta(routeId: string, baseStopIds: string[], scenarioStopIds: string[], label = 'Scenario'): import('../shared/types').ScenarioDelta {
  const baseSet = new Set(baseStopIds);
  const scenarioSet = new Set(scenarioStopIds);
  const addedStopIds = scenarioStopIds.filter((stopId) => !baseSet.has(stopId));
  const removedStopIds = baseStopIds.filter((stopId) => !scenarioSet.has(stopId));
  const warnings = [...new Set([
    ...(baseStopIds.length < 2 || scenarioStopIds.length < 2 ? ['Before/After 노선은 최소 2개 정류장이 필요합니다.'] : []),
    ...(new Set(scenarioStopIds).size !== scenarioStopIds.length ? ['Scenario 정류장 ID가 중복되어 있습니다.'] : [])
  ])];
  return { scenarioId: crypto.randomUUID(), label, routeId, baseStopIds, scenarioStopIds, addedStopIds, removedStopIds, warnings, createdAt: new Date().toISOString() };
}
