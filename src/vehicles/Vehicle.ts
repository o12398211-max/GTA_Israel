import * as THREE from 'three';
import { RAPIER, GROUP, groups, type Physics } from '../physics/Physics';
import { buildVehicleModel, getKit, type VehicleKit, type VehicleType } from './VehicleKits';
import type { ColliderWorld } from '../world/Colliders';
import { terrainHeight, WORLD } from '../world/Terrain';

export interface DriveInput { throttle: number; brake: number; steer: number; handbrake: boolean; pitch: number; roll: number; yaw: number }

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Player-drivable vehicle. Ground vehicles use Rapier's ray-cast vehicle
 * controller with arcade assists (speed-sensitive steering, extra grip,
 * downforce, anti-roll, drift with the handbrake). The plane uses a simple
 * kinematic flight model.
 */
export class Vehicle {
  readonly kit: VehicleKit;
  readonly model: THREE.Group;
  readonly wheels: THREE.Object3D[];
  private sirens: THREE.Mesh | null;
  body: RAPIER.RigidBody | null = null;
  private ctrl: RAPIER.DynamicRayCastVehicleController | null = null;
  occupied = false;
  speed = 0; // m/s signed forward
  skid = 0; // 0..1 lateral slip (for squeal + smoke)
  impact = 0; // last collision intensity
  sirenOn = false;
  private steerAngle = 0;
  private wheelSpin = 0;
  private lean = 0;
  // plane state
  private flight = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), throttle: 0, airborne: false };
  private lastVel = new THREE.Vector3();
  private rest = 0.28;
  private prop: THREE.Object3D | null = null;

  constructor(readonly type: VehicleType, private physics: Physics, private colliders: ColliderWorld, x: number, z: number, yaw: number, paint: number) {
    this.kit = getKit(type);
    const built = buildVehicleModel(this.kit, paint);
    this.model = built.group;
    this.wheels = built.wheels;
    this.sirens = built.sirens;
    const y = this.groundY(x, z) + 0.6;
    if (type === 'plane') {
      this.flight.pos.set(x, y - 0.6, z);
      this.flight.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.prop = this.model.children[this.model.children.length - 1 - this.wheels.length];
      this.prop.position.set(0, 1.5, 3.55);
      this.syncPlane();
      return;
    }
    const k = this.kit;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + k.size.y, z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
      .setLinearDamping(0.05).setAngularDamping(k.twoWheeler ? 3 : 0.6).setCanSleep(true);
    this.body = physics.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(k.size.x, k.size.y * 0.7, k.size.z).setTranslation(0, k.size.y * 0.9, 0)
      .setMass(k.mass).setFriction(0.4).setRestitution(0.15)
      .setCollisionGroups(groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.VEHICLE | GROUP.TRAFFIC | GROUP.PROP))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    physics.world.createCollider(col, this.body);
    // lower the center of mass for arcade stability
    this.body.setAdditionalMassProperties(k.mass * 0.5, { x: 0, y: -0.3, z: 0 }, { x: k.mass * 0.4, y: k.mass * 0.5, z: k.mass * 0.3 }, { w: 1, x: 0, y: 0, z: 0 }, true);
    this.ctrl = physics.world.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    const rest = k.type === 'bus' ? 0.35 : 0.28;
    this.rest = rest;
    k.wheels.forEach((w, i) => {
      this.ctrl!.addWheel({ x: w.x, y: w.y - k.size.y + rest, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, w.r);
      this.ctrl!.setWheelSuspensionStiffness(i, k.twoWheeler ? 40 : 30);
      this.ctrl!.setWheelSuspensionCompression(i, 4.4);
      this.ctrl!.setWheelSuspensionRelaxation(i, 2.3);
      this.ctrl!.setWheelMaxSuspensionTravel(i, 0.25);
      this.ctrl!.setWheelMaxSuspensionForce(i, k.mass * 60);
      this.ctrl!.setWheelFrictionSlip(i, k.grip * (w.drive ? 1 : 1.1));
      this.ctrl!.setWheelSideFrictionStiffness(i, 1);
    });
    // body origin is at chassis center; offset model so wheels sit right
    this.model.position.set(x, y, z);
  }

  private groundY(x: number, z: number) { return Math.max(terrainHeight(x, z), this.colliders.supportHeight(x, z, 0.5, 100)); }

  get position(): THREE.Vector3 { return this.model.position; }
  get quaternion(): THREE.Quaternion { return this.model.quaternion; }
  get yaw(): number { _e.setFromQuaternion(this.model.quaternion, 'YXZ'); return _e.y; }
  get forward(): THREE.Vector3 { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion); }
  get isPlane() { return this.type === 'plane'; }
  get airborne() { return this.flight.airborne; }

  /** World position of the driver seat. */
  seatWorld(): THREE.Vector3 { return this.kit.seat.clone().applyQuaternion(this.model.quaternion).add(this.model.position); }
  /** Door / exit position (left side). */
  exitPoint(): THREE.Vector3 { return new THREE.Vector3(this.kit.size.x + 1.0, 0, 0).applyQuaternion(this.model.quaternion).add(this.model.position); }

  /** Called every fixed physics step. */
  fixedUpdate(dt: number, inp: DriveInput | null) {
    if (this.isPlane) { if (this.occupied || this.flight.airborne || this.flight.vel.lengthSq() > 0.01) this.updatePlane(dt, inp); return; }
    const b = this.body!, c = this.ctrl!, k = this.kit;
    // parked and at rest: let Rapier keep it asleep, skip the ray-cast vehicle update
    if (!this.occupied && b.isSleeping()) { this.speed = 0; this.skid = 0; return; }
    if (this.occupied && b.isSleeping()) b.wakeUp();
    if (!this.occupied) {
      const lv = b.linvel();
      this.restT = Math.hypot(lv.x, lv.y, lv.z) < 0.08 ? this.restT + dt : 0;
      if (this.restT > 1.5) { b.sleep(); return; }
    }
    const lin = b.linvel();
    const rot = b.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    const fwd = _v.set(0, 0, 1).applyQuaternion(_q);
    this.speed = lin.x * fwd.x + lin.y * fwd.y + lin.z * fwd.z;
    const absSpeed = Math.abs(this.speed);
    // collision impact from velocity delta
    const dv = Math.hypot(lin.x - this.lastVel.x, lin.y - this.lastVel.y, lin.z - this.lastVel.z);
    this.impact = Math.max(this.impact * 0.9, dv > 3 ? dv : 0);
    this.lastVel.set(lin.x, lin.y, lin.z);

    const t = inp ?? { throttle: 0, brake: 0, steer: 0, handbrake: !this.occupied, pitch: 0, roll: 0, yaw: 0 };
    // steering: less lock at speed
    const maxSteer = k.steer * THREE.MathUtils.lerp(1, 0.35, THREE.MathUtils.clamp(absSpeed / 30, 0, 1));
    this.steerAngle += (t.steer * maxSteer - this.steerAngle) * Math.min(1, dt * 8);
    let engine = 0, brake = 0;
    if (t.throttle > 0) engine = this.speed < k.maxSpeed ? t.throttle * k.engine : 0;
    if (t.brake > 0) {
      if (this.speed > 1) brake = t.brake * k.mass * 0.012;
      else engine = this.speed > -8 ? -t.brake * k.engine * 0.5 : 0; // reverse
    }
    if (!t.throttle && !t.brake) brake = k.mass * 0.0012; // rolling resistance
    k.wheels.forEach((w, i) => {
      c.setWheelSteering(i, w.steer ? this.steerAngle : 0);
      c.setWheelEngineForce(i, w.drive ? engine / 2 : 0);
      c.setWheelBrake(i, t.handbrake && !w.steer ? k.mass * 0.02 : brake);
      c.setWheelFrictionSlip(i, t.handbrake && w.drive ? k.grip * 0.45 : k.grip);
    });
    c.updateVehicle(dt, undefined, groups(0xffff, GROUP.STATIC | GROUP.TRAFFIC | GROUP.PROP), (col) => col.parent()?.handle !== b.handle);

    // arcade assists: downforce, anti-roll / keep two-wheelers upright, yaw assist
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    const grounded = k.wheels.some((_, i) => c.wheelIsInContact(i));
    if (grounded) b.applyImpulse({ x: 0, y: -absSpeed * k.mass * 0.05 * dt, z: 0 }, true);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    const rollErr = right.y; // >0 rolled left
    const pitchErr = fwd.y;
    const av = b.angvel();
    const uprightK = k.twoWheeler ? 30 : 6;
    b.applyTorqueImpulse({
      x: (fwd.x * -rollErr * uprightK - av.x * (k.twoWheeler ? 0.8 : 0.1)) * k.mass * dt * (grounded ? 1 : 0.3),
      y: 0,
      z: (fwd.z * -rollErr * uprightK - av.z * (k.twoWheeler ? 0.8 : 0.1)) * k.mass * dt * (grounded ? 1 : 0.3),
    }, true);
    // in the air: let the player control pitch a little, and auto-level
    if (!grounded) b.applyTorqueImpulse({ x: right.x * (pitchErr * 2 + t.pitch) * k.mass * dt * 0.5, y: 0, z: right.z * (pitchErr * 2 + t.pitch) * k.mass * dt * 0.5 }, true);
    // flipped car? auto-reset after a moment
    if (up.y < 0.2 && absSpeed < 2) this.flipTimer += dt; else this.flipTimer = 0;
    if (this.flipTimer > 2.5) this.resetUpright();
    // lateral slip for squeal
    const lat = lin.x * right.x + lin.z * right.z;
    this.skid = grounded ? THREE.MathUtils.clamp((Math.abs(lat) - 2.5) / 6, 0, 1) + (t.handbrake && absSpeed > 6 ? 0.6 : 0) : 0;
    this.lean += ((k.twoWheeler ? -this.steerAngle * Math.min(1, absSpeed / 10) * 0.9 : 0) - this.lean) * Math.min(1, dt * 6);
    // keep inside the world
    const p = b.translation();
    if (p.y < -30 || p.x < WORLD.minX || p.x > WORLD.maxX || p.z < WORLD.minZ || p.z > WORLD.maxZ) this.resetUpright(true);
  }
  private flipTimer = 0;
  private restT = 0;

  resetUpright(moveToRoad = false) {
    const b = this.body!;
    const p = b.translation();
    let x = THREE.MathUtils.clamp(p.x, WORLD.minX + 10, WORLD.maxX - 10), z = THREE.MathUtils.clamp(p.z, WORLD.minZ + 10, WORLD.maxZ - 10);
    if (moveToRoad && x < WORLD.shoreX) x = -195;
    if (p.y < -30) z = 0;
    b.setTranslation({ x, y: this.groundY(x, z) + 1.5, z }, true);
    b.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw), true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Sync render model with physics (every frame). */
  sync(dt: number) {
    if (this.isPlane) { this.syncPlane(); return; }
    const b = this.body!, c = this.ctrl!;
    const t = b.translation(), r = b.rotation();
    this.model.position.set(t.x, t.y - this.kit.size.y, t.z);
    this.model.quaternion.set(r.x, r.y, r.z, r.w);
    if (this.kit.twoWheeler) this.model.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean));
    this.wheelSpin += (this.speed / Math.max(0.1, this.kit.wheels[0].r)) * dt;
    const vis = this.kit.twoWheeler ? [0, 2] : this.kit.wheels.map((_, i) => i);
    vis.forEach((wi, i) => {
      const pivot = this.wheels[i];
      if (!pivot) return;
      const w = this.kit.wheels[wi];
      const susp = c.wheelSuspensionLength(wi) ?? 0.28;
      pivot.position.y = w.y + this.rest - susp;
      pivot.rotation.y = w.steer ? this.steerAngle : 0;
      pivot.children[0].rotation.x = this.wheelSpin;
    });
    if (this.sirens) {
      const m = this.sirens.material as THREE.MeshStandardMaterial;
      const ph = Math.floor(performance.now() / 180) % 2;
      m.emissive.setHex(this.sirenOn ? (ph ? 0x2244ff : 0xff2222) : 0x112266);
      m.emissiveIntensity = this.sirenOn ? 4 : 0.3;
    }
  }

  // ---------------------------------------------------------------- plane
  private updatePlane(dt: number, inp: DriveInput | null) {
    const f = this.flight;
    const t = inp ?? { throttle: 0, brake: 0, steer: 0, handbrake: false, pitch: 0, roll: 0, yaw: 0 };
    f.throttle = THREE.MathUtils.clamp(f.throttle + (t.throttle - t.brake) * dt * 0.6, 0, 1);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(f.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.q);
    const airspeed = f.vel.dot(fwd);
    // thrust, drag, lift
    const acc = fwd.clone().multiplyScalar(f.throttle * 14);
    acc.addScaledVector(f.vel, -0.012 * f.vel.length());
    const aoa = THREE.MathUtils.clamp(fwd.y * 3, -0.5, 1);
    const lift = THREE.MathUtils.clamp(airspeed / 27, 0, 1.4) ** 2 * 9.81 * (1.0 + aoa * 0.4);
    acc.addScaledVector(up, lift);
    acc.y -= 9.81;
    f.vel.addScaledVector(acc, dt);
    // velocity follows the nose (simplified aerodynamics)
    const speed = f.vel.length();
    if (speed > 5) f.vel.lerp(fwd.clone().multiplyScalar(speed), Math.min(1, dt * 1.5 * THREE.MathUtils.clamp(airspeed / 25, 0, 1)));
    // control surfaces (effectiveness grows with airspeed)
    const ctl = THREE.MathUtils.clamp(airspeed / 25, 0.05, 1.2);
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-t.pitch * 1.1 * ctl * dt, (t.yaw * 0.4 - t.roll * 0.25 * (f.airborne ? 1 : 0) + (f.airborne ? 0 : t.steer * 0.8)) * ctl * dt, -t.roll * 1.6 * ctl * dt * (f.airborne ? 1 : 0), 'XYZ'));
    f.q.multiply(dq).normalize();
    // stability / auto-trim: nose and wings return to level when the stick is released
    if (f.airborne) {
      const e = new THREE.Euler().setFromQuaternion(f.q, 'YXZ');
      if (!t.pitch) e.x += (-0.04 - e.x) * Math.min(1, dt * 0.8);
      if (!t.roll) e.z += (0 - e.z) * Math.min(1, dt * 0.9);
      e.x = THREE.MathUtils.clamp(e.x, -1.2, 1.2);
      f.q.setFromEuler(e);
    }
    // bank turns
    if (f.airborne) { const bank = new THREE.Vector3(1, 0, 0).applyQuaternion(f.q).y; f.q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bank * dt * 0.8)); }
    f.pos.addScaledVector(f.vel, dt);
    const g = this.groundY(f.pos.x, f.pos.z);
    if (f.pos.y <= g + 0.05) {
      const hard = f.vel.y < -6 || this.colliders.pointInside(f.pos.x, f.pos.y + 1, f.pos.z);
      f.pos.y = g + 0.05;
      if (f.vel.y < 0) f.vel.y = 0;
      f.vel.multiplyScalar(1 - dt * (t.brake > 0 ? 1.5 : 0.3));
      // level out on the ground
      const e = new THREE.Euler().setFromQuaternion(f.q, 'YXZ');
      if (!(t.pitch > 0 && airspeed > 18)) e.x = Math.min(e.x * 0.9, 0) + Math.max(0, e.x) * 0.9;
      e.x = Math.max(e.x, -0.35); // can lift the nose for take-off
      e.z *= 0.9;
      f.q.setFromEuler(e);
      f.airborne = false;
      if (hard) { this.impact = 12; f.vel.set(0, 0, 0); }
    } else if (f.pos.y > g + 1.5) f.airborne = true;
    if (this.colliders.pointInside(f.pos.x, f.pos.y + 1.2, f.pos.z)) { this.impact = 15; f.vel.multiplyScalar(-0.2); f.pos.addScaledVector(fwd, -2); }
    f.pos.y = Math.min(f.pos.y, 600);
    f.pos.x = THREE.MathUtils.clamp(f.pos.x, WORLD.minX - 300, WORLD.maxX + 300);
    f.pos.z = THREE.MathUtils.clamp(f.pos.z, WORLD.minZ - 300, WORLD.maxZ + 300);
    this.speed = airspeed;
    this.impact *= 0.9;
  }
  private syncPlane() {
    this.model.position.copy(this.flight.pos);
    this.model.quaternion.copy(this.flight.q);
    // propeller
    if (this.prop) this.prop.rotation.z += 0.3 + this.flight.throttle;
  }
  get throttle() { return this.flight.throttle; }

  dispose() {
    if (this.body) this.physics.world.removeRigidBody(this.body);
    if (this.ctrl) this.physics.world.removeVehicleController(this.ctrl);
    this.model.removeFromParent();
  }
}
