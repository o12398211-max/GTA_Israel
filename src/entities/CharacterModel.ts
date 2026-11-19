import * as THREE from 'three';

export interface CharacterLook {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  hairStyle: 'short' | 'curly' | 'bald' | 'long';
  /** body width multiplier */ build?: number;
  height?: number;
  shorts?: boolean;
  beard?: boolean;
}

export const LOOKS = {
  avi: { skin: 0xc58c64, shirt: 0xf6f6f2, pants: 0x2b3a55, shoes: 0x2a2a2a, hair: 0x1d1410, hairStyle: 'short', build: 1.05, height: 1.0, beard: true },
  noa: { skin: 0xd9a07a, shirt: 0x161616, pants: 0x6d8fb8, shoes: 0xf2f2f2, hair: 0x2b1a12, hairStyle: 'curly', build: 0.88, height: 0.95, shorts: true },
} satisfies Record<string, CharacterLook>;

type Limb = { pivot: THREE.Group; lower?: THREE.Group };

const mat = (c: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });

/**
 * Procedural low-poly humanoid with a joint hierarchy (hips, spine, head,
 * shoulders/elbows, hips/knees) and code-driven animation states:
 * idle, walk, run, jump/fall, swim. A GLTF with a skeleton can replace this
 * later through the asset registry – keep the same `update()` contract.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private armL: Limb; private armR: Limb;
  private legL: Limb; private legR: Limb;
  private phase = 0;
  private blink = 0;
  private eyes: THREE.Mesh[] = [];
  private mouth: THREE.Mesh;
  /** 0..1 – how much the mouth moves (dialog lip-flap, stage 5) */
  talk = 0;

  constructor(look: CharacterLook) {
    const b = look.build ?? 1, H = look.height ?? 1;
    this.root.scale.setScalar(H);
    const skin = mat(look.skin, 0.6), shirt = mat(look.shirt, 0.85), pants = mat(look.pants, 0.9), shoes = mat(look.shoes, 0.7), hair = mat(look.hair, 0.9);

    this.hips.position.y = 0.98;
    this.root.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36 * b, 0.2, 0.22), pants);
    this.hips.add(pelvis);

    this.spine.position.y = 0.08;
    this.hips.add(this.spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2 * b, 0.32, 4, 10), shirt);
    torso.scale.set(1.05, 1, 0.68);
    torso.position.y = 0.3;
    this.spine.add(torso);
    // collar detail
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.025, 5, 10), shirt);
    collar.rotation.x = Math.PI / 2; collar.position.y = 0.6;
    this.spine.add(collar);

    this.head.position.y = 0.66;
    this.spine.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), skin);
    neck.position.y = 0.02;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
    skull.scale.set(0.92, 1.08, 1); skull.position.y = 0.17;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 5), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.16, 0.135);
    this.head.add(neck, skull, nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), mat(0x111111, 0.3));
      eye.position.set(s * 0.045, 0.2, 0.115);
      this.eyes.push(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), hair);
      brow.position.set(s * 0.047, 0.235, 0.12);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), skin);
      ear.scale.set(0.5, 1, 0.8); ear.position.set(s * 0.12, 0.17, 0);
      this.head.add(eye, brow, ear);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), mat(0x5a2a22, 0.6));
    this.mouth.position.set(0, 0.1, 0.122);
    this.head.add(this.mouth);
    this.addHair(look, hair);
    if (look.beard) {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hair);
      beard.position.y = 0.17; beard.scale.set(0.95, 1.08, 1.02);
      this.head.add(beard);
    }

    const sleeveMat = shirt;
    this.armL = this.makeArm(1, b, sleeveMat, skin);
    this.armR = this.makeArm(-1, b, sleeveMat, skin);
    this.legL = this.makeLeg(1, b, look.shorts ? skin : pants, pants, shoes, !!look.shorts);
    this.legR = this.makeLeg(-1, b, look.shorts ? skin : pants, pants, shoes, !!look.shorts);

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private addHair(look: CharacterLook, hair: THREE.Material) {
    if (look.hairStyle === 'bald') return;
    if (look.hairStyle === 'curly' || look.hairStyle === 'long') {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const curl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.065, 0), hair);
        const back = Math.cos(a) < 0.3 ? 1 : 0.4;
        curl.position.set(Math.sin(a) * 0.12, 0.24 - (1 - back) * 0.02 - Math.random() * 0.05, -Math.cos(a) * 0.1 - 0.02);
        this.head.add(curl);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
      top.position.y = 0.19; top.scale.set(1.1, 1, 1.15);
      this.head.add(top);
      if (look.hairStyle === 'curly') {
        const back = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), hair);
        back.position.set(0, 0.06, -0.09); back.scale.set(1.15, 1.25, 0.8);
        this.head.add(back);
      }
      return;
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.137, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), hair);
    cap.position.y = 0.18; cap.rotation.x = -0.25; cap.scale.set(0.95, 1.05, 1.05);
    this.head.add(cap);
  }

  private makeArm(side: number, b: number, sleeve: THREE.Material, skin: THREE.Material): Limb {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.26 * b, 0.53, 0);
    this.spine.add(pivot);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06 * b, 0.2, 3, 8), sleeve);
    upper.position.y = -0.14;
    pivot.add(upper);
    const lower = new THREE.Group();
    lower.position.y = -0.3;
    pivot.add(lower);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 3, 8), skin);
    fore.position.y = -0.12;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
    hand.position.y = -0.27; hand.scale.set(0.8, 1, 0.6);
    lower.add(fore, hand);
    pivot.rotation.z = side * 0.08;
    return { pivot, lower };
  }

  private makeLeg(side: number, b: number, legMat: THREE.Material, shortsMat: THREE.Material, shoeMat: THREE.Material, shorts: boolean): Limb {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1 * b, -0.05, 0);
    this.hips.add(pivot);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * b, 0.28, 3, 8), shorts ? shortsMat : legMat);
    thigh.position.y = -0.2;
    if (shorts) thigh.scale.set(1.1, 0.7, 1.1), thigh.position.y = -0.15;
    pivot.add(thigh);
    if (shorts) {
      const skinThigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.18, 3, 8), legMat);
      skinThigh.position.y = -0.3;
      pivot.add(skinThigh);
    }
    const lower = new THREE.Group();
    lower.position.y = -0.44;
    pivot.add(lower);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.3, 3, 8), legMat);
    shin.position.y = -0.2;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), shoeMat);
    shoe.position.set(0, -0.44, 0.05);
    lower.add(shin, shoe);
    return { pivot, lower };
  }

  /**
   * @param speed horizontal speed m/s
   * @param grounded on ground?
   * @param vy vertical velocity
   * @param swimming in water?
   */
  update(dt: number, speed: number, grounded: boolean, vy: number, swimming = false): void {
    const t = performance.now() / 1000;
    const runBlend = THREE.MathUtils.smoothstep(speed, 3, 6.5);
    const moveBlend = THREE.MathUtils.smoothstep(speed, 0.2, 1.5);
    const cadence = THREE.MathUtils.lerp(7.5, 11.5, runBlend);
    this.phase += dt * (moveBlend > 0 ? cadence * Math.max(0.6, speed / THREE.MathUtils.lerp(2, 7, runBlend)) * 0.62 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const k = 1 - Math.exp(-dt * 14); // pose smoothing
    const L = THREE.MathUtils.lerp;

    const legSwing = L(0.55, 0.95, runBlend) * moveBlend;
    const armSwing = L(0.45, 1.1, runBlend) * moveBlend;
    const lean = L(0.04, 0.22, runBlend) * moveBlend;
    const bob = Math.abs(c) * L(0.03, 0.07, runBlend) * moveBlend;
    const breathe = Math.sin(t * 2) * 0.012 * (1 - moveBlend);

    const target = {
      legL: s * legSwing, legR: -s * legSwing,
      kneeL: Math.max(0, -c) * L(0.4, 1.2, runBlend) * moveBlend + 0.04,
      kneeR: Math.max(0, c) * L(0.4, 1.2, runBlend) * moveBlend + 0.04,
      armL: -s * armSwing, armR: s * armSwing,
      elbow: -L(0.15, 1.2, runBlend) * moveBlend - 0.15,
      spine: lean, hipsY: 0.98 + bob + breathe,
      armSpread: 0.08,
    };
    if (swimming) {
      const sw = t * 3.5;
      target.spine = 1.25; target.hipsY = 0.55;
      target.armL = Math.sin(sw) * 2.4 - 1.2; target.armR = Math.sin(sw + Math.PI) * 2.4 - 1.2;
      target.legL = Math.sin(sw * 2) * 0.35; target.legR = -Math.sin(sw * 2) * 0.35;
      target.kneeL = target.kneeR = 0.15; target.elbow = -0.3;
    } else if (!grounded) {
      const rising = vy > 0;
      target.legL = rising ? -0.7 : -0.3; target.legR = rising ? 0.15 : 0.2;
      target.kneeL = rising ? 1.1 : 0.4; target.kneeR = rising ? 0.3 : 0.5;
      target.armL = -0.5; target.armR = -0.5; target.armSpread = 0.7; target.elbow = -0.5;
      target.spine = 0.1; target.hipsY = 0.98;
    }

    this.legL.pivot.rotation.x = L(this.legL.pivot.rotation.x, target.legL, k);
    this.legR.pivot.rotation.x = L(this.legR.pivot.rotation.x, target.legR, k);
    this.legL.lower!.rotation.x = L(this.legL.lower!.rotation.x, target.kneeL, k);
    this.legR.lower!.rotation.x = L(this.legR.lower!.rotation.x, target.kneeR, k);
    this.armL.pivot.rotation.x = L(this.armL.pivot.rotation.x, target.armL, k);
    this.armR.pivot.rotation.x = L(this.armR.pivot.rotation.x, target.armR, k);
    this.armL.pivot.rotation.z = L(this.armL.pivot.rotation.z, target.armSpread, k);
    this.armR.pivot.rotation.z = L(this.armR.pivot.rotation.z, -target.armSpread, k);
    this.armL.lower!.rotation.x = L(this.armL.lower!.rotation.x, target.elbow, k);
    this.armR.lower!.rotation.x = L(this.armR.lower!.rotation.x, target.elbow, k);
    this.spine.rotation.x = L(this.spine.rotation.x, target.spine, k);
    this.hips.position.y = L(this.hips.position.y, target.hipsY, k);
    this.hips.rotation.y = s * 0.08 * moveBlend;
    this.spine.rotation.y = -s * 0.12 * moveBlend;
    // idle head look-around
    this.head.rotation.y = Math.sin(t * 0.4) * 0.35 * (1 - moveBlend);

    // blinking + lip-flap
    this.blink -= dt;
    const closed = this.blink < 0.12;
    if (this.blink < 0) this.blink = 2 + Math.random() * 3;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
    this.mouth.scale.y = 1 + this.talk * (2 + Math.sin(t * 22) * 2);
  }
}
