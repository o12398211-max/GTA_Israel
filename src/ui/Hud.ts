import { ZONES, type ZoneId } from '../world/Terrain';

/** Minimal stage-1 HUD: clock, FPS, zone banner, controls help. */
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

  show(): void { this.root.hidden = false; }
  private toastEl: HTMLDivElement | null = null;
  private toastTimer = 0;
  /** Short GTA-style message in the top-left. */
  toast(text: string, seconds = 4) {
    if (!this.toastEl) { this.toastEl = document.createElement('div'); this.toastEl.id = 'hud-toast'; this.root.appendChild(this.toastEl); }
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }
  toggleHelp(): void { this.help.classList.toggle('hidden'); }

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
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl?.classList.remove('show'); }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }
}
