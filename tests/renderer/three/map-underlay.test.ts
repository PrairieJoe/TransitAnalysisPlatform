import { describe, expect, it } from 'vitest';
import { chooseTransitMapZoom, getTransitMapTileRange } from '../../../src/renderer/three/map-underlay';

const bounds = { minLatitude: 37, maxLatitude: 37.02, minLongitude: 127, maxLongitude: 127.02 };

describe('Transit 3D map underlay', () => {
  it('converts geographic bounds into a bounded raster tile range', () => {
    const range = getTransitMapTileRange(bounds, 15);

    expect(range.zoom).toBe(15);
    expect(range.width).toBeGreaterThan(0);
    expect(range.height).toBeGreaterThan(0);
    expect(range.width).toBeLessThanOrEqual(4);
    expect(range.height).toBeLessThanOrEqual(4);
    expect(range.minY).toBeLessThanOrEqual(range.maxY);
  });

  it('chooses the highest useful zoom without exceeding the tile budget', () => {
    const zoom = chooseTransitMapZoom(bounds);
    const range = getTransitMapTileRange(bounds, zoom);

    expect(zoom).toBeGreaterThanOrEqual(11);
    expect(zoom).toBeLessThanOrEqual(17);
    expect(range.width).toBeLessThanOrEqual(4);
    expect(range.height).toBeLessThanOrEqual(4);
  });
});
