import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeSceneResources } from '../../../src/renderer/three/scene';
import { createTransitLayers, updateSegmentSelection } from '../../../src/renderer/three/layers';
import type { Transit3DModel } from '../../../src/renderer/three/model';

function sceneModel(): Transit3DModel {
  return {
    origin: { latitude: 37, longitude: 127 },
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 5 },
    omittedCoordinateCount: 0,
    segments: [
      {
        key: 'segment-a', fromStationId: 'A', toStationId: 'B', fromStationName: '가', toStationName: '나', directionLabel: '순방향',
        from: { x: 0, y: 0, z: 1 }, to: { x: 50, y: 50, z: 1 }, color: '#55b947', width: 2, opacity: .82, height: 1,
        congestionPercent: 10, previousOnboard: 0, boardings: 1, alightings: 0, peakOnboardPassengers: 1
      },
      {
        key: 'segment-b', fromStationId: 'B', toStationId: 'C', fromStationName: '나', toStationName: '다', directionLabel: '순방향',
        from: { x: 50, y: 50, z: 3 }, to: { x: 100, y: 100, z: 3 }, color: '#e62626', width: 5, opacity: .82, height: 3,
        congestionPercent: 50, previousOnboard: 1, boardings: 2, alightings: 0, peakOnboardPassengers: 3
      }
    ],
    stops: [
      { key: 'stop-a', stationId: 'A', stationName: '가', sequence: 1, position: { x: 0, y: 0, z: 0 } },
      { key: 'stop-b', stationId: 'B', stationName: '나', sequence: 2, position: { x: 50, y: 50, z: 0 } },
      { key: 'stop-c', stationId: 'C', stationName: '다', sequence: 3, position: { x: 100, y: 100, z: 0 } }
    ]
  };
}

describe('transit scene layers', () => {
  it('creates one pickable segment per segment and one instanced station layer', () => {
    const layers = createTransitLayers(sceneModel(), { width: 800, height: 600 });
    const firstLine = layers.segmentObjects.get('segment-a');
    if (!firstLine) throw new Error('segment layer missing');
    const end = firstLine.geometry.getAttribute('instanceEnd') as THREE.BufferAttribute;

    expect(layers.segmentObjects.size).toBe(2);
    expect(layers.stationObject.userData.stopKeys).toEqual(['stop-a', 'stop-b', 'stop-c']);
    expect(layers.root.children).toHaveLength(3);
    expect(end.getX(0)).toBeCloseTo(2.5);
    expect(end.getZ(0)).toBeCloseTo(2.5);
  });

  it('updates only the selected segment visual state', () => {
    const layers = createTransitLayers(sceneModel(), { width: 800, height: 600 });
    const first = layers.segmentObjects.get('segment-a');
    const second = layers.segmentObjects.get('segment-b');
    if (!first || !second) throw new Error('segment layer missing');
    const firstMaterial = first.material as THREE.ShaderMaterial & { linewidth?: number; opacity: number };
    const secondMaterial = second.material as THREE.ShaderMaterial & { linewidth?: number; opacity: number };

    expect(first.material.worldUnits).toBe(false);
    expect(firstMaterial.linewidth).toBeGreaterThanOrEqual(3);

    updateSegmentSelection(layers, 'segment-a');

    expect(first.userData.selected).toBe(true);
    expect(second.userData.selected).toBe(false);
    expect(firstMaterial.opacity).toBe(1);
    expect(secondMaterial.opacity).toBe(.82);
  });

  it('disposes owned geometry and material resources exactly once', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    vi.spyOn(geometry, 'dispose');
    vi.spyOn(material, 'dispose');
    root.add(new THREE.Mesh(geometry, material));

    disposeSceneResources(root);
    disposeSceneResources(root);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(root.children).toHaveLength(0);
  });
});
