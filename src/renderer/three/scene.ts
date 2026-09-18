import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Transit3DModel } from './model';
import { createTransitLayers, TRANSIT_VERTICAL_SCALE, TRANSIT_WORLD_SCALE, updateLineResolutions, updateSegmentSelection, type TransitSceneLayers } from './layers';
import { pickTransitObject, type TransitScenePick } from './interaction';

export interface TransitSceneController {
  update: (model: Transit3DModel, selectedKey?: string) => void;
  setBasemapCanvas: (model: Transit3DModel, canvas: HTMLCanvasElement) => void;
  select: (selectedKey?: string) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  dispose: () => void;
}

export interface TransitSceneOptions {
  canvas: HTMLCanvasElement;
  onPick: (pick: TransitScenePick) => void;
  onContextLost?: () => void;
}

type RenderableObject = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

export function disposeSceneResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const renderable = object as RenderableObject;
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (renderable.material) {
      const ownedMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      ownedMaterials.forEach((material) => {
        materials.add(material);
        const texture = (material as THREE.Material & { map?: THREE.Texture | null }).map;
        if (texture) textures.add(texture);
      });
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  root.clear();
}

function fitCamera(camera: THREE.PerspectiveCamera, controls: MapControls, model: Transit3DModel): void {
  const centerX = (model.bounds.minX + model.bounds.maxX) / 2 * TRANSIT_WORLD_SCALE;
  const centerY = (model.bounds.minY + model.bounds.maxY) / 2 * TRANSIT_WORLD_SCALE;
  const centerZ = model.bounds.maxZ * TRANSIT_VERTICAL_SCALE / 2;
  const extent = Math.max((model.bounds.maxX - model.bounds.minX) * TRANSIT_WORLD_SCALE, (model.bounds.maxY - model.bounds.minY) * TRANSIT_WORLD_SCALE, model.bounds.maxZ * TRANSIT_VERTICAL_SCALE, 10);
  const distance = extent * 1.35;
  camera.near = .1;
  camera.far = Math.max(1000, extent * 20);
  camera.position.set(centerX + distance * .78, distance * .82, centerY + distance * .78);
  camera.updateProjectionMatrix();
  controls.target.set(centerX, centerZ, centerY);
  controls.update();
}

export function createTransitSceneController(options: TransitSceneOptions): TransitSceneController {
  const renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setClearColor('#f6f9fc', 1);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 1000);
  const controls = new MapControls(camera, options.canvas);
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c9d5', 2.2));
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.4);
  keyLight.position.set(40, 80, 25);
  scene.add(keyLight);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let layers: TransitSceneLayers | undefined;
  let basemap: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
  let disposed = false;

  const removeBasemap = (): void => {
    if (!basemap) return;
    scene.remove(basemap);
    disposeSceneResources(basemap);
    basemap = undefined;
  };

  const handleControlChange = (): void => { if (!disposed) controller.render(); };
  const handlePointerDown = (event: PointerEvent): void => {
    if (disposed || !layers) return;
    const rect = options.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const pick = pickTransitObject(raycaster, pointer, camera, layers);
    if (pick) options.onPick(pick);
  };
  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    options.onContextLost?.();
  };

  const controller: TransitSceneController = {
    update(model, selectedKey) {
      if (disposed) return;
      removeBasemap();
      if (layers) {
        scene.remove(layers.root);
        disposeSceneResources(layers.root);
      }
      const rect = options.canvas.getBoundingClientRect();
      layers = createTransitLayers(model, { width: rect.width, height: rect.height });
      scene.add(layers.root);
      fitCamera(camera, controls, model);
      updateSegmentSelection(layers, selectedKey);
      controller.resize(rect.width, rect.height);
      controller.render();
    },
    setBasemapCanvas(model, canvas) {
      if (disposed) return;
      removeBasemap();
      const width = Math.max((model.bounds.maxX - model.bounds.minX) * TRANSIT_WORLD_SCALE, 1);
      const depth = Math.max((model.bounds.maxY - model.bounds.minY) * TRANSIT_WORLD_SCALE, 1);
      const centerX = (model.bounds.minX + model.bounds.maxX) / 2 * TRANSIT_WORLD_SCALE;
      const centerZ = (model.bounds.minY + model.bounds.maxY) / 2 * TRANSIT_WORLD_SCALE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .82, depthWrite: false });
      basemap = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
      basemap.name = 'transit-map-underlay';
      basemap.rotation.x = Math.PI / 2;
      basemap.position.set(centerX, -.045, centerZ);
      basemap.renderOrder = -1;
      scene.add(basemap);
      controller.render();
    },
    select(selectedKey) {
      if (disposed || !layers) return;
      updateSegmentSelection(layers, selectedKey);
      controller.render();
    },
    resize(width, height) {
      if (disposed) return;
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      renderer.setSize(safeWidth, safeHeight, false);
      camera.aspect = safeWidth / safeHeight;
      camera.updateProjectionMatrix();
      if (layers) updateLineResolutions(layers, { width: safeWidth, height: safeHeight });
    },
    render() {
      if (!disposed) renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.canvas.removeEventListener('pointerdown', handlePointerDown);
      options.canvas.removeEventListener('webglcontextlost', handleContextLost);
      controls.removeEventListener('change', handleControlChange);
      controls.dispose();
      removeBasemap();
      if (layers) disposeSceneResources(layers.root);
      scene.clear();
      renderer.dispose();
      layers = undefined;
    }
  };

  controls.addEventListener('change', handleControlChange);
  options.canvas.addEventListener('pointerdown', handlePointerDown);
  options.canvas.addEventListener('webglcontextlost', handleContextLost);
  return controller;
}
