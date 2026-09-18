import { describe, expect, it } from 'vitest';
import { nextViewAfterImport } from '../../src/core/import-navigation';

describe('import navigation', () => {
  it('routes analysis imports to the report and GTFS imports to the builder', () => {
    expect(nextViewAfterImport('analysis')).toBe('report');
    expect(nextViewAfterImport('gtfs')).toBe('synthetic');
  });
});
