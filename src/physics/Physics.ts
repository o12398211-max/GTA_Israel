import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ColliderWorld } from '../world/Colliders';

export { RAPIER };

/** Collision groups (membership << 16 | filter). */
export const GROUP = {
  STATIC: 0x0001,
  VEHICLE: 0x0002,
  TRAFFIC: 0x0004,
  PROP: 0x0008,
};
export const groups = (member: number, filter: number) => (member << 16) | filter;

/**
 * Rapier physics world. Static geometry comes from the city's AABB list
 * (cuboids) and the rendered terrain mesh (trimesh, so wheels follow exactly
 * what you see). Dynamic: player vehicles, thrown props. Kinematic: traffic.
 */
export class Physics {
  world!: RAPIER.World;
  private accumulator = 0;
  readonly step = 1 / 60;
  /** called before each fixed step */
  onStep: ((dt: number) => void)[] = [];

  static async create(colliders: ColliderWorld, terrain: THREE.Mesh, extraMeshes: THREE.Mesh[] = []): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    p.world.timestep = p.step;
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const b of colliders.boxes) {
      const hx = (b.maxX - b.minX) / 2, hy = (b.maxY - b.minY) / 2, hz = (b.maxZ - b.minZ) / 2;
      if (hx <= 0 || hy <= 0 || hz <= 0) continue;
      p.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2)
          .setCollisionGroups(groups(GROUP.STATIC, 0xffff)).setFriction(0.8),
        body,
      );
    }
    for (const m of [terrain, ...extraMeshes]) p.addTrimesh(m, body);
    return p;
  }

  private addTrimesh(mesh: THREE.Mesh, body: RAPIER.RigidBody) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry.index ? mesh.geometry : mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new Float32Array(pos.count * 3);
    const t = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      t.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      v[i * 3] = t.x; v[i * 3 + 1] = t.y; v[i * 3 + 2] = t.z;
    }
    let idx: Uint32Array;
    if (g.index) idx = new Uint32Array(g.index.array);
    else { idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; }
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setCollisionGroups(groups(GROUP.STATIC, 0xffff)).setFriction(1.0), body);
  }

  /** Fixed-step update with interpolation-free catch-up (max 4 steps/frame). */
  update(dt: number) {
    this.accumulator = Math.min(this.accumulator + dt, this.step * 4);
    while (this.accumulator >= this.step) {
      for (const f of this.onStep) f(this.step);
      this.world.step();
      this.accumulator -= this.step;
    }
  }

  /** Ray cast against static world only. Returns hit distance or null. */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number, filter = GROUP.STATIC): number | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true, undefined, groups(0xffff, filter));
    return hit ? hit.timeOfImpact : null;
  }
}
