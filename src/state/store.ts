import { createStore } from 'zustand/vanilla';
import type { ZoneId } from '../world/Terrain';

/** Global game state (UI reads it, systems write it). */
export interface GameState {
  phase: 'loading' | 'title' | 'playing' | 'paused';
  zone: ZoneId | null;
  hour: number;
  fps: number;
  character: 'avi' | 'noa';
  shekels: number;
  /** "כוכבי עצבים" – nerve stars 0..5 (stage 3) */
  nerves: number;
  setZone: (z: ZoneId) => void;
}

export const gameStore = createStore<GameState>()((set) => ({
  phase: 'loading',
  zone: null,
  hour: 17,
  fps: 0,
  character: 'avi',
  shekels: 120,
  nerves: 0,
  setZone: (zone) => set({ zone }),
}));
