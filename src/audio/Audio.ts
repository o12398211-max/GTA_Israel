import { Howl, Howler } from 'howler';
import * as THREE from 'three';

/**
 * All game audio is synthesized at startup into small WAV buffers and played
 * through Howler (no external files). Positional sounds use simple distance
 * attenuation + stereo pan relative to the camera.
 */
const SR = 22050;

function wav(seconds: number, fn: (t: number, i: number) => number): string {
  const n = Math.floor(seconds * SR);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, fn(i / SR, i)));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const TAU = Math.PI * 2;
const sq = (x: number) => (Math.sin(x) > 0 ? 1 : -1);
const saw = (x: number) => ((x / TAU) % 1) * 2 - 1;
let seed = 1;
const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };

function lowpass(fn: (t: number, i: number) => number, a: number) {
  let y = 0;
  return (t: number, i: number) => (y += a * (fn(t, i) - y));
}

export type SoundId = 'horn' | 'hornTruck' | 'engine' | 'squeal' | 'siren' | 'punch' | 'tok' | 'alert' | 'waves' | 'city' | 'cash' | 'click' | 'splash' | 'crowd' | 'crash' | 'whoosh' | 'beat';

export class AudioSystem {
  private sounds = new Map<SoundId, Howl>();
  private loops = new Map<SoundId, number>();
  master = 0.8;
  sfx = 1;
  music = 0.7;
  private listener = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);

  constructor() {
    const def = (id: SoundId, src: string, loop = false, vol = 1) => this.sounds.set(id, new Howl({ src: [src], format: ['wav'], loop, volume: vol }));
    def('horn', wav(0.55, (t) => (sq(TAU * 415 * t) * 0.5 + sq(TAU * 523 * t) * 0.5) * 0.35 * Math.min(1, t * 40, (0.55 - t) * 20)));
    def('hornTruck', wav(0.9, (t) => (saw(TAU * 220 * t) + saw(TAU * 277 * t)) * 0.25 * Math.min(1, t * 30, (0.9 - t) * 10)));
    // engine loop: harmonics of a 50Hz firing frequency, pitch is driven with rate()
    def('engine', wav(1.0, (t) => (saw(TAU * 50 * t) * 0.5 + Math.sin(TAU * 100 * t) * 0.3 + Math.sin(TAU * 150 * t) * 0.15 + noise() * 0.05) * 0.4), true, 0);
    def('squeal', wav(1.0, lowpass((t) => noise() * (0.6 + 0.4 * Math.sin(TAU * 7 * t)) + Math.sin(TAU * 2400 * t + Math.sin(TAU * 13 * t) * 3) * 0.5, 0.5)), true, 0);
    def('siren', wav(2.0, (t) => Math.sin(TAU * (650 + 350 * Math.sin(TAU * 0.5 * t)) * t) * 0.35), true, 0);
    def('punch', wav(0.22, (t) => (noise() * Math.exp(-t * 40) * 0.8 + Math.sin(TAU * 90 * t) * Math.exp(-t * 18)) * 0.8));
    def('tok', wav(0.09, (t) => (Math.sin(TAU * 1250 * t) + 0.5 * Math.sin(TAU * 2600 * t)) * Math.exp(-t * 70) * 0.8));
    // phone alert tone: calm rising chime (not a siren)
    def('alert', wav(1.6, (t) => { const f = [660, 880, 990, 1320][Math.min(3, Math.floor(t / 0.4))]; return Math.sin(TAU * f * t) * 0.4 * Math.exp(-((t % 0.4) * 5)); }));
    def('waves', wav(6.0, lowpass((t) => noise() * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * t / 6) * Math.sin(Math.PI * t / 3), 2)), 0.08)), true, 0);
    def('city', wav(4.0, lowpass(() => noise(), 0.03)), true, 0);
    def('crowd', wav(4.0, lowpass((t) => noise() * (0.6 + 0.4 * Math.sin(TAU * 1.5 * t)), 0.2)), true, 0);
    def('cash', wav(0.5, (t) => (Math.sin(TAU * 1800 * t) * (t < 0.12 ? 1 : 0) + Math.sin(TAU * 2400 * t) * (t > 0.12 ? 1 : 0)) * Math.exp(-t * 6) * 0.5));
    def('click', wav(0.04, (t) => Math.sin(TAU * 1800 * t) * Math.exp(-t * 120) * 0.5));
    def('splash', wav(0.6, lowpass((t) => noise() * Math.exp(-t * 6), 0.4)));
    def('crash', wav(0.7, (t) => (noise() * Math.exp(-t * 5) + Math.sin(TAU * 60 * t) * Math.exp(-t * 8)) * 0.9));
    def('whoosh', wav(0.5, lowpass((t) => noise() * Math.sin(Math.PI * t / 0.5), 0.15)));
    // simple drum loop for the stadium rhythm game (120 bpm)
    def('beat', wav(2.0, (t) => {
      const b = t % 0.5, k = Math.sin(TAU * 60 * b * (1 - b)) * Math.exp(-b * 18);
      const s8 = t % 1.0; const snare = s8 > 0.5 ? noise() * Math.exp(-(s8 - 0.5) * 25) * 0.5 : 0;
      return (k + snare) * 0.7;
    }), true, 0);
    Howler.volume(this.master);
  }

  setVolumes(master: number, sfx: number, music: number) {
    this.master = master; this.sfx = sfx; this.music = music;
    Howler.volume(master);
  }

  setListener(pos: THREE.Vector3, camera: THREE.Camera) {
    this.listener.copy(pos);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  /** One-shot; optionally positional. */
  play(id: SoundId, at?: THREE.Vector3, vol = 1, rate = 1) {
    const h = this.sounds.get(id);
    if (!h) return;
    let v = vol * this.sfx, pan = 0;
    if (at) {
      const d = at.distanceTo(this.listener);
      v *= 1 / (1 + d * 0.06);
      if (v < 0.02) return;
      pan = THREE.MathUtils.clamp(at.clone().sub(this.listener).normalize().dot(this.listenerRight), -1, 1) * 0.7;
    }
    const sid = h.play();
    h.volume(v, sid);
    h.stereo(pan, sid);
    h.rate(rate, sid);
  }

  /** Continuous loop with live volume/rate (engine, squeal, ambience…). */
  loop(id: SoundId, vol: number, rate = 1) {
    const h = this.sounds.get(id);
    if (!h) return;
    let sid = this.loops.get(id);
    if (sid === undefined) {
      if (vol <= 0.001) return;
      sid = h.play();
      this.loops.set(id, sid);
    }
    h.volume(vol * (id === 'beat' ? this.music : this.sfx), sid);
    h.rate(rate, sid);
  }
}
