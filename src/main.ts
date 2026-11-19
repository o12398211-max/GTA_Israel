import { Game } from './core/Game';
import { Phone } from './ui/Phone';
import { MissionManager } from './missions/MissionManager';
import { buildMissions } from './missions/missions';
import { gameStore } from './state/store';
import { Activities } from './minigames/Activities';
import { DialogSystem } from './story/Dialog';
import { Cutscene } from './story/Cutscene';
import { playIntro } from './story/Intro';
import { NetClient } from './net/NetClient';
import { Menu } from './ui/Menu';
import { Matkot } from './minigames/Matkot';
import { Brawl } from './minigames/Brawl';
import { ShelterRun } from './minigames/Shelter';
import { AyalonJam } from './minigames/AyalonJam';
import { StadiumRhythm } from './minigames/Stadium';

const canvas = document.getElementById('game') as HTMLCanvasElement;

function webgl2Available(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}


if (!webgl2Available()) {
  document.getElementById('loading-tip')!.textContent = 'הדפדפן שלך לא תומך ב-WebGL2. גם הרכבת לירושלים לא תמיד מגיעה, אבל הפעם זה עליך.';
} else {
  const game = new Game(canvas);
  game.load(async (g) => {
    g.phone = new Phone();
    g.dialog = new DialogSystem(g);
    g.cutscene = new Cutscene(g);
    g.missions = new MissionManager(g, buildMissions(g), g.phone);
    g.systems.push(g.missions);
    g.activities = new Activities(g);
    const net = new NetClient(g);
    g.systems.push(net);
    const menu = new Menu(g, net);
    g.phone.onOpenSettings = () => menu.toggle(true, 'settings');
    g.systems.push({ update: (_dt, gm) => { if (gm.input.action('pause') && !gm.phone.open) menu.toggle(); else if (gm.input.action('pause') && gm.phone.open) gm.phone.toggle(false); } });
    (window as unknown as { __net: NetClient }).__net = net;
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
  }).then(() => {
    const p = new URLSearchParams(location.search);
    if (gameStore.getState().missionIndex === 0 && !p.has('nointro') && !p.has('autostart')) void playIntro(game);
  }).catch((err) => {
    console.error(err);
    document.getElementById('loading-tip')!.textContent = `שגיאה בטעינה: ${err?.message ?? err}`;
  });
}
