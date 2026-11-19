import * as THREE from 'three';
import { SkinnedCharacter, OUTFITS, randomOutfit, type State } from './SkinnedCharacter';
import { CITY } from '../world/City';
import { terrainHeight, WORLD } from '../world/Terrain';
import { mulberry32 } from '../world/Builders';

/**
 * Pedestrians: a pool of animated characters that live near the player.
 * They walk sidewalk loops around city blocks, the promenade, the beach and
 * the old city. Behaviour states: walk, idle (phone / chatting), flee (car
 * coming), knocked (cartoon fall – no blood), chase (police).
 * Agents that drift far from the player are recycled to a spot nearby.
 */
type PedKind = 'local' | 'tourist' | 'police';
interface Path { pts: THREE.Vector2[]; loop: boolean; y: number | null; zone: 'city' | 'beach' | 'jerusalem' }
interface Ped {
  ch: SkinnedCharacter; kind: PedKind; path: Path; seg: number; t: number; speed: number; dirSign: 1 | -1;
  state: 'walk' | 'idle' | 'flee' | 'knocked' | 'chase' | 'getup'; timer: number;
  pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; dazed: number;
}

export interface PedEvents { hitByCar: number; caught: boolean; punched: number }

export class Pedestrians {
  readonly group = new THREE.Group();
  private peds: Ped[] = [];
  private paths: Path[] = [];
  private rnd = mulberry32(4242);
  private stars: THREE.Group[] = [];
  readonly events: PedEvents = { hitByCar: 0, caught: false, punched: 0 };

  private constructor() {}

