import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { MissionDef, Step, MissionCtx } from './MissionManager';
import { S } from './MissionManager';
import { Npc, groundY } from '../minigames/common';
import { Matkot } from '../minigames/Matkot';
import { Brawl } from '../minigames/Brawl';
import { ShelterRun } from '../minigames/Shelter';
import { AyalonJam } from '../minigames/AyalonJam';
import { StadiumRhythm, STADIUM } from '../minigames/Stadium';
import { OUTFITS, randomOutfit, type Outfit } from '../entities/SkinnedCharacter';
import { buildVehicleModel, getKit } from '../vehicles/VehicleKits';
import { playEnding } from '../story/Intro';
import type { DialogId } from '../story/Dialog';
import { gameStore } from '../state/store';
import { CITY } from '../world/City';

// ------------------------------------------------------------------ helpers
const spawned: Npc[] = [];
const props: THREE.Object3D[] = [];
function cleanupAll() { for (const n of spawned.splice(0)) n.dispose(); for (const p of props.splice(0)) p.removeFromParent(); }

const C = (h: number) => new THREE.Color(h);
const LOOK = {
  yossi: { ...OUTFITS.avi, shirt: C(0xff8a3d), pants: C(0x2f6db5), shorts: true, sleeves: 'short', beard: false, height: 1.8 } as Outfit,
  mom: { body: 'female', height: 1.62, shirt: C(0x7a3b6e), pants: C(0x2b2b2b), shoes: C(0x3a2a20), sleeves: 'rolled', crop: false, shorts: false, beard: false } as Outfit,
  uncle: { ...OUTFITS.avi, shirt: C(0xdfe6ee), pants: C(0x3a3a3a), beard: true, height: 1.74, sleeves: 'rolled' } as Outfit,
  moshe: { ...OUTFITS.avi, shirt: C(0xffffff), pants: C(0x4a4a4a), beard: true, sleeves: 'short', height: 1.76 } as Outfit,
  thief: { ...OUTFITS.avi, shirt: C(0x222222), pants: C(0x222222), beard: false, sleeves: 'rolled', height: 1.75 } as Outfit,
  tourist: { body: 'female', height: 1.72, shirt: C(0xff6f61), pants: C(0xd8c3a5), shoes: C(0xffffff), sleeves: 'short', crop: false, shorts: true, beard: false } as Outfit,
  cousin: { ...OUTFITS.avi, shirt: C(0x8a2be2), pants: C(0x1e1e1e), beard: false, sleeves: 'short', height: 1.7 } as Outfit,
};

async function npc(game: Game, outfit: Outfit, name: string, x: number, z: number, yaw = 0): Promise<Npc> {
  const n = await Npc.create(game.scene, outfit, name, Math.random());
  n.place(x, z, yaw);
  spawned.push(n);
  game.dialog.speakers.set(name, n.ch);
  return n;
}

/** dialogue as a step (actors face each other while talking) */
function talk(id: DialogId, objective?: string): Step {
  return { objective, enter: (c) => { c.game.cinematic = false; return c.game.dialog.play(id); }, update: () => true };
}

/** NPCs need their animation updated every frame while alive */
function animateNpcs(dt: number) { for (const n of spawned) n.sync(dt); }

/** Chase a runner along waypoints. Catch = get within `catchR` (on foot: press E / punch). */
function chase(opts: { runner: (c: MissionCtx) => Npc; path: [number, number][]; speed: number; catchR: number; objective: string; onFoot: boolean; vehicleModel?: THREE.Object3D }): Step {
  return {
    objective: opts.objective, failText: 'הוא ברח… בפעם הבאה – לרוץ מהר יותר!', route: false,
    target: (c) => { const r = c.data.runner as Npc | undefined; return r ? { x: r.pos.x, z: r.pos.z, r: 0.01 } : null; },
    marker: false,
    enter: (c) => { c.data.runner = opts.runner(c); c.data.wp = 0; c.data.near = 0; },
    update: (c) => {
      const r = c.data.runner as Npc;
      let wp = c.data.wp as number;
      const p = c.game.vehicles.current ? c.game.vehicles.current.position : c.game.player.position;
      const dist = r.pos.distanceTo(p);
      // runner slows when far ahead (rubber-banding keeps it fun)
      const sp = opts.speed * (dist > 35 ? 0.75 : dist < 6 ? 1.12 : 1);
      if (wp < opts.path.length) {
        const [x, z] = opts.path[wp];
        if (r.moveTo(x, z, sp, c.dt) < 0.6) c.data.wp = ++wp;
      } else return 'fail';
      if (opts.vehicleModel) { opts.vehicleModel.position.copy(r.pos); opts.vehicleModel.rotation.y = r.yaw; r.state = 'drive'; r.ch.root.position.y += 0.2; }
      if (dist < opts.catchR) {
        c.data.near = (c.data.near as number) + c.dt;
        if (opts.onFoot) c.game.hud.setPrompt('E – תפוס אותו!');
        if ((opts.onFoot && (c.game.input.action('interact') || c.game.input.action('punch'))) || (!opts.onFoot && (c.data.near as number) > 1.2)) {
          c.game.hud.setPrompt(null);
          r.speed = 0; r.state = 'death';
          c.game.audio.play('punch', r.pos);
          return true;
        }
      } else { c.data.near = 0; c.game.hud.setPrompt(null); }
      if (dist > 90) return 'fail';
      return false;
    },
    exit: (c) => c.game.hud.setPrompt(null),
  };
}

