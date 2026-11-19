import * as THREE from 'three';
import type { Game } from '../core/Game';
import { GameOverlay } from './common';
import type { MgResult } from './Matkot';
import { mulberry32 } from '../world/Builders';
import { canvasTexture } from '../world/Materials';

export const STADIUM = { x: -60, z: -357, rx: 48, rz: 32 };

let built: THREE.Group | null = null;
let flares: THREE.Points | null = null;

/** Original stadium bowl with an instanced crowd and flare particles. */
export function buildStadium(game: Game): THREE.Group {
  if (built) return built;
  const g = new THREE.Group();
  const { x, z, rx, rz } = STADIUM;
  // bowl: lathe profile, scaled into an ellipse
  const prof = [new THREE.Vector2(1.0, 0), new THREE.Vector2(1.0, 2), new THREE.Vector2(1.18, 6), new THREE.Vector2(1.36, 12), new THREE.Vector2(1.42, 18), new THREE.Vector2(1.46, 18.5), new THREE.Vector2(1.46, 0)];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), new THREE.MeshStandardMaterial({ color: 0x8b8f99, roughness: 0.8, side: THREE.DoubleSide }));
  bowl.scale.set(rx / 1.46, 1, rz / 1.46);
  bowl.castShadow = bowl.receiveShadow = true;
  const pitchTex = canvasTexture(512, 512, (ctx) => {
    for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? '#3f8f3a' : '#4aa043'; ctx.fillRect(0, i * 32, 512, 32); }
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.strokeRect(30, 30, 452, 452);
    ctx.beginPath(); ctx.moveTo(30, 256); ctx.lineTo(482, 256); ctx.stroke(); ctx.beginPath(); ctx.arc(256, 256, 60, 0, Math.PI * 2); ctx.stroke();
  });
  const pitch = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.9 }));
  pitch.scale.set(rx * 0.68, 1, rz * 0.68); pitch.position.y = 0.05; pitch.receiveShadow = true;
  // crowd: instanced bodies on the steps, team colors (purple-pink vs white-gold – fictional clubs)
  const r = mulberry32(31);
  const fanGeo = new THREE.CapsuleGeometry(0.22, 0.6, 2, 6).translate(0, 0.55, 0);
  const fans = new THREE.InstancedMesh(fanGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 2600);
  const m = new THREE.Matrix4(); const c = new THREE.Color();
  let n = 0;
  for (let row = 0; row < 14; row++) {
    const t = row / 14, sr = 1.02 + t * 0.4, h = 1 + t * 16.5;
    const count = Math.floor(150 + t * 60);
    for (let i = 0; i < count && n < 2600; i++) {
      const a = (i / count) * Math.PI * 2 + r.range(-0.01, 0.01);
      m.makeTranslation(Math.cos(a) * sr * rx / 1.46 * 1.0, h, Math.sin(a) * sr * rz / 1.46);
      fans.setMatrixAt(n, m);
      const home = Math.cos(a) > 0;
      fans.setColorAt(n, c.setHex(home ? r.pick([0x8a2be2, 0xff4fa3, 0xff4fa3]) : r.pick([0xffffff, 0xf2c335])));
      n++;
    }
  }
  fans.count = n;
  // flares
  const fp: number[] = [];
  for (let i = 0; i < 260; i++) { const a = r.range(-0.9, 0.9), sr = r.range(1.05, 1.35); fp.push(Math.cos(a) * sr * rx / 1.46, 2 + (sr - 1) * 40, Math.sin(a) * sr * rz / 1.46); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  flares = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff3b1f, size: 1.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(bowl, pitch, fans, flares);
  g.position.set(x, 0, z);
  game.scene.add(g);
  game.city.colliders.addBox(x, z - rz - 1, rx * 2, 3, 18);
  game.physics.addStaticBox(x, 9, z - rz - 1, rx, 9, 1.5);
  built = g;
  return g;
}

