import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { DialogId } from './Dialog';

type V3 = [number, number, number];

/** One camera shot on the timeline. */
export interface Shot {
  duration: number;
  /** dolly: from→to straight; crane: rising arc; orbit: around `target`; ots: over the shoulder of `actor` */
  move: 'static' | 'dolly' | 'crane' | 'orbit' | 'ots';
  from?: V3; to?: V3;
  look?: V3; lookTo?: V3;
  target?: V3 | (() => THREE.Vector3);
  radius?: number; height?: number; angleFrom?: number; angleTo?: number;
  actor?: () => { pos: THREE.Vector3; yaw: number };
  fov?: number; fovTo?: number;
  /** cut (default) or crossfade through black */
  transition?: 'cut' | 'fade';
  hour?: number;
  dialog?: DialogId;
  title?: { text: string; sub?: string };
  onStart?: () => void;
  ease?: boolean;
}

/**
 * Timeline cutscene player: camera moves, cuts/fades, letterbox, titles,
 * dialogue, time-of-day changes. Hold SPACE to skip.
 */
export class Cutscene {
  private lb: HTMLDivElement;
  private fade: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private skipEl: HTMLDivElement;
  playing = false;

  constructor(private game: Game) {
    const mk = (id: string) => { let e = document.getElementById(id) as HTMLDivElement | null; if (!e) { e = document.createElement('div'); e.id = id; document.body.appendChild(e); } return e; };
    this.lb = mk('letterbox');
    this.lb.innerHTML = '<div class="top"></div><div class="bot"></div>';
    this.fade = mk('fade');
    this.titleEl = mk('cine-title');
    this.skipEl = mk('cine-skip');
    this.skipEl.textContent = 'החזיקו רווח לדילוג';
  }

  setFade(v: number, ms = 600) { this.fade.style.transition = `opacity ${ms}ms`; this.fade.style.opacity = String(v); }

  async play(shots: Shot[]): Promise<void> {
    const g = this.game;
    this.playing = true;
    g.cinematic = true;
    document.getElementById('hud')!.classList.add('cine');
    this.lb.classList.add('on');
    this.skipEl.classList.add('on');
    let skipHold = 0, skipped = false;
    const savedFov = g.camera.fov;
    for (const shot of shots) {
      if (skipped) break;
      if (shot.transition === 'fade') { this.setFade(1, 350); await this.sleep(0.4); }
      if (shot.hour !== undefined) g.setHour(shot.hour);
      shot.onStart?.();
      if (shot.title) { this.titleEl.innerHTML = `<div class="t">${shot.title.text}</div>${shot.title.sub ? `<div class="s">${shot.title.sub}</div>` : ''}`; this.titleEl.classList.add('on'); }
      const dialogDone = shot.dialog ? g.dialog.play(shot.dialog, { skippable: true }) : null;
      if (shot.transition === 'fade') this.setFade(0, 450);
      await new Promise<void>((resolve) => {
        let t = 0;
        const sys = { update: (dt: number) => {
          t += dt;
          skipHold = g.input.isDown('Space') ? skipHold + dt : 0;
          if (skipHold > 0.8) skipped = true;
          const u = THREE.MathUtils.clamp(t / shot.duration, 0, 1);
          this.applyCamera(shot, shot.ease === false ? u : u * u * (3 - 2 * u));
          if (u >= 1 || skipped) { g.systems.splice(g.systems.indexOf(sys), 1); resolve(); }
        } };
        g.systems.push(sys);
      });
      if (dialogDone && !skipped) await dialogDone;
      this.titleEl.classList.remove('on');
    }
    g.hud.setSubtitle(null, null);
    g.camera.fov = savedFov; g.camera.updateProjectionMatrix();
    this.lb.classList.remove('on');
    this.skipEl.classList.remove('on');
    document.getElementById('hud')!.classList.remove('cine');
    this.setFade(0, 300);
    g.cinematic = false;
    this.playing = false;
    // put the follow camera behind the player again
    g.follow.snap(g.player.position, g.player.yaw);
  }

  private applyCamera(s: Shot, u: number) {
    const cam = this.game.camera;
    const v = (a?: V3) => (a ? new THREE.Vector3(...a) : new THREE.Vector3());
    const tgt = typeof s.target === 'function' ? s.target() : s.target ? v(s.target) : null;
    let pos = new THREE.Vector3(), look = new THREE.Vector3();
    switch (s.move) {
      case 'static': pos = v(s.from); look = tgt ?? v(s.look); break;
      case 'dolly': pos = v(s.from).lerp(v(s.to ?? s.from), u); look = tgt ?? v(s.look).lerp(v(s.lookTo ?? s.look), u); break;
      case 'crane': {
        pos = v(s.from).lerp(v(s.to ?? s.from), u);
        pos.y += Math.sin(u * Math.PI) * (s.height ?? 6);
        look = tgt ?? v(s.look).lerp(v(s.lookTo ?? s.look), u);
        break;
      }
      case 'orbit': {
        const c = tgt ?? v(s.look);
        const a = THREE.MathUtils.lerp(s.angleFrom ?? 0, s.angleTo ?? Math.PI / 2, u);
        const r = s.radius ?? 8;
        pos.set(c.x + Math.sin(a) * r, c.y + (s.height ?? 3), c.z + Math.cos(a) * r);
        look = c;
        break;
      }
      case 'ots': {
        const act = s.actor!();
        const back = new THREE.Vector3(-Math.sin(act.yaw), 0, -Math.cos(act.yaw));
        const right = new THREE.Vector3(-Math.cos(act.yaw), 0, Math.sin(act.yaw));
        pos = act.pos.clone().addScaledVector(back, 1.6 - u * 0.3).addScaledVector(right, 0.55).setY(act.pos.y + 1.7);
        look = tgt ?? act.pos.clone().addScaledVector(back, -6).setY(act.pos.y + 1.4);
        break;
      }
    }
    cam.position.copy(pos);
    cam.lookAt(look);
    if (s.fov) { cam.fov = THREE.MathUtils.lerp(s.fov, s.fovTo ?? s.fov, u); cam.updateProjectionMatrix(); }
  }

  sleep(sec: number): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const sys = { update: (dt: number) => { t += dt; if (t >= sec) { this.game.systems.splice(this.game.systems.indexOf(sys), 1); resolve(); } } };
      this.game.systems.push(sys);
    });
  }
}
