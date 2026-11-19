import * as THREE from 'three';
import type { InputState } from '../core/Input';
import type { AABB, ColliderWorld } from '../world/Colliders';
import { terrainHeight, WORLD } from '../world/Terrain';
/** Anything that can visualize the player (procedural fallback or skinned GLTF). */
export interface CharacterView {
  root: THREE.Object3D;
  update(dt: number, speed: number, grounded: boolean, vy: number, swimming?: boolean): void;
}

const GRAVITY = -24;
const JUMP_V = 7.6;
const WALK = 1.6, JOG = 3.8, RUN = 6.6, SWIM = 1.6, SWIM_FAST = 2.8;
const RADIUS = 0.35, HEIGHT = 1.8, STEP = 0.45;
const CLIMB_MAX = 2.3; // ledge height you can climb (vault) onto
const SWIM_DEPTH = 1.15; // water depth at which you start swimming
const SWIM_FEET = -0.55; // feet height while floating (body lies at the surface)
const tmp: AABB[] = [];

/**
 * Kinematic on-foot controller (stage 1). Handles walking, running, jumping,
 * stepping up curbs, vaulting/climbing ledges, swimming, and collision with the
 * static AABB world. Stage 2 moves this onto a Rapier kinematic character
 * controller; the public surface (position, velocity, yaw, update) stays.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0; // facing angle; forward = (sin yaw, 0, cos yaw)
  grounded = true;
  swimming = false;
  private coyote = 0;
  private climb: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;

  constructor(readonly model: CharacterView, private colliders: ColliderWorld) {}

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }
  get isClimbing(): boolean { return this.climb !== null; }

  spawn(x: number, z: number, yaw = 0): void {
    this.position.set(x, this.groundAt(x, z, 50), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
  }

  /** Highest walkable surface at or below `maxY` (terrain or box tops). */
  groundAt(x: number, z: number, maxY: number): number {
    const t = terrainHeight(x, z);
    const s = this.colliders.supportHeight(x, z, RADIUS, maxY);
    return Math.max(t, s);
  }

  update(dt: number, input: InputState, cameraYaw: number): void {
    if (this.climb) { this.updateClimb(dt); this.syncModel(dt); return; }

    // desired direction relative to camera
    const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
    const rx = -Math.cos(cameraYaw), rz = Math.sin(cameraYaw);
    let dx = fx * input.moveY + rx * input.moveX;
    let dz = fz * input.moveY + rz * input.moveX;
    const mag = Math.min(1, Math.hypot(dx, dz));
    const dl = Math.hypot(dx, dz);
    if (dl > 0.001) { dx /= dl; dz /= dl; }

    const waterDepth = WORLD.seaLevel - terrainHeight(this.position.x, this.position.z);
    this.swimming = waterDepth > SWIM_DEPTH && this.position.y < WORLD.seaLevel + SWIM_FEET + 0.3;

    const maxSpeed = this.swimming ? (input.run ? SWIM_FAST : SWIM) : (input.run ? RUN : input.walk ? WALK : JOG);
    const accel = this.grounded || this.swimming ? 14 : 3.5;
    const tvx = dx * maxSpeed * mag, tvz = dz * maxSpeed * mag;
    const a = 1 - Math.exp(-accel * dt);
    this.velocity.x += (tvx - this.velocity.x) * a;
    this.velocity.z += (tvz - this.velocity.z) * a;

    // face movement direction
    if (mag > 0.05) {
      const targetYaw = Math.atan2(dx, dz);
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-12 * dt));
    }

    // vertical
    if (this.swimming) {
      const surface = WORLD.seaLevel + SWIM_FEET;
      this.velocity.y += (surface - this.position.y) * 6 * dt - this.velocity.y * 4 * dt;
      this.velocity.y += Math.sin(performance.now() / 600) * 0.15 * dt; // bobbing
    } else {
      this.velocity.y += GRAVITY * dt;
    }
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (input.jump && !this.swimming) {
      if (!this.tryStartClimb(dx, dz, mag)) {
        if (this.coyote > 0) { this.velocity.y = JUMP_V; this.coyote = 0; this.grounded = false; }
      }
    }

    // integrate horizontal with collision
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.resolveHorizontal();
    this.position.x = THREE.MathUtils.clamp(this.position.x, WORLD.minX, WORLD.maxX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, WORLD.minZ, WORLD.maxZ);

    // integrate vertical
    this.position.y += this.velocity.y * dt;
    const ground = this.groundAt(this.position.x, this.position.z, this.position.y + STEP);
    if (this.position.y <= ground + 0.001) {
      // snap / step up
      this.position.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.velocity.y <= 0 && this.position.y - ground < STEP) {
      // stick to ground when walking down steps/slopes
      this.position.y = ground;
      this.velocity.y = 0;
    } else {
      this.grounded = false;
    }
    // ceiling (gate arches, lifeguard decks)
    const head = this.position.y + HEIGHT;
    for (const b of this.colliders.query(this.position.x - RADIUS, this.position.z - RADIUS, this.position.x + RADIUS, this.position.z + RADIUS, tmp)) {
      if (b.minY > this.position.y + STEP && b.minY < head && this.overlapsXZ(b, RADIUS * 0.7)) {
        this.position.y = b.minY - HEIGHT;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
    }
    this.syncModel(dt);
  }

  private overlapsXZ(b: AABB, r: number): boolean {
    const p = this.position;
    return p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ;
  }

  /** Circle-vs-AABB push-out for every box that blocks the body's vertical span. */
  private resolveHorizontal(): void {
    const p = this.position;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.colliders.query(p.x - RADIUS, p.z - RADIUS, p.x + RADIUS, p.z + RADIUS, tmp)) {
        if (b.maxY <= p.y + STEP || b.minY >= p.y + HEIGHT) continue;
        const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
        const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
        let ox = p.x - cx, oz = p.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 < 1e-8) {
          // center inside the box: push out along the shallowest axis
          const pen = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z];
          const i = pen.indexOf(Math.min(...pen));
          ox = i === 0 ? -1 : i === 1 ? 1 : 0; oz = i === 2 ? -1 : i === 3 ? 1 : 0;
          const depth = pen[i] + RADIUS;
          p.x += ox * depth; p.z += oz * depth;
        } else {
          const d = Math.sqrt(d2);
          const push = RADIUS - d;
          ox /= d; oz /= d;
          p.x += ox * push; p.z += oz * push;
          // kill velocity into the wall
          const vn = this.velocity.x * ox + this.velocity.z * oz;
          if (vn < 0) { this.velocity.x -= vn * ox; this.velocity.z -= vn * oz; }
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** If there's a ledge in front within reach, vault onto it. */
  private tryStartClimb(dx: number, dz: number, mag: number): boolean {
    const fx = mag > 0.05 ? dx : Math.sin(this.yaw), fz = mag > 0.05 ? dz : Math.cos(this.yaw);
    const px = this.position.x + fx * (RADIUS + 0.45), pz = this.position.z + fz * (RADIUS + 0.45);
    const top = this.groundAt(px, pz, this.position.y + CLIMB_MAX);
    const rise = top - this.position.y;
    if (rise <= STEP + 0.6 || rise > CLIMB_MAX) return false; // low stuff: just jump
    // need headroom on top
    if (this.colliders.pointInside(px, top + 1.0, pz)) return false;
    const to = new THREE.Vector3(this.position.x + fx * (RADIUS + 0.7), top, this.position.z + fz * (RADIUS + 0.7));
    this.climb = { from: this.position.clone(), to, t: 0 };
    this.velocity.set(0, 0, 0);
    this.yaw = Math.atan2(fx, fz);
    return true;
  }

  private updateClimb(dt: number): void {
    const c = this.climb!;
    c.t += dt / 0.55;
    const t = Math.min(1, c.t);
    // up first, then forward
    const up = THREE.MathUtils.smoothstep(t, 0, 0.6);
    const fwd = THREE.MathUtils.smoothstep(t, 0.45, 1);
    this.position.set(
      THREE.MathUtils.lerp(c.from.x, c.to.x, fwd),
      THREE.MathUtils.lerp(c.from.y, c.to.y + 0.05, up),
      THREE.MathUtils.lerp(c.from.z, c.to.z, fwd),
    );
    if (t >= 1) { this.climb = null; this.grounded = true; this.position.y = c.to.y; }
  }

  private syncModel(dt: number): void {
    const m = this.model.root;
    m.position.copy(this.position);
    m.rotation.y = this.yaw;
    this.model.update(dt, this.speed, this.grounded || this.isClimbing, this.isClimbing ? 3 : this.velocity.y, this.swimming);
  }
}
