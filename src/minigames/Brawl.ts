import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Npc, GameOverlay, ComicText, ChairProps, groundY } from './common';
import { randomOutfit, OUTFITS } from '../entities/SkinnedCharacter';
import { gameStore } from '../state/store';
import type { MgResult } from './Matkot';
import { mulberry32 } from '../world/Builders';

const SHOUTS = ['מה הצבעת?!', 'אתה לא מבין כלום!', 'תביא את הכיסא!', 'אחי, תירגע!', 'זה בגלל אנשים כמוך!', 'שאלתי בנימוס!', 'עזבו, בואו נאכל אבטיח', 'אמא שלי תשמע על זה!'];

interface Fighter { npc: Npc; hp: number; target: Fighter | null; cooldown: number; ko: number; chairCd: number; chasePlayer: boolean; home: THREE.Vector3 }

/**
 * "קטטת מה הצבעת?" – the mass comic brawl from the video, on the beach:
 * a crowd argues and swings plastic chairs (Rapier props). Cartoon only –
 * POW bubbles, dizzy stars, people sit down and shake it off. No blood.
 * Goal: get to Yossi in the middle (E), then escape the brawl together.
 */
export class Brawl {
  private fighters: Fighter[] = [];
  private yossi!: Npc;
  private chairs: ChairProps;
  private comic = new ComicText();
  private ui!: GameOverlay;
  private rescued = false;
  private result: MgResult = 'running';
  private shoutT = 0;
  private rnd = mulberry32(777);
  readonly center = new THREE.Vector3(-248, 0, 112);
  readonly escapeR = 32;
  private shout: HTMLDivElement | null = null;
  knocked = 0;

  constructor(private game: Game, private count = 14) {
    this.chairs = new ChairProps(game.scene, game.physics);
  }

  async start() {
    const g = this.game;
    await this.chairs.init();
    this.center.y = groundY(this.center.x, this.center.z);
    this.yossi = await Npc.create(g.scene, { ...OUTFITS.avi, shirt: new THREE.Color(0xff8a3d), pants: new THREE.Color(0x2f6db5), shorts: true, sleeves: 'short', beard: false, height: 1.8 }, 'יוסי', 0.37);
    this.yossi.place(this.center.x, this.center.z, 0);
    this.yossi.state = 'crouch';
    const jobs = [];
    for (let i = 0; i < this.count; i++) {
      jobs.push(Npc.create(g.scene, randomOutfit(this.rnd.next), '', this.rnd.next()).then((npc) => {
        const a = (i / this.count) * Math.PI * 2, r = 4 + this.rnd.range(0, 7);
        const home = new THREE.Vector3(this.center.x + Math.cos(a) * r, 0, this.center.z + Math.sin(a) * r);
        npc.place(home.x, home.z, a + Math.PI);
        this.fighters.push({ npc, hp: 3, target: null, cooldown: this.rnd.range(0, 2), ko: 0, chairCd: this.rnd.range(2, 8), chasePlayer: i % 4 === 0, home });
      }));
    }
    await Promise.all(jobs);
    for (const f of this.fighters) f.target = this.fighters[Math.floor(this.rnd.next() * this.fighters.length)];
    // scattered chairs flying around at the start
    for (let i = 0; i < 6; i++) this.chairs.throw(this.center.clone().add(new THREE.Vector3(this.rnd.range(-6, 6), 1.5, this.rnd.range(-6, 6))), new THREE.Vector3(this.rnd.range(-3, 3), 4, this.rnd.range(-3, 3)));
    this.ui = new GameOverlay('brawl', `<div class="title">מה הצבעת?!</div><div class="obj">הגיעו ליוסי באמצע (E)</div><div class="ko"></div>`);
    this.shout = document.createElement('div');
    this.shout.className = 'brawl-shout';
    document.getElementById('hud')!.appendChild(this.shout);
    g.audio.loop('crowd', 0.6);
  }

  get yossiPos() { return this.yossi.pos; }

