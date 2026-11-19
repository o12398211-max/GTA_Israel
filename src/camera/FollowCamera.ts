import * as THREE from 'three';
import type { InputState } from '../core/Input';
import type { ColliderWorld } from '../world/Colliders';
import { terrainHeight } from '../world/Terrain';

/**
 * GTA-style third-person orbit camera: mouse/stick orbit, wheel zoom, slight
 * over-the-shoulder offset, auto-recenter behind the player while moving,
 * and obstruction handling against buildings/terrain.
 */
export class FollowCamera {
  yaw = 0; // camera looks along (sin yaw, 0, cos yaw)
  pitch = 0.28;
  distance = 5.5;
  private targetDistance = 5.5;
  private idleLook = 0;
  private current = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private shoulder = 0.45;

  constructor(readonly camera: THREE.PerspectiveCamera, private colliders: ColliderWorld) {}

  setDistance(d: number) { this.targetDistance = d; this.maxDistance = Math.max(14, d * 1.6); }
  private maxDistance = 14;
  private vehicleMode = false;

  snap(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.focus.copy(target);
    this.computeDesired(this.current);
  }

  update(dt: number, input: InputState, target: THREE.Vector3, playerYaw: number, playerSpeed: number, vehicle = false): void {
    this.vehicleMode = vehicle;
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, -0.5, 1.25);
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + input.zoom * 0.8, 2.2, this.maxDistance);
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-8 * dt));

    // gently swing behind the player when moving and not touching the camera
    const touched = Math.abs(input.lookX) + Math.abs(input.lookY) > 1e-4;
    this.idleLook = touched ? 0 : this.idleLook + dt;
    if ((this.idleLook > (this.vehicleMode ? 0.6 : 1.2)) && playerSpeed > 1.5) {
      let d = playerYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-(this.vehicleMode ? 3.5 : 1.2) * dt)) * Math.min(1, playerSpeed / 6);
      this.pitch += (0.22 - this.pitch) * (1 - Math.exp(-0.8 * dt));
    }

    // focus point: chest height, smoothed (slightly more lag vertically)
    const f = new THREE.Vector3(target.x, target.y + (this.vehicleMode ? 1.8 : 1.55), target.z);
    const kh = 1 - Math.exp(-18 * dt), kv = 1 - Math.exp(-9 * dt);
    this.focus.x += (f.x - this.focus.x) * kh;
    this.focus.z += (f.z - this.focus.z) * kh;
    this.focus.y += (f.y - this.focus.y) * kv;

    const desired = new THREE.Vector3();
    this.computeDesired(desired);
    this.current.copy(desired);
    this.camera.position.copy(this.current);
    const look = this.focus.clone().add(this.rightVec().multiplyScalar(this.shoulder * (this.distance / 5.5)));
    this.camera.lookAt(look);
    // speed-based FOV kick
    const fov = 62 + THREE.MathUtils.smoothstep(playerSpeed, 5, 8) * 6;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  private rightVec() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  private computeDesired(out: THREE.Vector3): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const origin = this.focus.clone().add(this.rightVec().multiplyScalar(this.shoulder));
    // ray-march toward the desired position and stop before obstacles
    const step = 0.2;
    let dist = this.distance;
    for (let d = 0.4; d <= this.distance; d += step) {
      const p = origin.clone().addScaledVector(back, d);
      if (this.colliders.pointInside(p.x, p.y, p.z) || p.y < terrainHeight(p.x, p.z) + 0.25) { dist = Math.max(0.4, d - step * 1.5); break; }
    }
    out.copy(origin).addScaledVector(back, dist);
  }
}
