import { describe, expect, it } from 'vitest';
import { createLocalMeterProjection } from '../../../src/renderer/three/projection';

describe('local meter projection', () => {
  it('projects longitude and latitude deltas into finite east/north meters', () => {
    const projection = createLocalMeterProjection([
      { latitude: 37, longitude: 127 },
      { latitude: 37.01, longitude: 127.01 }
    ]);

    const origin = projection.project(projection.origin);
    const northeast = projection.project({ latitude: 37.01, longitude: 127.01 });

    expect(origin).toEqual({ x: 0, y: 0 });
    expect(northeast.x).toBeGreaterThan(400);
    expect(northeast.x).toBeLessThan(500);
    expect(northeast.y).toBeGreaterThan(500);
    expect(northeast.y).toBeLessThan(600);
    expect(projection.bounds.maxX).toBeGreaterThan(0);
    expect(projection.bounds.maxY).toBeGreaterThan(0);
  });

  it('keeps a degenerate extent finite and centered at zero', () => {
    const projection = createLocalMeterProjection([{ latitude: 37, longitude: 127 }]);

    expect(projection.project({ latitude: 37, longitude: 127 })).toEqual({ x: 0, y: 0 });
    expect(projection.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
});
