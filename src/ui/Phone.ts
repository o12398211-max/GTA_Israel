import { gameStore } from '../state/store';
import { mapCanvas, MAP_ORIGIN, MAP_SIZE } from './MapRender';
import type { Blip } from './Hud';

export type PhoneApp = 'home' | 'messages' | 'map' | 'alerts' | 'missions' | 'settings';

export interface MissionListItem { title: string; done: boolean; active: boolean; available: boolean }

/**
 * In-game smartphone (P / D-pad up). HTML overlay; while open the mouse cursor
 * is free. Apps: messages, map (set waypoint), alerts, missions, settings.
 */
export class Phone {
  private el: HTMLDivElement;
  private screen: HTMLDivElement;
  open = false;
  app: PhoneApp = 'home';
  waypoint: { x: number; z: number } | null = null;
  /** provided by the mission system */
  missionList: () => MissionListItem[] = () => [];
  onReplayMission: (i: number) => void = () => {};
  onOpenSettings: () => void = () => {};
  player = { x: 0, z: 0 };
  blips: Blip[] = [];
  private alertEl: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'phone';
    this.el.innerHTML = `<div class="notch"></div><div class="status"><span class="time"></span><span>5G ▮▮▮ 🔋</span></div><div class="screen"></div><div class="homebar"></div>`;
    document.body.appendChild(this.el);
    this.screen = this.el.querySelector('.screen')!;
    this.el.querySelector('.homebar')!.addEventListener('click', () => this.show('home'));
    this.alertEl = document.createElement('div');
    this.alertEl.id = 'phone-alert';
    document.body.appendChild(this.alertEl);
    gameStore.subscribe((s, p) => { if (s.notifications !== p.notifications && this.open && this.app === 'messages') this.render(); });
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('open', this.open);
    if (this.open) { document.exitPointerLock?.(); this.show('home'); }
  }

  show(app: PhoneApp) { this.app = app; this.render(); }

  /** Lock-screen style banner notification (also stored in the messages app). */
  push(app: string, title: string, text: string, urgent = false) {
    gameStore.getState().notify(app, title, text);
    this.alertEl.className = urgent ? 'urgent show' : 'show';
    this.alertEl.innerHTML = `<div class="a-app">${app === 'alert' ? '⚠️ התרעה' : app === 'police' ? '🚓' : '💬'} ${escapeHtml(title)}</div><div class="a-text">${escapeHtml(text)}</div>`;
    clearTimeout(this.alertTimer);
    this.alertTimer = window.setTimeout(() => this.alertEl.classList.remove('show'), urgent ? 6000 : 4500);
  }
  private alertTimer = 0;

  update(hour: number) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    (this.el.querySelector('.time') as HTMLElement).textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (this.open && this.app === 'map') this.drawMap();
  }

  private render() {
    const s = this.screen;
    const back = `<button class="back" data-go="home">→ חזרה</button>`;
    switch (this.app) {
      case 'home': {
        const apps: [PhoneApp, string, string, string][] = [
          ['messages', '💬', 'הודעות', '#25d366'], ['map', '🗺️', 'מפה', '#4285f4'], ['alerts', '⚠️', 'התרעות', '#e53935'],
          ['missions', '⭐', 'משימות', '#f9a825'], ['settings', '⚙️', 'הגדרות', '#78909c'],
        ];
        const unread = gameStore.getState().notifications.length;
        s.innerHTML = `<div class="wall"><div class="big-time"></div><div class="date">יום שישי · ערב חג (כמובן)</div></div>
          <div class="apps">${apps.map(([id, ic, name, c]) => `<button class="app" data-go="${id}"><span class="ic" style="background:${c}">${ic}${id === 'messages' && unread ? `<i>${unread}</i>` : ''}</span><span>${name}</span></button>`).join('')}</div>`;
        (s.querySelector('.big-time') as HTMLElement).textContent = (this.el.querySelector('.time') as HTMLElement).textContent;
        break;
      }
      case 'messages': {
        const n = gameStore.getState().notifications.filter((x) => x.app !== 'alert');
        s.innerHTML = `${back}<h3>הודעות</h3><div class="list">${n.length ? n.map((x) => `<div class="msg"><b>${escapeHtml(x.title)}</b><span class="t">${x.time}</span><p>${escapeHtml(x.text)}</p></div>`).join('') : '<p class="empty">אין הודעות. מוזר. אמא בטח מקלידה.</p>'}</div>`;
        break;
      }
      case 'alerts': {
        const n = gameStore.getState().notifications.filter((x) => x.app === 'alert');
        s.innerHTML = `${back}<h3>התרעות</h3><p class="note">בעת התרעה: שומרים על קור רוח, נכנסים למרחב מוגן ונשארים בו עד להודעה.</p><div class="list">${n.length ? n.map((x) => `<div class="msg alert"><b>${escapeHtml(x.title)}</b><span class="t">${x.time}</span><p>${escapeHtml(x.text)}</p></div>`).join('') : '<p class="empty">אין התרעות פעילות.</p>'}</div>`;
        break;
      }
      case 'missions': {
        const list = this.missionList();
        s.innerHTML = `${back}<h3>משימות</h3><div class="list">${list.map((m, i) => `<div class="mission ${m.done ? 'done' : ''} ${m.active ? 'active' : ''}"><span>${m.done ? '✅' : m.active ? '▶️' : m.available ? '⭐' : '🔒'} ${i + 1}. ${escapeHtml(m.title)}</span>${m.done ? `<button data-replay="${i}">שחק שוב</button>` : ''}</div>`).join('')}</div>`;
        break;
      }
      case 'map':
        s.innerHTML = `${back}<h3>מפה</h3><canvas class="map" width="560" height="400"></canvas><p class="note">לחצו על המפה כדי לסמן יעד.</p>`;
        s.querySelector('canvas')!.addEventListener('click', (e) => {
          const c = e.target as HTMLCanvasElement, r = c.getBoundingClientRect();
          const u = ((e.clientX - r.left) / r.width) * MAP_SIZE.w, v = ((e.clientY - r.top) / r.height) * MAP_SIZE.h;
          this.waypoint = { x: u + MAP_ORIGIN.x, z: v + MAP_ORIGIN.z };
        });
        this.drawMap();
        break;
      case 'settings':
        this.toggle(false);
        this.onOpenSettings();
        return;
    }
    s.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.go as PhoneApp)));
    s.querySelectorAll<HTMLElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => { this.onReplayMission(Number(b.dataset.replay)); this.toggle(false); }));
  }

  private drawMap() {
    const c = this.screen.querySelector('canvas.map') as HTMLCanvasElement | null;
    if (!c) return;
    const g = c.getContext('2d')!;
    const sx = c.width / MAP_SIZE.w, sy = c.height / MAP_SIZE.h;
    g.drawImage(mapCanvas(), 0, 0, c.width, c.height);
    const dot = (x: number, z: number, col: string, r = 5) => { g.fillStyle = col; g.beginPath(); g.arc((x - MAP_ORIGIN.x) * sx, (z - MAP_ORIGIN.z) * sy, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.stroke(); };
    for (const b of this.blips) dot(b.x, b.z, b.color, 5);
    if (this.waypoint) dot(this.waypoint.x, this.waypoint.z, '#c04dff', 6);
    dot(this.player.x, this.player.z, '#fff', 6);
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
