import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Rigged, animated character built on CC0 assets by Quaternius
 * (Universal Base Characters + Universal Animation Library, same skeleton).
 *
 * The base bodies come without clothes, so outfits are generated: every vertex
 * gets a "region" (shirt / pants / shoes) from its bone weights + bind-pose
 * position, and the shader paints fabric (cotton, denim, sneakers) there,
 * slightly inflating cloth and flattening the anatomy normal map under it.
 */

export interface Outfit {
  body: 'male' | 'female';
  height: number; // meters
  shirt: THREE.Color; pants: THREE.Color; shoes: THREE.Color;
  sleeves: 'short' | 'rolled' | 'none';
  crop: boolean; // crop top
  shorts: boolean;
  beard: boolean;
}

export const OUTFITS: Record<'avi' | 'noa' | 'police', Outfit> = {
  avi: { body: 'male', height: 1.78, shirt: new THREE.Color(0xf4f3ee), pants: new THREE.Color(0x2c3e5c), shoes: new THREE.Color(0x2a2a2c), sleeves: 'rolled', crop: false, shorts: false, beard: true },
  police: { body: 'male', height: 1.82, shirt: new THREE.Color(0x1c2a4a), pants: new THREE.Color(0x141a26), shoes: new THREE.Color(0x0d0d0d), sleeves: 'short', crop: false, shorts: false, beard: false },
  noa: { body: 'female', height: 1.66, shirt: new THREE.Color(0x151515), pants: new THREE.Color(0x6f93c0), shoes: new THREE.Color(0xf2f2f2), sleeves: 'none', crop: true, shorts: true, beard: false },
};

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;
const regionGeoCache = new Map<string, THREE.BufferGeometry>();
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
const load = (f: string) => {
  if (!cache.has(f)) cache.set(f, loader.loadAsync(BASE + f));
  return cache.get(f)!;
};

/** Preload everything a character needs (call during the loading screen). */
export async function preloadCharacters(): Promise<void> {
  await Promise.all(['Superhero_Male_FullBody.gltf', 'Superhero_Female_FullBody.gltf', 'animations.glb', 'Hair_Beard.gltf', 'Hair_SimpleParted.gltf', 'Eyebrows_Regular.gltf', 'Eyebrows_Female.gltf'].map(load));
}

export type State = 'idle' | 'walk' | 'jog' | 'sprint' | 'jumpStart' | 'jumpLoop' | 'jumpLand' | 'swimIdle' | 'swim' | 'drive' | 'talk' | 'punch' | 'dance' | 'hit' | 'sit' | 'death' | 'roll' | 'jab' | 'crouch' | 'interact' | 'pickup';
const CLIPS: Record<State, string> = {
  sit: 'Sitting_Idle_Loop', death: 'Death01', roll: 'Roll', jab: 'Punch_Jab', crouch: 'Crouch_Idle_Loop', interact: 'Interact', pickup: 'PickUp_Table',
  idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land',
  swimIdle: 'Swim_Idle_Loop', swim: 'Swim_Fwd_Loop', drive: 'Driving_Loop', talk: 'Idle_Talking_Loop',
  punch: 'Punch_Cross', dance: 'Dance_Loop', hit: 'Hit_Chest',
};
/** speed (m/s) at which each locomotion clip looks right at timeScale 1 */
const REF_SPEED: Partial<Record<State, number>> = { walk: 1.5, jog: 3.6, sprint: 6.2, swim: 1.6 };

/** Random everyday outfit for pedestrians / tourists. */
export function randomOutfit(r: () => number, kind: 'local' | 'tourist' = 'local'): Outfit {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const female = r() < 0.5;
  const shirts = kind === 'tourist' ? [0xff6f61, 0x6ec6ff, 0xfff176, 0x81c784, 0xffffff, 0xf48fb1] : [0xf5f5f0, 0x2b2b2b, 0x3b5f8a, 0x9e2b2b, 0x6b7f4a, 0xd8c3a5, 0x7a4fa0, 0xe8e8e8];
  const pants = kind === 'tourist' ? [0xd8c3a5, 0x8d9a7a, 0x4a6fa5] : [0x2c3e5c, 0x1e1e1e, 0x5a5a5a, 0x7a6a50, 0x3f5f8f];
  return {
    body: female ? 'female' : 'male',
    height: female ? 1.6 + r() * 0.12 : 1.7 + r() * 0.14,
    shirt: new THREE.Color(pick(shirts)), pants: new THREE.Color(pick(pants)), shoes: new THREE.Color(pick([0xf0f0f0, 0x222222, 0x8a5a3a])),
    sleeves: female ? pick(['short', 'none'] as const) : pick(['short', 'short', 'rolled'] as const),
    crop: female && r() < 0.3, shorts: kind === 'tourist' || r() < 0.35, beard: !female && r() < 0.45,
  };
}

