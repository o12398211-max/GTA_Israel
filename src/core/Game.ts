import * as THREE from 'three';
import { Input, type InputState } from './Input';
import { CityBuilder, type CityRuntime } from '../world/City';
import { loadTextures, setMaxAnisotropy } from '../render/Textures';
import { loadModel } from '../render/GltfInstances';
import { lightBinParts, lightParkLampParts } from '../world/Props';
import { PostFX } from '../render/Post';
import { DayNight } from '../world/DayNight';
import { buildSea } from '../world/Sea';
import { worldUniforms } from '../world/Materials';
import { zoneAt, WORLD } from '../world/Terrain';
import { SkinnedCharacter, OUTFITS, preloadCharacters } from '../entities/SkinnedCharacter';
import { PlayerController } from '../entities/PlayerController';
import { Pedestrians } from '../entities/Pedestrians';
import { FollowCamera } from '../camera/FollowCamera';
import { Hud } from '../ui/Hud';
import { LoadingScreen } from '../ui/Loading';
import { gameStore, type CharacterId } from '../state/store';
import { Physics } from '../physics/Physics';
import { VehicleSystem } from '../vehicles/VehicleSystem';
import { Traffic } from '../vehicles/Traffic';
import type { Vehicle } from '../vehicles/Vehicle';
import { AudioSystem } from '../audio/Audio';
import type { Phone } from '../ui/Phone';
import type { MissionManager } from '../missions/MissionManager';
import type { Activities } from '../minigames/Activities';
import type { DialogSystem } from '../story/Dialog';
import type { Cutscene } from '../story/Cutscene';

/** Named spawn points – also usable via URL: ?spawn=jerusalem */
export const SPAWNS: Record<string, { x: number; z: number; yaw: number }> = {
  beach: { x: -245, z: 10, yaw: Math.PI * 0.85 },
  promenade: { x: -206, z: 22, yaw: Math.PI },
  market: { x: -110, z: 0, yaw: Math.PI / 2 },
  ayalon: { x: 77, z: 20, yaw: 0 },
  route1: { x: 300, z: 6, yaw: Math.PI / 2 },
  jerusalem: { x: 535, z: 0, yaw: Math.PI / 2 },
  stadium: { x: -60, z: -316, yaw: Math.PI },
  airfield: { x: -234.5, z: -332, yaw: 0 },
};

