import { describe, expect, it } from 'vitest';
import { calculatePolylineDistanceMeters, fetchRouteShapes, fetchRouteShapesForStops } from '../../src/core/route-shape';
import { routeSegmentKey } from '../../src/core/route-demand-view';
import type { RouteSegmentMetric } from '../../src/shared/types';
const metric = (overrides = {}): RouteSegmentMetric => ({ routeId: 'R', routeName: 'R', transportMode: 'B', direction: 'forward', directionLabel: '순방향', fromSequence: 0, toSequence: 1, fromStationId: 'A', toStationId: 'B', fromStationName: 'A', toStationName: 'B', fromLatitude: 34.75, fromLongitude: 127.73, toLatitude: 34.76, toLongitude: 127.74, previousOnboard: 0, boardings: 1, alightings: 0, onboardPassengers: 1, peakOnboardPassengers: 1, averageOnboardPassengers: 1, totalBoardings: 1, totalAlightings: 0, vehicleCapacity: 1, dailyTrips: 1, congestionPercent: 100, rank: 1, ...overrides });
const response = (coordinates = [[127.73,34.75],[127.735,34.752],[127.74,34.76]], way = 123) => ({type:'FeatureCollection', features:[{type:'Feature', properties:{way},geometry:{type:'LineString',coordinates}}]});
describe('BUS road shapes', () => {
  it('fetches keyed stop-pair shapes and calculates their polyline distance', async () => {
    const result = await fetchRouteShapesForStops({
      requests: [{ key: 'A:a-1:a-2', fromStopId: 'a-1', toStopId: 'a-2', from: { latitude: 34.75, longitude: 127.73 }, to: { latitude: 34.76, longitude: 127.74 } }],
      request: async () => response()
    });

    expect(result.get('A:a-1:a-2')).toMatchObject({ source: 'osm', key: 'A:a-1:a-2' });
    expect(calculatePolylineDistanceMeters(result.get('A:a-1:a-2')!.points)).toBeGreaterThan(0);
  });

  it('retains fallback provenance for keyed requests when MOTIS is unavailable', async () => {
    const result = await fetchRouteShapesForStops({
      requests: [{ key: 'A:a-1:a-2', fromStopId: 'a-1', toStopId: 'a-2', from: { latitude: 34.75, longitude: 127.73 }, to: { latitude: 34.76, longitude: 127.74 } }],
      request: async () => { throw new Error('MOTIS unavailable'); }
    });

    expect(result.get('A:a-1:a-2')).toMatchObject({ source: 'beeline', warning: expect.stringContaining('MOTIS') });
  });

  it('flags excessive road detours without changing demand or replacing valid geometry', async () => {
    const result = await fetchRouteShapes([metric()], async () => response([[127.73,34.75],[127.70,34.79],[127.74,34.76]]));
    expect(result.segments[0].source).toBe('osm');
    expect(result.segments[0].warning).toMatch(/우회비율/);
  });
  it('requests native BUS profile, preserves keys, endpoints and demand', async () => {
    const input = metric(); const before = JSON.stringify(input);
    const result = await fetchRouteShapes([input], async (path, init) => {
      expect(path).toBe('/api/route'); expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body!)).toMatchObject({profile:'bus',direction:'forward',start:{lat:34.75,lng:127.73}});
      return response();
    });
    expect(result.segments[0]).toMatchObject({key:routeSegmentKey(input),source:'osm'});
    expect(result.segments[0].points).toHaveLength(3); expect(result.quality.routedSegments).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('retains explicit beelines for no path, malformed, remote and reversed geometry', async () => {
    for (const value of [{error:'no path found'}, response([[NaN,34.75]]),response([[1,1],[2,2]]),response([[127.74,34.76],[127.73,34.75]])]) {
      const result = await fetchRouteShapes([metric()], async () => value);
      expect(result.segments[0].source).toBe('beeline'); expect(result.quality.fallbackSegments).toBe(1); expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
  it('does not invent roads from way-zero geometry', async () => {
    expect((await fetchRouteShapes([metric()], async()=>response(undefined,0))).segments[0].source).toBe('beeline');
  });
  it('fails invalid coordinates before requests and retains valid endpoints only', async () => {
    let count=0; const result=await fetchRouteShapes([metric({fromLatitude:NaN})],async()=>{count++; return response();});
    expect(count).toBe(0); expect(result.segments[0].points).toEqual([]); expect(result.quality.invalidSegments).toBe(1);
  });
  it('stops on unavailable endpoint and summarizes repeated fallback warnings', async () => {
    let count=0; const result=await fetchRouteShapes(Array.from({length:20},(_,i)=>metric({fromSequence:i})),async()=>{count++; throw new Error('MOTIS HTTP 404');});
    expect(count).toBe(1); expect(result.quality.fallbackSegments).toBe(20); expect(result.warnings).toHaveLength(1);
  });
  it('labels short snap connectors and keeps exact stop coordinates', async () => {
    const result=await fetchRouteShapes([metric()],async()=>response([[127.7301,34.7501],[127.735,34.752],[127.7399,34.7599]]));
    expect(result.segments[0].source).toBe('osm'); expect(result.segments[0].points[0]).toEqual({latitude:34.75,longitude:127.73}); expect(result.segments[0].warning).toMatch(/연결/);
  });
});
