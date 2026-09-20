import { describe, expect, it } from 'vitest';
import { buildMotisPlanPath, defaultMotisDepartureDateTime, DEFAULT_MOTIS_PLAN_OPTIONS, toMotisPlace, toMotisSyntheticStopId } from '../../src/core/motis';

describe('MOTIS Synthetic GTFS identifiers', () => {
  it('qualifies raw GTFS stop IDs with the synthetic feed ID', () => {
    expect(toMotisSyntheticStopId('3250842')).toBe('tap-synthetic-gtfs_3250842');
  });

  it('does not qualify an ID that is already MOTIS-qualified', () => {
    expect(toMotisSyntheticStopId('tap-synthetic-gtfs_3250842')).toBe('tap-synthetic-gtfs_3250842');
  });

  it('uses the Korea-local current date for the default query date', () => {
    expect(defaultMotisDepartureDateTime(new Date('2026-09-17T15:00:00.000Z'))).toBe('2026-09-18T08:00');
  });

  it('builds a plan request with feed-qualified stops and Korea time', () => {
    const path = buildMotisPlanPath({ kind: 'stop', stopId: '3250842' }, { kind: 'stop', stopId: '3250845' }, '2026-09-18T08:00', DEFAULT_MOTIS_PLAN_OPTIONS);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('fromPlace')).toBe('tap-synthetic-gtfs_3250842');
    expect(query.get('toPlace')).toBe('tap-synthetic-gtfs_3250845');
    expect(query.get('time')).toBe('2026-09-18T08:00:00+09:00');
    expect(query.get('pedestrianProfile')).toBe('FOOT');
    expect(query.get('maxPreTransitTime')).toBe('900');
    expect(query.get('maxPostTransitTime')).toBe('900');
    expect(query.get('maxMatchingDistance')).toBe('250');
    expect(query.get('detailedLegs')).toBe('true');
  });

  it('serializes coordinate endpoints as latitude,longitude without rounding', () => {
    expect(toMotisPlace({ kind: 'coordinate', latitude: 37.374635, longitude: 126.6330278 })).toBe('37.374635,126.6330278');
    expect(toMotisPlace({ kind: 'coordinate', latitude: -33.856784, longitude: 151.215297 })).toBe('-33.856784,151.215297');
  });

  it('rejects non-finite or out-of-range coordinate endpoints', () => {
    expect(() => toMotisPlace({ kind: 'coordinate', latitude: Number.NaN, longitude: 127 })).toThrow('위도');
    expect(() => toMotisPlace({ kind: 'coordinate', latitude: 37, longitude: Number.POSITIVE_INFINITY })).toThrow('경도');
    expect(() => toMotisPlace({ kind: 'coordinate', latitude: 91, longitude: 127 })).toThrow('위도');
  });

  it('builds coordinate plan requests with the configured pedestrian search limits', () => {
    const path = buildMotisPlanPath(
      { kind: 'coordinate', latitude: 34.7604, longitude: 127.6622, label: 'A' },
      { kind: 'coordinate', latitude: 34.7463, longitude: 127.7441, label: 'B' },
      '2026-09-20T08:00',
      { ...DEFAULT_MOTIS_PLAN_OPTIONS, maxTransfers: 2 }
    );
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('fromPlace')).toBe('34.7604,127.6622');
    expect(query.get('toPlace')).toBe('34.7463,127.7441');
    expect(query.get('maxTransfers')).toBe('2');
  });
});