/** Hooks later stages plug into (HUD, missions, mini-games, multiplayer…). */
export interface GameSystem { update(dt: number, game: Game): void }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
  readonly input: Input;
  readonly audio = new AudioSystem();
  private timer = new THREE.Timer();
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  dayNight!: DayNight;
  city!: CityRuntime;
  physics!: Physics;
  vehicles!: VehicleSystem;
  traffic!: Traffic;
  peds!: Pedestrians;
  player!: PlayerController;
  characters: Partial<Record<CharacterId, SkinnedCharacter>> = {};
  follow!: FollowCamera;
  hud = new Hud();
  post!: PostFX;
  private spit: THREE.Object3D | undefined;
  private fastTime = false;
  readonly params = new URLSearchParams(location.search);
  readonly systems: GameSystem[] = [];
  // attached by main.ts after loading
  phone!: Phone;
  missions!: MissionManager;
  activities!: Activities;
  dialog!: DialogSystem;
  cutscene!: Cutscene;
  /** set by cutscenes: disables player control + follow camera */
  cinematic = false;
  /** last frame input (for systems) */
  lastInput: InputState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false, walk: false, jump: false, zoom: 0 };
  private hornCooldown = 0;
  renderScale = 1;
  private maxScale = 1;
  private perfT = 0;
  private perfFrames = 0;
  private perfWarm = 0;
  private punchCooldown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in PostFX
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.input = new Input(canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get quality() { return (this.params.get('quality') as 'low' | 'medium' | 'high' | null) ?? gameStore.getState().settings.quality; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(onLoaded?: (g: Game) => Promise<void> | void): Promise<void> {
    const loading = new LoadingScreen();
    loading.progress(0.02, 'טוענים טקסטורות…');
    const [, , chair] = await Promise.all([
      loadTextures(['plaster', 'jstone', 'asphalt', 'pavers', 'sand', 'rock', 'slabs'], (p) => loading.progress(p * 0.15)),
      preloadCharacters(), loadModel('chair'),
    ]);
    // the scanned bin / lamp are ~14k / ~30k triangles each – light procedural versions instead
    const lamp = lightParkLampParts(), bin = lightBinParts();
    const builder = new CityBuilder({ chair, lamp, bin });
    const steps = builder.steps();
    for (let i = 0; i < steps.length; i++) {
      loading.progress(0.15 + (i / steps.length) * 0.5, steps[i].label);
      await nextFrame();
      steps[i].run();
    }
    this.city = builder.runtime();
    this.scene.add(this.city.group);
    this.scene.add(buildSea());
    this.spit = this.scene.getObjectByName('shawarma-spit');

    loading.progress(0.7, 'מפעילים פיזיקה…');
    await nextFrame();
    const terrain = this.scene.getObjectByName('terrain') as THREE.Mesh;
    const route1 = this.scene.getObjectByName('route1') as THREE.Mesh;
    this.physics = await Physics.create(this.city.colliders, terrain, [route1]);
    this.vehicles = new VehicleSystem(this.physics, this.city.colliders);
    this.scene.add(this.vehicles.group);
    this.traffic = new Traffic(this.physics, this.quality === 'low' ? 0.5 : this.quality === 'medium' ? 0.75 : 1);
    this.traffic.drawDistance = this.quality === 'low' ? 220 : this.quality === 'medium' ? 300 : 400;
    this.scene.add(this.traffic.group);

    loading.progress(0.8, 'מגייסים הולכי רגל…');
    await nextFrame();
    this.peds = await Pedestrians.create(this.quality === 'low' ? 8 : this.quality === 'medium' ? 12 : 18, 3);
    this.scene.add(this.peds.group);

    const low = this.quality === 'low';
    // render scale: never above 1 CSS px (except 'high' on small screens), adapted at runtime to hold ~60 FPS
    this.maxScale = this.quality === 'high' ? Math.min(window.devicePixelRatio, 1.25) : 1;
    this.renderScale = low ? 0.75 : this.maxScale;
    this.renderer.setPixelRatio(this.renderScale);
    this.dayNight = new DayNight(this.scene, this.renderer, low ? 1024 : 2048);
    const hour = Number(this.params.get('hour'));
    this.dayNight.hour = Number.isFinite(hour) && this.params.has('hour') ? hour : 16.9;
    this.dayNight.speed = 0.5;

    loading.progress(0.9, 'מעירים את אבי…');
    await nextFrame();
    const start: CharacterId = this.params.get('char') === 'noa' ? 'noa' : 'avi';
    this.characters.avi = await SkinnedCharacter.create(OUTFITS.avi);
    this.characters.noa = await SkinnedCharacter.create(OUTFITS.noa);
    for (const c of Object.values(this.characters)) { this.scene.add(c.root); c.root.visible = false; }
    this.player = new PlayerController(this.characters[start]!, this.city.colliders);
    this.characters[start]!.root.visible = true;
    gameStore.setState({ character: start });
    const sp = SPAWNS[this.params.get('spawn') ?? 'promenade'] ?? SPAWNS.promenade;
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.follow = new FollowCamera(this.camera, this.city.colliders);
    this.follow.snap(this.player.position, sp.yaw);
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.quality === 'high' ? 'high' : 'low');
    this.resize();

    if (onLoaded) await onLoaded(this);

    // warm up: compile shaders + one render so the first frame doesn't hitch
    this.dayNight.update(0, this.player.position);
    this.follow.update(0.016, this.lastInput, this.player.position, this.player.yaw, 0);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.post.render(0.016);
    loading.progress(1);

    gameStore.setState({ phase: 'title' });
    if (!this.params.has('autostart')) await loading.waitForStart();
    else { void loading.waitForStart(); document.getElementById('start-btn')!.click(); }
    gameStore.setState({ phase: 'playing' });
    this.hud.show();
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.frame(t));

    (window as unknown as { __game: Game }).__game = this;
    (window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
  }

  // ------------------------------------------------------------------ debug helpers
  teleport(where: string | { x: number; z: number }) {
    const sp = typeof where === 'string' ? SPAWNS[where] : { ...where, yaw: this.player.yaw };
    if (!sp) return;
    if (this.vehicles.current) this.exitVehicle();
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.follow.snap(this.player.position, sp.yaw);
  }
  setHour(h: number) { this.dayNight.setHour(h); }
  debugView(pos: [number, number, number] | null, look?: [number, number, number]) {
    this.debugCam = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...(look ?? [0, 0, 0])) } : null;
  }
  /** Run the simulation without rendering (automated tests in slow headless browsers). */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) { this.update(step, step); this.input.endFrame(); }
  }

  // ------------------------------------------------------------------ vehicles
  enterVehicle(v: Vehicle) {
    this.vehicles.current = v;
    v.occupied = true;
    const ch = this.player.model as SkinnedCharacter;
    ch.forced = 'drive';
    gameStore.setState({ inVehicle: v.type });
    this.follow.setDistance(v.isPlane ? 16 : v.kit.size.z * 2 + 3.5);
    this.input.arrowLook = !v.isPlane;
    this.audio.play('click');
  }
  exitVehicle() {
    const v = this.vehicles.current;
    if (!v) return;
    if (v.isPlane && v.airborne) return; // no parachute (yet)
    const p = v.exitPoint();
    this.vehicles.current = null;
    v.occupied = false;
    (this.player.model as SkinnedCharacter).forced = null;
    this.player.spawn(p.x, p.z, v.yaw);
    gameStore.setState({ inVehicle: null });
    this.follow.setDistance(5.5);
    this.input.arrowLook = true;
  }

  /** Switch playable character (GTA V style). */
  switchCharacter(to?: CharacterId) {
    const cur = gameStore.getState().character;
    const next: CharacterId = to ?? (cur === 'avi' ? 'noa' : 'avi');
    if (next === cur) return;
    if (this.vehicles.current) this.exitVehicle();
    const pos = this.player.position.clone();
    const old = this.player;
    this.characterSpots[cur] = { x: pos.x, z: pos.z, yaw: old.yaw };
    this.characters[cur]!.root.visible = false;
    const ch = this.characters[next]!;
    ch.root.visible = true;
    this.player = new PlayerController(ch, this.city.colliders);
    const spot = next === 'noa' ? SPAWNS.market : SPAWNS.promenade;
    const sp = this.characterSpots[next] ?? { x: spot.x, z: spot.z, yaw: spot.yaw };
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.follow.snap(this.player.position, sp.yaw);
    gameStore.setState({ character: next });
    this.audio.play('whoosh');
  }
  private characterSpots: Partial<Record<CharacterId, { x: number; z: number; yaw: number }>> = {};

  // ------------------------------------------------------------------ main loop
  private frame(time: number) {
    this.timer.update(time);
    const rawDt = this.timer.getDelta();
    const dt = Math.min(0.05, rawDt);
    this.update(dt, rawDt);
    this.render(dt);
    this.input.endFrame();
    this.adaptResolution(rawDt);
  }

  /** Dynamic resolution: lower the render scale when FPS drops, raise it back when there's headroom. */
  private adaptResolution(rawDt: number) {
    this.perfWarm += rawDt;
    if (this.perfWarm < 3) return; // ignore shader-compile hitches at start
    this.perfT += rawDt; this.perfFrames++;
    if (this.perfT < 1) return;
    const fps = this.perfFrames / this.perfT;
    this.perfT = 0; this.perfFrames = 0;
    let s = this.renderScale;
    if (fps < 48) s = Math.max(0.5, s - (fps < 30 ? 0.15 : 0.08));
    else if (fps > 58 && s < this.maxScale) s = Math.min(this.maxScale, s + 0.05);
    if (Math.abs(s - this.renderScale) > 0.001) {
      this.renderScale = s;
      this.renderer.setPixelRatio(s);
      this.resize();
    }
  }

  update(dt: number, rawDt: number) {
    worldUniforms.uTime.value += dt;
    const st = gameStore.getState();
    const inp = this.cinematic ? { ...this.lastInput, moveX: 0, moveY: 0, jump: false, lookX: 0, lookY: 0 } : this.input.sample(dt);
    this.lastInput = inp;

    if (this.input.action('time')) { this.fastTime = !this.fastTime; this.dayNight.speed = this.fastTime ? 20 : 0.5; }
    if (this.input.action('help')) this.hud.toggleHelp();

    const v = this.vehicles.current;
    const playing = st.phase === 'playing' && !this.cinematic;
    if (playing && this.input.action('enter')) {
      if (v) this.exitVehicle();
      else {
        const near = this.vehicles.nearest(this.player.position);
        if (near) this.enterVehicle(near);
      }
    }
    if (playing && this.input.action('switch')) this.switchCharacter();

    // driving / walking
    this.vehicles.driveInput = this.vehicles.current && playing ? this.input.drive() : null;
    if (this.vehicles.driveInput && gameStore.getState().turbo && !this.vehicles.current!.isPlane) this.vehicles.driveInput.throttle *= 1.35;
    this.physics.update(dt);
    this.vehicles.sync(dt);
    const cur = this.vehicles.current;
    if (cur) {
      const seat = cur.seatWorld();
      const m = this.player.model.root;
      m.position.copy(seat);
      m.quaternion.copy(cur.quaternion);
      this.player.position.copy(seat);
      this.player.model.update(dt, 0, true, 0, false);
      if (playing && this.input.held('horn') && this.hornCooldown <= 0) { this.audio.play(cur.type === 'bus' ? 'hornTruck' : 'horn', cur.position); this.hornCooldown = 0.5; gameStore.getState().addNerves(0.04); }
      if (playing && cur.type === 'police' && this.input.action('siren')) cur.sirenOn = !cur.sirenOn;
      if (cur.impact > 6) { this.audio.play('crash', cur.position, Math.min(1, cur.impact / 15)); if (this.traffic.bump(cur.position)) gameStore.getState().addNerves(0.35); cur.impact = 0; }
    } else if (!this.cinematic) {
      this.player.update(dt, inp, this.follow.yaw);
      if (playing && this.input.action('punch') && this.punchCooldown <= 0) this.doPunch();
    }
    this.hornCooldown -= dt;
    this.punchCooldown -= dt;

    // traffic + pedestrians
    const obstacles = [{ pos: (cur ? cur.position : this.player.position), radius: cur ? cur.kit.size.x : 0.4 }, ...this.peds.obstacles()];
    this.traffic.update(dt, obstacles, this.player.position);
    this.peds.update(dt, this.player.position, this.vehicles.movers(), st.nerves);
    if (this.peds.events.hitByCar) { gameStore.getState().addNerves(this.peds.events.hitByCar); this.audio.play('punch', this.player.position, 0.8, 0.7); }
    if (this.peds.events.caught) {
      const fine = 250;
      gameStore.setState({ nerves: 0, shekels: Math.max(0, gameStore.getState().shekels - fine) });
      gameStore.getState().notify('police', 'משטרת ישראל', `קיבלת דו"ח על התנהגות עצבנית: ${fine} ₪. נשום עמוק.`);
      this.hud.toast('🚓 "תעודת זהות בבקשה." – קנס 250 ₪');
    }
    if (gameStore.getState().nerves > 0) gameStore.setState({ nerves: Math.max(0, gameStore.getState().nerves - dt * 0.03) });
    const sprinting = !cur && inp.run && this.player.speed > 4;
    gameStore.setState({ energy: THREE.MathUtils.clamp(gameStore.getState().energy + (sprinting ? -9 : 6) * dt, 0, 100) });

    for (const s of [...this.systems]) s.update(dt, this);

    // camera
    if (!this.cinematic) {
      if (cur) this.follow.update(dt, inp, cur.position, cur.isPlane ? Math.atan2(cur.forward.x, cur.forward.z) : cur.yaw, Math.abs(cur.speed), true);
      else this.follow.update(dt, inp, this.player.position, this.player.yaw, this.player.speed);
    }
    if (this.debugCam) { this.camera.position.copy(this.debugCam.pos); this.camera.lookAt(this.debugCam.look); }
    this.dayNight.update(dt, this.player.position);

    const n = worldUniforms.uNight.value;
    for (const { mat, max } of this.city.nightMaterials) mat.emissiveIntensity = 0.05 + n * max;
    this.city.lightPools.opacity = n * 0.9;
    if (this.spit) this.spit.rotation.y += dt * 1.5;

    this.updateAudio();

    const p = this.player.position;
    const zone = zoneAt(p.x, p.z);
    if (gameStore.getState().zone !== zone) gameStore.getState().setZone(zone);
    this.hud.update(rawDt, this.dayNight.timeString, zone, this.fastTime);
    gameStore.setState({ hour: this.dayNight.hour, fps: this.hud.currentFps });
  }

  /** Comic punch: whoosh or POW. */
  doPunch(): boolean {
    (this.player.model as SkinnedCharacter).trigger(Math.random() < 0.5 ? 'punch' : 'jab', 0.55);
    this.punchCooldown = 0.6;
    const hit = this.peds.punch(this.player.position, this.player.yaw);
    if (hit) { this.audio.play('punch', this.player.position); gameStore.getState().addNerves(0.6); }
    else this.audio.play('whoosh', this.player.position, 0.4);
    return hit;
  }

  private updateAudio() {
    const a = this.audio;
    a.setListener(this.camera.position, this.camera);
    const cur = this.vehicles.current;
    const sp = cur ? Math.abs(cur.speed) : 0;
    const engineVol = cur ? (cur.isPlane ? 0.25 + cur.throttle * 0.5 : cur.kit.twoWheeler && cur.type !== 'moto' ? 0.05 : 0.18 + Math.min(0.5, sp / 40)) : 0;
    const gear = cur && !cur.isPlane ? (sp % 12) / 12 : 0;
    a.loop('engine', engineVol, cur?.isPlane ? 1.2 + cur.throttle * 1.5 : 0.6 + gear * 0.9 + sp / 60);
    a.loop('squeal', cur ? Math.min(0.6, cur.skid * 0.7) : 0, 1);
    a.loop('siren', cur?.sirenOn ? 0.5 : 0, 1);
    const p = this.player.position;
    const nearSea = THREE.MathUtils.clamp(1 - (p.x - WORLD.shoreX) / 120, 0, 1);
    a.loop('waves', nearSea * 0.5, 1);
    a.loop('city', (1 - nearSea) * 0.25 + Math.min(0.3, this.traffic.jamLevel * 0.3), 1);
    for (const h of this.traffic.honks.slice(0, 2)) a.play(Math.random() < 0.2 ? 'hornTruck' : 'horn', h, 0.6, 0.9 + Math.random() * 0.25);
  }

  render(dt: number) {
    this.post.update(this.dayNight.exposure, this.dayNight.golden, worldUniforms.uNight.value);
    this.post.render(dt);
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