  update(dt: number): MgResult {
    const g = this.game;
    const st = gameStore.getState();
    this.comic.update(dt, g.camera);
    this.chairs.update(dt);
    if (this.result !== 'running') return this.result;
    const p = g.player.position;
    const distC = Math.hypot(p.x - this.center.x, p.z - this.center.z);
    g.audio.loop('crowd', THREE.MathUtils.clamp(1 - distC / 60, 0, 0.7));

    for (const f of this.fighters) {
      const n = f.npc;
      f.cooldown -= dt; f.chairCd -= dt;
      if (f.ko > 0) { f.ko -= dt; n.speed = 0; n.state = f.ko > 1 ? 'sit' : null; if (f.ko <= 0) f.hp = 3; n.sync(dt); continue; }
      const dToPlayer = n.pos.distanceTo(p);
      const huntingPlayer = (f.chasePlayer || this.rescued) && dToPlayer < 14;
      const tgt = huntingPlayer ? p : f.target && f.target.ko <= 0 ? f.target.npc.pos : f.home;
      const d = Math.hypot(tgt.x - n.pos.x, tgt.z - n.pos.z);
      if (d > 1.3) { n.moveTo(tgt.x, tgt.z, huntingPlayer ? 3.6 : 2.2, dt); n.state = null; }
      else {
        n.speed = 0; n.face(tgt.x, tgt.z);
        if (f.cooldown <= 0) {
          f.cooldown = this.rnd.range(0.9, 1.8);
          n.ch.trigger(this.rnd.chance(0.5) ? 'punch' : 'jab', 0.6);
          const hitPos = n.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
          if (huntingPlayer && !g.vehicles.current) {
            if (this.rnd.chance(0.55)) { gameStore.setState({ health: Math.max(0, st.health - 7) }); g.audio.play('punch', p); this.comic.spawn('POW!', hitPos, '#ff5a5a'); (g.player.model as unknown as { trigger: (s: string, d: number) => void }).trigger('hit', 0.4); }
          } else if (f.target && f.target.ko <= 0) {
            g.audio.play('punch', n.pos, 0.6, 0.9 + Math.random() * 0.3);
            if (this.rnd.chance(0.3)) this.comic.spawn(this.rnd.pick(['POW!', 'בום!', 'טראח!']), hitPos);
            f.target.npc.ch.trigger('hit', 0.4);
            if (--f.target.hp <= 0) f.target.ko = 4;
          }
        }
      }
      // chairs!
      if (f.chairCd <= 0 && dToPlayer < 25) {
        f.chairCd = this.rnd.range(5, 11);
        const aim = (huntingPlayer ? p : (f.target?.npc.pos ?? f.home)).clone();
        const from = n.pos.clone().add(new THREE.Vector3(0, 1.7, 0));
        const dir = aim.sub(from).setY(0);
        const dist = dir.length();
        dir.normalize().multiplyScalar(Math.min(9, dist * 1.4)).setY(3.5);
        n.ch.trigger('punch', 0.6);
        this.chairs.throw(from, dir);
      }
      if (this.rnd.chance(dt * 0.3)) f.target = this.fighters[Math.floor(this.rnd.next() * this.fighters.length)];
      n.sync(dt);
    }
    // flying chairs hit the player
    if (!g.vehicles.current && this.chairs.hits(p, 0.9)) {
      gameStore.setState({ health: Math.max(0, gameStore.getState().health - 12) });
      this.comic.spawn('כיסא!', p.clone().setY(p.y + 1.8), '#ffffff');
      g.audio.play('crash', p, 0.5, 1.6);
    }
    // player punches fighters
    if (g.input.action('punch') && !g.vehicles.current) {
      const fwd = new THREE.Vector3(Math.sin(g.player.yaw), 0, Math.cos(g.player.yaw));
      for (const f of this.fighters) {
        const rel = f.npc.pos.clone().sub(p);
        if (f.ko <= 0 && rel.length() < 1.8 && rel.normalize().dot(fwd) > 0.3) {
          f.hp -= 2;
          f.npc.ch.trigger('hit', 0.4);
          this.comic.spawn('POW!', f.npc.pos.clone().setY(f.npc.pos.y + 1.6), '#ffe14d');
          g.audio.play('punch', f.npc.pos);
          if (f.hp <= 0) { f.ko = 5; this.knocked++; this.comic.spawn('😵', f.npc.pos.clone().setY(f.npc.pos.y + 2)); }
          break;
        }
      }
    }
    // shouting subtitles
    this.shoutT -= dt;
    if (this.shoutT <= 0 && this.shout && distC < 30) {
      this.shout.textContent = `"${this.rnd.pick(SHOUTS)}"`;
      this.shout.classList.add('show');
      this.shoutT = this.rnd.range(2, 4);
      setTimeout(() => this.shout?.classList.remove('show'), 1600);
    }
    // Yossi
    if (!this.rescued) {
      const dy = this.yossi.pos.distanceTo(p);
      g.hud.setPrompt(dy < 2.2 ? 'E – תפוס את יוסי' : null);
      if (dy < 2.2 && g.input.action('interact')) {
        this.rescued = true; this.yossi.state = null;
        g.hud.setPrompt(null);
        this.ui.set('.obj', `ברחו מהקטטה! (${this.escapeR} מ' מהמרכז)`);
        g.hud.setSubtitle('יוסי', 'אחי! רק שאלתי מה השעה והתחיל בלגן!');
        setTimeout(() => g.hud.setSubtitle(null, null), 3000);
      }
      this.yossi.sync(dt);
    } else {
      const behind = p.clone().add(new THREE.Vector3(-Math.sin(g.player.yaw) * 1.4, 0, -Math.cos(g.player.yaw) * 1.4));
      this.yossi.moveTo(behind.x, behind.z, Math.max(2, g.player.speed * 1.05), dt);
      this.yossi.sync(dt);
      if (distC > this.escapeR) { this.result = 'won'; }
    }
    this.ui.set('.ko', this.knocked ? `הרגעת ${this.knocked} מתווכחים` : '');
    if (gameStore.getState().health <= 0) this.result = 'lost';
    return this.result;
  }

  dispose() {
    for (const f of this.fighters) f.npc.dispose();
    this.fighters = [];
    this.yossi?.dispose();
    this.chairs.clear();
    this.ui?.remove();
    this.shout?.remove();
    this.game.audio.loop('crowd', 0);
    this.game.hud.setPrompt(null);
    gameStore.setState({ health: 100 });
  }
}
