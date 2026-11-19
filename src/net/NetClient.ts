import * as THREE from 'three';
import type { Game, GameSystem } from '../core/Game';
import type { ClientMsg, ServerMsg, NetPlayer, GameMode, Avatar, RaceState } from '../../shared/protocol';
import { RACE_CHECKPOINTS } from '../../shared/protocol';
import { SkinnedCharacter, OUTFITS, randomOutfit } from '../entities/SkinnedCharacter';
import { buildVehicleModel, getKit, type VehicleType } from '../vehicles/VehicleKits';
import { gameStore } from '../state/store';

interface Remote {
  id: string; name: string; ch: SkinnedCharacter | null; tag: THREE.Sprite; veh: THREE.Group | null; vehType: string | null;
  buf: { t: number; p: NetPlayer }[]; hp: number;
}

/**
 * Multiplayer client.
 *  - Client-side prediction: the local player moves immediately (normal game code).
 *  - Inputs are sent at 20 Hz with sequence numbers; each input stores the
 *    predicted position.
 *  - Reconciliation: when a snapshot acks input N and flags a correction, the
 *    error between the server position and our prediction for N is applied to
 *    the current position (smoothed), which is equivalent to re-simulating the
 *    pending inputs on top of the server state for our kinematic model.
 *  - Remote players are interpolated 100 ms in the past from a snapshot buffer.
 */
export class NetClient implements GameSystem {
  private ws: WebSocket | null = null;
  id: string | null = null;
  room = '';
  mode: GameMode = 'freeroam';
  connected = false;
  private seq = 0;
  private history: { seq: number; x: number; z: number }[] = [];
  private sendAcc = 0;
  private remotes = new Map<string, Remote>();
  private correction = new THREE.Vector3();
  race: RaceState | null = null;
  rtt = 0;
  private chatBox: HTMLDivElement;
  private chatInput: HTMLInputElement;
  private chatOpen = false;
  private raceMarker: THREE.Mesh | null = null;
  private infoEl: HTMLDivElement;

