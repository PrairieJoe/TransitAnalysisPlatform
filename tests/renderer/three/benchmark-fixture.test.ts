import { describe, expect, it } from 'vitest';
import { createBenchmarkRouteMetrics } from '../../../src/renderer/three/benchmark-fixture';
import { buildTransit3DModel } from '../../../src/renderer/three/model';

describe('Three.js benchmark fixtures', () => {
  it('creates deterministic finite route metrics at the requested scale', () => {
    const first = createBenchmarkRouteMetrics(1000, 5);
    const second = createBenchmarkRouteMetrics(1000, 5);

    expect(first).toHaveLength(1000);
    expect(first).toEqual(second);
    expect(first.every((metric) => Number.isFinite(metric.fromLatitude) && Number.isFinite(metric.toLongitude))).toBe(true);
  });

  it('produces a finite visual model for a scaled fixture', () => {
    const model = buildTransit3DModel(createBenchmarkRouteMetrics(1000, 5));

    expect(model.segments).toHaveLength(1000);
    expect(model.segments.every((segment) => Number.isFinite(segment.from.x) && Number.isFinite(segment.to.z))).toBe(true);
    expect(model.omittedCoordinateCount).toBe(0);
  });
});
