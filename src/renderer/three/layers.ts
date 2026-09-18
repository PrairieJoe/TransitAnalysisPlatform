import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Transit3DModel, Transit3DSegment } from './model';

export interface TransitLayerViewport {
  width: number;
  height: number;
}

export interface TransitSceneLayers {
  root: THREE.Group;
  segmentObjects: Map<string, Line2>;
  stationObject: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

function worldPoint(point: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.z, point.y);
}

function linePositions(segment: Transit3DSegment): number[] {
  const from = worldPoint(segment.from);
  const to = worldPoint(segment.to);
  return [from.x, from.y, from.z, to.x, to.y, to.z];
}

function createSegmentObject(segment: Transit3DSegment, viewport: TransitLayerViewport): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(linePositions(segment));
  const material = new LineMaterial({
    color: segment.color,
    linewidth: segment.width,
    worldUnits: true,
    transparent: true,
    opacity: segment.opacity
  });
  material.resolution.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.userData.kind = 'segment';
  line.userData.key = segment.key;
  line.userData.baseColor = segment.color;
  line.userData.baseOpacity = segment.opacity;
  line.userData.baseWidth = segment.width;
  line.userData.selected = false;
  return line;
}

function createStationObject(model: Transit3DModel): THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.SphereGeometry(.7, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: '#2f5d8c', transparent: true, opacity: .95 });
  const stationObject = new THREE.InstancedMesh(geometry, material, Math.max(1, model.stops.length));
  const matrix = new THREE.Matrix4();
  model.stops.forEach((stop, index) => stationObject.setMatrixAt(index, matrix.makeTranslation(...worldPoint(stop.position).toArray())));
  stationObject.instanceMatrix.needsUpdate = true;
  stationObject.userData.kind = 'stop';
  stationObject.userData.stopKeys = model.stops.map((stop) => stop.key);
  return stationObject;
}

export function createTransitLayers(model: Transit3DModel, viewport: TransitLayerViewport): TransitSceneLayers {
  const root = new THREE.Group();
  root.name = 'transit-route-layers';
  const segmentObjects = new Map<string, Line2>();
  for (const segment of model.segments) {
    const line = createSegmentObject(segment, viewport);
    segmentObjects.set(segment.key, line);
    root.add(line);
  }
  const stationObject = createStationObject(model);
  root.add(stationObject);
  return { root, segmentObjects, stationObject };
}

export function updateSegmentSelection(layers: TransitSceneLayers, selectedKey?: string): void {
  for (const [key, line] of layers.segmentObjects) {
    const selected = key === selectedKey;
    const material = line.material;
    material.color.set(selected ? '#fff3a6' : String(line.userData.baseColor));
    material.opacity = selected ? 1 : Number(line.userData.baseOpacity);
    material.linewidth = selected ? Number(line.userData.baseWidth) + 1.5 : Number(line.userData.baseWidth);
    line.userData.selected = selected;
  }
}

export function updateLineResolutions(layers: TransitSceneLayers, viewport: TransitLayerViewport): void {
  for (const line of layers.segmentObjects.values()) line.material.resolution.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
}
