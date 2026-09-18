import { describe, expect, it } from 'vitest';
import { buildMotisPlanPath, defaultMotisDepartureDateTime, toMotisSyntheticStopId } from '../../src/core/motis';

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
    const path = buildMotisPlanPath('3250842', '3250845', '2026-09-18T08:00');
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('fromPlace')).toBe('tap-synthetic-gtfs_3250842');
    expect(query.get('toPlace')).toBe('tap-synthetic-gtfs_3250845');
    expect(query.get('time')).toBe('2026-09-18T08:00:00+09:00');
  });
});
