import { describe, expect, it } from 'vitest';
import { getThreeViewNotice, type ThreeViewStatus } from '../../src/renderer/three/view-state';

describe('route congestion 3D view state', () => {
  it.each([
    ['loading', false, '3D 혼잡도 장면을 준비하고 있습니다.'],
    ['ready', false, '마우스로 이동·확대하고 구간을 선택할 수 있습니다.'],
    ['unsupported', true, '이 환경에서는 WebGL2를 사용할 수 없어 2D 지도로 전환할 수 있습니다.'],
    ['error', true, '3D 장면을 초기화하지 못했습니다. 기존 2D 지도를 사용할 수 있습니다.']
  ] as Array<[ThreeViewStatus, boolean, string]>)('describes %s state for a usable route view', (status, fallbackAvailable, message) => {
    expect(getThreeViewNotice(status, 0)).toEqual({ message, fallbackAvailable, omittedCoordinateCount: 0 });
  });

  it('reports omitted geometry without changing the fallback contract', () => {
    expect(getThreeViewNotice('ready', 2)).toEqual({
      message: '마우스로 이동·확대하고 구간을 선택할 수 있습니다.',
      fallbackAvailable: false,
      omittedCoordinateCount: 2
    });
  });
});
