import * as THREE from 'three';
import type { Game } from '../core/Game';
import { GameOverlay } from './common';
import type { MgResult } from './Matkot';
import type { Vehicle } from '../vehicles/Vehicle';

const RANTS = [
  'יאללה, זוז כבר!', 'מי נתן לו רישיון?!', 'כל יום אותו דבר…', 'איפה הרכבת שהבטיחו?', 'הוויז אמר 12 דקות!',
  'אני עוד אגיע לאירוע עם זקן לבן', 'למה כולם נוסעים לאותו מקום באותו זמן?!', 'זה לא פקק, זה אורח חיים',
];

/**
 * "פקק באיילון" – survive the eternal jam. Patience drains while you're stuck
 * and recovers when you move; weaving between lanes helps, honking helps your
 * soul (a bit) but raises your nerve stars. Reach the exit before you snap.
 */
export class AyalonJam {
  private ui!: GameOverlay;
  patience = 100;
  private car!: Vehicle;
  private result: MgResult = 'running';
  private rantT = 4;
  private lastLaneX = 0;
  readonly exitZ = 260;
  constructor(private game: Game, private ownCar = true) {}

  start() {
    const g = this.game;
    if (this.ownCar) {
      const at = new THREE.Vector3(92.5, 0, -300);
      g.traffic.clearAround(at, 14);
      if (g.vehicles.current) g.exitVehicle();
      this.car = g.vehicles.spawn('sedan', at.x, at.z, 0, 0xb3122a);
      g.enterVehicle(this.car);
      g.follow.snap(this.car.position, 0);
    } else this.car = g.vehicles.current!;
    this.lastLaneX = this.car.position.x;
    this.ui = new GameOverlay('jam', `<div class="title">פקק באיילון</div><div class="label">סבלנות</div><div class="meter"><div class="fill"></div></div><div class="dist"></div><div class="rant"></div>`);
  }

  get targetPos() { return { x: 92.5, z: this.exitZ, r: 10 }; }

  update(dt: number): MgResult {
    if (this.result !== 'running') return this.result;
    const g = this.game, c = this.car;
    if (g.vehicles.current !== c) { this.patience -= dt * 10; }
    const sp = Math.abs(c.speed);
    if (sp < 1.5) this.patience -= dt * 3.2;
    else if (sp < 6) this.patience -= dt * 1.2;
    else this.patience += dt * (sp > 12 ? 4 : 2);
    // changing lanes = feeling of progress
    if (Math.abs(c.position.x - this.lastLaneX) > 4.5) { this.patience += 6; this.lastLaneX = c.position.x; g.hud.toast('🔀 החלפת נתיב! (הנתיב השני תמיד זז מהר יותר)', 2); }
    if (g.input.held('horn')) this.patience += dt * 2.5;
    this.patience = THREE.MathUtils.clamp(this.patience, 0, 100);
    this.rantT -= dt;
    if (this.rantT <= 0 && this.patience < 70) { this.ui.set('.rant', `אבי: "${RANTS[Math.floor(Math.random() * RANTS.length)]}"`); this.rantT = 6 + Math.random() * 4; }
    const fill = this.ui.q('.fill');
    fill.style.width = `${this.patience}%`;
    fill.style.background = this.patience > 50 ? '#7be06f' : this.patience > 25 ? '#ffcf40' : '#ff4d4d';
    this.ui.set('.dist', `עד היציאה: ${Math.max(0, Math.round(this.exitZ - c.position.z))} מ'`);
    if (this.patience <= 0) { this.result = 'lost'; this.ui.remove(); }
    else if (c.position.z >= this.exitZ && Math.abs(c.position.x - 105) < 30) { this.result = 'won'; this.ui.remove(); }
    return this.result;
  }
  dispose() { this.ui?.remove(); }
}
