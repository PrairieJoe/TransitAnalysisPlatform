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
  segmentVolumeObjects: Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>;
  stationObject: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  stationPillarObject: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
}

/** Keep source coordinates in meters while using a readable display scale in the scene. */
export const TRANSIT_WORLD_SCALE = 0.05;
/** Exaggerate vertical values so the analytical dimension remains visible at route scale. */
export const TRANSIT_VERTICAL_SCALE = 5;

function worldPoint(point: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(point.x * TRANSIT_WORLD_SCALE, point.z * TRANSIT_VERTICAL_SCALE, point.y * TRANSIT_WORLD_SCALE);
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
    linewidth: Math.max(3, segment.width * 1.5),
    worldUnits: false,
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

function createSegmentVolume(segment: Transit3DSegment): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  const from = worldPoint(segment.from);
  const to = worldPoint(segment.to);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.max(0.01, Math.hypot(dx, dz));
  const height = Math.max(0.2, segment.height * TRANSIT_VERTICAL_SCALE);
  const width = Math.max(0.75, segment.width * 0.22);
  const geometry = new THREE.BoxGeometry(length, height, width);
  const material = new THREE.MeshStandardMaterial({
    color: segment.color,
    transparent: true,
    opacity: 0.72,
    roughness: 0.62,
    metalness: 0.05
  });
  const volume = new THREE.Mesh(geometry, material);
  volume.position.set((from.x + to.x) / 2, height / 2, (from.z + to.z) / 2);
  volume.rotation.y = -Math.atan2(dz, dx);
  volume.userData.kind = 'segment';
  volume.userData.key = segment.key;
  volume.userData.baseColor = segment.color;
  volume.userData.baseOpacity = 0.72;
  volume.userData.selected = false;
  return volume;
}

function stationHeights(model: Transit3DModel): Map<string, number> {
  const heights = new Map<string, number>();
  for (const segment of model.segments) {
    heights.set(segment.fromStationId, Math.max(heights.get(segment.fromStationId) ?? 0, segment.height));
    heights.set(segment.toStationId, Math.max(heights.get(segment.toStationId) ?? 0, segment.height));
  }
  return heights;
}

function createStationObject(model: Transit3DModel, heights: Map<string, number>): THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
  const geometry = new THREE.SphereGeometry(1.5, 12, 8);
  const material = new THREE.MeshStandardMaterial({ color: '#2f5d8c', transparent: true, opacity: .98, roughness: .35, metalness: .12 });
  const stationObject = new THREE.InstancedMesh(geometry, material, Math.max(1, model.stops.length));
  const matrix = new THREE.Matrix4();
  model.stops.forEach((stop, index) => {
    const height = heights.get(stop.stationId) ?? 0;
    stationObject.setMatrixAt(index, matrix.makeTranslation(...worldPoint({ ...stop.position, z: height }).toArray()));
  });
  stationObject.instanceMatrix.needsUpdate = true;
  stationObject.userData.kind = 'stop';
  stationObject.userData.stopKeys = model.stops.map((stop) => stop.key);
  return stationObject;
}

function createStationPillarObject(model: Transit3DModel, heights: Map<string, number>): THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> {
  const geometry = new THREE.CylinderGeometry(.2, .28, 1, 8);
  const material = new THREE.MeshStandardMaterial({ color: '#7891aa', transparent: true, opacity: .55, roughness: .75, metalness: 0 });
  const stationPillarObject = new THREE.InstancedMesh(geometry, material, Math.max(1, model.stops.length));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  model.stops.forEach((stop, index) => {
    const height = (heights.get(stop.stationId) ?? 0) * TRANSIT_VERTICAL_SCALE;
    const point = worldPoint(stop.position);
    position.set(point.x, Math.max(.1, height / 2), point.z);
    scale.set(1, Math.max(.1, height), 1);
    matrix.compose(position, rotation, scale);
    stationPillarObject.setMatrixAt(index, matrix);
  });
  stationPillarObject.instanceMatrix.needsUpdate = true;
  stationPillarObject.userData.kind = 'stop-pillar';
  stationPillarObject.userData.stopKeys = model.stops.map((stop) => stop.key);
  return stationPillarObject;
}

function createGroundReference(model: Transit3DModel): THREE.Group {
  const minX = model.bounds.minX * TRANSIT_WORLD_SCALE;
  const maxX = model.bounds.maxX * TRANSIT_WORLD_SCALE;
  const minZ = model.bounds.minY * TRANSIT_WORLD_SCALE;
  const maxZ = model.bounds.maxY * TRANSIT_WORLD_SCALE;
  const size = Math.max(maxX - minX, maxZ - minZ, 10) * 1.35;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const reference = new THREE.Group();
  reference.name = 'transit-ground-reference';

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color: '#eef4f8', transparent: true, opacity: .9, depthWrite: false })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(centerX, -.08, centerZ);

  const divisions = Math.max(8, Math.min(24, Math.round(size / 5)));
  const grid = new THREE.GridHelper(size, divisions, '#b7cbd9', '#d9e6ee');
  grid.position.set(centerX, -.02, centerZ);

  reference.add(plane, grid);
  return reference;
}

export function createTransitLayers(model: Transit3DModel, viewport: TransitLayerViewport): TransitSceneLayers {
  const root = new THREE.Group();
  root.name = 'transit-route-layers';
  const segmentObjects = new Map<string, Line2>();
  const segmentVolumeObjects = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  for (const segment of model.segments) {
    const line = createSegmentObject(segment, viewport);
    const volume = createSegmentVolume(segment);
    segmentObjects.set(segment.key, line);
    segmentVolumeObjects.set(segment.key, volume);
    root.add(volume, line);
  }
  const heights = stationHeights(model);
  const stationPillarObject = createStationPillarObject(model, heights);
  const stationObject = createStationObject(model, heights);
  root.add(createGroundReference(model), stationPillarObject, stationObject);
  return { root, segmentObjects, segmentVolumeObjects, stationObject, stationPillarObject };
}

export function updateSegmentSelection(layers: TransitSceneLayers, selectedKey?: string): void {
  for (const [key, line] of layers.segmentObjects) {
    const selected = key === selectedKey;
    const material = line.material;
    material.color.set(selected ? '#fff3a6' : String(line.userData.baseColor));
    material.opacity = selected ? 1 : Number(line.userData.baseOpacity);
    material.linewidth = selected ? Number(line.userData.baseWidth) + 1.5 : Number(line.userData.baseWidth);
    line.userData.selected = selected;

    const volume = layers.segmentVolumeObjects.get(key);
    if (!volume) continue;
    volume.material.color.set(selected ? '#fff3a6' : String(volume.userData.baseColor));
    volume.material.emissive.set(selected ? '#766400' : '#000000');
    volume.material.opacity = selected ? 0.98 : Number(volume.userData.baseOpacity);
    volume.userData.selected = selected;
  }
}

export function updateLineResolutions(layers: TransitSceneLayers, viewport: TransitLayerViewport): void {
  for (const line of layers.segmentObjects.values()) line.material.resolution.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
}
