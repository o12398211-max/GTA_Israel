import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** A GLTF flattened into (geometry, material) parts with baked transforms, ready for instancing. */
export interface ModelParts { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; size: THREE.Vector3 }

const loader = new GLTFLoader();
const cache = new Map<string, ModelParts>();
const BASE = `${import.meta.env.BASE_URL}assets/models/`;

/**
 * Load a CC0 model from public/assets/models/<key>/<key>.gltf.
 * `filter` picks nodes by name (some Poly Haven files contain variants side by side).
 * The result is re-centered so its footprint is centered on the origin and its base at y=0.
 */
export async function loadModel(key: string, filter?: (name: string) => boolean): Promise<ModelParts> {
  const ck = key + (filter ? ':f' : '');
  if (cache.has(ck)) return cache.get(ck)!;
  const gltf = await loader.loadAsync(`${BASE}${key}/${key}.gltf`);
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelParts['parts'] = [];
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (filter) {
      let ok = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p.name && filter(p.name)) { ok = true; break; }
      if (!ok) return;
    }
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    g.computeBoundingBox();
    box.union(g.boundingBox!);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length > 1 && g.groups.length) {
      // split multi-material meshes into one part per group
      for (const grp of g.groups) {
        const sub = g.clone();
        sub.setDrawRange(grp.start, grp.count);
        sub.clearGroups();
        parts.push({ geometry: sub, material: mats[grp.materialIndex ?? 0] });
      }
    } else parts.push({ geometry: g, material: mats[0] });
  });
  const c = box.getCenter(new THREE.Vector3());
  for (const p of parts) p.geometry.translate(-c.x, -box.min.y, -c.z);
  const res = { parts, size: box.getSize(new THREE.Vector3()) };
  cache.set(ck, res);
  return res;
}

/** Collects transforms and builds one InstancedMesh per model part. */
export class ModelInstancer {
  private matrices: THREE.Matrix4[] = [];
  constructor(private model: ModelParts, private opts: { castShadow?: boolean; name?: string } = {}) {}
  add(x: number, y: number, z: number, rotY = 0, scale = 1): this {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
    this.matrices.push(m);
    return this;
  }
  build(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = this.opts.name ?? 'model-instances';
    for (const p of this.model.parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, this.matrices.length));
      im.count = this.matrices.length;
      this.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = this.opts.castShadow ?? true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    return group;
  }
}
