import { Game } from './core/Game';
import { Phone } from './ui/Phone';
import { MissionManager } from './missions/MissionManager';
import { buildMissions } from './missions/missions';
import { gameStore } from './state/store';
import { Activities } from './minigames/Activities';
import { Matkot } from './minigames/Matkot';
import { Brawl } from './minigames/Brawl';
import { ShelterRun } from './minigames/Shelter';
import { AyalonJam } from './minigames/AyalonJam';
import { StadiumRhythm } from './minigames/Stadium';

const canvas = document.getElementById('game') as HTMLCanvasElement;

function webgl2Available(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

declare module './core/Game' {
  interface Game { phone: Phone; missions: MissionManager; activities: Activities }
}

if (!webgl2Available()) {
  document.getElementById('loading-tip')!.textContent = 'הדפדפן שלך לא תומך ב-WebGL2. גם הרכבת לירושלים לא תמיד מגיעה, אבל הפעם זה עליך.';
} else {
  const game = new Game(canvas);
  game.load(async (g) => {
    g.phone = new Phone();
    g.missions = new MissionManager(g, buildMissions(), g.phone);
    g.systems.push(g.missions);
    g.activities = new Activities(g);
    g.systems.push(g.activities);
    g.systems.push({
      update: (_dt, gm) => {
        const v = gm.vehicles.current;
        const p = v ? v.position : gm.player.position;
        gm.hud.view = { x: p.x, z: p.z, heading: v ? Math.atan2(v.forward.x, v.forward.z) : gm.player.yaw, camYaw: gm.follow.yaw, speed: v ? Math.abs(v.speed) : 0 };
        gm.phone.player = { x: p.x, z: p.z };
        if (gm.input.action('phone')) gm.phone.toggle();
        gm.phone.update(gm.dayNight.hour);
      },
    });
    (window as unknown as { __mg: unknown }).__mg = { Matkot, Brawl, ShelterRun, AyalonJam, StadiumRhythm };
    gameStore.getState().notify('msg', 'אמא ❤️', 'אבי חמוד, אל תשכח: היום בערב האירוע בירושלים!');
  }).catch((err) => {
    console.error(err);
    document.getElementById('loading-tip')!.textContent = `שגיאה בטעינה: ${err?.message ?? err}`;
  });
}