/** Mission 3 chase: the thief rides Noa's scooter (model follows the runner). */
function scooterChase(): Step {
  const base = chase({ runner: (c) => c.data.thief as Npc, path: [[-93.6, -86], [-93.6, -40], [-93.6, 25], [-60, 32.4], [-8, 32.4], [-6.4, -20], [-6.4, -140], [-60, -147.6], [-130, -147.6]], speed: 7.3, catchR: 3.2, objective: 'רדפו אחרי הגנב – התקרבו אליו!', onFoot: false });
  return {
    ...base,
    update: (c) => {
      const r = base.update!(c);
      const sc = c.data.scooter as THREE.Object3D, t = c.data.thief as Npc;
      sc.position.copy(t.pos); sc.rotation.y = t.yaw;
      t.state = r === true ? 'death' : 'drive';
      return r;
    },
  };
}

/** timed drive: reach the target before an in-game hour */
function beforeHour(x: number, z: number, hour: number, objective: string, r = 8): Step {
  return {
    objective: (c) => `${objective} – ${c.game.dayNight.timeString} / ${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`,
    target: { x, z, r }, failText: 'איחרת… אמא כבר סיפרה לכולם שהתחתנת בסוד.',
    update: (c) => {
      const p = c.game.vehicles.current ? c.game.vehicles.current.position : c.game.player.position;
      if (Math.hypot(p.x - x, p.z - z) < r) return true;
      if (c.game.dayNight.hour >= hour && c.game.dayNight.hour < hour + 2) return 'fail';
      return false;
    },
  };
}

