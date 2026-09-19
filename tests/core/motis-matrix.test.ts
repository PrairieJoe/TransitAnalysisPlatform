import { describe, expect, it } from 'vitest';
import { matrixRequest, runBoundedMatrix, mergeGtfsPackages, LatencyHistogram } from '../../src/core/motis-matrix';

describe('MOTIS matrix benchmark', () => {
  it('enumerates every unique origin/destination/time exactly once', () => {
    const keys = Array.from({length: 12}, (_, i) => matrixRequest(i, ['a','b'], ['c','d'], ['06','07','08']));
    expect(new Set(keys.map(v => JSON.stringify(v))).size).toBe(12);
    expect(keys[11]).toEqual({origin: 'b', destination: 'd', departure: '08'});
    expect(() => matrixRequest(12, ['a','b'], ['c','d'], ['06','07','08'])).toThrow();
  });
  it('limits work in flight and completes each index once', async () => {
    let active = 0; let peak = 0; const done: number[] = [];
    await runBoundedMatrix(17, 3, async i => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      done.push(i); --active;
    });
    expect(peak).toBe(3); expect(done.sort((a,b)=>a-b)).toEqual(Array.from({length:17},(_,i)=>i));
  });
  it('waits for in-flight workers before propagating a sink failure', async () => {
    let settled = false;
    const execution = runBoundedMatrix(100, 2, async index => {
      if (index === 0) throw new Error('sink failed');
      await new Promise(resolve => setTimeout(resolve, 10));
      settled = true;
    });
    await expect(execution).rejects.toThrow('sink failed');
    // The second worker may be skipped if the first fails synchronously.
    expect(settled).toBe(true);
  });
  it('stops scheduling after cancellation', async () => {
    const abort = new AbortController(); let count = 0;
    await runBoundedMatrix(100, 1, async () => { count++; abort.abort(); }, abort.signal);
    expect(count).toBe(1);
  });
  it('deduplicates GTFS keys and rejects contradictory definitions', () => {
    const first = {'stops.txt':'stop_id,stop_name\r\na,A\r\n', 'trips.txt':'route_id,service_id,trip_id\r\nr,s,t1\r\nr,s,t2\r\n', 'stop_times.txt':'trip_id,stop_sequence\r\nt,1\r\nt,2\r\n'};
    expect(mergeGtfsPackages([first,first])['stop_times.txt']).toContain('t,2');
    expect(mergeGtfsPackages([first,first])['stops.txt'].split('\r\n')).toHaveLength(3);
    expect(() => mergeGtfsPackages([first, {'stops.txt':'stop_id,stop_name\na,B\n'}])).toThrow(/conflict/);
  });
  it('bounds histogram storage and reports conservative millisecond quantiles', () => {
    const histogram = new LatencyHistogram();
    [1.1,2.5,3,4,5,6,7,8,9,10].forEach(v=>histogram.add(v));
    expect(histogram.percentile(.9)).toBe(9);
    expect(histogram.count).toBe(10);
  });
});


