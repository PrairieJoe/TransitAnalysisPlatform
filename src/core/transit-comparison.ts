export interface NormalizedJourneyLeg {
  mode: string;
  routeId?: string;
  boardStopId?: string;
  alightStopId?: string;
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

const NUMERIC_KEYS = ['totalSeconds', 'accessWalkSeconds', 'egressWalkSeconds', 'initialWaitSeconds', 'transferWaitSeconds', 'transferWalkSeconds', 'transferCount', 'inVehicleSeconds', 'walkMeters'] as const;

function emptyJourney(warning: string): NormalizedJourney {
  return { found: false, totalSeconds: 0, accessWalkSeconds: 0, egressWalkSeconds: 0, initialWaitSeconds: 0, transferWaitSeconds: 0, transferWalkSeconds: 0, transferCount: 0, inVehicleSeconds: 0, walkMeters: 0, legs: [], warnings: [warning] };
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

export function normalizeMotisJourney(response: unknown, requestedTime?: string): NormalizedJourney {
  const candidate = journeyArray(response)[0];
  if (!candidate) return emptyJourney('MOTIS가 해당 OD에 대한 여정을 반환하지 않았습니다.');
  const journey = objectValue(candidate);
  const rawLegs = Array.isArray(journey.legs) ? journey.legs : [];
  const timedLegs = rawLegs.map((raw) => {
    const leg = objectValue(raw);
    const mode = typeof leg.mode === 'string' ? leg.mode : 'UNKNOWN';
    const duration = numberValue(leg.duration) || timeDifferenceSeconds(leg.startTime, leg.endTime);
    const isWalk = /WALK|FOOT/i.test(mode);
    return { normalized: {
      mode,
      routeId: typeof leg.routeId === 'string' ? leg.routeId : undefined,
      boardStopId: stopId(leg.from),
      alightStopId: stopId(leg.to),
      rideSeconds: isWalk ? 0 : duration,
      waitSeconds: 0,
      walkSeconds: isWalk ? duration : 0,
      walkMeters: isWalk ? numberValue(leg.distance) : 0
    }, startTime: leg.startTime, endTime: leg.endTime, isWalk };
  });
  const legs = timedLegs.map((entry) => entry.normalized);
  const transitLegs = legs.filter((leg) => leg.rideSeconds > 0);
  const walkLegs = legs.filter((leg) => leg.walkSeconds > 0);
  const totalSeconds = numberValue(journey.duration) || timeDifferenceSeconds(journey.startTime, journey.endTime);
  const transferCount = typeof journey.transfers === 'number' && Number.isFinite(journey.transfers) ? journey.transfers : Math.max(0, transitLegs.length - 1);
  const accessWalkSeconds = walkLegs.length ? walkLegs[0].walkSeconds : 0;
  const egressWalkSeconds = walkLegs.length > 1 ? walkLegs[walkLegs.length - 1].walkSeconds : 0;
  const transferWalkSeconds = Math.max(0, walkLegs.reduce((sum, leg) => sum + leg.walkSeconds, 0) - accessWalkSeconds - egressWalkSeconds);
  const firstTransitIndex = timedLegs.findIndex((entry) => !entry.isWalk);
  const initialWaitSeconds = firstTransitIndex >= 0 ? Math.max(0, timeDifferenceSeconds(requestedTime, timedLegs[firstTransitIndex].startTime)) : 0;
  let transferWaitSeconds = 0;
  for (let index = firstTransitIndex + 1; index < timedLegs.length; index += 1) {
    if (timedLegs[index].isWalk) continue;
    const previousTransit = [...timedLegs.slice(0, index)].reverse().find((entry) => !entry.isWalk);
    if (!previousTransit) continue;
    const betweenWalkSeconds = timedLegs.slice(timedLegs.indexOf(previousTransit) + 1, index).filter((entry) => entry.isWalk).reduce((sum, entry) => sum + entry.normalized.walkSeconds, 0);
    transferWaitSeconds += Math.max(0, timeDifferenceSeconds(previousTransit.endTime, timedLegs[index].startTime) - betweenWalkSeconds);
  }
  const warnings = legs.length ? [] : ['MOTIS 응답에 여정 구간이 없습니다. 원시 응답을 확인하세요.'];
  return {
    found: true,
    totalSeconds,
    accessWalkSeconds,
    egressWalkSeconds,
    initialWaitSeconds,
    transferWaitSeconds,
    transferWalkSeconds,
    transferCount,
    inVehicleSeconds: transitLegs.reduce((sum, leg) => sum + leg.rideSeconds, 0),
    walkMeters: legs.reduce((sum, leg) => sum + leg.walkMeters, 0),
    legs,
    warnings
  };
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