  static async create(count = 22, policeCount = 3): Promise<Pedestrians> {
    const p = new Pedestrians();
    p.buildPaths();
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const kind: PedKind = i < policeCount ? 'police' : p.rnd.chance(0.3) ? 'tourist' : 'local';
      jobs.push((async () => {
        const outfit = kind === 'police' ? OUTFITS.police : randomOutfit(p.rnd.next, kind === 'tourist' ? 'tourist' : 'local');
        const ch = await SkinnedCharacter.create(outfit);
        const ped: Ped = { ch, kind, path: p.paths[0], seg: 0, t: 0, speed: 1.3, dirSign: 1, state: 'walk', timer: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, dazed: 0 };
        p.peds.push(ped);
        p.group.add(ch.root);
        const star = p.makeDizzyStars();
        star.visible = false;
        ch.root.add(star);
        p.stars.push(star);
      })());
    }
    await Promise.all(jobs);
    return p;
  }

  private makeDizzyStars(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo, mat); m.position.set(Math.cos(i * 1.57) * 0.28, 0, Math.sin(i * 1.57) * 0.28); g.add(m); }
    g.position.y = 1.9;
    g.name = 'dizzy';
    return g;
  }

  private buildPaths() {
    const { streetsX, streetsZ, streetW } = CITY;
    const xs = [...streetsX, CITY.ayalon.west - 4];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < streetsZ.length - 1; j++) {
      const x0 = xs[i] + streetW / 2 + 1.4, x1 = xs[i + 1] - streetW / 2 - 1.4;
      const z0 = streetsZ[j] + streetW / 2 + 1.4, z1 = streetsZ[j + 1] - streetW / 2 - 1.4;
      this.paths.push({ pts: [new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)], loop: true, y: 0.15, zone: 'city' });
    }
    // promenade (two directions) and beach strolls
    for (const x of [-204, -209]) this.paths.push({ pts: [new THREE.Vector2(x, -380), new THREE.Vector2(x, 380)], loop: false, y: 0.15, zone: 'beach' });
    for (let k = 0; k < 6; k++) {
      const x = -230 - k * 10;
      this.paths.push({ pts: [new THREE.Vector2(x, -300 + k * 40), new THREE.Vector2(x - 20, -200 + k * 40), new THREE.Vector2(x + 5, -100 + k * 40)], loop: false, y: null, zone: 'beach' });
    }
    // shuk alley
    this.paths.push({ pts: [new THREE.Vector2(-140, -1.5), new THREE.Vector2(-6, -1.5)], loop: false, y: 0.15, zone: 'city' });
    this.paths.push({ pts: [new THREE.Vector2(-6, 1.5), new THREE.Vector2(-140, 1.5)], loop: false, y: 0.15, zone: 'city' });
    // old city lanes
    const { minX, maxX, gateZ } = CITY.jeru;
    this.paths.push({ pts: [new THREE.Vector2(minX - 30, gateZ - 1.5), new THREE.Vector2(maxX - 5, gateZ - 1.5)], loop: false, y: null, zone: 'jerusalem' });
    this.paths.push({ pts: [new THREE.Vector2(590, -60), new THREE.Vector2(590, 60)], loop: false, y: null, zone: 'jerusalem' });
  }

  private pointOn(path: Path, seg: number, t: number): THREE.Vector2 {
    const a = path.pts[seg], b = path.pts[(seg + 1) % path.pts.length];
    return a.clone().lerp(b, t);
  }

  /** Put a ped somewhere on a path within [minD, maxD] of the focus point. */
  private relocate(p: Ped, focus: THREE.Vector3, minD: number, maxD: number) {
    for (let tries = 0; tries < 30; tries++) {
      const path = this.rnd.pick(this.paths);
      const seg = this.rnd.int(0, path.loop ? path.pts.length - 1 : path.pts.length - 2);
      const t = this.rnd.next();
      const pt = this.pointOn(path, seg, t);
      const d = Math.hypot(pt.x - focus.x, pt.y - focus.z);
      if (d < minD || d > maxD) continue;
      if (p.kind === 'police' && path.zone === 'beach' && this.rnd.chance(0.5)) continue;
      p.path = path; p.seg = seg; p.t = t; p.dirSign = this.rnd.chance(0.5) ? 1 : -1;
      p.speed = p.kind === 'tourist' ? this.rnd.range(0.9, 1.2) : this.rnd.range(1.15, 1.6);
      p.state = 'walk'; p.timer = this.rnd.range(5, 25);
      p.pos.set(pt.x, this.groundY(path, pt.x, pt.y), pt.y);
      p.ch.root.visible = true;
      return true;
    }
    return false;
  }

  private groundY(path: Path, x: number, z: number) {
    return path.y ?? (x < -212 ? terrainHeight(x, z) : Math.max(terrainHeight(x, z), x > 500 ? WORLD.jerusalemHeight : 0));
  }

  private initialized = false;

  /**
   * @param player player feet position
   * @param vehicles moving vehicles that can hit peds
   * @param nerves current nerve stars (police chase at 2+)
   */
  update(dt: number, player: THREE.Vector3, vehicles: { pos: THREE.Vector3; vel: THREE.Vector3; radius: number }[], nerves: number) {
    this.events.hitByCar = 0;
    this.events.caught = false;
    if (!this.initialized) { for (const p of this.peds) this.relocate(p, player, 5, 70); this.initialized = true; }
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      const dist = p.pos.distanceTo(player);
      if (dist > 95 && p.state !== 'chase') { this.relocate(p, player, 45, 85); continue; }

      // threats: fast vehicles
      for (const v of vehicles) {
        const speed = v.vel.length();
        if (speed < 3) continue;
        const rel = p.pos.clone().sub(v.pos);
        const d = Math.hypot(rel.x, rel.z);
        if (d < v.radius + 0.4 && p.state !== 'knocked') {
          // cartoon tumble
          p.state = 'knocked'; p.timer = 3.2; p.dazed = 3.2;
          p.vel.set(v.vel.x * 0.6 + rel.x * 2, 4 + speed * 0.25, v.vel.z * 0.6 + rel.z * 2);
          p.ch.trigger('death', 3);
          this.events.hitByCar++;
        } else if (d < 9 && p.state === 'walk') {
          const vdir = v.vel.clone().setY(0).normalize();
          if (rel.dot(vdir) > 0) { p.state = 'flee'; p.timer = 1.4; const side = new THREE.Vector3(-vdir.z, 0, vdir.x); if (side.dot(rel) < 0) side.negate(); p.vel.copy(side.multiplyScalar(4.5)); }
        }
      }

      let moving = 0;
      switch (p.state) {
        case 'walk': {
          if (p.kind === 'police' && nerves >= 2 && dist < 60) { p.state = 'chase'; break; }
          const a = p.path.pts[p.seg], b = p.path.pts[(p.seg + 1) % p.path.pts.length];
          const len = a.distanceTo(b);
          p.t += (p.dirSign * p.speed * dt) / Math.max(0.1, len);
          if (p.t > 1 || p.t < 0) {
            const n = p.path.pts.length;
            if (p.path.loop) { p.seg = (p.seg + (p.t > 1 ? 1 : n - 1)) % n; p.t = p.t > 1 ? 0 : 1; }
            else if ((p.t > 1 && p.seg >= n - 2) || (p.t < 0 && p.seg <= 0)) { p.dirSign = (p.dirSign * -1) as 1 | -1; p.t = THREE.MathUtils.clamp(p.t, 0, 1); }
            else { p.seg += p.t > 1 ? 1 : -1; p.t = p.t > 1 ? 0 : 1; }
          }
          const pt = this.pointOn(p.path, p.seg, p.t);
          // small lateral offset per ped so they don't walk in a single file
          const dir = b.clone().sub(a).normalize().multiplyScalar(p.dirSign);
          const off = ((i % 5) - 2) * 0.35;
          const nx = pt.x - dir.y * off, nz = pt.y + dir.x * off;
          p.yaw = Math.atan2(dir.x, dir.y);
          p.pos.set(nx, this.groundY(p.path, nx, nz), nz);
          moving = p.speed;
          p.timer -= dt;
          if (p.timer < 0) { p.state = 'idle'; p.timer = this.rnd.range(2, 6); }
          break;
        }
        case 'idle':
          p.timer -= dt;
          if (p.timer < 0) { p.state = 'walk'; p.timer = this.rnd.range(8, 25); }
          if (dist < 3) p.yaw = Math.atan2(player.x - p.pos.x, player.z - p.pos.z); // look at the player
          break;
        case 'flee':
          p.pos.addScaledVector(p.vel, dt);
          p.yaw = Math.atan2(p.vel.x, p.vel.z);
          moving = p.vel.length();
          p.timer -= dt;
          if (p.timer < 0) p.state = 'walk';
          break;
        case 'knocked': {
          p.vel.y -= 14 * dt;
          p.pos.addScaledVector(p.vel, dt);
          const g = this.groundY(p.path, p.pos.x, p.pos.z);
          if (p.pos.y < g) { p.pos.y = g; p.vel.multiplyScalar(0.5); p.vel.y = Math.abs(p.vel.y) > 2 ? -p.vel.y * 0.3 : 0; }
          p.timer -= dt;
          if (p.timer < 0) { p.state = 'getup'; p.timer = 1.2; p.ch.trigger('roll', 1.0); }
          break;
        }
        case 'getup':
          p.timer -= dt;
          if (p.timer < 0) { p.state = 'walk'; p.timer = 10; }
          break;
        case 'chase': {
          const to = player.clone().sub(p.pos).setY(0);
          const d = to.length();
          if (nerves < 1 || d > 70) { p.state = 'walk'; break; }
          to.normalize();
          const sp = d > 3 ? 5.2 : 0;
          p.pos.addScaledVector(to, sp * dt);
          p.pos.y = Math.max(terrainHeight(p.pos.x, p.pos.z), p.pos.x > -213 && p.pos.x < 500 ? 0.15 : p.pos.y);
          p.yaw = Math.atan2(to.x, to.z);
          moving = sp;
          if (d < 1.6) { this.events.caught = true; p.state = 'idle'; p.timer = 3; p.ch.trigger('interact', 1); }
          break;
        }
      }
      if (p.dazed > 0) p.dazed -= dt;
      this.stars[i].visible = p.dazed > 0;
      this.stars[i].rotation.y += dt * 5;

      p.ch.root.position.copy(p.pos);
      p.ch.root.rotation.y = p.yaw;
      // animation LOD: skip far mixers on alternate frames
      if (dist < 70) p.ch.update(dt, moving, true, 0);
      p.ch.root.visible = dist < 110;
    }
  }

  /** Player punch: hits the nearest ped in front. Returns true if someone was hit. */
  punch(from: THREE.Vector3, yaw: number): boolean {
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (const p of this.peds) {
      const rel = p.pos.clone().sub(from);
      if (rel.length() < 1.6 && rel.normalize().dot(fwd) > 0.4 && p.state !== 'knocked') {
        p.state = 'knocked'; p.timer = 2.5; p.dazed = 2.5;
        p.vel.copy(fwd).multiplyScalar(3).setY(2.5);
        p.ch.trigger('hit', 0.5);
        this.events.punched++;
        return true;
      }
    }
    return false;
  }

  /** Obstacles for traffic (cars stop for pedestrians on the road). */
  obstacles(): { pos: THREE.Vector3; radius: number }[] {
    return this.peds.filter((p) => p.ch.root.visible).map((p) => ({ pos: p.pos, radius: 0.4 }));
  }

  nearest(pos: THREE.Vector3, max = 2): Ped | null {
    let best: Ped | null = null, bd = max;
    for (const p of this.peds) { const d = p.pos.distanceTo(pos); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  get list() { return this.peds; }
  forceState(i: number, st: State | null) { if (this.peds[i]) this.peds[i].ch.forced = st; }
}
