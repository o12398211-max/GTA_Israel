import * as THREE from 'three';
import { RAPIER, GROUP, groups, type Physics } from '../physics/Physics';
import { getKit, partMaterial, PAINTS, lowPolyGeometry, type VehicleType, type VehicleKit } from './VehicleKits';
import { CITY } from '../world/City';
import { terrainHeight } from '../world/Terrain';
import { mulberry32 } from '../world/Builders';

/**
 * Ambient traffic on a lane graph (right-hand traffic). Each lane is a straight
 * segment; cars wrap around at the ends (out of sight at the map edges).
 * Longitudinal control is IDM (intelligent driver model): keeps distance,
 * queues at red lights and – on the Ayalon – forms the eternal traffic jam
 * with stop-and-go waves. Cars are kinematic Rapier bodies so the player can
 * crash into them; they are rendered with one InstancedMesh per part.
 */
interface Lane {
  a: THREE.Vector2; b: THREE.Vector2; len: number; dir: THREE.Vector2;
  v0: number; jam: boolean; axis: 'NS' | 'EW' | null; stops: number[]; route1: boolean;
  cars: Car[];
}
interface Car {
  lane: Lane; s: number; v: number; type: VehicleType; kit: VehicleKit; paint: THREE.Color;
  body: RAPIER.RigidBody; slot: number; bumped: number; honk: number; len: number; parked: boolean;
}

export interface TrafficObstacle { pos: THREE.Vector3; radius: number }

const LIGHT_CYCLE = 22;

