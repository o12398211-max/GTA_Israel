import * as THREE from 'three';
import type { Game } from '../core/Game';
import { GameOverlay, groundY } from './common';
import { canvasTexture } from '../world/Materials';
import type { MgResult } from './Matkot';

/** Public shelters placed around the map. */
export const SHELTERS = [
  { x: -209.5, z: -60, rot: Math.PI / 2 },
  { x: -209.5, z: 140, rot: Math.PI / 2 },
  { x: -240, z: -150, rot: Math.PI / 2 },
  { x: 150, z: 14, rot: Math.PI },
  { x: 578, z: 14, rot: Math.PI },
];

let built = false;
/** Concrete public shelters with a green sign (built once). */
export function buildShelters(game: Game) {
  if (built) return;
  built = true;
  const sign = canvasTexture(512, 160, (ctx) => {
    ctx.fillStyle = '#0b7a3b'; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 496, 144);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
    ctx.font = 'bold 64px Rubik, Arial'; ctx.fillText('מרחב מוגן', 256, 82);
    ctx.font = 'bold 34px Arial'; ctx.direction = 'ltr'; ctx.fillText('Public Shelter', 256, 132);
  });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 });
  const door = new THREE.MeshStandardMaterial({ color: 0x2f6b46, roughness: 0.5, metalness: 0.4 });
  const signMat = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 });
  for (const s of SHELTERS) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.7, 3.2), concrete);
    body.position.y = 1.35; body.castShadow = body.receiveShadow = true;
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.08), door); d.position.set(0, 1.0, 1.62);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), signMat); sg.position.set(0, 2.35, 1.62);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9dffb5, emissiveIntensity: 1.5 }));
    lamp.position.set(0, 2.05, 1.7);
    g.add(body, d, sg, lamp);
    const y = groundY(s.x, s.z);
    g.position.set(s.x, y, s.z);
    g.rotation.y = s.rot;
    game.scene.add(g);
    // colliders: walkable around, the door side is the target
    const w = Math.abs(Math.sin(s.rot)) > 0.5 ? 3.2 : 4.2, dd = Math.abs(Math.sin(s.rot)) > 0.5 ? 4.2 : 3.2;
    game.city.colliders.addBox(s.x, s.z, w, dd, 2.7, y);
    game.physics.addStaticBox(s.x, y + 1.35, s.z, w / 2, 1.35, dd / 2);
  }
}

export function shelterDoor(i: number) {
  const s = SHELTERS[i];
  return { x: s.x + Math.sin(s.rot) * 2.6, z: s.z + Math.cos(s.rot) * 2.6 };
}

/**
 * "ריצה למקלט" – an alert arrives on the phone; get to the nearest public
 * shelter within the time limit. Presented calmly and respectfully: no
 * explosions, no panic – just following instructions, then life goes on.
 */
export class ShelterRun {
  private ui!: GameOverlay;
  private timeLeft: number;
  private target = 0;
  private inside = 0;
  private result: MgResult = 'running';
  constructor(private game: Game, private limit = 90) { this.timeLeft = limit; }

  get targetPos() { return shelterDoor(this.target); }

  start() {
    const g = this.game;
    buildShelters(g);
    const p = g.player.position;
    let best = 0, bd = Infinity;
    SHELTERS.forEach((_, i) => { const d = shelterDoor(i); const dist = Math.hypot(d.x - p.x, d.z - p.z); if (dist < bd) { bd = dist; best = i; } });
    this.target = best;
    g.phone.push('alert', 'התרעה', 'יש להיכנס למרחב מוגן. שמרו על קור רוח ופעלו לפי ההנחיות.', true);
    g.audio.play('alert');
    this.ui = new GameOverlay('shelter', `<div class="title">⚠️ התרעה באזור</div><div class="clock">90</div><div class="hint">לכו למרחב המוגן הקרוב (סימון ירוק)</div>`);
    this.timeLeft = this.limit;
  }

  update(dt: number): MgResult {
    const g = this.game;
    if (this.result !== 'running') return this.result;
    const p = g.vehicles.current ? g.vehicles.current.position : g.player.position;
    const t = this.targetPos;
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    if (this.inside > 0) {
      this.inside += dt;
      if (this.inside > 4) { this.result = 'won'; this.ui.remove(); }
      return 'running';
    }
    this.timeLeft -= dt;
    this.ui.set('.clock', String(Math.max(0, Math.ceil(this.timeLeft))));
    this.ui.q('.clock').classList.toggle('low', this.timeLeft < 20);
    if (d < 2.6 && !g.vehicles.current) {
      this.inside = 0.001;
      this.ui.el.innerHTML = `<div class="title">✅ הגעת למרחב המוגן</div><div class="hint">נשארים בפנים עד לקבלת הנחיה. כולם בסדר. מישהו כבר הוציא בורקס.</div>`;
      g.setHour(g.dayNight.hour + 10 / 60);
      g.phone.push('alert', 'עדכון', 'ניתן לצאת מהמרחב המוגן. המשיכו בשגרה.');
      return 'running';
    }
    if (this.timeLeft <= 0) { this.result = 'lost'; this.ui.remove(); }
    return this.result;
  }
  dispose() { this.ui?.remove(); }
}
