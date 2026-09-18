import type { TransitGeoBounds } from './model';

export interface TransitMapTileRange {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface TransitBasemapCanvas {
  canvas: HTMLCanvasElement;
  tileRange: TransitMapTileRange;
}

export interface TransitBasemapOptions {
  zoom?: number;
  tileUrlTemplate?: string;
  document?: Document;
  imageFactory?: () => HTMLImageElement;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 11;
const MAX_ZOOM = 17;
const MAX_TILE_SPAN = 4;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function clampLatitude(latitude: number): number {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
}

function longitudeToTileX(longitude: number, zoom: number): number {
  const worldSize = 2 ** zoom;
  return ((longitude + 180) / 360) * worldSize;
}

function latitudeToTileY(latitude: number, zoom: number): number {
  const radians = clampLatitude(latitude) * Math.PI / 180;
  const worldSize = 2 ** zoom;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * worldSize;
}

export function getTransitMapTileRange(bounds: TransitGeoBounds, zoom: number): TransitMapTileRange {
  const safeZoom = Math.max(0, Math.floor(zoom));
  const minX = Math.floor(longitudeToTileX(bounds.minLongitude, safeZoom));
  const maxX = Math.floor(longitudeToTileX(bounds.maxLongitude, safeZoom));
  const minY = Math.floor(latitudeToTileY(bounds.maxLatitude, safeZoom));
  const maxY = Math.floor(latitudeToTileY(bounds.minLatitude, safeZoom));
  return {
    zoom: safeZoom,
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1)
  };
}

export function chooseTransitMapZoom(bounds: TransitGeoBounds): number {
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const range = getTransitMapTileRange(bounds, zoom);
    if (range.width <= MAX_TILE_SPAN && range.height <= MAX_TILE_SPAN) return zoom;
  }
  return MIN_ZOOM;
}

function tileUrl(template: string, zoom: number, x: number, y: number): string {
  return template.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
}

function loadTileImage(url: string, imageFactory: () => HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = imageFactory();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`지도 타일을 불러오지 못했습니다: ${url}`));
    image.src = url;
  });
}

export async function loadTransitBasemapCanvas(bounds: TransitGeoBounds, options: TransitBasemapOptions = {}): Promise<TransitBasemapCanvas> {
  const documentRef = options.document ?? globalThis.document;
  if (!documentRef) throw new Error('브라우저 문서가 없어 지도 바닥면을 만들 수 없습니다.');
  const imageFactory = options.imageFactory ?? (() => new Image());
  const tileRange = getTransitMapTileRange(bounds, options.zoom ?? chooseTransitMapZoom(bounds));
  const canvas = documentRef.createElement('canvas');
  canvas.width = tileRange.width * TILE_SIZE;
  canvas.height = tileRange.height * TILE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('지도 바닥면용 캔버스를 초기화하지 못했습니다.');
  context.fillStyle = '#eef4f8';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const template = options.tileUrlTemplate ?? DEFAULT_TILE_URL;
  const tiles = await Promise.all(Array.from({ length: tileRange.width * tileRange.height }, async (_, index) => {
    const column = index % tileRange.width;
    const row = Math.floor(index / tileRange.width);
    const x = tileRange.minX + column;
    const y = tileRange.minY + row;
    return { image: await loadTileImage(tileUrl(template, tileRange.zoom, x, y), imageFactory), column, row };
  }));
  for (const tile of tiles) context.drawImage(tile.image, tile.column * TILE_SIZE, tile.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  return { canvas, tileRange };
}
