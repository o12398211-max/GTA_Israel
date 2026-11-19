import { ZONES, type ZoneId } from '../world/Terrain';
import { gameStore } from '../state/store';
import { mapCanvas, MAP_ORIGIN } from './MapRender';

export interface Blip { x: number; z: number; color: string; icon?: string; size?: number; route?: boolean }

/**
 * GTA-style HUD: rotating minimap with blips, health/energy bars, nerve stars,
 * cash, clock, zone banner, objective line, subtitles, "mission passed" splash.
 */
export class Hud {
  private root = document.getElementById('hud')!;
  private clock = document.getElementById('hud-clock')!;
  private fps = document.getElementById('hud-fps')!;
  private help = document.getElementById('hud-help')!;
  private banner = document.getElementById('zone-banner')!;
  private bannerTimer = 0;
  private lastZone: ZoneId | null = null;
  private frames = 0;
  private fpsTime = 0;
  currentFps = 0;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private stars: HTMLDivElement;
  private cash: HTMLDivElement;
  private health: HTMLDivElement;
  private energy: HTMLDivElement;
  private objective: HTMLDivElement;
  private subtitle: HTMLDivElement;
  private splash: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private splashTimer = 0;
  private prompt: HTMLDivElement;
  blips: Blip[] = [];
  /** player position + heading and camera yaw for the minimap */
  view = { x: 0, z: 0, heading: 0, camYaw: 0, speed: 0 };

  constructor() {
    const el = (cls: string, parent: HTMLElement = this.root, tag = 'div') => { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e as HTMLDivElement; };
    const radar = el('hud-radar');
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 220;
    radar.appendChild(this.mini);
    this.miniCtx = this.mini.getContext('2d')!;
    const bars = el('hud-bars', radar);
    this.health = el('bar health', bars);
    this.energy = el('bar energy', bars);
    const tr = el('hud-topright');
    this.stars = el('hud-stars', tr);
    this.stars.title = 'כוכבי עצבים';
    this.cash = el('hud-cash', tr);
    this.objective = el('hud-objective');
    this.subtitle = el('hud-subtitle');
    this.splash = el('hud-splash');
    this.toastEl = el('hud-toast');
    this.prompt = el('hud-prompt');
    this.toastEl.id = 'hud-toast';
  }

  show(): void { this.root.hidden = false; setTimeout(() => this.help.classList.add('hidden'), 25000); }
  hide(): void { this.root.hidden = true; }
  toggleHelp(): void { this.help.classList.toggle('hidden'); }
  setVisible(v: boolean) { this.root.style.opacity = v ? '1' : '0'; }

  toast(text: string, seconds = 4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }
  setObjective(text: string | null) { this.objective.textContent = text ?? ''; this.objective.classList.toggle('show', !!text); }
  setSubtitle(speaker: string | null, text: string | null) {
    if (!text) { this.subtitle.classList.remove('show'); return; }
    this.subtitle.innerHTML = '';
    if (speaker) { const s = document.createElement('b'); s.textContent = `${speaker}: `; this.subtitle.appendChild(s); }
    this.subtitle.appendChild(document.createTextNode(text));
    this.subtitle.classList.add('show');
  }
  setPrompt(text: string | null) { this.prompt.textContent = text ?? ''; this.prompt.classList.toggle('show', !!text); }
  /** Big centered GTA-like splash: "משימה הושלמה" etc. */
  showSplash(title: string, sub = '', color = '#ffcf40', seconds = 4) {
    this.splash.innerHTML = `<div class="t" style="color:${color}">${title}</div><div class="s">${sub}</div>`;
    this.splash.classList.add('show');
    this.splashTimer = seconds;
  }

  update(dt: number, time: string, zone: ZoneId, speedUp: boolean): void {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.currentFps = Math.round(this.frames / this.fpsTime);
      this.fps.textContent = `${this.currentFps} FPS`;
      this.frames = 0; this.fpsTime = 0;
    }
    this.clock.textContent = speedUp ? `${time} ⏩` : time;
    if (zone !== this.lastZone) {
      this.lastZone = zone;
      const z = ZONES[zone];
      (this.banner.querySelector('.zone-en') as HTMLElement).textContent = z.en;
      (this.banner.querySelector('.zone-he') as HTMLElement).textContent = z.he;
      this.banner.classList.add('show');
      this.bannerTimer = 4;
    }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.banner.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.remove('show'); }
    if (this.splashTimer > 0) { this.splashTimer -= dt; if (this.splashTimer <= 0) this.splash.classList.remove('show'); }

    const s = gameStore.getState();
    const full = Math.floor(s.nerves + 0.001);
    let html = '';
    for (let i = 4; i >= 0; i--) html += `<span class="${i < full ? 'on' : ''}${i === full && s.nerves % 1 > 0.5 ? ' half' : ''}">★</span>`;
    if (this.stars.innerHTML !== html) this.stars.innerHTML = html;
    this.stars.classList.toggle('flash', s.nerves >= 1);
    const cashText = `₪${s.shekels.toLocaleString('he-IL')}`;
    if (this.cash.textContent !== cashText) this.cash.textContent = cashText;
    this.health.style.setProperty('--v', `${s.health}%`);
    this.energy.style.setProperty('--v', `${s.energy}%`);
    this.drawMinimap();
  }

  private drawMinimap() {
    const g = this.miniCtx, W = this.mini.width, R = W / 2;
    const map = mapCanvas();
    const zoom = 1.1 + Math.min(1.2, this.view.speed / 25); // zoom out with speed
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1f5f86'; g.fillRect(0, 0, W, W);
    g.translate(R, R);
    // up on the minimap = camera forward
    g.rotate(Math.PI + this.view.camYaw);
    g.scale(1 / zoom, 1 / zoom);
    g.translate(-(this.view.x - MAP_ORIGIN.x), -(this.view.z - MAP_ORIGIN.z));
    g.drawImage(map, 0, 0);
    // blips
    for (const b of this.blips) {
      const bx = b.x - MAP_ORIGIN.x, bz = b.z - MAP_ORIGIN.z;
      if (b.route) {
        g.strokeStyle = 'rgba(255, 207, 64, 0.85)'; g.lineWidth = 5 * zoom; g.setLineDash([10 * zoom, 8 * zoom]);
        g.beginPath(); g.moveTo(this.view.x - MAP_ORIGIN.x, this.view.z - MAP_ORIGIN.z); g.lineTo(bx, bz); g.stroke(); g.setLineDash([]);
      }
      g.fillStyle = b.color;
      g.beginPath(); g.arc(bx, bz, (b.size ?? 6) * zoom, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1.5 * zoom; g.stroke();
    }
    g.restore();
    // blips outside the radius: clamp to the edge
    for (const b of this.blips) {
      const dx = (b.x - this.view.x) / zoom, dz = (b.z - this.view.z) / zoom;
      const a = Math.PI + this.view.camYaw;
      const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
      const d = Math.hypot(rx, rz);
      if (d > R - 10) { g.fillStyle = b.color; g.beginPath(); g.arc(R + (rx / d) * (R - 10), R + (rz / d) * (R - 10), 6, 0, Math.PI * 2); g.fill(); }
    }
    // player arrow (relative to camera)
    g.save();
    g.translate(R, R);
    g.rotate(-(this.view.heading - this.view.camYaw));
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // rim + north marker
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 4; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.stroke();
    const na = this.view.camYaw; // north (-z) direction on screen
    g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', R - Math.sin(na) * (R - 14), R + Math.cos(na) * (R - 14));
  }
}
