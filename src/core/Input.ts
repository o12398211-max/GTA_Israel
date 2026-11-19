/**
 * Unified input: keyboard + mouse (pointer lock) + Gamepad API.
 * Game code reads abstract axes/actions, never raw keys.
 */
export interface InputState {
  moveX: number; // -1 left .. 1 right
  moveY: number; // -1 back .. 1 forward
  lookX: number; // accumulated delta this frame (radians-ish)
  lookY: number;
  run: boolean;
  walk: boolean;
  jump: boolean; // edge-triggered (true one frame)
  zoom: number; // wheel delta this frame
}

const DEADZONE = 0.15;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private prevPadJump = false;
  mouseSensitivity = 0.0025;
  padSensitivity = 2.6;
  invertY = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  /** Was the key pressed this frame (edge)? */
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  isDown(code: string): boolean { return this.keys.has(code); }

  /** Sample state for this frame. Call once per frame, then endFrame(). */
  sample(dt: number): InputState {
    const k = this.keys;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let my = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let lx = this.mouseDX * this.mouseSensitivity;
    let ly = this.mouseDY * this.mouseSensitivity;
    // Arrow keys rotate camera (useful without pointer lock)
    lx += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 2.2 * dt;
    ly += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 1.5 * dt;
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    const walk = k.has('AltLeft') || k.has('ControlLeft') || k.has('KeyC');
    let jump = this.pressed.has('Space');
    let zoom = this.wheel;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = dz(pad.axes[0] ?? 0), ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
      if (ax || ay) { mx = ax; my = -ay; }
      lx += rx * this.padSensitivity * dt;
      ly += ry * this.padSensitivity * 0.7 * dt;
      if (pad.buttons[10]?.pressed || pad.buttons[5]?.pressed) run = true; // L3 / RB
      const pj = !!pad.buttons[0]?.pressed; // A / Cross
      if (pj && !this.prevPadJump) jump = true;
      this.prevPadJump = pj;
      if (pad.buttons[12]?.pressed) zoom -= 0.1;
      if (pad.buttons[13]?.pressed) zoom += 0.1;
    }

    // normalize diagonal keyboard movement
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (this.invertY) ly = -ly;
    return { moveX: mx, moveY: my, lookX: lx, lookY: ly, run, walk: walk || (pad != null && Math.hypot(mx, my) < 0.55 && Math.hypot(mx, my) > 0), jump, zoom };
  }

  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
  }
}
