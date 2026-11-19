import { createStore } from 'zustand/vanilla';
import type { ZoneId } from '../world/Terrain';

export type CharacterId = 'avi' | 'noa';

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  mouseSensitivity: number;
  invertY: boolean;
  master: number; sfx: number; music: number;
  language: 'he' | 'en';
  subtitles: boolean;
  tts: boolean;
}

/** Global game state (UI reads it, systems write it). */
export interface GameState {
  phase: 'loading' | 'title' | 'playing' | 'paused' | 'cutscene' | 'minigame' | 'ending';
  zone: ZoneId | null;
  hour: number;
  fps: number;
  character: CharacterId;
  shekels: number;
  /** "כוכבי עצבים" – nerve stars 0..5 (fractional, HUD rounds) */
  nerves: number;
  health: number; // 0..100
  energy: number; // 0..100 (sprint stamina)
  inVehicle: string | null;
  missionIndex: number; // story progress
  objective: string | null;
  notifications: { id: number; app: string; title: string; text: string; time: string }[];
  outfit: { shirt: number; pants: number };
  carPaint: number;
  turbo: boolean;
  settings: Settings;
  setZone: (z: ZoneId) => void;
  addNerves: (n: number) => void;
  addCash: (n: number) => void;
  notify: (app: string, title: string, text: string) => void;
}

const SETTINGS_KEY = 'gta-israel-settings';
const SAVE_KEY = 'gta-israel-save';

function loadSettings(): Settings {
  const def: Settings = { quality: 'high', mouseSensitivity: 1, invertY: false, master: 0.8, sfx: 1, music: 0.7, language: 'he', subtitles: true, tts: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return def; }
}
function loadSave(): { missionIndex: number; shekels: number } {
  try { return { missionIndex: 0, shekels: 120, ...JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') }; } catch { return { missionIndex: 0, shekels: 120 }; }
}

let notifId = 0;
const save = loadSave();

export const gameStore = createStore<GameState>()((set, get) => ({
  phase: 'loading',
  zone: null,
  hour: 17,
  fps: 0,
  character: 'avi',
  shekels: save.shekels,
  nerves: 0,
  health: 100,
  energy: 100,
  inVehicle: null,
  missionIndex: save.missionIndex,
  objective: null,
  notifications: [],
  outfit: { shirt: 0xf4f3ee, pants: 0x2c3e5c },
  carPaint: 0xb3122a,
  turbo: false,
  settings: loadSettings(),
  setZone: (zone) => set({ zone }),
  addNerves: (n) => set({ nerves: Math.max(0, Math.min(5, get().nerves + n)) }),
  addCash: (n) => set({ shekels: Math.max(0, get().shekels + n) }),
  notify: (app, title, text) => {
    const d = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    set({ notifications: [{ id: ++notifId, app, title, text, time }, ...get().notifications].slice(0, 30) });
  },
}));

gameStore.subscribe((s, prev) => {
  if (s.settings !== prev.settings) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s.settings)); } catch { /* private mode */ } }
  if (s.missionIndex !== prev.missionIndex || s.shekels !== prev.shekels) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ missionIndex: s.missionIndex, shekels: s.shekels })); } catch { /* ignore */ }
  }
});
