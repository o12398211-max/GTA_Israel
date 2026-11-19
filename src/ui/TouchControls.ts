import type { Input } from '../core/Input';

/**
 * Mobile touch controls: left virtual joystick (move / steer), right-half drag
 * (camera), and action buttons. Writes into Input.virtual. Shown only on
 * touch devices (or with ?touch).
 */
export class TouchControls {
  private el: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };

  static wanted() { return 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'); }

  constructor(input: Input) {
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.innerHTML = `<div class="stick"><div class="knob"></div></div>
      <div class="btns">
        <button data-b="jump">⤒</button><button data-b="punch">👊</button><button data-b="enter">🚗</button>
        <button data-b="run" class="hold">🏃</button><button data-b="interact">E</button><button data-b="phone">📱</button><button data-b="horn">📯</button>
      </div>`;
    document.body.appendChild(this.el);
    this.stick = this.el.querySelector('.stick')!;
    this.knob = this.el.querySelector('.knob')!;
    const v = input.virtual;
    this.el.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        const target = t.target as HTMLElement;
        const b = target.closest('button') as HTMLButtonElement | null;
        if (b) { const id = b.dataset.b!; if (id === 'run') v.run = true; else v.buttons.add(id); b.classList.add('on'); continue; }
        if (t.clientX < innerWidth * 0.45 && this.stickId === null) {
          this.stickId = t.identifier; this.stickOrigin = { x: t.clientX, y: t.clientY };
          this.stick.style.left = `${t.clientX - 60}px`; this.stick.style.top = `${t.clientY - 60}px`; this.stick.classList.add('on');
        } else if (this.lookId === null) { this.lookId = t.identifier; this.lookLast = { x: t.clientX, y: t.clientY }; }
      }
      e.preventDefault();
    }, { passive: false });
    this.el.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          let dx = (t.clientX - this.stickOrigin.x) / 55, dy = (t.clientY - this.stickOrigin.y) / 55;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          v.moveX = dx; v.moveY = -dy;
          this.knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (t.identifier === this.lookId) {
          v.lookX += (t.clientX - this.lookLast.x) * 0.006; v.lookY += (t.clientY - this.lookLast.y) * 0.004;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const b = (t.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (b) { const id = b.dataset.b!; if (id === 'run') v.run = false; else v.buttons.delete(id); b.classList.remove('on'); }
        if (t.identifier === this.stickId) { this.stickId = null; v.moveX = v.moveY = 0; this.knob.style.transform = ''; this.stick.classList.remove('on'); }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    this.el.addEventListener('touchend', end);
    this.el.addEventListener('touchcancel', end);
  }
}
