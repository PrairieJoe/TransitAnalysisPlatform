import * as THREE from 'three';
import type { TransitSceneLayers } from './layers';

export interface TransitScenePick {
  kind: 'segment' | 'stop';
  key: string;
}

export function pickTransitObject(
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  layers: TransitSceneLayers
): TransitScenePick | undefined {
  raycaster.setFromCamera(pointer, camera);
  const targets: THREE.Object3D[] = [...layers.segmentObjects.values(), ...layers.segmentVolumeObjects.values(), layers.stationObject];
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return undefined;
  if (hit.object === layers.stationObject && hit.instanceId !== undefined) {
    const key = layers.stationObject.userData.stopKeys?.[hit.instanceId] as string | undefined;
    return key ? { kind: 'stop', key } : undefined;
  }
  const key = hit.object.userData.key as string | undefined;
  return key ? { kind: 'segment', key } : undefined;
}