export class SkinnedCharacter {
  readonly root = new THREE.Group();
  talk = 0;
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<State, THREE.AnimationAction>();
  private state: State = 'idle';
  private oneShot = 0;
  private airTime = 0;
  /** override state for cutscenes / vehicles (null = automatic locomotion) */
  forced: State | null = null;

  static async create(outfit: Outfit): Promise<SkinnedCharacter> {
    const c = new SkinnedCharacter();
    await c.init(outfit);
    return c;
  }

  private async init(o: Outfit) {
    const [body, anims] = await Promise.all([
      load(o.body === 'male' ? 'Superhero_Male_FullBody.gltf' : 'Superhero_Female_FullBody.gltf'),
      load('animations.glb'),
    ]);
    const model = SkeletonUtils.clone(body.scene) as THREE.Object3D;
    model.updateMatrixWorld(true);
    // normalize height, keep feet on y=0
    const box = new THREE.Box3().setFromObject(model);
    const s = o.height / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    this.root.add(model);

    let skeleton: THREE.Skeleton | null = null;
    model.traverse((obj) => {
      const m = obj as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (m.isSkinnedMesh) skeleton ??= m.skeleton;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/Superhero/i.test(mat.name)) {
        const ws = m.getWorldScale(new THREE.Vector3()).y; // world meters per mesh unit
        m.material = this.dressMaterial(mat, o, 1 / ws);
        const key = `${o.body}|${o.sleeves}|${o.crop}|${o.shorts}`;
        const cached = regionGeoCache.get(key);
        if (cached) m.geometry = cached;
        else { m.geometry = m.geometry.clone(); this.computeRegions(m, o, 1 / ws); regionGeoCache.set(key, m.geometry); }
      } else {
        m.material = mat.clone();
        if (/Hair/i.test(mat.name)) {
          const hm = m.material as THREE.MeshStandardMaterial;
          hm.alphaTest = 0.4; hm.transparent = false; hm.side = THREE.DoubleSide;
          if (o.body === 'male') hm.color.setRGB(0.24, 0.17, 0.12);
        }
      }
    });

    // rigged accessories (beard / eyebrows) rebound to this skeleton by bone name
    const extras = [o.body === 'male' ? 'Eyebrows_Regular.gltf' : 'Eyebrows_Female.gltf'];
    if (o.beard) extras.push('Hair_Beard.gltf');
    if (o.body === 'male') extras.push('Hair_SimpleParted.gltf');
    if (skeleton) for (const f of extras) this.attachRigged(await load(f), skeleton, model);

    this.mixer = new THREE.AnimationMixer(model);
    const byName = new Map(anims.animations.map((a) => [a.name, a]));
    for (const [st, name] of Object.entries(CLIPS) as [State, string][]) {
      const clip = byName.get(name);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (['jumpStart', 'jumpLand', 'punch', 'hit', 'death', 'roll', 'jab', 'interact', 'pickup'].includes(st)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(st, a);
    }
    this.actions.get('idle')?.play();
  }

  /** Attach a separately skinned mesh (hair, beard) to our skeleton. */
  private attachRigged(gltf: GLTF, skeleton: THREE.Skeleton, model: THREE.Object3D) {
    const src = SkeletonUtils.clone(gltf.scene);
    src.updateMatrixWorld(true);
    const meshes: THREE.SkinnedMesh[] = [];
    src.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const holder = model.children.find((c) => c.type !== 'Bone' && !(c as THREE.Bone).isBone && c.children.some((g) => (g as THREE.SkinnedMesh).isSkinnedMesh)) ?? model;
    for (const m of meshes) {
      const bones = m.skeleton.bones.map((b) => skeleton.bones.find((x) => x.name === b.name) ?? b);
      const sk = new THREE.Skeleton(bones, m.skeleton.boneInverses);
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.alphaTest = 0.4; mat.side = THREE.DoubleSide; mat.color.setRGB(0.24, 0.17, 0.12);
      m.material = mat;
      m.castShadow = true;
      m.frustumCulled = false;
      holder.add(m);
      m.bind(sk, m.bindMatrix);
    }
  }

