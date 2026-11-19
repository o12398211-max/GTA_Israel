/**
 * Multiplayer protocol (JSON over WebSocket). Shared by client and server.
 * Only erasable TypeScript here so Node can run it with type stripping.
 */
export type GameMode = 'freeroam' | 'race' | 'arena';
export type Avatar = 'avi' | 'noa' | 'random';

export interface NetVehicle { type: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; speed: number; paint: number }

/** client → server */
export type ClientMsg =
  | { t: 'join'; room: string; name: string; avatar: Avatar; mode: GameMode }
  | { t: 'input'; seq: number; dt: number; mx: number; mz: number; run: boolean; jump: boolean; yaw: number; x: number; y: number; z: number; anim: number; veh: NetVehicle | null }
  | { t: 'chat'; text: string }
  | { t: 'punch' }
  | { t: 'ready' }
  | { t: 'ping'; at: number };

export interface NetPlayer {
  id: string; name: string; avatar: Avatar; seed: number;
  x: number; y: number; z: number; yaw: number; anim: number;
  veh: NetVehicle | null; hp: number; score: number; checkpoint: number; ko: number;
}

export interface RaceState { phase: 'lobby' | 'countdown' | 'racing' | 'finished'; startAt: number; checkpoints: { x: number; z: number }[]; winner: string | null; finish: Record<string, number> }

/** server → client */
export type ServerMsg =
  | { t: 'welcome'; id: string; room: string; mode: GameMode; tick: number }
  | { t: 'snapshot'; time: number; ack: number; you: { x: number; y: number; z: number; corrected: boolean }; players: NetPlayer[]; race: RaceState | null }
  | { t: 'chat'; from: string; text: string; system?: boolean }
  | { t: 'event'; kind: 'hit' | 'ko' | 'race_start' | 'race_finish' | 'joined' | 'left'; by?: string; target?: string; text?: string; grid?: { x: number; z: number; yaw: number } }
  | { t: 'error'; text: string }
  | { t: 'pong'; at: number };

export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;
export const MAX_SPEED: Record<string, number> = { foot: 7.5, sedan: 46, hatch: 46, taxi: 46, police: 54, bus: 27, moto: 52, scooter: 9, ebike: 11, plane: 80 };

/** Ayalon race course (southbound carriageway). */
export const RACE_CHECKPOINTS = [-250, -170, -90, -10, 70, 150, 230, 300].map((z, i) => ({ x: i % 2 ? 92 : 88, z }));
export const RACE_GRID = (i: number) => ({ x: 82.5 + (i % 4) * 5, z: -300 - Math.floor(i / 4) * 9, yaw: 0 });
/** Arena (beach) for the "what did you vote?" brawl mode. */
export const ARENA = { x: -248, z: 112, r: 26 };
