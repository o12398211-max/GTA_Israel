import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Npc, GameOverlay, ComicText, groundY } from './common';
import { OUTFITS } from '../entities/SkinnedCharacter';
import type { SkinnedCharacter } from '../entities/SkinnedCharacter';

export type MgResult = 'running' | 'won' | 'lost';

/**
 * מטקות – timing & rhythm. The ball flies back and forth; press SPACE (or click)
 * when it reaches you. The rally speeds up. 20 hits wins; 3 misses loses.
 * "טוק… טוק… טוק…" – the national anthem of every Israeli beach.
 */
export class Matkot {
  private partner!: Npc;
  private ball!: THREE.Mesh;
  private ui!: GameOverlay;
  private comic = new ComicText();
  private A = new THREE.Vector3(-262, 0, 28);
  private B = new THREE.Vector3(-262, 0, 35.5);
  private toPlayer = true;
  private t = 0;
  private T = 1.15;
  hits = 0;
  private combo = 0;
  private lives = 3;
  private pressed = false;
  private done: MgResult = 'running';
  private endTimer = 0;
  readonly goal: number;

  constructor(private game: Game, goal = 20) { this.goal = goal; }

  async start() {
    const g = this.game;
    if (g.vehicles.current) g.exitVehicle();
    this.A.y = groundY(this.A.x, this.A.z); this.B.y = groundY(this.B.x, this.B.z);
    g.player.spawn(this.A.x, this.A.z, 0);
    this.partner = await Npc.create(g.scene, { ...OUTFITS.avi, shirt: new THREE.Color(0xff8a3d), pants: new THREE.Color(0x2f6db5), shorts: true, sleeves: 'short', beard: false, height: 1.8 }, 'יוסי', 0.37);
    this.partner.place(this.B.x, this.B.z, Math.PI);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1e88e5, roughness: 0.4 }));
    this.ball.castShadow = true;
    g.scene.add(this.ball);
    this.ui = new GameOverlay('matkot', `<h2>מטקות</h2><div class="row"><span>חבטות</span><b class="hits">0</b>/<span>${this.goal}</span></div>
      <div class="row"><span>קומבו</span><b class="combo">0</b></div><div class="row"><span>חיים</span><b class="lives">❤❤❤</b></div>
      <div class="timing"><div class="zone"></div><div class="cursor"></div></div><p>רווח / קליק כשהכדור מגיע אליך</p>`);
    g.cinematic = true;
    this.t = 0; this.toPlayer = true; this.T = 1.15;
  }

  private ballPos(u: number, from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3) {
    out.lerpVectors(from, to, u);
    out.y = THREE.MathUtils.lerp(from.y, to.y, u) + 1.1 + Math.sin(u * Math.PI) * (0.6 + this.T * 0.6);
    return out;
  }

  update(dt: number): MgResult {
    const g = this.game;
    this.comic.update(dt, g.camera);
    if (this.done !== 'running') { this.endTimer -= dt; this.partner.sync(dt); return this.endTimer <= 0 ? this.done : 'running'; }
    const press = g.input.wasPressed('Space') || g.input.wasPressed('Mouse0') || g.input.action('punch');
    this.t += dt;
    const from = this.toPlayer ? this.B : this.A, to = this.toPlayer ? this.A : this.B;
    const u = Math.min(1.15, this.t / this.T);
    this.ballPos(u, from, to, this.ball.position);
    const avi = g.player.model as SkinnedCharacter;
    if (this.toPlayer) {
      const early = this.T - this.t;
      if (press && !this.pressed) {
        this.pressed = true;
        if (Math.abs(early) < 0.17) {
          const perfect = Math.abs(early) < 0.06;
          this.hits++; this.combo++;
          avi.trigger('jab', 0.35);
          g.audio.play('tok', this.A, 1, perfect ? 1.1 : 1);
          this.comic.spawn(perfect ? 'טוק! מושלם' : 'טוק!', this.ball.position, perfect ? '#7be06f' : '#ffe14d');
          this.toPlayer = false; this.t = 0; this.pressed = false;
          this.T = Math.max(0.5, this.T * (perfect ? 0.95 : 0.975));
          if (this.hits >= this.goal) { this.done = 'won'; this.endTimer = 1.5; g.audio.play('cash'); }
        } else if (early > 0.17) {
          this.comic.spawn('מוקדם מדי', this.ball.position, '#ff9e9e');
        }
      }
      if (this.t > this.T + 0.2) {
        // miss: ball drops in the sand
        this.lives--; this.combo = 0;
        this.comic.spawn('פספוס!', this.A.clone().setY(this.A.y + 1.4), '#ff6b6b');
        g.audio.play('splash', this.A, 0.4, 1.6);
        if (this.lives <= 0) { this.done = 'lost'; this.endTimer = 1.5; }
        else { this.toPlayer = true; this.t = 0; this.pressed = false; this.T = Math.min(1.15, this.T * 1.1); }
      }
    } else if (this.t >= this.T) {
      // Yossi always returns it (he's been playing since 1987)
      this.partner.ch.trigger('jab', 0.35);
      g.audio.play('tok', this.B, 0.9, 0.95);
      this.toPlayer = true; this.t = 0; this.pressed = false;
    }
    // timing bar
    const prog = this.toPlayer ? Math.min(1, this.t / this.T) : 0;
    this.ui.q('.cursor').style.left = `${prog * 100}%`;
    this.ui.q('.zone').style.cssText = `left:${(1 - 0.17 / this.T) * 100}%;width:${(0.3 / this.T) * 100}%`;
    this.ui.set('.hits', String(this.hits));
    this.ui.set('.combo', String(this.combo));
    this.ui.set('.lives', '❤'.repeat(Math.max(0, this.lives)) + '♡'.repeat(3 - Math.max(0, this.lives)));
    // camera: side view of the rally
    const mid = this.A.clone().add(this.B).multiplyScalar(0.5);
    g.camera.position.set(mid.x - 6.5, mid.y + 2.4, mid.z - 1.5);
    g.camera.lookAt(mid.x, mid.y + 1.2, mid.z);
    g.player.position.copy(this.A);
    avi.root.position.copy(this.A);
    avi.root.rotation.y = 0;
    avi.update(dt, 0, true, 0);
    this.partner.yaw = Math.PI;
    this.partner.sync(dt);
    return 'running';
  }

  dispose() {
    this.partner?.dispose();
    this.ball?.removeFromParent();
    this.ui?.remove();
    this.game.cinematic = false;
  }
}