  /** Per-vertex outfit regions from bone weights + bind-pose position. */
  private computeRegions(mesh: THREE.SkinnedMesh, o: Outfit, unit: number) {
    const g = mesh.geometry;
    const idx = g.attributes.skinIndex as THREE.BufferAttribute;
    const wt = g.attributes.skinWeight as THREE.BufferAttribute;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const bones = mesh.skeleton.bones;
    const boneIdx = (n: string) => bones.findIndex((b) => b.name === n);
    // bind-pose bone positions in mesh space
    const bindPos = (n: string) => {
      const i = boneIdx(n);
      return new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert());
    };
    const neckY = bindPos('neck_01').y, spine2Y = bindPos('spine_02').y, spine1Y = bindPos('spine_01').y;
    const kneeY = bindPos('calf_l').y, ankleY = bindPos('foot_l').y, hipY = bindPos('thigh_l').y;
    const elbowX = Math.abs(bindPos('lowerarm_l').x), handX = Math.abs(bindPos('hand_l').x), shoulderX = Math.abs(bindPos('upperarm_l').x);
    const cat = new Map<number, 'torso' | 'arm' | 'fore' | 'hand' | 'leg' | 'foot' | 'head'>();
    bones.forEach((b, i) => {
      const n = b.name;
      if (/spine|clavicle/.test(n)) cat.set(i, 'torso');
      else if (/upperarm/.test(n)) cat.set(i, 'arm');
      else if (/lowerarm/.test(n)) cat.set(i, 'fore');
      else if (/hand|index|middle|ring|pinky|thumb/.test(n)) cat.set(i, 'hand');
      else if (/pelvis|thigh|calf/.test(n)) cat.set(i, 'leg');
      else if (/foot|ball/.test(n)) cat.set(i, 'foot');
      else cat.set(i, 'head');
    });
    const region = new Float32Array(pos.count * 4);
    const sleeveX = o.sleeves === 'rolled' ? elbowX + (handX - elbowX) * 0.45 : o.sleeves === 'short' ? shoulderX + (elbowX - shoulderX) * 0.55 : shoulderX - 0.02;
    for (let v = 0; v < pos.count; v++) {
      const acc: Record<string, number> = {};
      for (let k = 0; k < 4; k++) {
        const w = wt.getComponent(v, k);
        if (w <= 0) continue;
        const c = cat.get(idx.getComponent(v, k)) ?? 'head';
        acc[c] = (acc[c] ?? 0) + w;
      }
      const x = Math.abs(pos.getX(v)), y = pos.getY(v);
      const torsoW = (acc.torso ?? 0) + (acc.arm ?? 0) + (acc.fore ?? 0) * 0.999;
      let shirt = 0, pants = 0, shoes = 0;
      // shirt: torso + arms up to the sleeve line, below the neckline
      const headW = acc.head ?? 0;
      if (torsoW > 0.45 && headW < 0.3 && (acc.hand ?? 0) < 0.3 && y < neckY + 0.01 * unit && x < sleeveX) {
        shirt = 1;
        if (o.crop && y < spine2Y - (spine2Y - spine1Y) * 0.1) shirt = 0;
        if (o.sleeves === 'none' && x > shoulderX - 0.01 * unit) shirt = 0;
      }
      // pants: pelvis/legs (+ lower torso near the waist)
      const legW = acc.leg ?? 0;
      if (legW > 0.35 || ((acc.torso ?? 0) > 0.3 && y < spine1Y + (spine2Y - spine1Y) * 0.15 && !o.crop) || (o.crop && legW > 0.2)) {
        pants = 1;
        if (o.shorts && y < kneeY + (hipY - kneeY) * 0.55) pants = 0;
        if (o.crop && y > spine1Y + (spine2Y - spine1Y) * 0.1) pants = 0;
      }
      if ((acc.foot ?? 0) > 0.3 || y < ankleY + (kneeY - ankleY) * 0.08) { shoes = 1; pants = 0; }
      if (shirt && pants) shirt = y > spine1Y ? 1 : 0, pants = shirt ? 0 : 1;
      region.set([shirt, pants, shoes, 0], v * 4);
    }
    g.setAttribute('region', new THREE.BufferAttribute(region, 4));
  }

  private dressMaterial(base: THREE.MeshStandardMaterial, o: Outfit, unit: number): THREE.MeshStandardMaterial {
    const mat = base.clone();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uShirt = { value: o.shirt };
      shader.uniforms.uPants = { value: o.pants };
      shader.uniforms.uShoes = { value: o.shoes };
      shader.uniforms.uInflate = { value: unit * 0.01 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 region; varying vec4 vRegion; varying vec2 vCUv; uniform float uInflate;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRegion = region; vCUv = uv;
          transformed += objectNormal * uInflate * (region.x * 1.6 + region.y * 1.5 + region.z * 2.6);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vRegion; varying vec2 vCUv; uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uShoes;
          float ch(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float cn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
            return mix(mix(ch(i), ch(i+vec2(1,0)), u.x), mix(ch(i+vec2(0,1)), ch(i+vec2(1,1)), u.x), u.y); }
          float cloth;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 cuv = vCUv * 600.0;
            float weave = 0.93 + 0.07 * cn(cuv) ;
            float folds = 0.86 + 0.14 * cn(vCUv * vec2(18.0, 50.0));
            vec3 shirtC = uShirt * weave * folds;
            float twill = 0.88 + 0.12 * step(0.5, fract((vCUv.x + vCUv.y) * 420.0));
            vec3 denim = uPants * twill * (0.85 + 0.25 * cn(vCUv * 90.0)) * folds;
            vec3 shoe = uShoes * (0.9 + 0.1 * cn(cuv * 0.3));
            cloth = clamp(vRegion.x + vRegion.y + vRegion.z, 0.0, 1.0);
            vec3 c = diffuseColor.rgb;
            c = mix(c, shirtC, vRegion.x);
            c = mix(c, denim, vRegion.y);
            c = mix(c, shoe, vRegion.z);
            diffuseColor.rgb = c;
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.92, cloth);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, nonPerturbedNormal, cloth * 0.85));`);
    };
    mat.customProgramCacheKey = () => 'dressed-body';
    return mat;
  }

  private play(st: State, fade = 0.2) {
    if (st === this.state && !this.actions.get(st)?.getClip().name.includes('Jump')) return;
    const next = this.actions.get(st);
    if (!next) return;
    const prev = this.actions.get(this.state);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.state = st;
  }

  /** Trigger a one-shot action (punch, hit…). */
  trigger(st: State, dur = 0.6) { this.play(st, 0.1); this.oneShot = dur; }

  update(dt: number, speed: number, grounded: boolean, vy: number, swimming = false): void {
    if (!this.mixer) return;
    this.oneShot -= dt;
    let target: State;
    if (this.forced) target = this.forced;
    else if (this.oneShot > 0) target = this.state;
    else if (swimming) target = speed > 0.4 ? 'swim' : 'swimIdle';
    else if (!grounded) {
      this.airTime += dt;
      target = this.airTime < 0.25 && vy > 0 ? 'jumpStart' : 'jumpLoop';
      if (this.state === 'jumpStart' && this.airTime < 0.35) target = 'jumpStart';
    } else {
      if (this.airTime > 0.45) { this.airTime = 0; this.trigger('jumpLand', 0.25); target = 'jumpLand'; }
      else {
        this.airTime = 0;
        target = speed < 0.25 ? (this.talk > 0 ? 'talk' : 'idle') : speed < 2.4 ? 'walk' : speed < 5.0 ? 'jog' : 'sprint';
      }
    }
    if (target !== this.state) this.play(target, target === 'jumpLoop' ? 0.15 : 0.22);
    // match cadence to actual speed
    const ref = REF_SPEED[this.state];
    const a = this.actions.get(this.state);
    if (a) a.timeScale = ref ? THREE.MathUtils.clamp(speed / ref, 0.6, 1.6) : 1;
    this.mixer.update(dt);
  }
}
