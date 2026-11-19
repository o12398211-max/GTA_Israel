/**
 * Unified input: keyboard + mouse (pointer lock) + Gamepad API + touch
 * (virtual stick/buttons feed `virtual`). Game code reads abstract actions.
 */
export interface InputState {
  moveX: number; // -1 left .. 1 right
  moveY: number; // -1 back .. 1 forward
  lookX: number;
  lookY: number;
  run: boolean;
  walk: boolean;
  jump: boolean; // edge
  zoom: number;
}

export type Action = 'enter' | 'punch' | 'horn' | 'siren' | 'phone' | 'interact' | 'switch' | 'pause' | 'help' | 'time' | 'map' | 'chat' | 'camera';

const DEADZONE = 0.15;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

const ACTION_KEYS: Record<Action, string[]> = {
  enter: ['KeyF'], punch: ['Mouse0', 'KeyR'], horn: ['KeyH'], siren: ['KeyE'], phone: ['KeyP'],
  interact: ['KeyE'], switch: ['Tab'], pause: ['Escape'], help: ['F1'], time: ['KeyT'], map: ['KeyM'], chat: ['Enter'], camera: ['KeyV'],
};
const PAD_BUTTONS: Partial<Record<Action, number>> = { enter: 3, punch: 2, horn: 10, phone: 12, interact: 1, switch: 8, pause: 9, map: 13 };

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  mouseSensitivity = 0.0025;
  padSensitivity = 2.6;
  invertY = false;
  /** when false, arrow keys don't rotate the camera (plane controls) */
  arrowLook = true;
  /** while typing in chat etc. */
  suspended = false;
  /** touch controls write here */
  virtual = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false, buttons: new Set<string>() };
  private virtualPrev = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.suspended && e.code !== 'Enter' && e.code !== 'Escape') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas && !('ontouchstart' in window)) canvas.requestPointerLock?.();
    });
    canvas.addEventListener('mousedown', (e) => { if (document.pointerLockElement === canvas) { this.pressed.add(`Mouse${e.button}`); this.keys.add(`Mouse${e.button}`); } });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  get pointerLocked() { return document.pointerLockElement === this.canvas; }
  releasePointer() { if (this.pointerLocked) document.exitPointerLock(); }

  wasPressed(code: string): boolean { return this.pressed.has(code); }
  isDown(code: string): boolean { return this.keys.has(code); }
  /** for tests / scripted input */
  press(code: string, down = true) { if (down) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); } else this.keys.delete(code); }

  private pad(): Gamepad | null {
    return navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
  }

  action(a: Action): boolean {
    if (this.suspended && a !== 'chat' && a !== 'pause') return false;
    if (ACTION_KEYS[a].some((k) => this.pressed.has(k))) return true;
    const b = PAD_BUTTONS[a];
    if (b !== undefined && this.padNow[b] && !this.padPrev[b]) return true;
    if (this.virtual.buttons.has(a) && !this.virtualPrev.has(a)) return true;
    return false;
  }
  held(a: Action): boolean {
    if (ACTION_KEYS[a].some((k) => this.keys.has(k))) return true;
    const b = PAD_BUTTONS[a];
    return (b !== undefined && !!this.padNow[b]) || this.virtual.buttons.has(a);
  }

  sample(dt: number): InputState {
    const k = this.suspended ? new Set<string>() : this.keys;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let my = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let lx = this.mouseDX * this.mouseSensitivity;
    let ly = this.mouseDY * this.mouseSensitivity;
    if (this.arrowLook) {
      lx += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 2.2 * dt;
      ly += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 1.5 * dt;
    }
    let run = k.has('ShiftLeft') || k.has('ShiftRight') || this.virtual.run;
    const walk = k.has('AltLeft') || k.has('ControlLeft') || k.has('KeyC');
    let jump = this.pressed.has('Space') || (this.virtual.buttons.has('jump') && !this.virtualPrev.has('jump'));
    const zoom = this.wheel;
    let padWalk = false;
    const pad = this.pad();
    if (pad) {
      const ax = dz(pad.axes[0] ?? 0), ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
      if (ax || ay) { mx = ax; my = -ay; padWalk = Math.hypot(ax, ay) < 0.55; }
      lx += rx * this.padSensitivity * dt;
      ly += ry * this.padSensitivity * 0.7 * dt;
      if (pad.buttons[5]?.pressed) run = true;
      if (this.padNow[0] && !this.padPrev[0]) jump = true;
    }
    if (this.virtual.moveX || this.virtual.moveY) { mx = this.virtual.moveX; my = this.virtual.moveY; }
    lx += this.virtual.lookX; ly += this.virtual.lookY;
    this.virtual.lookX = this.virtual.lookY = 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (this.invertY) ly = -ly;
    return { moveX: mx, moveY: my, lookX: lx, lookY: ly, run, walk: walk || padWalk, jump, zoom };
  }

  /** Raw driving / flying axes (keyboard + gamepad triggers + touch). */
  drive(): { throttle: number; brake: number; steer: number; handbrake: boolean; pitch: number; roll: number; yaw: number } {
    const k = this.suspended ? new Set<string>() : this.keys;
    let throttle = k.has('KeyW') ? 1 : 0, brake = k.has('KeyS') ? 1 : 0;
    let steer = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
    let handbrake = k.has('Space');
    const pitch = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    let roll = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const yaw = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    const pad = this.pad();
    if (pad) {
      const t = pad.buttons[7]?.value ?? 0, b = pad.buttons[6]?.value ?? 0;
      if (t > 0.05) throttle = t;
      if (b > 0.05) brake = b;
      const ax = dz(pad.axes[0] ?? 0);
      if (ax) { steer = -ax; roll = ax; }
      if (pad.buttons[2]?.pressed) handbrake = true;
    }
    if (this.virtual.moveY > 0.2) throttle = this.virtual.moveY;
    if (this.virtual.moveY < -0.2) brake = -this.virtual.moveY;
    if (this.virtual.moveX) { steer = -this.virtual.moveX; roll = this.virtual.moveX; }
    return { throttle, brake, steer, handbrake, pitch, roll, yaw };
  }

  endFrame(): void {
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.pressed.clear();
    this.padPrev = this.padNow;
    const pad = this.pad();
    this.padNow = pad ? pad.buttons.map((b) => b.pressed) : [];
    this.virtualPrev = new Set(this.virtual.buttons);
  }
}
