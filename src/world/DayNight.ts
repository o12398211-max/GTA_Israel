import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { worldUniforms } from './Materials';
import { Clouds } from './Clouds';

const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;

/**
 * Day/night cycle: physical sky, sun/moon directional light with shadows
 * that follows the player, hemisphere fill, fog tint and a periodically
 * refreshed PMREM environment for reflections.
 */
export class DayNight {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7452, 1.0);
  readonly fog: THREE.Fog;
  /** in-game hour 0..24 */
  hour = 17.6;
  /** pre-tonemap exposure, golden-hour factor (read by post FX) */
  exposure = 1;
  golden = 0;
  /** game minutes per real second */
  speed = 1;
  private sunDir = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 999;
  private stars: THREE.Points;
  readonly clouds = new Clouds();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowSize = 2048) {
    this.sky.scale.setScalar(4500);
    scene.add(this.sky);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -90; cam.right = 90; cam.top = 90; cam.bottom = -90; cam.near = 1; cam.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.fog = new THREE.Fog(0xffc6a0, 120, 1100);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // stars
    const g = new THREE.BufferGeometry();
    const p: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(3000);
      p.push(v.x, v.y, v.z);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    scene.add(this.clouds.mesh);
  }

  /** Jump to an hour and refresh lighting/env immediately. */
  setHour(h: number): void { this.hour = h; this.envTimer = 999; }

  /** 0 = full day, 1 = full night */
  get night(): number { return worldUniforms.uNight.value; }

  get timeString(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.hour = (this.hour + (dt * this.speed) / 60) % 24;
    // sun path: rises in the east (+x), sets over the sea in the west (-x)
    const a = ((this.hour - 12) / 6) * (Math.PI / 2);
    const elev = Math.cos(a) * 1.15 - 0.12; // radians-ish
    const el = Math.max(-0.6, Math.min(1.25, elev));
    this.sunDir.set(-Math.sin(a) * Math.cos(el), Math.sin(el), 0.35 * Math.cos(el)).normalize();

    const day = smooth(this.sunDir.y, -0.08, 0.18);
    const golden = (1 - smooth(this.sunDir.y, 0.05, 0.45)) * day;
    worldUniforms.uNight.value = 1 - smooth(this.sunDir.y, -0.12, 0.06);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = lerp(4, 9, golden);
    u.rayleigh.value = lerp(1.2, 3.2, golden) * lerp(0.15, 1, day);
    u.mieCoefficient.value = 0.0035;
    u.mieDirectionalG.value = 0.78;

    // light: sun by day, cool moon by night (moon opposite the sun)
    const isMoon = this.sunDir.y < 0;
    const lightDir = isMoon ? this.sunDir.clone().multiplyScalar(-1).setY(Math.max(0.35, -this.sunDir.y)) : this.sunDir.clone().setY(Math.max(0.06, this.sunDir.y));
    lightDir.normalize();
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    // snap shadow camera to texels to avoid shimmering
    const sunColor = new THREE.Color().setRGB(1, lerp(0.55, 0.96, smooth(this.sunDir.y, 0.0, 0.5)), lerp(0.35, 0.9, smooth(this.sunDir.y, 0.0, 0.6)));
    if (isMoon) sunColor.setRGB(0.55, 0.65, 1.0);
    this.sun.color.copy(sunColor);
    this.sun.intensity = isMoon ? 0.35 * smooth(-this.sunDir.y, 0.0, 0.2) : 3.2 * smooth(this.sunDir.y, -0.02, 0.15);

    this.hemi.color.setRGB(lerp(0.2, 0.72, day) + golden * 0.15, lerp(0.22, 0.8, day), lerp(0.45, 1.0, day));
    this.hemi.groundColor.setRGB(lerp(0.06, 0.5, day) + golden * 0.15, lerp(0.05, 0.4, day), lerp(0.1, 0.3, day));
    this.hemi.intensity = lerp(0.9, 1.1, day);

    // fog: purple-pink at sunset, blue haze by day, deep violet at night
    const fogDay = new THREE.Color(0xb9d3ea), fogGold = new THREE.Color(0xf6a98b), fogNight = new THREE.Color(0x1a1530);
    const fc = fogDay.clone().lerp(fogGold, golden).lerp(fogNight, worldUniforms.uNight.value);
    this.fog.color.copy(fc);
    this.fog.near = lerp(180, 120, golden);
    this.fog.far = lerp(1800, 1200, golden);
    (this.stars.material as THREE.PointsMaterial).opacity = worldUniforms.uNight.value * 0.9;
    this.stars.position.copy(focus);
    // clouds: warm sunset light on the undersides, pinkish at golden hour
    const cloudSun = new THREE.Color().setRGB(1.0, lerp(0.62, 0.95, smooth(this.sunDir.y, 0.02, 0.5)), lerp(0.55, 0.92, smooth(this.sunDir.y, 0.02, 0.5)))
      .multiplyScalar(lerp(0.35, 1.25, day));
    if (golden > 0.2) cloudSun.lerp(new THREE.Color(1.0, 0.55, 0.62), golden * 0.45);
    this.clouds.update(worldUniforms.uTime.value, this.sunDir, cloudSun, fc, worldUniforms.uNight.value, focus);
    this.exposure = lerp(0.9, 0.75, golden) * lerp(1, 2.3, worldUniforms.uNight.value);
    this.golden = golden;

    // refresh environment map every few seconds (or quickly when time is sped up)
    this.envTimer += dt * Math.max(1, this.speed / 6);
    if (this.envTimer > 4) {
      this.envTimer = 0;
      const eu = this.envSky.material.uniforms;
      for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) {
        const v = u[k].value;
        if (v instanceof THREE.Vector3) eu[k].value.copy(v); else eu[k].value = v;
      }
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = lerp(0.08, 0.6, day);
      this.envRT?.dispose();
      this.envRT = rt;
    }
  }
}
