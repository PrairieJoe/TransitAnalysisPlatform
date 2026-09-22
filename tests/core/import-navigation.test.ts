import { describe, expect, it } from 'vitest';
import { getImportActionLayout, nextViewAfterImport } from '../../src/core/import-navigation';

describe('import navigation', () => {
  it('routes analysis imports to the report and GTFS imports to the builder', () => {
    expect(nextViewAfterImport('analysis')).toBe('report');
    expect(nextViewAfterImport('gtfs')).toBe('synthetic');
    expect(nextViewAfterImport('alighting')).toBe('alighting');
  });

  it('keeps one recommended primary action and exposes valid alternate outputs', () => {
    expect(getImportActionLayout({ coreMappingReady: true, routeStopMasterCount: 3 })).toEqual({
      primary: 'alighting',
      secondary: ['analysis', 'gtfs']
    });
    expect(getImportActionLayout({ coreMappingReady: true, routeStopMasterCount: 0 })).toEqual({
      primary: 'analysis',
      secondary: []
    });
  });
});
