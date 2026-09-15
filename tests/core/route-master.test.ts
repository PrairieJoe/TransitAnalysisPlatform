import { describe, expect, it } from 'vitest';
import { buildRoutePathIndex, normalizeRouteMasterDate, normalizeRouteStopMasterRows, routeOptions, selectRoutePath, suggestRouteStopMasterMapping } from '../../src/core/route-master';

const headerlessHeaders = Array.from({ length: 14 }, (_value, index) => `필드${index + 1}`);
const row = (date: string, route = 'R1', sequence = '0', stationId = 'A') => ({
  필드1: date, 필드2: '03', 필드3: 'MM10146000', 필드4: route, 필드5: '여수1', 필드6: 'B', 필드7: sequence, 필드8: stationId, 필드9: `정류장-${stationId}`, 필드10: '34.75', 필드11: '127.73', 필드12: '~', 필드13: sequence, 필드14: '100'
});

describe('route stop master', () => {
  it('suggests the supplied 14-field positions', () => {
    expect(suggestRouteStopMasterMapping(headerlessHeaders, [row('0240415')])).toMatchObject({
      serviceDateColumn: '필드1',
      routeIdColumn: '필드4',
      routeNameColumn: '필드5',
      transportModeColumn: '필드6',
      stationSequenceColumn: '필드7',
      stationIdColumn: '필드8',
      stationNameColumn: '필드9',
      latitudeColumn: '필드10',
      longitudeColumn: '필드11',
      arsNumberColumn: '필드12',
      cumulativeDistanceColumn: '필드13',
      stationDistanceColumn: '필드14'
    });
  });

  it('normalizes six, seven and eight digit dates', () => {
    expect(normalizeRouteMasterDate('240415')).toBe('2024-04-15');
    expect(normalizeRouteMasterDate('0240415')).toBe('2024-04-15');
    expect(normalizeRouteMasterDate('20240415')).toBe('2024-04-15');
  });

  it('normalizes valid rows and rejects invalid coordinates or duplicate path keys', () => {
    const mapping = suggestRouteStopMasterMapping(headerlessHeaders, [row('0240415')]);
    const parsed = normalizeRouteStopMasterRows([
      row('0240415', 'R1', '0', 'A'),
      row('0240415', 'R1', '1', 'B'),
      { ...row('0240415', 'R1', '1', 'C'), 필드10: '91' },
      row('0240415', 'R1', '1', 'B')
    ], mapping);
    expect(parsed.stops).toHaveLength(3);
    const index = buildRoutePathIndex(parsed.stops);
    expect(index.paths).toHaveLength(0);
    expect(index.warnings.join(' ')).toContain('중복');
  });

  it('prefers an exact dated path, then static data, then a single dated fallback', () => {
    const stops = [
      ...[row('', 'R1', '0', 'A'), row('', 'R1', '1', 'B')],
      ...[row('2024-04-15', 'R2', '0', 'A'), row('2024-04-15', 'R2', '1', 'B')],
      ...[row('2024-04-15', 'R3', '0', 'A'), row('2024-04-15', 'R3', '1', 'B')]
    ];
    const mapping = suggestRouteStopMasterMapping(headerlessHeaders, [row('0240415')]);
    const parsed = normalizeRouteStopMasterRows(stops, mapping);
    const index = buildRoutePathIndex(parsed.stops);
    expect(selectRoutePath(index, 'R1', '2024-05-01').path?.routeId).toBe('R1');
    expect(selectRoutePath(index, 'R2', '2024-04-15').path?.serviceDate).toBe('2024-04-15');
    expect(selectRoutePath(index, 'R3', '2024-05-01').path?.routeId).toBe('R3');
    expect(routeOptions(index).map((option) => option.routeId)).toEqual(['R1', 'R2', 'R3']);
  });
});
