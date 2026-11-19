import * as THREE from 'three';

/**
 * Asset registry – every visual comes from here so procedural placeholders can
 * be swapped for GLTF models later without touching game code:
 *
 *   registerModel('car.sedan', async () => (await gltfLoader.loadAsync('cars/sedan.glb')).scene);
 *
 * Factories return a fresh Object3D (clone) per call.
 */
type Factory = () => THREE.Object3D | Promise<THREE.Object3D>;
const factories = new Map<string, Factory>();

export function registerModel(id: string, factory: Factory): void {
  factories.set(id, factory);
}

export function hasModel(id: string): boolean {
  return factories.has(id);
}

export async function createModel(id: string): Promise<THREE.Object3D> {
  const f = factories.get(id);
  if (!f) throw new Error(`model not registered: ${id}`);
  return await f();
}
