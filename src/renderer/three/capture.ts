export interface CanvasCaptureSource {
  toDataURL: (type: string) => string;
}

function safeFilePart(value: string): string {
  const normalized = value.normalize('NFKC').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return normalized || 'route';
}

export function captureCanvasSnapshot(canvas: CanvasCaptureSource, routeLabel: string): { fileName: string; dataUrl: string } {
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) throw new Error('3D 장면을 PNG로 캡처하지 못했습니다.');
  return { fileName: `route-3d-${safeFilePart(routeLabel)}.png`, dataUrl };
}
