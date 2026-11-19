import * as THREE from 'three';
import type { Game, GameSystem } from '../core/Game';
import { gameStore } from '../state/store';
import { OUTFITS } from '../entities/SkinnedCharacter';
import { Matkot, type MgResult } from './Matkot';
import { StadiumRhythm, buildStadium, STADIUM } from './Stadium';
import { buildShelters } from './Shelter';
import type { Blip } from '../ui/Hud';

interface Spot { id: string; name: string; x: number; z: number; color: string; icon: string }

const SPOTS: Spot[] = [
  { id: 'clothes', name: 'דוכן בגדים "רק בשבילך"', x: -88, z: -2, color: '#ff7ad9', icon: '👕' },
  { id: 'garage', name: 'מוסך "אחי מהמוסך"', x: 140, z: 18, color: '#ff9f1c', icon: '🔧' },
  { id: 'matkot', name: 'מטקות על החוף', x: -262, z: 24, color: '#4dd2ff', icon: '🏓' },
  { id: 'stadium', name: 'האצטדיון', x: STADIUM.x, z: STADIUM.z + STADIUM.rz + 6, color: '#b388ff', icon: '🏟️' },
];

const SHIRTS: [string, number, number][] = [
  ['לבנה קלאסית', 0xf4f3ee, 0], ['שחורה "אני בעניינים"', 0x1a1a1a, 60], ['תכלת של שבת', 0x8ec5ff, 80],
  ['ורודה VI', 0xff4fa3, 120], ['ירוקה צבאית', 0x5f6f3a, 90], ['חולצת טריקו של להקה', 0x7a1fa2, 150],
];
const PANTS: [string, number, number][] = [['ג\'ינס כהה', 0x2c3e5c, 0], ['מכנסי שבת שחורים', 0x1b1b1f, 70], ['ברמודה חאקי', 0xb39b6e, 50]];
const PAINTS: [string, number, number][] = [['אדום מותג', 0xb3122a, 200], ['כחול חשמלי', 0x1d4ed8, 220], ['שחור מט', 0x111111, 260], ['ורוד VI', 0xff4fa3, 300], ['זהב ירושלמי', 0xd4a017, 350]];

/**
 * Free-roam activities: shops (clothes, garage paint/turbo) and replayable
 * mini-games (matkot, stadium) with map blips and E-to-interact.
 */
export class Activities implements GameSystem {
  private menu: HTMLDivElement | null = null;
  private running: { mg: Matkot | StadiumRhythm; id: string } | null = null;
  private lastCar: THREE.Object3D | null = null;

  constructor(private game: Game) {
    buildShelters(game);
    buildStadium(game);
    game.missions.staticBlips.push(...SPOTS.map<Blip>((s) => ({ x: s.x, z: s.z, color: s.color, size: 5 })));
  }

  get busy() { return !!this.running || !!this.menu; }

  update(dt: number, game: Game) {
    if (this.running) {
      const r: MgResult = this.running.mg.update(dt);
      if (r !== 'running') {
        this.running.mg.dispose();
        if (r === 'won') { gameStore.getState().addCash(this.running.id === 'matkot' ? 80 : 120); game.hud.showSplash('כל הכבוד!', this.running.id === 'matkot' ? '+₪80 · יוסי מתרשם' : '+₪120', '#7be06f', 3); game.audio.play('cash'); }
        else game.hud.showSplash('לא נורא', 'נסו שוב', '#ff9e9e', 3);
        this.running = null;
      }
      return;
    }
    if (game.vehicles.current) this.lastCar = game.vehicles.current.model;
    if (game.missions.active || this.menu) return;
    const p = game.vehicles.current ? game.vehicles.current.position : game.player.position;
    let near: Spot | null = null;
    for (const s of SPOTS) if (Math.hypot(p.x - s.x, p.z - s.z) < (s.id === 'garage' ? 5 : 2.5)) near = s;
    if (!near) return;
    game.hud.setPrompt(`E – ${near.icon} ${near.name}`);
    if (game.input.action('interact')) { game.hud.setPrompt(null); this.open(near); }
  }

  private async open(s: Spot) {
    const g = this.game;
    if (s.id === 'matkot') { const mg = new Matkot(g, 15); await mg.start(); this.running = { mg, id: s.id }; return; }
    if (s.id === 'stadium') { const mg = new StadiumRhythm(g, 32); mg.start(); this.running = { mg, id: s.id }; return; }
    const items = s.id === 'clothes'
      ? [...SHIRTS.map(([n, c, p]) => ({ kind: 'shirt', n, c, p })), ...PANTS.map(([n, c, p]) => ({ kind: 'pants', n, c, p }))]
      : [...PAINTS.map(([n, c, p]) => ({ kind: 'paint', n, c, p })), { kind: 'turbo', n: 'טורבו (לא חוקי בכלל)', c: 0, p: 900 }, { kind: 'fix', n: 'תיקון + ניקוי חול מהבגאז\'', c: 0, p: 50 }];
    document.exitPointerLock?.();
    this.menu = document.createElement('div');
    this.menu.className = 'shop-menu';
    this.menu.innerHTML = `<h2>${s.icon} ${s.name}</h2><p class="cash">יש לך ₪${gameStore.getState().shekels}</p>
      <div class="items">${items.map((it, i) => `<button data-i="${i}">${it.c ? `<i style="background:#${it.c.toString(16).padStart(6, '0')}"></i>` : ''}<span>${it.n}</span><b>${it.p ? `₪${it.p}` : 'חינם'}</b></button>`).join('')}</div>
      <button class="close">סגור (Esc)</button>`;
    document.body.appendChild(this.menu);
    const close = () => { this.menu?.remove(); this.menu = null; window.removeEventListener('keydown', esc); };
    const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    this.menu.querySelector('.close')!.addEventListener('click', close);
    this.menu.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const it = items[Number(b.dataset.i)];
      const st = gameStore.getState();
      if (st.shekels < it.p) { g.hud.toast('אין מספיק כסף. אולי תמכור את הקורקינט?'); return; }
      st.addCash(-it.p);
      g.audio.play('cash');
      if (it.kind === 'shirt') { OUTFITS[st.character === 'noa' ? 'noa' : 'avi'].shirt.setHex(it.c); gameStore.setState({ outfit: { ...st.outfit, shirt: it.c } }); }
      if (it.kind === 'pants') { OUTFITS[st.character === 'noa' ? 'noa' : 'avi'].pants.setHex(it.c); gameStore.setState({ outfit: { ...st.outfit, pants: it.c } }); }
      if (it.kind === 'paint' || it.kind === 'fix') {
        const v = g.vehicles.current ?? g.vehicles.nearest(g.player.position, 8);
        if (!v) { g.hud.toast('תביא רכב למוסך, אחי.'); st.addCash(it.p); return; }
        if (it.kind === 'paint') v.model.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial; if (m && m.clearcoat === 1) m.color.setHex(it.c); });
        else if (!v.isPlane) v.resetUpright();
        gameStore.setState({ carPaint: it.c });
      }
      if (it.kind === 'turbo') gameStore.setState({ turbo: true });
      g.hud.toast(`✔ ${it.n}`);
      (this.menu?.querySelector('.cash') as HTMLElement).textContent = `יש לך ₪${gameStore.getState().shekels}`;
    }));
    void this.lastCar;
  }
}
