import * as THREE from 'three';
import { SkinnedCharacter, randomOutfit, type Outfit, type State } from '../entities/SkinnedCharacter';
import { terrainHeight } from '../world/Terrain';
import { loadModel } from '../render/GltfInstances';
import { RAPIER, GROUP, groups, type Physics } from '../physics/Physics';

/** A scripted character for mini-games and cutscenes. */
export class Npc {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  name: string;
  private constructor(readonly ch: SkinnedCharacter, name: string) { this.name = name; }
  static async create(scene: THREE.Scene, outfit: Outfit | null, name = '', seed = Math.random()): Promise<Npc> {
    let s = seed * 1e6;
    const r = () => { s = (s * 16807) % 2147483647; return (s % 1e6) / 1e6; };
    const ch = await SkinnedCharacter.create(outfit ?? randomOutfit(r));
    scene.add(ch.root);
    return new Npc(ch, name);
  }
  place(x: number, z: number, yaw = this.yaw, y?: number) {
    this.pos.set(x, y ?? groundY(x, z), z);
    this.yaw = yaw;
    this.sync(0);
  }
  /** walk toward a point; returns remaining distance */
  moveTo(x: number, z: number, speed: number, dt: number): number {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, speed * dt);
      this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
      this.pos.y = groundY(this.pos.x, this.pos.z);
      let dy = Math.atan2(dx, dz) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 10);
      this.speed = speed;
    } else this.speed = 0;
    return d;
  }
  face(x: number, z: number) { this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z); }
  set state(s: State | null) { this.ch.forced = s; }
  sync(dt: number) {
    this.ch.root.position.copy(this.pos);
    this.ch.root.rotation.y = this.yaw;
    this.ch.update(dt, this.speed, true, 0);
  }
  dispose() { this.ch.root.removeFromParent(); }
}

export function groundY(x: number, z: number) {
  const t = terrainHeight(x, z);
  if (x > -213 && x < 76) return Math.max(t, 0.15);
  return t;
}

/** Overlay panel used by mini-games (score, meters, instructions). */
export class GameOverlay {
  readonly el: HTMLDivElement;
  constructor(cls: string, html = '') {
    this.el = document.createElement('div');
    this.el.className = `mg-overlay ${cls}`;
    this.el.innerHTML = html;
    document.getElementById('hud')!.appendChild(this.el);
  }
  q<T extends HTMLElement = HTMLElement>(sel: string) { return this.el.querySelector(sel) as T; }
  set(sel: string, text: string) { const e = this.q(sel); if (e && e.textContent !== text) e.textContent = text; }
  remove() { this.el.remove(); }
}

/** Floating comic text ("POW!", "טוק!") projected to screen. */
export class ComicText {
  private items: { el: HTMLDivElement; pos: THREE.Vector3; t: number }[] = [];
  spawn(text: string, pos: THREE.Vector3, color = '#ffe14d') {
    const el = document.createElement('div');
    el.className = 'comic-pop';
    el.textContent = text;
    el.style.color = color;
    document.getElementById('hud')!.appendChild(el);
    this.items.push({ el, pos: pos.clone(), t: 0 });
  }
  update(dt: number, camera: THREE.Camera) {
    const v = new THREE.Vector3();
    for (const it of this.items) {
      it.t += dt;
      v.copy(it.pos).setY(it.pos.y + it.t * 1.2).project(camera);
      it.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      it.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      it.el.style.opacity = String(Math.max(0, 1 - it.t / 0.9));
      it.el.style.display = v.z < 1 ? '' : 'none';
    }
    this.items = this.items.filter((it) => { if (it.t > 0.9) { it.el.remove(); return false; } return true; });
  }
}

/** Throwable white plastic chairs (Rapier dynamic bodies + CC0 model). */
export class ChairProps {
  private chairs: { body: RAPIER.RigidBody; mesh: THREE.Group; life: number }[] = [];
  private template: THREE.Group | null = null;
  constructor(private scene: THREE.Scene, private physics: Physics) {}
  async init() {
    const model = await loadModel('chair');
    const g = new THREE.Group();
    for (const p of model.parts) { const m = new THREE.Mesh(p.geometry, p.material); m.castShadow = true; g.add(m); }
    this.template = g;
  }
  throw(from: THREE.Vector3, vel: THREE.Vector3) {
    if (!this.template) return;
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z)
      .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.42, 0.3).setTranslation(0, 0.42, 0).setMass(3).setRestitution(0.4)
      .setCollisionGroups(groups(GROUP.PROP, GROUP.STATIC | GROUP.VEHICLE | GROUP.PROP | GROUP.TRAFFIC)), body);
    const mesh = this.template.clone();
    this.scene.add(mesh);
    this.chairs.push({ body, mesh, life: 20 });
    if (this.chairs.length > 30) this.removeAt(0);
  }
  private removeAt(i: number) { const c = this.chairs[i]; this.physics.world.removeRigidBody(c.body); c.mesh.removeFromParent(); this.chairs.splice(i, 1); }
  /** returns chairs near a point moving fast (for hits) */
  hits(p: THREE.Vector3, r: number): number {
    let n = 0;
    for (const c of this.chairs) {
      const t = c.body.translation(), v = c.body.linvel();
      if (Math.hypot(t.x - p.x, t.y + 0.4 - (p.y + 1), t.z - p.z) < r && Math.hypot(v.x, v.y, v.z) > 4) { n++; c.body.setLinvel({ x: v.x * -0.3, y: 1, z: v.z * -0.3 }, true); }
    }
    return n;
  }
  update(dt: number) {
    for (let i = this.chairs.length - 1; i >= 0; i--) {
      const c = this.chairs[i];
      const t = c.body.translation(), r = c.body.rotation();
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      c.life -= dt;
      if (c.life < 0) this.removeAt(i);
    }
  }
  clear() { while (this.chairs.length) this.removeAt(0); }
}
