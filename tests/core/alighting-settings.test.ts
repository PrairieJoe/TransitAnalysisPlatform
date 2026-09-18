import { describe, expect, it } from 'vitest';
import {
  ALIGHTING_PRESET_OPTIONS,
  alightingConfigForPreset,
  alightingModeFromControls,
  canEnterAlightingEstimation,
  identifyAlightingPreset
} from '../../src/core/alighting-settings';
import { DEFAULT_ALIGHTING_INFERENCE_CONFIG, type AlightingInferenceConfig } from '../../src/shared/types';

describe('alighting settings', () => {
  it('identifies the recommended profile from the default configuration', () => {
    expect(identifyAlightingPreset(DEFAULT_ALIGHTING_INFERENCE_CONFIG)).toBe('recommended');
    expect(ALIGHTING_PRESET_OPTIONS.map((option) => option.value)).toEqual(['recommended', 'strict', 'expanded', 'custom']);
  });

  it('provides distinct strict and expanded profile configurations', () => {
    const strict = alightingConfigForPreset('strict');
    const expanded = alightingConfigForPreset('expanded');

    expect(strict.fallbackDistanceMeters).toBeLessThan(DEFAULT_ALIGHTING_INFERENCE_CONFIG.fallbackDistanceMeters);
    expect(expanded.fallbackDistanceMeters).toBeGreaterThan(DEFAULT_ALIGHTING_INFERENCE_CONFIG.fallbackDistanceMeters);
    expect(identifyAlightingPreset({ ...DEFAULT_ALIGHTING_INFERENCE_CONFIG, maxTransferMinutes: 45 })).toBe('custom');
  });

  it('requires route stop master records before entering estimation', () => {
    expect(canEnterAlightingEstimation(true, 0)).toBe(false);
    expect(canEnterAlightingEstimation(false, 1)).toBe(false);
    expect(canEnterAlightingEstimation(true, 1)).toBe(true);
  });

  it('maps the report checkbox and scope to an analysis mode', () => {
    expect(alightingModeFromControls(false, false)).toBe('observed');
    expect(alightingModeFromControls(true, false)).toBe('high-confidence');
    expect(alightingModeFromControls(true, true)).toBe('expected-flow');
  });
});
