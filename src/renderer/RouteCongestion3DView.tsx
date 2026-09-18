import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CONGESTION_BANDS } from '../core/route-analysis';
import type { RouteSegmentMetric } from '../shared/types';
import { detectWebGL2 } from './three/capabilities';
import { captureCanvasSnapshot } from './three/capture';
import { buildTransit3DModel } from './three/model';
import { getThreeViewNotice, type ThreeViewStatus } from './three/view-state';
import type { TransitSceneController } from './three/scene';

interface RouteCongestion3DViewProps {
  metrics: RouteSegmentMetric[];
  routeLabel: string;
  selectedSegmentKey?: string;
  onSelectSegment: (key: string) => void;
  onFallback: () => void;
}

export default function RouteCongestion3DView({ metrics, routeLabel, selectedSegmentKey, onSelectSegment, onFallback }: RouteCongestion3DViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<TransitSceneController | null>(null);
  const [status, setStatus] = useState<ThreeViewStatus>('loading');
  const [snapshotError, setSnapshotError] = useState<string>();
  const model = useMemo(() => buildTransit3DModel(metrics), [metrics]);
  const notice = getThreeViewNotice(status, model.omittedCoordinateCount);

  useEffect(() => {
    if (!canvasRef.current || !model.segments.length) return undefined;
    const canvas = canvasRef.current;
    let cancelled = false;
    let controller: TransitSceneController | undefined;
    let cleanupResize = (): void => undefined;
    const capability = detectWebGL2();
    if (capability.status === 'unsupported') {
      setStatus('unsupported');
      return undefined;
    }
    setStatus('loading');
    void import('./three/scene').then(({ createTransitSceneController }) => {
      if (cancelled) return;
      try {
        controller = createTransitSceneController({
          canvas,
          onPick: (pick) => { if (pick.kind === 'segment') onSelectSegment(pick.key); },
          onContextLost: () => setStatus('error')
        });
        controllerRef.current = controller;
        controller.update(model, selectedSegmentKey);
        setStatus('ready');
        const resize = (): void => {
          const rect = canvas.getBoundingClientRect();
          controller?.resize(rect.width, rect.height);
          controller?.render();
        };
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
        observer?.observe(canvas);
        window.addEventListener('resize', resize);
        resize();
        cleanupResize = () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
      } catch {
        setStatus('error');
      }
    }).catch(() => setStatus('error'));
    return () => {
      cancelled = true;
      cleanupResize();
      controllerRef.current = null;
      controller?.dispose();
    };
  }, [model, onSelectSegment]);

  useEffect(() => {
    controllerRef.current?.select(selectedSegmentKey);
  }, [selectedSegmentKey]);

  function captureSnapshot(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      controllerRef.current?.render();
      const snapshot = captureCanvasSnapshot(canvas, routeLabel);
      const link = document.createElement('a');
      link.href = snapshot.dataUrl;
      link.download = snapshot.fileName;
      link.click();
      setSnapshotError(undefined);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : '3D 장면을 PNG로 캡처하지 못했습니다.');
    }
  }

  if (!model.segments.length) return <div className="map-empty"><strong>표시할 노선 구간이 없습니다.</strong><span>노선정보와 승·하차 정류장 ID가 일치하는지 확인하세요.</span></div>;
  return <div className="three-map-shell">
    <canvas ref={canvasRef} className="three-map-canvas" aria-label="노선 구간 혼잡도 3D 시각화" />
    <div className="three-map-help" role="status"><strong>{notice.message}</strong>{notice.omittedCoordinateCount > 0 && <span>좌표가 유효하지 않아 {notice.omittedCoordinateCount}개 구간은 제외했습니다.</span>}<div className="three-map-actions"><button type="button" className="secondary-button" onClick={captureSnapshot} disabled={status !== 'ready'}>3D PNG 저장</button></div>{snapshotError && <span role="alert">{snapshotError}</span>}</div>
    <div className="three-map-legend" aria-label="3D 혼잡도 범례">
      <strong>혼잡도 색상</strong>
      {CONGESTION_BANDS.map((band) => <span key={band.label}><i style={{ backgroundColor: band.color }} />{band.label}</span>)}
      <small>높이: 피크 재차인원 · 회색: 혼잡도 기준 미입력</small>
    </div>
    {notice.fallbackAvailable && <div className="three-map-fallback" role="alert"><span>{notice.message}</span><button className="text-button" onClick={onFallback}>2D 지도로 보기</button></div>}
  </div>;
}
