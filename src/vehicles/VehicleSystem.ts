import * as THREE from 'three';
import { Vehicle, type DriveInput } from './Vehicle';
import type { VehicleType } from './VehicleKits';
import type { Physics } from '../physics/Physics';
import type { ColliderWorld } from '../world/Colliders';

/** Parked vehicles the player can take (F to enter / exit). */
export const PARKED: { type: VehicleType; x: number; z: number; yaw: number; paint: number }[] = [
  { type: 'sedan', x: -199, z: 42, yaw: Math.PI, paint: 0xb3122a },
  { type: 'ebike', x: -211, z: 16, yaw: Math.PI, paint: 0x1f6fd1 },
  { type: 'scooter', x: -211, z: 13, yaw: Math.PI, paint: 0x1db954 },
  { type: 'moto', x: -199, z: 52, yaw: Math.PI, paint: 0x111111 },
  { type: 'taxi', x: -146.1, z: -45, yaw: 0, paint: 0xf4f1e6 },
  { type: 'scooter', x: -100, z: 6, yaw: Math.PI / 2, paint: 0xff5a1f },
  { type: 'hatch', x: -54.1, z: 50, yaw: 0, paint: 0x1d4e9e },
  { type: 'police', x: 0.1, z: 60, yaw: Math.PI, paint: 0xf5f6f8 },
  { type: 'sedan', x: 140, z: 5.5, yaw: Math.PI / 2, paint: 0x202226 },
  { type: 'bus', x: 180, z: 90, yaw: Math.PI / 2, paint: 0xf2f2f2 },
  { type: 'plane', x: -232, z: -330, yaw: 0, paint: 0xf5f5f5 },
  { type: 'sedan', x: 470, z: 5.5, yaw: -Math.PI / 2, paint: 0xd9a520 },
];

export class VehicleSystem {
  readonly group = new THREE.Group();
  readonly vehicles: Vehicle[] = [];
  current: Vehicle | null = null;

  constructor(private physics: Physics, private colliders: ColliderWorld) {
    for (const p of PARKED) this.spawn(p.type, p.x, p.z, p.yaw, p.paint);
    physics.onStep.push((dt) => {
      for (const v of this.vehicles) v.fixedUpdate(dt, v === this.current ? this.driveInput : null);
    });
  }
  driveInput: DriveInput | null = null;

  spawn(type: VehicleType, x: number, z: number, yaw: number, paint: number): Vehicle {
    const v = new Vehicle(type, this.physics, this.colliders, x, z, yaw, paint);
    this.vehicles.push(v);
    this.group.add(v.model);
    return v;
  }

  nearest(pos: THREE.Vector3, max = 3.5): Vehicle | null {
    let best: Vehicle | null = null, bd = max;
    for (const v of this.vehicles) {
      const d = v.position.distanceTo(pos) - Math.max(v.kit.size.x, v.kit.size.z) * 0.6;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  sync(dt: number) { for (const v of this.vehicles) v.sync(dt); }

  /** Moving vehicles as threats for pedestrians. */
  movers(): { pos: THREE.Vector3; vel: THREE.Vector3; radius: number }[] {
    return this.vehicles.filter((v) => Math.abs(v.speed) > 3).map((v) => ({ pos: v.position, vel: v.forward.multiplyScalar(v.speed), radius: Math.max(v.kit.size.x, 1.0) }));
  }
}
