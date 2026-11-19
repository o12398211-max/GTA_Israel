/**
 * GTA VI: Israel – authoritative multiplayer server.
 *
 *   node --experimental-strip-types server/index.ts      (PORT=8787 by default)
 *
 * Model: clients send inputs (move vector, run, jump, yaw) with sequence numbers
 * plus their locally predicted position (client-side prediction, collisions are
 * resolved locally against the static city). The server integrates the same
 * kinematics, validates speed/teleports, and accepts the client's collision-
 * resolved position only when it lies within the reachable envelope; otherwise
 * it keeps its own authoritative position and tells the client to reconcile.
 * Server also owns hit detection (arena), race checkpoints and timing, chat.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { terrainHeight, WORLD } from '../shared/terrain.ts';
import type { ClientMsg, ServerMsg, NetPlayer, GameMode, RaceState } from '../shared/protocol.ts';
import { MAX_PLAYERS, TICK_HZ, MAX_SPEED, RACE_CHECKPOINTS, RACE_GRID, ARENA } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);

interface Client {
  ws: WebSocket; id: string; room: Room | null; p: NetPlayer; ack: number; corrected: boolean;
  lastMsg: number; msgBudget: number; lastPunch: number;
}
interface Room { code: string; mode: GameMode; clients: Map<string, Client>; race: RaceState | null; created: number }

const rooms = new Map<string, Room>();
let nextId = 1;
const now = () => Date.now();

function send(c: Client, m: ServerMsg) { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); }
function broadcast(r: Room, m: ServerMsg, except?: string) { for (const c of r.clients.values()) if (c.id !== except) send(c, m); }
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);

function getRoom(code: string, mode: GameMode): Room {
  let r = rooms.get(code);
  if (!r) {
    r = { code, mode, clients: new Map(), race: null, created: now() };
    if (mode === 'race') r.race = { phase: 'lobby', startAt: 0, checkpoints: RACE_CHECKPOINTS, winner: null, finish: {} };
    rooms.set(code, r);
  }
  return r;
}

function groundY(x: number, z: number) { const t = terrainHeight(x, z); return x > -213 && x < 76 ? Math.max(t, 0.15) : t; }

function handle(c: Client, raw: string) {
  // simple rate limit: 60 msgs/s burst budget
  const t = now();
  c.msgBudget = Math.min(60, c.msgBudget + ((t - c.lastMsg) / 1000) * 40);
  c.lastMsg = t;
  if (--c.msgBudget < 0) return;
  let m: ClientMsg;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m.t) {
    case 'join': {
      if (c.room) return;
      const code = clean(m.room, 12).toUpperCase() || 'PUBLIC';
      const mode: GameMode = m.mode === 'race' || m.mode === 'arena' ? m.mode : 'freeroam';
      const r = getRoom(code, mode);
      if (r.clients.size >= MAX_PLAYERS) { send(c, { t: 'error', text: 'החדר מלא (8 שחקנים)' }); return; }
      c.room = r;
      c.p.name = clean(m.name, 16) || `שחקן ${c.id}`;
      c.p.avatar = m.avatar === 'noa' || m.avatar === 'random' ? m.avatar : 'avi';
      const spawn = r.mode === 'arena' ? { x: ARENA.x + (Math.random() - 0.5) * 20, z: ARENA.z + (Math.random() - 0.5) * 20 } : r.mode === 'race' ? RACE_GRID(r.clients.size) : { x: -206, z: 20 + r.clients.size * 2 };
      Object.assign(c.p, { x: spawn.x, z: spawn.z, y: groundY(spawn.x, spawn.z) });
      r.clients.set(c.id, c);
      send(c, { t: 'welcome', id: c.id, room: r.code, mode: r.mode, tick: TICK_HZ });
      broadcast(r, { t: 'chat', from: '', text: `${c.p.name} הצטרף/ה לחדר`, system: true });
      break;
    }
    case 'input': {
      const r = c.room; if (!r) return;
      if (typeof m.seq !== 'number' || m.seq <= c.ack) return;
      const dt = Math.min(0.25, Math.max(0, Number(m.dt) || 0));
      const p = c.p;
      p.yaw = Number(m.yaw) || 0;
      p.anim = Math.min(20, Math.max(0, Number(m.anim) || 0));
      if (p.ko > 0) { c.ack = m.seq; return; }
      if (m.veh) {
        // vehicle: validate reported motion against the type's top speed
        const v = m.veh;
        const max = MAX_SPEED[v.type] ?? 50;
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        const ok = Number.isFinite(d) && d <= max * dt * 1.6 + 2 && Math.abs(v.speed) <= max * 1.2;
        if (ok) { p.x = v.x; p.y = v.y; p.z = v.z; p.veh = { ...v, type: clean(v.type, 10) }; c.corrected = false; }
        else c.corrected = true;
      } else {
        p.veh = null;
        // authoritative kinematics for on-foot movement
        const len = Math.hypot(m.mx, m.mz) || 1;
        const speed = (m.run ? MAX_SPEED.foot : 3.8) * Math.min(1, Math.hypot(m.mx, m.mz));
        const sx = p.x + (m.mx / len) * speed * dt, sz = p.z + (m.mz / len) * speed * dt;
        // accept the client's collision-resolved position if it's within the envelope of what we simulated
        const dErr = Math.hypot(m.x - sx, m.z - sz);
        if (Number.isFinite(dErr) && dErr < 1.2 + speed * dt) { p.x = m.x; p.z = m.z; p.y = m.y; c.corrected = false; }
        else { p.x = sx; p.z = sz; p.y = groundY(sx, sz); c.corrected = true; }
      }
      p.x = Math.min(WORLD.maxX, Math.max(WORLD.minX, p.x));
      p.z = Math.min(WORLD.maxZ, Math.max(WORLD.minZ, p.z));
      c.ack = m.seq;
      if (r.race?.phase === 'racing') raceProgress(r, c);
      break;
    }
    case 'chat': {
      const r = c.room; if (!r) return;
      const text = clean(m.text, 140);
      if (text) broadcast(r, { t: 'chat', from: c.p.name, text });
      break;
    }
    case 'punch': {
      const r = c.room; if (!r || r.mode !== 'arena' || c.p.ko > 0) return;
      if (now() - c.lastPunch < 450) return;
      c.lastPunch = now();
      const fx = Math.sin(c.p.yaw), fz = Math.cos(c.p.yaw);
      for (const o of r.clients.values()) {
        if (o === c || o.p.ko > 0) continue;
        const dx = o.p.x - c.p.x, dz = o.p.z - c.p.z, d = Math.hypot(dx, dz);
        if (d < 1.8 && (dx * fx + dz * fz) / (d || 1) > 0.35) {
          o.p.hp -= 25;
          broadcast(r, { t: 'event', kind: 'hit', by: c.id, target: o.id });
          if (o.p.hp <= 0) { o.p.ko = 3; c.p.score++; broadcast(r, { t: 'event', kind: 'ko', by: c.id, target: o.id, text: `${c.p.name} הרגיע את ${o.p.name} 😵` }); }
          break;
        }
      }
      break;
    }
    case 'ready': {
      const r = c.room;
      if (r?.race && (r.race.phase === 'lobby' || r.race.phase === 'finished')) startRace(r);
      break;
    }
    case 'ping': send(c, { t: 'pong', at: m.at }); break;
  }
}

function startRace(r: Room) {
  const race = r.race!;
  race.phase = 'countdown'; race.startAt = now() + 5000; race.winner = null; race.finish = {};
  let i = 0;
  for (const c of r.clients.values()) {
    const g = RACE_GRID(i++);
    Object.assign(c.p, { x: g.x, z: g.z, y: 0, checkpoint: 0 });
    send(c, { t: 'event', kind: 'race_start', grid: g, text: 'מירוץ איילון מתחיל בעוד 5 שניות!' });
  }
}

function raceProgress(r: Room, c: Client) {
  const race = r.race!;
  const cp = race.checkpoints[c.p.checkpoint];
  if (!cp) return;
  if (Math.hypot(c.p.x - cp.x, c.p.z - cp.z) < 22) {
    c.p.checkpoint++;
    if (c.p.checkpoint >= race.checkpoints.length) {
      race.finish[c.id] = now() - race.startAt;
      if (!race.winner) { race.winner = c.id; broadcast(r, { t: 'event', kind: 'race_finish', by: c.id, text: `🏁 ${c.p.name} ניצח/ה במירוץ איילון! (${(race.finish[c.id] / 1000).toFixed(1)} שנ')` }); }
      if (Object.keys(race.finish).length >= r.clients.size) race.phase = 'finished';
    }
  }
}

// ---- tick: snapshots, timers, cleanup
setInterval(() => {
  const t = now();
  for (const [code, r] of rooms) {
    if (r.clients.size === 0 && t - r.created > 10000) { rooms.delete(code); continue; }
    if (r.race?.phase === 'countdown' && t >= r.race.startAt) r.race.phase = 'racing';
    const players = [...r.clients.values()].map((c) => {
      if (c.p.ko > 0) { c.p.ko -= 1 / TICK_HZ; if (c.p.ko <= 0) { c.p.ko = 0; c.p.hp = 100; } }
      return c.p;
    });
    for (const c of r.clients.values()) {
      send(c, { t: 'snapshot', time: t, ack: c.ack, you: { x: c.p.x, y: c.p.y, z: c.p.z, corrected: c.corrected }, players: players.filter((p) => p.id !== c.id), race: r.race });
      c.corrected = false;
    }
  }
}, 1000 / TICK_HZ);

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  const id = String(nextId++);
  const c: Client = {
    ws, id, room: null, ack: 0, corrected: false, lastMsg: now(), msgBudget: 60, lastPunch: 0,
    p: { id, name: '', avatar: 'avi', seed: Math.floor(Math.random() * 1e6), x: 0, y: 0, z: 0, yaw: 0, anim: 0, veh: null, hp: 100, score: 0, checkpoint: 0, ko: 0 },
  };
  ws.on('message', (d) => handle(c, String(d)));
  ws.on('close', () => {
    const r = c.room;
    if (r) { r.clients.delete(id); broadcast(r, { t: 'chat', from: '', text: `${c.p.name} יצא/ה`, system: true }); broadcast(r, { t: 'event', kind: 'left', target: id }); }
  });
});
console.log(`GTA VI: Israel server listening on ws://0.0.0.0:${PORT}`);
