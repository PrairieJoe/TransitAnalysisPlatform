export type ThreeViewStatus = 'loading' | 'ready' | 'unsupported' | 'error';

export interface ThreeViewNotice {
  message: string;
  fallbackAvailable: boolean;
  omittedCoordinateCount: number;
}

export function getThreeViewNotice(status: ThreeViewStatus, omittedCoordinateCount: number): ThreeViewNotice {
  const message = status === 'loading'
    ? '3D 혼잡도 장면을 준비하고 있습니다.'
    : status === 'unsupported'
      ? '이 환경에서는 WebGL2를 사용할 수 없어 2D 지도로 전환할 수 있습니다.'
      : status === 'error'
        ? '3D 장면을 초기화하지 못했습니다. 기존 2D 지도를 사용할 수 있습니다.'
        : '마우스로 이동·확대하고 구간을 선택할 수 있습니다.';
  return { message, fallbackAvailable: status === 'unsupported' || status === 'error', omittedCoordinateCount };
}