// ------------------------------------------------------------------ missions
export function buildMissions(game: Game): MissionDef[] {
  game.systems.push({ update: (dt) => animateNpcs(dt) });
  const plaza = { x: 588, z: 6 };

  return [
    // 1 ---------------------------------------------------------------
    {
      id: 'm1', title: 'בוקר רגיל בחוף', titleEn: 'Just Another Beach Day', character: 'avi',
      start: { x: -208, z: 12 }, reward: 150, hour: 16.4,
      description: 'אמא מתקשרת: האירוע המשפחתי בירושלים ב-20:00. קודם – סיבוב מטקות עם יוסי.',
      cleanup: cleanupAll,
      steps: [
        S.call((c) => c.game.phone.push('msg', 'אמא ❤️', 'אבי, תענה! זה דחוף!')),
        talk('m1_call'),
        { ...S.goto(-262, 26, 'לך ליוסי ליד סוכת המציל', 4), enter: async (c) => { await npc(c.game, LOOK.yossi, 'יוסי', -262, 35.5, Math.PI); } },
        talk('m1_yossi'),
        { ...S.call(() => cleanupAll()) },
        S.mg((c) => new Matkot(c.game, 12), 'מטקות: 12 חבטות ברצף (רווח בזמן)', 'יוסי ניצח. שוב.'),
        { ...S.call(async (c) => { const y = await npc(c.game, LOOK.yossi, 'יוסי', -262, 35.5, Math.PI); y.face(c.game.player.position.x, c.game.player.position.z); }) },
        talk('m1_after'),
      ],
    },
    // 2 ---------------------------------------------------------------
    {
      id: 'm2', title: 'פלאפל בסכנה', titleEn: 'Falafel in Danger', character: 'avi',
      start: { x: -66, z: -3 }, reward: 300,
      description: 'בשוק, גנב חוטף את הקופה מהדוכן של משה. תפסו אותו!',
      cleanup: cleanupAll,
      steps: [
        { enter: async (c) => {
          await npc(c.game, LOOK.moshe, 'משה הפלאפלן', -60, -8.2, 0);
          const t = await npc(c.game, LOOK.thief, 'הגנב', -58, -6.5, 0);
          c.data.thief = t;
          await c.game.cutscene.play([
            { duration: 4, move: 'dolly', from: [-54, 2.6, -1], to: [-57, 2.0, -3], look: [-60, 1.6, -8], dialog: 'm2_intro' },
            { duration: 2.5, move: 'static', from: [-50, 3, 2], look: [-58, 1.2, -6] },
          ]);
        }, update: () => true },
        chase({ runner: (c) => c.data.thief as Npc, path: [[-62, -2], [-100, -1.5], [-139, 0], [-146.5, -12], [-146.5, -60], [-146.5, -120], [-146.5, -200]], speed: 5.2, catchR: 1.8, objective: 'תפוס את הגנב!', onFoot: true }),
        talk('m2_caught'),
        S.goto(-62, -3, 'החזר את הקופה למשה', 3),
        talk('m2_outro'),
      ],
    },
    // 3 ---------------------------------------------------------------
    {
      id: 'm3', title: 'גנב הקורקינטים', titleEn: 'The Scooter Thief', character: 'noa',
      start: { x: -118, z: -86.6 }, reward: 350,
      description: 'נועה בשדרה. מישהו גונב לה את הקורקינט – רדפו אחריו באופניים חשמליים.',
      cleanup: cleanupAll,
      steps: [
        { enter: async (c) => {
          const t = await npc(c.game, LOOK.thief, 'הגנב', -112, -86.6, Math.PI / 2);
          c.data.thief = t;
          const scooter = buildVehicleModel(getKit('scooter'), 0x1db954).group;
          c.game.scene.add(scooter); props.push(scooter);
          c.data.scooter = scooter;
          const bike = c.game.vehicles.spawn('ebike', -120, -84.5, Math.PI / 2, 0xff4fa3);
          c.data.bike = bike;
          await c.game.cutscene.play([
            { duration: 4.5, move: 'orbit', target: () => c.game.player.position.clone().setY(1.4), radius: 4, height: 1.2, angleFrom: 0.5, angleTo: 1.4, dialog: 'm3_intro' },
          ]);
        }, update: () => true },
        S.enterVehicle('קפוץ על האופניים החשמליים (F)', 'ebike', { x: -120, z: -84.5 }),
        scooterChase(),
        talk('m3_caught'),
      ],
    },
    // 4 ---------------------------------------------------------------
    {
      id: 'm4', title: 'מה הצבעת?!', titleEn: 'What Did You Vote?!', character: 'avi',
      start: { x: -212, z: 100 }, reward: 400,
      description: 'יוסי נתקע בקטטה המונית בחוף. הגיעו אליו והוציאו אותו.',
      cleanup: cleanupAll,
      steps: [
        S.call((c) => c.game.phone.push('msg', 'יוסי', 'אבי!!! הצילו! מישהו שאל מה הצבעת ועכשיו כולם עם כיסאות!', true)),
        talk('m4_text'),
        S.mg((c) => new Brawl(c.game, 14), 'הגיעו ליוסי ותוציאו אותו מהקטטה', 'התעלפת מרוב ויכוחים.', (mg) => { const b = mg as Brawl; return { x: b.yossiPos.x, z: b.yossiPos.z, r: 2 }; }),
        { ...S.call(async (c) => { const p = c.game.player.position; await npc(c.game, LOOK.yossi, 'יוסי', p.x + 1.2, p.z + 0.8, 0); }) },
        talk('m4_outro'),
      ],
    },
    // 5 ---------------------------------------------------------------
    {
      id: 'm5', title: 'התרעה', titleEn: 'The Alert', character: 'noa',
      start: { x: -205, z: -20 }, reward: 300,
      description: 'התרעה בטלפון. הגיעו למרחב מוגן בזמן, בשקט ובסדר.',
      cleanup: cleanupAll,
      steps: [
        talk('m5_intro'),
        S.mg((c) => new ShelterRun(c.game, 90), 'הגיעו למרחב המוגן הקרוב', 'לא הספקת להגיע. זה בסדר – מתרגלים ומשתפרים.', (mg) => ({ ...(mg as ShelterRun).targetPos, r: 2.6 })),
        { ...S.call(async (c) => { const p = c.game.player.position; await npc(c.game, LOOK.tourist, 'תיירת', p.x + 1.4, p.z + 1, Math.PI); }) },
        talk('m5_outro'),
      ],
    },
    // 6 ---------------------------------------------------------------
    {
      id: 'm6', title: 'שעה אפס באיילון', titleEn: 'Rush Hour Forever', character: 'avi',
      start: { x: 70, z: -276 }, reward: 450, hour: 18.0,
      description: 'צריך לעבור את האיילון בלי לאבד את העצבים.',
      cleanup: cleanupAll,
      steps: [
        talk('m6_intro'),
        S.mg((c) => new AyalonJam(c.game, true), 'שרדו את הפקק – הגיעו ליציאה', 'אבי איבד את זה. הוא עובר לגור ברכבת.', (mg) => (mg as AyalonJam).targetPos),
        talk('m6_outro'),
      ],
    },
    // 7 ---------------------------------------------------------------
    {
      id: 'm7', title: 'המשחק הגדול', titleEn: 'The Big Game', character: 'noa',
      start: { x: STADIUM.x, z: STADIUM.z + STADIUM.rz + 6 }, reward: 400, hour: 18.5,
      description: 'בן הדוד תקוע – נועה הולכת לשיר במקומו באצטדיון.',
      cleanup: cleanupAll,
      steps: [
        { ...S.call(async (c) => { const p = c.game.player.position; await npc(c.game, LOOK.cousin, 'בן הדוד', p.x + 1.5, p.z - 1, 0); }) },
        talk('m7_intro'),
        S.call(() => cleanupAll()),
        S.mg((c) => new StadiumRhythm(c.game, 36), 'שירו עם הקהל – בקצב!', 'הקהל שרק בוז. אולי בפעם הבאה.'),
        talk('m7_outro'),
      ],
    },
    // 8 ---------------------------------------------------------------
    {
      id: 'm8', title: 'ירושלים של שקיעה', titleEn: 'Jerusalem Sunset', character: 'avi',
      start: { x: 136, z: 10 }, reward: 1000, hour: 18.85,
      description: 'כביש 1, השקיעה, ואמא. להגיע לאירוע עד 20:00.',
      cleanup: cleanupAll,
      steps: [
        talk('m8_intro'),
        S.enterVehicle('היכנס לרכב (F)', undefined, { x: 140, z: 5.5 }),
        beforeHour(CITY.jeru.minX - 30, 0, 20, 'סעו לירושלים בכביש 1', 10),
        beforeHour(plaza.x, plaza.z, 20, 'הגיעו לרחבה בעיר העתיקה', 6),
        { enter: async (c) => {
          const g = c.game;
          if (g.vehicles.current) g.exitVehicle();
          g.player.spawn(plaza.x - 3, plaza.z, Math.PI / 2);
          const mom = await npc(g, LOOK.mom, 'אמא', plaza.x + 1, plaza.z, -Math.PI / 2);
          const uncle = await npc(g, LOOK.uncle, 'הדוד', plaza.x + 1.5, plaza.z + 1.6, -Math.PI / 2 - 0.4);
          await npc(g, LOOK.yossi, 'יוסי', plaza.x + 2.2, plaza.z - 1.6, -Math.PI / 2 + 0.5);
          const noa = await npc(g, OUTFITS.noa, 'נועה', plaza.x - 1, plaza.z + 2.6, Math.PI);
          for (let i = 0; i < 8; i++) await npc(g, randomOutfit(Math.random), '', plaza.x + 4 + (i % 4) * 1.4, plaza.z - 3 + Math.floor(i / 4) * 5, -Math.PI / 2);
          g.dialog.speakers.set('אבי', g.characters.avi!);
          await g.cutscene.play([
            { duration: 5, move: 'crane', from: [plaza.x - 25, 30, plaza.z - 30], to: [plaza.x - 8, 4, plaza.z - 6], look: [plaza.x, 15, plaza.z], lookTo: [plaza.x, 1.5, plaza.z], height: 4, hour: 19.95, title: { text: '20:00', sub: 'ירושלים. בזמן. בערך.' } },
            { duration: 6, move: 'ots', actor: () => ({ pos: g.player.position, yaw: Math.PI / 2 }), target: () => mom.pos.clone().setY(mom.pos.y + 1.5), dialog: 'm8_finale' },
            { duration: 6, move: 'orbit', target: () => new THREE.Vector3(plaza.x, 16, plaza.z), radius: 14, height: 5, angleFrom: 0, angleTo: 1.2 },
          ]);
          void uncle; void noa;
        }, update: () => true },
        S.call(async (c) => { await playEnding(c.game); }),
      ],
    },
  ];
}

/** keep imports used (helper for debugging in the console) */
export const _dbg = { groundY, gameStore };