/** Corridor of fans with flares – rhythm mode (arrows / DFJK). */
export class StadiumRhythm {
  private ui!: GameOverlay;
  private notes: { t: number; lane: number; hit: boolean; el: HTMLDivElement }[] = [];
  private time = -2;
  private hits = 0;
  private result: MgResult = 'running';
  private readonly bpm = 120;
  private readonly keys = [['ArrowLeft', 'KeyD'], ['ArrowDown', 'KeyF'], ['ArrowUp', 'KeyJ'], ['ArrowRight', 'KeyK']];
  private camT = 0;
  constructor(private game: Game, private count = 40) {}

  start() {
    const g = this.game;
    buildStadium(g);
    if (g.vehicles.current) g.exitVehicle();
    g.cinematic = true;
    this.ui = new GameOverlay('rhythm', `<div class="title">אוֹ-לֶה, אוֹ-לֶה!</div><div class="score">0</div><div class="lanes">${[0, 1, 2, 3].map((i) => `<div class="lane l${i}"><div class="hitline"></div><span class="key">${['←', '↓', '↑', '→'][i]}</span></div>`).join('')}</div><div class="hint">לחצו בקצב כשהתו מגיע לקו (חיצים או D F J K)</div>`);
    const r = mulberry32(5);
    const beat = 60 / this.bpm;
    for (let i = 0; i < this.count; i++) {
      const t = i * beat * (r.chance(0.25) ? 0.5 : 1) + Math.floor(i / 8) * beat;
      const lane = r.int(0, 3);
      const el = document.createElement('div');
      el.className = `note n${lane}`;
      this.ui.q(`.l${lane}`).appendChild(el);
      this.notes.push({ t: t + i * 0.02, lane, hit: false, el });
    }
    this.notes.sort((a, b) => a.t - b.t);
    g.audio.loop('beat', 0.8);
    g.audio.loop('crowd', 0.7);
  }

  update(dt: number): MgResult {
    const g = this.game;
    if (this.result !== 'running') return this.result;
    this.time += dt;
    const travel = 1.6; // seconds a note is visible
    for (let lane = 0; lane < 4; lane++) {
      if (!this.keys[lane].some((k) => g.input.wasPressed(k))) continue;
      const cand = this.notes.find((n) => !n.hit && n.lane === lane && Math.abs(n.t - this.time) < 0.16);
      const laneEl = this.ui.q(`.l${lane}`);
      laneEl.classList.remove('good', 'bad'); void laneEl.offsetWidth;
      if (cand) { cand.hit = true; cand.el.remove(); this.hits++; laneEl.classList.add('good'); g.audio.play('tok', undefined, 0.5, 0.7 + lane * 0.12); }
      else laneEl.classList.add('bad');
    }
    for (const n of this.notes) {
      if (n.hit) continue;
      const y = 1 - (n.t - this.time) / travel; // 0 top .. 1 hit line
      n.el.style.top = `${Math.max(-10, y * 86)}%`;
      n.el.style.display = y < -0.1 || y > 1.15 ? 'none' : '';
    }
    this.ui.set('.score', `${this.hits} / ${this.count}`);
    // flares flicker
    if (flares) (flares.material as THREE.PointsMaterial).size = 1.0 + Math.random() * 0.6;
    // camera sways along the fan corridor
    this.camT += dt;
    const { x, z, rx } = STADIUM;
    g.camera.position.set(x + rx * 0.9 + Math.sin(this.camT * 0.3) * 3, 9 + Math.sin(this.camT * 2) * 0.15, z + Math.sin(this.camT * 0.2) * 8);
    g.camera.lookAt(x - rx * 0.3, 5, z);
    const last = this.notes[this.notes.length - 1];
    if (this.time > last.t + 1.5) {
      this.result = this.hits / this.count >= 0.65 ? 'won' : 'lost';
      g.hud.showSplash(this.result === 'won' ? 'האצטדיון רועד!' : 'הקהל שורק בוז', `${Math.round((this.hits / this.count) * 100)}% דיוק`, this.result === 'won' ? '#ff4fa3' : '#aaa', 3);
    }
    return this.result;
  }
  dispose() {
    this.ui?.remove();
    this.game.audio.loop('beat', 0);
    this.game.audio.loop('crowd', 0);
    this.game.cinematic = false;
  }
}
