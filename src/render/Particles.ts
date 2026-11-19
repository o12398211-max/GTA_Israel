import * as THREE from 'three';

export type ParticleKind = 'dust' | 'smoke' | 'splash' | 'spark' | 'flame' | 'debris' | 'rain';

interface Preset { color: THREE.Color; color2: THREE.Color; size: [number, number]; life: [number, number]; gravity: number; drag: number; additive: boolean; grow: number }
const P: Record<ParticleKind, Preset> = {
  dust: { color: new THREE.Color(0xd8c39a), color2: new THREE.Color(0xc9b48a), size: [0.4, 1.0], life: [0.6, 1.4], gravity: -0.3, drag: 2.2, additive: false, grow: 1.8 },
  smoke: { color: new THREE.Color(0xdddddd), color2: new THREE.Color(0x9a9a9a), size: [0.6, 1.2], life: [1.0, 2.2], gravity: -0.6, drag: 1.5, additive: false, grow: 2.5 },
  splash: { color: new THREE.Color(0xffffff), color2: new THREE.Color(0xbfe8ff), size: [0.15, 0.35], life: [0.5, 0.9], gravity: 9.8, drag: 0.4, additive: false, grow: 0.6 },
  spark: { color: new THREE.Color(0xffd27a), color2: new THREE.Color(0xff6a00), size: [0.06, 0.14], life: [0.3, 0.7], gravity: 9.8, drag: 0.6, additive: true, grow: -0.5 },
  flame: { color: new THREE.Color(0xffb040), color2: new THREE.Color(0xff2a10), size: [0.3, 0.6], life: [0.4, 0.9], gravity: -3, drag: 1.2, additive: true, grow: 0.8 },
  debris: { color: new THREE.Color(0xf2f2f0), color2: new THREE.Color(0xbbbbbb), size: [0.08, 0.18], life: [0.8, 1.6], gravity: 9.8, drag: 0.3, additive: false, grow: 0 },
  rain: { color: new THREE.Color(0xc4d6ec), color2: new THREE.Color(0xe8f0fa), size: [0.11, 0.16], life: [0.8, 1.1], gravity: 30, drag: 0, additive: false, grow: 0 },
};

/**
 * Pooled CPU particle system rendered as two Points draws (alpha + additive)
 * with soft round sprites and per-particle size/color/alpha.
 */
export class Particles {
  private max: number;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array;
  private life: Float32Array; private maxLife: Float32Array; private kind: Uint8Array; private baseSize: Float32Array;
  private add: Uint8Array;
  private geo: THREE.BufferGeometry[] = [];
  readonly group = new THREE.Group();
  private next = 0;
  private kinds = Object.keys(P) as ParticleKind[];

  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.kind = new Uint8Array(max); this.baseSize = new Float32Array(max); this.add = new Uint8Array(max);
    for (const additive of [false, true]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('palpha', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uScale: { value: 600 } },
        vertexShader: /* glsl */ `attribute float psize; attribute float palpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
          void main(){ vC = color; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * uScale / max(0.1, -mv.z); }`,
        fragmentShader: /* glsl */ `varying vec3 vC; varying float vA;
          void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vC, vA * (1.0 - r)); }`,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      this.group.add(pts);
      this.geo.push(g);
    }
  }

  setViewportHeight(h: number) { for (const p of this.group.children) ((p as THREE.Points).material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9; }

  emit(kind: ParticleKind, at: THREE.Vector3, count: number, spread = 0.5, vel?: THREE.Vector3, velSpread = 1) {
    const pr = P[kind];
    for (let n = 0; n < count; n++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const r = () => Math.random() * 2 - 1;
      this.pos[i * 3] = at.x + r() * spread; this.pos[i * 3 + 1] = at.y + Math.random() * spread * 0.5; this.pos[i * 3 + 2] = at.z + r() * spread;
      this.vel[i * 3] = (vel?.x ?? 0) + r() * velSpread; this.vel[i * 3 + 1] = (vel?.y ?? 0) + Math.random() * velSpread; this.vel[i * 3 + 2] = (vel?.z ?? 0) + r() * velSpread;
      const c = pr.color.clone().lerp(pr.color2, Math.random());
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.baseSize[i] = THREE.MathUtils.lerp(pr.size[0], pr.size[1], Math.random());
      this.maxLife[i] = this.life[i] = THREE.MathUtils.lerp(pr.life[0], pr.life[1], Math.random());
      this.kind[i] = this.kinds.indexOf(kind);
      this.add[i] = pr.additive ? 1 : 0;
    }
  }

  update(dt: number) {
    const outs = this.geo.map((g) => ({ p: g.attributes.position.array as Float32Array, c: g.attributes.color.array as Float32Array, s: g.attributes.psize.array as Float32Array, a: g.attributes.palpha.array as Float32Array, n: 0 }));
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const pr = P[this.kinds[this.kind[i]]];
      const k = Math.max(0, 1 - pr.drag * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - pr.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const u = 1 - this.life[i] / this.maxLife[i];
      const o = outs[this.add[i]];
      const j = o.n++;
      o.p[j * 3] = this.pos[i * 3]; o.p[j * 3 + 1] = this.pos[i * 3 + 1]; o.p[j * 3 + 2] = this.pos[i * 3 + 2];
      o.c[j * 3] = this.col[i * 3]; o.c[j * 3 + 1] = this.col[i * 3 + 1]; o.c[j * 3 + 2] = this.col[i * 3 + 2];
      o.s[j] = this.baseSize[i] * (1 + pr.grow * u);
      o.a[j] = (pr.additive ? 1 : this.kind[i] === 6 ? 0.8 : 0.55) * Math.min(1, (1 - u) * 2) * Math.min(1, u * 8 + 0.2);
    }
    this.geo.forEach((g, gi) => {
      g.setDrawRange(0, outs[gi].n);
      for (const k of ['position', 'color', 'psize', 'palpha']) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    });
  }
}
