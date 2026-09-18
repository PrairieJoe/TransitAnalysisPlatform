import { describe, expect, it } from 'vitest';
import { detectWebGL2 } from '../../../src/renderer/three/capabilities';

describe('WebGL2 capability detection', () => {
  it('reports support when a webgl2 context can be created', () => {
    const result = detectWebGL2({
      createCanvas: () => ({ getContext: (contextId: string) => contextId === 'webgl2' ? {} : null })
    });

    expect(result).toEqual({ status: 'supported' });
  });

  it('reports an unavailable context without treating it as a runtime exception', () => {
    const result = detectWebGL2({
      createCanvas: () => ({ getContext: () => null })
    });

    expect(result).toEqual({ status: 'unsupported', reason: 'context-unavailable' });
  });

  it('classifies missing browser APIs and probe exceptions', () => {
    expect(detectWebGL2({ createCanvas: undefined })).toEqual({ status: 'unsupported', reason: 'browser-api-unavailable' });
    expect(detectWebGL2({ createCanvas: () => { throw new Error('probe failed'); } })).toEqual({ status: 'unsupported', reason: 'probe-failed' });
  });
});
