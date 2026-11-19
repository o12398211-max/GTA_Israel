import * as THREE from 'three';
import { Input } from './Input';
import { CityBuilder, type CityRuntime } from '../world/City';
import { loadTextures, setMaxAnisotropy } from '../render/Textures';
import { loadModel } from '../render/GltfInstances';
import { PostFX } from '../render/Post';
import { DayNight } from '../world/DayNight';
import { buildSea } from '../world/Sea';
import { worldUniforms } from '../world/Materials';
import { zoneAt } from '../world/Terrain';
import { SkinnedCharacter, OUTFITS, preloadCharacters } from '../entities/SkinnedCharacter';
import { PlayerController } from '../entities/PlayerController';
import { FollowCamera } from '../camera/FollowCamera';
import { Hud } from '../ui/Hud';
import { LoadingScreen } from '../ui/Loading';
import { gameStore } from '../state/store';

/** Named spawn points – also usable via URL: ?spawn=jerusalem */
export const SPAWNS: Record<string, { x: number; z: number; yaw: number }> = {
  beach: { x: -245, z: 10, yaw: Math.PI * 0.85 },
  market: { x: -110, z: 0, yaw: Math.PI / 2 },
  ayalon: { x: 90, z: 20, yaw: 0 },
  route1: { x: 300, z: 0, yaw: Math.PI / 2 },
  jerusalem: { x: 535, z: 0, yaw: Math.PI / 2 },
};

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
  readonly input: Input;
  private timer = new THREE.Timer();
  private debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private dayNight!: DayNight;
  private city!: CityRuntime;
  private player!: PlayerController;
  private follow!: FollowCamera;
  private hud = new Hud();
  private post!: PostFX;
  private spit: THREE.Object3D | undefined;
  private fastTime = false;
  private params = new URLSearchParams(location.search);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in PostFX
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.input = new Input(canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(): Promise<void> {
    const loading = new LoadingScreen();
    loading.progress(0.02, 'טוענים טקסטורות…');
    const [, , chair, lamp, bin] = await Promise.all([
      loadTextures(['plaster', 'jstone', 'asphalt', 'pavers', 'sand', 'rock', 'slabs'], (p) => loading.progress(p * 0.15)),
      preloadCharacters(), loadModel('chair'), loadModel('lamp'), loadModel('bin', (n) => n === 'metal_trash_can' || (n.startsWith('metal_trash_can_') && !n.includes('rust'))),
    ]);
    const builder = new CityBuilder({ chair, lamp, bin });
    const steps = builder.steps();
    for (let i = 0; i < steps.length; i++) {
      loading.progress(i / (steps.length + 2), steps[i].label);
      await nextFrame();
      steps[i].run();
    }
    this.city = builder.runtime();
    this.scene.add(this.city.group);
    this.scene.add(buildSea());
    this.spit = this.scene.getObjectByName('shawarma-spit');

    const low = this.params.get('quality') === 'low';
    if (low) this.renderer.setPixelRatio(1);
    this.dayNight = new DayNight(this.scene, this.renderer, low ? 1024 : 2048);
    const hour = Number(this.params.get('hour'));
    this.dayNight.hour = Number.isFinite(hour) && this.params.has('hour') ? hour : 16.9;
    this.dayNight.speed = 0.5;
    loading.progress((steps.length + 1) / (steps.length + 2));
    await nextFrame();

    const model = await SkinnedCharacter.create(OUTFITS[this.params.get('char') === 'noa' ? 'noa' : 'avi']);
    this.scene.add(model.root);
    this.player = new PlayerController(model, this.city.colliders);
    const sp = SPAWNS[this.params.get('spawn') ?? 'beach'] ?? SPAWNS.beach;
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.follow = new FollowCamera(this.camera, this.city.colliders);
    this.follow.snap(this.player.position, sp.yaw);
    this.post = new PostFX(this.renderer, this.scene, this.camera, (this.params.get('quality') as 'low' | 'high' | null) ?? 'high');
    this.resize();

    // warm up: compile shaders + one render so the first frame doesn't hitch
    this.dayNight.update(0, this.player.position);
    this.follow.update(0.016, { moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false, walk: false, jump: false, zoom: 0 }, this.player.position, this.player.yaw, 0);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.post.render(0.016);
    loading.progress(1);

    gameStore.setState({ phase: 'title' });
    if (!this.params.has('autostart')) await loading.waitForStart();
    else loading.waitForStart(), document.getElementById('start-btn')!.click();
    gameStore.setState({ phase: 'playing' });
    this.hud.show();
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.frame(t));

    // debug handle for automated tests / console tinkering
    (window as unknown as { __game: Game }).__game = this;
    (window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
  }

  /** Debug: teleport to a named spawn or coordinates. */
  teleport(where: string | { x: number; z: number }) {
    const sp = typeof where === 'string' ? SPAWNS[where] : { ...where, yaw: this.player.yaw };
    if (!sp) return;
    this.player.spawn(sp.x, sp.z, sp.yaw);
    this.follow.snap(this.player.position, sp.yaw);
  }

  setHour(h: number) { this.dayNight.setHour(h); }

  /** Debug: park the camera somewhere (null = back to follow cam). */
  debugView(pos: [number, number, number] | null, look?: [number, number, number]) {
    this.debugCam = pos ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...(look ?? [0, 0, 0])) } : null;
  }

  private frame(time: number) {
    this.timer.update(time);
    const rawDt = this.timer.getDelta();
    const dt = Math.min(0.05, rawDt);
    worldUniforms.uTime.value += dt;
    const inp = this.input.sample(dt);

    if (this.input.wasPressed('KeyT')) { this.fastTime = !this.fastTime; this.dayNight.speed = this.fastTime ? 20 : 0.5; }
    if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();

    this.player.update(dt, inp, this.follow.yaw);
    this.follow.update(dt, inp, this.player.position, this.player.yaw, this.player.speed);
    if (this.debugCam) { this.camera.position.copy(this.debugCam.pos); this.camera.lookAt(this.debugCam.look); }
    this.dayNight.update(dt, this.player.position);

    // night-lit materials (lamps, signs, string lights)
    const n = worldUniforms.uNight.value;
    for (const { mat, max } of this.city.nightMaterials) mat.emissiveIntensity = 0.05 + n * max;
    this.city.lightPools.opacity = n * 0.9;
    if (this.spit) this.spit.rotation.y += dt * 1.5;

    const p = this.player.position;
    const zone = zoneAt(p.x, p.z);
    if (gameStore.getState().zone !== zone) gameStore.getState().setZone(zone);
    this.hud.update(rawDt, this.dayNight.timeString, zone, this.fastTime);
    gameStore.setState({ hour: this.dayNight.hour, fps: this.hud.currentFps });

    this.post.update(this.dayNight.exposure, this.dayNight.golden, worldUniforms.uNight.value);
    this.post.render(dt);
    this.input.endFrame();
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