export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];
  private cars: Car[] = [];
  private meshes = new Map<VehicleType, { parts: THREE.InstancedMesh[]; wheels: THREE.InstancedMesh[]; far: THREE.InstancedMesh; count: number }>();
  private time = 0;
  private lightHeads!: THREE.InstancedMesh;
  private lightData: { x: number; z: number; axis: 'NS' | 'EW' }[] = [];
  /** cars that honked this frame (for audio) */
  honks: THREE.Vector3[] = [];
  /** how jammed the Ayalon is right now (0..1), for the patience mini-game */
  jamLevel = 0;

  private farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
  constructor(private physics: Physics, private density = 1) {
    this.buildLanes();
    this.spawnCars();
    this.buildMeshes();
    this.buildLights();
  }

  private addLane(ax: number, az: number, bx: number, bz: number, v0: number, opts: Partial<Pick<Lane, 'jam' | 'axis' | 'route1'>> = {}) {
    const a = new THREE.Vector2(ax, az), b = new THREE.Vector2(bx, bz);
    const lane: Lane = { a, b, len: a.distanceTo(b), dir: b.clone().sub(a).normalize(), v0, jam: !!opts.jam, axis: opts.axis ?? null, stops: [], route1: !!opts.route1, cars: [] };
    this.lanes.push(lane);
    return lane;
  }

  private buildLanes() {
    const { streetsX, streetsZ, ayalon } = CITY;
    const zMin = streetsZ[0] - 18, zMax = streetsZ[streetsZ.length - 1] + 18;
    for (const x of streetsX) {
      const s = this.addLane(x - 2.4, zMin, x - 2.4, zMax, 12.5, { axis: 'NS' }); // southbound
      const n = this.addLane(x + 2.4, zMax, x + 2.4, zMin, 12.5, { axis: 'NS' }); // northbound
      for (const z of streetsZ) { s.stops.push(z - 7 - zMin); n.stops.push(zMax - (z + 7)); }
    }
    for (const z of streetsZ) {
      const e = this.addLane(-196, z + 2.4, ayalon.west - 4, z + 2.4, 11, { axis: 'EW' });
      const w = this.addLane(ayalon.west - 4, z - 2.4, -196, z - 2.4, 11, { axis: 'EW' });
      for (const x of streetsX) { if (x > -190) e.stops.push(x - 7 - -196); if (x > -190) w.stops.push(ayalon.west - 4 - (x + 7)); }
    }
    // Ayalon: 4 lanes each way, permanently jammed
    const lw = (ayalon.median[0] - ayalon.west) / 4;
    for (let i = 0; i < 4; i++) {
      this.addLane(ayalon.west + lw * (i + 0.5), -395, ayalon.west + lw * (i + 0.5), 395, 22, { jam: true });
      this.addLane(ayalon.median[1] + lw * (i + 0.5), 395, ayalon.median[1] + lw * (i + 0.5), -395, 22, { jam: true });
    }
    // Route 1 to Jerusalem
    this.addLane(ayalon.east + 2, 1.9, CITY.jeru.minX - 12, 1.9, 20, { route1: true });
    this.addLane(CITY.jeru.minX - 12, -1.9, ayalon.east + 2, -1.9, 20, { route1: true });
  }

  private spawnCars() {
    const rnd = mulberry32(99);
    const pickType = (lane: Lane): VehicleType => {
      const r = rnd.next();
      if (lane.jam && r < 0.06) return 'bus';
      if (r < 0.04) return 'police';
      if (r < 0.2) return 'taxi';
      if (r < 0.45) return 'hatch';
      return 'sedan';
    };
    for (const lane of this.lanes) {
      const density = (lane.jam ? 1 / 17 : lane.route1 ? 1 / 55 : 1 / 75) * this.density;
      const n = Math.max(1, Math.floor(lane.len * density));
      for (let i = 0; i < n; i++) {
        const type = pickType(lane);
        const kit = getKit(type);
        const s = (i / n) * lane.len + rnd.range(0, lane.len / n * 0.3);
        const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(kit.size.x, kit.size.y * 1.2, kit.size.z).setTranslation(0, kit.size.y * 1.4, 0)
          .setCollisionGroups(groups(GROUP.TRAFFIC, GROUP.VEHICLE | GROUP.PROP)), body);
        const car: Car = { lane, s, v: lane.v0 * 0.5, type, kit, paint: new THREE.Color(type === 'taxi' ? 0xf4f1e6 : type === 'police' ? 0xf5f6f8 : rnd.pick(PAINTS)), body, slot: 0, bumped: 0, honk: rnd.range(3, 20), len: kit.size.z * 2, parked: false };
        lane.cars.push(car);
        this.cars.push(car);
      }
      lane.cars.sort((a, b) => a.s - b.s);
    }
  }

  private buildMeshes() {
    const byType = new Map<VehicleType, Car[]>();
    for (const c of this.cars) { if (!byType.has(c.type)) byType.set(c.type, []); byType.get(c.type)!.push(c); }
    for (const [type, cars] of byType) {
      const kit = getKit(type);
      const parts = kit.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, partMaterial(p.key), cars.length);
        im.castShadow = p.key === 'paint' || p.key === 'glass';
        im.receiveShadow = true;
        im.frustumCulled = false;
        if (p.key === 'paint') { cars.forEach((c, i) => im.setColorAt(i, c.paint)); im.userData.paint = true; }
        this.group.add(im);
        return im;
      });
      const wheels: THREE.InstancedMesh[] = [];
      if (kit.wheelGeo) for (const [g, k] of [[kit.wheelGeo.tire, 'rubber'], [kit.wheelGeo.rim, 'metal']] as const) {
        const im = new THREE.InstancedMesh(g, partMaterial(k), cars.length * 4);
        im.frustumCulled = false;
        this.group.add(im);
        wheels.push(im);
      }
      cars.forEach((c, i) => (c.slot = i));
      const far = new THREE.InstancedMesh(lowPolyGeometry(kit), this.farMat, cars.length);
      far.frustumCulled = false; far.castShadow = false; far.receiveShadow = true;
      cars.forEach((c, i) => far.setColorAt(i, c.paint));
      this.group.add(far);
      this.meshes.set(type, { parts, wheels, far, count: cars.length });
    }
  }

  private buildLights() {
    const { streetsX, streetsZ } = CITY;
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6).translate(0, 2.1, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 }), streetsX.length * streetsZ.length * 2);
    const headGeo = new THREE.BoxGeometry(0.32, 0.9, 0.3).translate(0, 4.3, 0);
    this.lightHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.4 }), streetsX.length * streetsZ.length * 2);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const x of streetsX) for (const z of streetsZ) {
      for (const [px, pz, axis] of [[x - 6.2, z - 6.2, 'NS'], [x + 6.2, z + 6.2, 'EW']] as const) {
        m.makeTranslation(px, 0.15, pz);
        poles.setMatrixAt(i, m);
        this.lightHeads.setMatrixAt(i, m);
        this.lightData.push({ x: px, z: pz, axis });
        i++;
      }
    }
    poles.count = this.lightHeads.count = i;
    poles.castShadow = true;
    this.group.add(poles, this.lightHeads);
  }

  /** Is the light green for an axis? (yellow counts as red for starting cars) */
  private green(axis: 'NS' | 'EW', offset = 0): boolean {
    const t = (this.time + offset) % LIGHT_CYCLE;
    return axis === 'NS' ? t < LIGHT_CYCLE / 2 - 2 : t >= LIGHT_CYCLE / 2 && t < LIGHT_CYCLE - 2;
  }
  private lightColor(axis: 'NS' | 'EW'): number {
    const t = this.time % LIGHT_CYCLE, h = LIGHT_CYCLE / 2;
    const own = axis === 'NS' ? t : (t + h) % LIGHT_CYCLE;
    return own < h - 2 ? 0x22ff66 : own < h ? 0xffb000 : 0xff2a2a;
  }

  /**
   * @param obstacles player / player vehicle etc. – cars brake for them
   */
  update(dt: number, obstacles: TrafficObstacle[], focus: THREE.Vector3) {
    this.time += dt;
    this.honks.length = 0;
    // traffic light colors (cheap: update every frame, ~120 instances)
    const c = new THREE.Color();
    this.lightData.forEach((l, i) => this.lightHeads.setColorAt(i, c.setHex(this.lightColor(l.axis))));
    if (this.lightHeads.instanceColor) this.lightHeads.instanceColor.needsUpdate = true;

    let jamSum = 0, jamN = 0;
    for (const lane of this.lanes) {
      const cars = lane.cars;
      const n = cars.length;
      for (let i = 0; i < n; i++) {
        const car = cars[i];
        const leader = cars[(i + 1) % n];
        let gap = leader.s - car.s - (leader.len + car.len) / 2;
        if (gap < -lane.len / 2) gap += lane.len; // wrap-around leader
        if (n === 1) gap = 1e4;
        let dvLead = car.v - leader.v;
        // red lights act as a stopped leader at the stop line
        if (lane.axis && !this.green(lane.axis)) {
          for (const st of lane.stops) {
            const d = st - car.s - car.len / 2;
            if (d > 0.5 && d < gap && d > (car.v * car.v) / (2 * 6) - 1) { gap = d; dvLead = car.v; }
          }
        }
        // player and other obstacles in this lane ahead
        const cx = lane.a.x + lane.dir.x * car.s, cz = lane.a.y + lane.dir.y * car.s;
        for (const o of obstacles) {
          const rx = o.pos.x - cx, rz = o.pos.z - cz;
          const ahead = rx * lane.dir.x + rz * lane.dir.y;
          const lat = Math.abs(-rx * lane.dir.y + rz * lane.dir.x);
          if (ahead > 0 && ahead < 40 && lat < 1.6 + o.radius) {
            const d = ahead - car.len / 2 - o.radius;
            if (d < gap) { gap = Math.max(0.1, d); dvLead = car.v; }
            if (d < 8 && car.honk <= 0) { this.honks.push(new THREE.Vector3(cx, 1, cz)); car.honk = 4 + Math.random() * 6; }
          }
        }
        // IDM
        let v0 = lane.v0;
        if (lane.jam) {
          // stop-and-go waves travelling backwards through the jam
          const wave = Math.sin(car.s * 0.035 + this.time * 0.25) * 0.5 + 0.5;
          v0 = 1.5 + wave * wave * 9;
        }
        if (car.bumped > 0) { car.bumped -= dt; v0 = 0; }
        const aMax = 1.6, bComf = 2.5, s0 = 2.2, T = lane.jam ? 1.0 : 1.4;
        const sStar = s0 + Math.max(0, car.v * T + (car.v * dvLead) / (2 * Math.sqrt(aMax * bComf)));
        let acc = aMax * (1 - Math.pow(car.v / Math.max(0.1, v0), 4) - Math.pow(sStar / Math.max(0.1, gap), 2));
        acc = Math.max(-9, acc);
        car.v = Math.max(0, car.v + acc * dt);
        car.s += car.v * dt;
        car.honk -= dt;
        if (lane.jam && car.v < 2 && car.honk <= 0 && Math.random() < 0.02) { this.honks.push(new THREE.Vector3(cx, 1, cz)); car.honk = 3 + Math.random() * 8; }
        if (lane.jam && Math.abs(cz - focus.z) < 150) { jamSum += 1 - Math.min(1, car.v / 12); jamN++; }
      }
      // wrap + keep order
      let wrapped = false;
      for (const car of cars) if (car.s >= lane.len) { car.s -= lane.len; wrapped = true; }
      if (wrapped) cars.sort((a, b) => a.s - b.s);
    }
    this.jamLevel = jamN ? jamSum / jamN : 0;
    this.writeTransforms();
  }

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3(1, 1, 1);
  private _wm = new THREE.Matrix4();
  private _full = new THREE.Matrix4();
  /** camera position for distance culling (cars beyond 420 m are collapsed) */
  viewer = new THREE.Vector3();
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  /** full-detail models only up close, boxes beyond */
  lodDistance = 85;
  private writeTransforms() {
    // compact visible cars into the first slots of each InstancedMesh and set
    // .count – the GPU only processes cars within draw range
    const used = new Map<VehicleType, number>();
    const usedFar = new Map<VehicleType, number>();
    for (const k of this.meshes.keys()) { used.set(k, 0); usedFar.set(k, 0); }
    for (const car of this.cars) {
      const l = car.lane;
      const x = l.a.x + l.dir.x * car.s, z = l.a.y + l.dir.y * car.s;
      const d = Math.hypot(x - this.viewer.x, z - this.viewer.z);
      let y = 0.03;
      let pitch = 0;
      if (l.route1) {
        y = terrainHeight(x, z) + 0.06;
        const y2 = terrainHeight(x + l.dir.x * 2, z + l.dir.y * 2) + 0.06;
        pitch = -Math.atan2(y2 - y, 2);
      }
      const yaw = Math.atan2(l.dir.x, l.dir.y);
      this._q.setFromEuler(this._euler.set(pitch, yaw, 0, 'YXZ'));
      // only cars near the viewer take part in physics; far ones are parked under the map
      if (d < 140) { car.body.setNextKinematicTranslation({ x, y, z }); car.body.setNextKinematicRotation(this._q); car.parked = false; }
      else if (!car.parked) { car.body.setTranslation({ x, y: -300, z }, false); car.parked = true; }
      if (d > this.drawDistance) continue;
      if (d > this.lodDistance) {
        const fs = usedFar.get(car.type)!;
        usedFar.set(car.type, fs + 1);
        this._m.compose(this._p.set(x, y, z), this._q, this._s);
        const fm = this.meshes.get(car.type)!.far;
        fm.setMatrixAt(fs, this._m);
        fm.setColorAt(fs, car.paint);
        continue;
      }
      const slot = used.get(car.type)!;
      used.set(car.type, slot + 1);
      this._m.compose(this._p.set(x, y, z), this._q, this._s);
      const mm = this.meshes.get(car.type)!;
      for (const im of mm.parts) {
        im.setMatrixAt(slot, this._m);
        if (im.instanceColor && im.userData.paint) im.setColorAt(slot, car.paint);
      }
      car.kit.wheels.forEach((w, wi) => {
        this._wm.makeTranslation(w.x, w.y, w.z);
        this._full.multiplyMatrices(this._m, this._wm);
        for (const im of mm.wheels) im.setMatrixAt(slot * 4 + wi, this._full);
      });
    }
    for (const [type, mm] of this.meshes) {
      const n = used.get(type)!;
      for (const im of mm.parts) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      for (const im of mm.wheels) { im.count = n * 4; im.instanceMatrix.needsUpdate = true; }
      mm.far.count = usedFar.get(type)!;
      mm.far.instanceMatrix.needsUpdate = true;
      if (mm.far.instanceColor) mm.far.instanceColor.needsUpdate = true;
    }
  }
  /** cars beyond this distance from the camera are not drawn */
  drawDistance = 380;

  /** A player crash into a traffic car: it stops and honks. Returns true if a car was near. */
  bump(at: THREE.Vector3): boolean {
    let best: Car | null = null, bd = 6;
    for (const c of this.cars) {
      const t = c.body.translation();
      const d = Math.hypot(t.x - at.x, t.z - at.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.bumped = 4; best.v = 0; this.honks.push(at.clone()); }
    return !!best;
  }

  /** Push traffic cars away from a spot (spawning the player's car in a lane). */
  clearAround(at: THREE.Vector3, r: number) {
    for (const c of this.cars) {
      const x = c.lane.a.x + c.lane.dir.x * c.s, z = c.lane.a.y + c.lane.dir.y * c.s;
      if (Math.hypot(x - at.x, z - at.z) < r) { c.s = (c.s + r * 2) % c.lane.len; c.v = 0; }
    }
    for (const l of this.lanes) l.cars.sort((a, b) => a.s - b.s);
  }
  /** Nearest lane point + heading (for mini-games / spawning). */
  get carCount() { return this.cars.length; }
}
