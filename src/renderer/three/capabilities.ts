export type WebGL2UnsupportedReason = 'browser-api-unavailable' | 'context-unavailable' | 'probe-failed';

export type WebGL2Capability =
  | { status: 'supported' }
  | { status: 'unsupported'; reason: WebGL2UnsupportedReason };

export interface WebGL2CanvasLike {
  getContext: (contextId: string) => unknown;
}

export interface WebGL2ProbeOptions {
  createCanvas?: () => WebGL2CanvasLike | undefined;
}

function defaultCanvas(): WebGL2CanvasLike | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.createElement('canvas');
}

export function detectWebGL2(options: WebGL2ProbeOptions = {}): WebGL2Capability {
  const createCanvas = options.createCanvas ?? defaultCanvas;
  if (!createCanvas) return { status: 'unsupported', reason: 'browser-api-unavailable' };

  try {
    const canvas = createCanvas();
    if (!canvas || typeof canvas.getContext !== 'function') return { status: 'unsupported', reason: 'browser-api-unavailable' };
    return canvas.getContext('webgl2') ? { status: 'supported' } : { status: 'unsupported', reason: 'context-unavailable' };
  } catch {
    return { status: 'unsupported', reason: 'probe-failed' };
  }
}
