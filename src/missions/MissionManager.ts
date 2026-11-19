import * as THREE from 'three';
import type { Game, GameSystem } from '../core/Game';
import { gameStore, type CharacterId } from '../state/store';
import type { Blip } from '../ui/Hud';
import type { Phone } from '../ui/Phone';
import { terrainHeight } from '../world/Terrain';

export interface MissionCtx {
  game: Game; mm: MissionManager; dt: number;
  /** seconds since this step started */
  t: number;
  /** scratch storage for the mission */
  data: Record<string, unknown>;
}
export type StepResult = boolean | 'fail' | void;
export interface Step {
  objective?: string | ((c: MissionCtx) => string);
  /** target shown as blip + world marker */
  target?: { x: number; z: number; r?: number } | ((c: MissionCtx) => { x: number; z: number; r?: number } | null);
  marker?: boolean;
  route?: boolean;
  enter?(c: MissionCtx): void | Promise<void>;
  /** return true when the step is complete, 'fail' to fail the mission */
  update?(c: MissionCtx): StepResult;
  exit?(c: MissionCtx): void;
  failText?: string;
}
export interface MissionDef {
  id: string; title: string; titleEn: string; character: CharacterId;
  start: { x: number; z: number }; reward: number; hour?: number;
  description: string;
  steps: Step[];
  /** cleanup after pass/fail */
  cleanup?(game: Game): void;
}

/**
 * Story mission runner: shows the next mission's start marker, runs step
 * state machines, handles fail/retry, rewards and save progress.
 */
export class MissionManager implements GameSystem {
  active: MissionDef | null = null;
  private stepIdx = 0;
  private ctx: MissionCtx | null = null;
  private stepPending = false;
  private markers: THREE.Mesh[] = [];
  private markerMat: THREE.ShaderMaterial;
  private failed: MissionDef | null = null;
  private replaying = false;
  /** extra blips other systems want on the map (shops etc.) */
  staticBlips: Blip[] = [];
  onAllDone: (() => void) | null = null;

