import { describe, expect, it, vi } from 'vitest';
import { captureCanvasSnapshot } from '../../../src/renderer/three/capture';

describe('3D canvas snapshot', () => {
  it('captures a PNG data URL with a safe file name', () => {
    const canvas = { toDataURL: vi.fn(() => 'data:image/png;base64,scene') };

    expect(captureCanvasSnapshot(canvas, 'R/1 방향')).toEqual({
      fileName: 'route-3d-R-1-방향.png',
      dataUrl: 'data:image/png;base64,scene'
    });
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('rejects a non-PNG canvas result instead of downloading a broken file', () => {
    const canvas = { toDataURL: () => 'data:image/jpeg;base64,scene' };

    expect(() => captureCanvasSnapshot(canvas, 'R1')).toThrow('PNG');
  });
});