  constructor(private game: Game) {
    this.chatBox = document.createElement('div');
    this.chatBox.id = 'chat';
    this.chatBox.innerHTML = '<div class="log"></div><input maxlength="140" placeholder="הקלידו הודעה… (Enter לשליחה)" />';
    document.body.appendChild(this.chatBox);
    this.chatInput = this.chatBox.querySelector('input')!;
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const text = this.chatInput.value.trim(); if (text) this.send({ t: 'chat', text }); this.chatInput.value = ''; this.toggleChat(false); }
      if (e.key === 'Escape') this.toggleChat(false);
    });
    this.infoEl = document.createElement('div');
    this.infoEl.id = 'net-info';
    document.body.appendChild(this.infoEl);
  }

  connect(url: string, room: string, name: string, avatar: Avatar, mode: GameMode): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disconnect();
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 6000);
      ws.onopen = () => { this.send({ t: 'join', room, name, avatar, mode }); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMsg;
        if (m.t === 'welcome') { clearTimeout(timer); this.onWelcome(m); resolve(); }
        else if (m.t === 'error') { clearTimeout(timer); reject(new Error(m.text)); }
        else this.onMessage(m);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('connection failed')); };
      ws.onclose = () => { this.connected = false; this.chatBox.classList.remove('on'); this.infoEl.textContent = ''; for (const r of this.remotes.values()) this.removeRemote(r); this.remotes.clear(); };
    });
  }

  disconnect() { this.ws?.close(); this.ws = null; this.connected = false; }

  private send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>) {
    this.id = m.id; this.room = m.room; this.mode = m.mode; this.connected = true;
    this.chatBox.classList.add('on');
    this.log('', `מחובר לחדר ${m.room} (${m.mode === 'race' ? 'מירוץ איילון' : m.mode === 'arena' ? 'ארנה: מה הצבעת?' : 'עולם פתוח'}) · Enter לצ'אט`, true);
    if (m.mode === 'race') this.log('', 'לחצו R כדי להתחיל מירוץ. נוסעים דרומה באיילון דרך כל השערים.', true);
    setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'snapshot': {
        const t = performance.now();
        for (const p of m.players) {
          let r = this.remotes.get(p.id);
          if (!r) { r = this.addRemote(p); this.remotes.set(p.id, r); }
          r.buf.push({ t, p });
          if (r.buf.length > 30) r.buf.shift();
          r.hp = p.hp;
        }
        for (const [id, r] of this.remotes) if (!m.players.some((p) => p.id === id)) { this.removeRemote(r); this.remotes.delete(id); }
        // reconciliation
        const h = this.history.find((x) => x.seq === m.ack);
        this.history = this.history.filter((x) => x.seq > m.ack);
        if (m.you.corrected && h) this.correction.set(m.you.x - h.x, 0, m.you.z - h.z);
        this.race = m.race;
        break;
      }
      case 'chat': this.log(m.from, m.text, m.system); break;
      case 'event':
        if (m.kind === 'hit' && m.target === this.id) { gameStore.setState({ health: Math.max(0, gameStore.getState().health - 25) }); this.game.audio.play('punch'); this.game.hud.toast('POW! מישהו לא אהב את התשובה שלך', 1.5); }
        if (m.kind === 'ko' || m.kind === 'race_finish') { this.log('', m.text ?? '', true); this.game.hud.showSplash(m.kind === 'ko' ? '😵' : '🏁', m.text ?? '', '#ff4fa3', 3); }
        if (m.kind === 'ko' && m.target === this.id) setTimeout(() => gameStore.setState({ health: 100 }), 3000);
        if (m.kind === 'race_start' && m.grid) {
          const g = this.game;
          if (!g.vehicles.current) { const v = g.vehicles.spawn('sedan', m.grid.x, m.grid.z, m.grid.yaw, 0xff4fa3); g.enterVehicle(v); }
          else g.vehicles.current.body?.setTranslation({ x: m.grid.x, y: 1, z: m.grid.z }, true);
          g.hud.showSplash('3… 2… 1…', m.text ?? '', '#ffcf40', 4);
        }
        break;
      case 'pong': this.rtt = performance.now() - m.at; break;
    }
  }

  private addRemote(p: NetPlayer): Remote {
    const tag = makeTag(p.name);
    this.game.scene.add(tag);
    const r: Remote = { id: p.id, name: p.name, ch: null, tag, veh: null, vehType: null, buf: [], hp: p.hp };
    let s = p.seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s % 100000) / 100000; };
    const outfit = p.avatar === 'noa' ? OUTFITS.noa : p.avatar === 'random' ? randomOutfit(rnd) : OUTFITS.avi;
    void SkinnedCharacter.create(outfit).then((ch) => { r.ch = ch; this.game.scene.add(ch.root); });
    return r;
  }
  private removeRemote(r: Remote) { r.ch?.root.removeFromParent(); r.tag.removeFromParent(); r.veh?.removeFromParent(); }

  toggleChat(on = !this.chatOpen) {
    if (!this.connected) return;
    this.chatOpen = on;
    this.game.input.suspended = on;
    this.chatBox.classList.toggle('typing', on);
    if (on) { document.exitPointerLock?.(); setTimeout(() => this.chatInput.focus(), 0); } else this.chatInput.blur();
  }

  private log(from: string, text: string, system = false) {
    const el = document.createElement('div');
    el.className = system ? 'sys' : '';
    el.innerHTML = from ? `<b></b> ` : '';
    if (from) (el.querySelector('b') as HTMLElement).textContent = `${from}:`;
    el.appendChild(document.createTextNode(text));
    const log = this.chatBox.querySelector('.log')!;
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild!.remove();
  }

  update(dt: number, g: Game) {
    if (!this.connected) return;
    if (!this.chatOpen && g.input.action('chat')) this.toggleChat(true);
    if (this.mode === 'arena' && g.input.action('punch')) this.send({ t: 'punch' });
    if (this.mode === 'race' && g.input.wasPressed('KeyR') && !this.chatOpen) this.send({ t: 'ready' });

    // apply reconciliation smoothly
    if (this.correction.lengthSq() > 0.25 * 0.25) {
      const step = this.correction.clone().multiplyScalar(Math.min(1, dt * 10));
      const v = g.vehicles.current;
      if (v?.body) { const t = v.body.translation(); v.body.setTranslation({ x: t.x + step.x, y: t.y, z: t.z + step.z }, true); }
      else g.player.position.add(step);
      this.correction.sub(step);
    } else this.correction.set(0, 0, 0);

    // send input at 20 Hz
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      const inp = g.lastInput;
      const fx = Math.sin(g.follow.yaw), fz = Math.cos(g.follow.yaw), rx = -Math.cos(g.follow.yaw), rz = Math.sin(g.follow.yaw);
      const v = g.vehicles.current;
      const pos = v ? v.position : g.player.position;
      this.seq++;
      const q = v?.quaternion;
      this.send({
        t: 'input', seq: this.seq, dt: this.sendAcc, mx: fx * inp.moveY + rx * inp.moveX, mz: fz * inp.moveY + rz * inp.moveX, run: inp.run, jump: inp.jump,
        yaw: v ? v.yaw : g.player.yaw, x: pos.x, y: pos.y, z: pos.z, anim: v ? 0 : g.player.speed,
        veh: v && q ? { type: v.type, x: pos.x, y: pos.y, z: pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, speed: v.speed, paint: 0 } : null,
      });
      this.history.push({ seq: this.seq, x: pos.x, z: pos.z });
      if (this.history.length > 100) this.history.shift();
      this.sendAcc = 0;
    }

    // interpolate remotes 100 ms behind
    const renderT = performance.now() - 100;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= renderT && b[i + 1].t >= renderT) { a = b[i]; c = b[i + 1]; break; }
      const u = c.t === a.t ? 1 : THREE.MathUtils.clamp((renderT - a.t) / (c.t - a.t), 0, 1);
      const x = THREE.MathUtils.lerp(a.p.x, c.p.x, u), y = THREE.MathUtils.lerp(a.p.y, c.p.y, u), z = THREE.MathUtils.lerp(a.p.z, c.p.z, u);
      let dyaw = c.p.yaw - a.p.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const yaw = a.p.yaw + dyaw * u;
      const veh = c.p.veh;
      if (veh && r.vehType !== veh.type) {
        r.veh?.removeFromParent();
        r.veh = buildVehicleModel(getKit(veh.type as VehicleType), 0xff4fa3).group;
        g.scene.add(r.veh); r.vehType = veh.type;
      } else if (!veh && r.veh) { r.veh.removeFromParent(); r.veh = null; r.vehType = null; }
      if (r.veh && veh) { r.veh.position.set(x, y, z); r.veh.quaternion.set(veh.qx, veh.qy, veh.qz, veh.qw); }
      if (r.ch) {
        r.ch.root.position.set(x, y + (veh ? 0.4 : 0), z);
        r.ch.root.rotation.y = yaw;
        r.ch.forced = veh ? 'drive' : c.p.ko > 0 ? 'sit' : null;
        r.ch.update(dt, c.p.anim, true, 0);
      }
      r.tag.position.set(x, y + 2.25, z);
    }
    this.infoEl.textContent = `🌐 ${this.room} · ${this.remotes.size + 1}/8 · ${Math.round(this.rtt)}ms${this.race ? ` · ${raceText(this.race)}` : ''}`;
    // race checkpoint marker
    if (this.mode === 'race') this.updateRaceMarker(g);
  }

  private updateRaceMarker(g: Game) {
    if (!this.raceMarker) {
      this.raceMarker = new THREE.Mesh(new THREE.TorusGeometry(10, 0.6, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.7 }));
      g.scene.add(this.raceMarker);
    }
    const me = this.race?.phase === 'racing' ? (this.myCheckpoint ?? 0) : 0;
    const cp = RACE_CHECKPOINTS[Math.min(me, RACE_CHECKPOINTS.length - 1)];
    this.raceMarker.position.set(cp.x, 6, cp.z);
    const pos = g.vehicles.current ? g.vehicles.current.position : g.player.position;
    if (this.race?.phase === 'racing' && Math.hypot(pos.x - cp.x, pos.z - cp.z) < 22) this.myCheckpoint = me + 1;
    if (this.race?.phase !== 'racing') this.myCheckpoint = 0;
    g.hud.blips = [...g.hud.blips, { x: cp.x, z: cp.z, color: '#ff4fa3', size: 8, route: true }];
  }
  private myCheckpoint = 0;
}

function raceText(r: RaceState) {
  if (r.phase === 'lobby') return 'מירוץ: R להתחלה';
  if (r.phase === 'countdown') return `מתחילים בעוד ${Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000))}`;
  if (r.phase === 'racing') return 'מירוץ!';
  return 'המירוץ הסתיים · R לסיבוב נוסף';
}

function makeTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 20); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 30px Rubik, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
  g.fillText(name, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}
