import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Seeded PRNG so the city is identical for every player (important for multiplayer). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next: rnd,
    range: (min: number, max: number) => min + (max - min) * rnd(),
    int: (min: number, max: number) => Math.floor(min + (max - min + 1) * rnd()),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)],
    chance: (p: number) => rnd() < p,
  };
}
export type Rng = ReturnType<typeof mulberry32>;

/** Give a geometry a flat vertex color (for merged low-poly props). */
export function colored(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng.attributes.uv) ng.deleteAttribute('uv');
    if (!ng.attributes.color) colored(ng, 0xffffff);
    return ng;
  });
  const m = mergeGeometries(prepared, false)!;
  m.computeBoundingSphere();
  return m;
}

/** Unit box with its base on y=0 – scaled per instance. */
export const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Collects instances and builds one InstancedMesh (one draw call). */
export class Instancer {
  private matrices: number[] = [];
  private colors: number[] = [];
  private hasColor = false;

  constructor(
    readonly geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
    readonly opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {},
  ) {}

  get count() { return this.matrices.length / 16; }

  add(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0, color?: THREE.ColorRepresentation, rotX = 0, rotZ = 0): this {
    _e.set(rotX, rotY, rotZ, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.matrices.push(..._m.elements);
    const c = new THREE.Color(color ?? 0xffffff);
    if (color !== undefined) this.hasColor = true;
    this.colors.push(c.r, c.g, c.b);
    return this;
  }

  build(): THREE.InstancedMesh {
    const n = this.count;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, n));
    mesh.count = n;
    mesh.instanceMatrix.array.set(this.matrices);
    if (this.hasColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.colors), 3);
    mesh.castShadow = !!this.opts.castShadow;
    mesh.receiveShadow = this.opts.receiveShadow ?? true;
    mesh.name = this.opts.name ?? 'instances';
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    return mesh;
  }
}