  constructor(private game: Game, readonly missions: MissionDef[], private phone: Phone) {
    this.markerMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffcf40) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * (0.55 + 0.45 * sin(vUv.y * 20.0 - uTime * 4.0)); gl_FragColor = vec4(uColor * a, a); }`,
    });
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 32, 1, true).translate(0, 3, 0), i === 0 ? this.markerMat : this.markerMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      game.scene.add(m);
      this.markers.push(m);
    }
    (this.markers[1].material as THREE.ShaderMaterial).uniforms.uColor.value = new THREE.Color(0x4dd2ff);
    phone.missionList = () => this.missions.map((m, i) => ({ title: m.title, done: i < gameStore.getState().missionIndex, active: this.active === m, available: i <= gameStore.getState().missionIndex }));
    phone.onReplayMission = (i) => this.start(i, true);
  }

  get next(): MissionDef | null { return this.missions[gameStore.getState().missionIndex] ?? null; }

  start(index: number, replay = false) {
    const def = this.missions[index];
    if (!def || this.active) return;
    this.active = def;
    this.replaying = replay;
    this.failed = null;
    this.stepIdx = -1;
    if (gameStore.getState().character !== def.character) this.game.switchCharacter(def.character);
    if (def.hour !== undefined) this.game.setHour(def.hour);
    this.game.hud.showSplash(def.title, def.titleEn, '#ffffff', 3);
    this.ctx = { game: this.game, mm: this, dt: 0, t: 0, data: {} };
    this.advance();
  }

  private advance() {
    const def = this.active!;
    const c = this.ctx!;
    if (this.stepIdx >= 0) def.steps[this.stepIdx].exit?.(c);
    this.stepIdx++;
    if (this.stepIdx >= def.steps.length) { this.pass(); return; }
    c.t = 0;
    const r = def.steps[this.stepIdx].enter?.(c);
    if (r instanceof Promise) {
      this.stepPending = true;
      const idx = this.stepIdx;
      r.then(() => { if (this.stepIdx === idx) this.stepPending = false; }, (e) => { console.error(e); this.stepPending = false; });
    }
  }

  fail(reason?: string) {
    const def = this.active;
    if (!def) return;
    def.steps[this.stepIdx]?.exit?.(this.ctx!);
    def.cleanup?.(this.game);
    this.game.hud.showSplash('משימה נכשלה', reason ?? def.steps[this.stepIdx]?.failText ?? '', '#ff4d4d', 4);
    this.game.hud.setObjective(null);
    this.game.audio.play('crash', undefined, 0.4, 0.6);
    this.failed = def;
    this.active = null;
    this.game.cinematic = false;
  }

  private pass() {
    const def = this.active!;
    def.cleanup?.(this.game);
    const idx = this.missions.indexOf(def);
    const st = gameStore.getState();
    if (!this.replaying && idx === st.missionIndex) gameStore.setState({ missionIndex: idx + 1 });
    st.addCash(def.reward);
    this.game.audio.play('cash');
    this.game.hud.setObjective(null);
    this.game.hud.showSplash('משימה הושלמה', `+₪${def.reward}`, '#ffcf40', 5);
    this.active = null;
    this.game.cinematic = false;
    if (idx === this.missions.length - 1 && !this.replaying) this.onAllDone?.();
  }

  update(dt: number, game: Game) {
    (this.markerMat.uniforms.uTime.value as number) += dt;
    (this.markers[1].material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    const p = game.vehicles.current ? game.vehicles.current.position : game.player.position;
    const blips: Blip[] = [...this.staticBlips];
    let marker: { x: number; z: number; r: number } | null = null;
    let startMarker: { x: number; z: number } | null = null;

    if (this.active && this.ctx) {
      const step = this.active.steps[this.stepIdx];
      const c = this.ctx;
      c.dt = dt; c.t += dt;
      if (step && !this.stepPending) {
        const tgt = typeof step.target === 'function' ? step.target(c) : step.target;
        if (tgt) { blips.push({ x: tgt.x, z: tgt.z, color: '#ffcf40', size: 8, route: step.route !== false }); if (step.marker !== false) marker = { x: tgt.x, z: tgt.z, r: tgt.r ?? 3 }; }
        const obj = typeof step.objective === 'function' ? step.objective(c) : step.objective;
        game.hud.setObjective(obj ?? null);
        const r = step.update ? step.update(c) : tgt ? Math.hypot(p.x - tgt.x, p.z - tgt.z) < (tgt.r ?? 3) : true;
        if (r === 'fail') this.fail();
        else if (r) this.advance();
      }
    } else {
      // free roam: offer the next mission (or the failed one again)
      const next = this.failed ?? this.next;
      if (next && gameStore.getState().phase === 'playing') {
        startMarker = next.start;
        blips.push({ x: next.start.x, z: next.start.z, color: '#4dd2ff', size: 8 });
        const d = Math.hypot(p.x - next.start.x, p.z - next.start.z);
        game.hud.setPrompt(d < 3.5 ? `E – ${next.title}` : null);
        if (d < 3.5 && game.input.action('interact')) { game.hud.setPrompt(null); this.start(this.missions.indexOf(next)); }
      }
    }
    if (this.phone.waypoint) blips.push({ x: this.phone.waypoint.x, z: this.phone.waypoint.z, color: '#c04dff', size: 7, route: true });
    game.hud.blips = blips;
    this.phone.blips = blips;
    this.placeMarker(this.markers[0], marker);
    this.placeMarker(this.markers[1], startMarker ? { ...startMarker, r: 1.6 } : null);
  }

  private placeMarker(m: THREE.Mesh, at: { x: number; z: number; r: number } | null) {
    m.visible = !!at;
    if (!at) return;
    const y = Math.max(terrainHeight(at.x, at.z), at.x > -213 && at.x < 500 ? 0.15 : -100);
    m.position.set(at.x, y, at.z);
    m.scale.set(at.r, 1, at.r);
  }
}

/** Common step builders. */
export const S = {
  goto(x: number, z: number, objective: string, r = 4, opts: Partial<Step> = {}): Step {
    return { objective, target: { x, z, r }, ...opts };
  },
  wait(seconds: number, objective?: string): Step {
    return { objective, update: (c) => c.t >= seconds };
  },
  call(fn: (c: MissionCtx) => void | Promise<void>): Step {
    return { enter: fn, update: () => true };
  },
  enterVehicle(objective: string, type?: string, near?: { x: number; z: number }): Step {
    return {
      objective, target: near ? { ...near, r: 3 } : undefined, marker: false,
      update: (c) => !!c.game.vehicles.current && (!type || c.game.vehicles.current.type === type),
    };
  },
};
