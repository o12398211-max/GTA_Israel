import * as THREE from 'three';
import type { Game, GameSystem } from './Game';
import { Particles } from '../render/Particles';
import { WORLD, zoneAt } from '../world/Terrain';
import { STADIUM } from '../minigames/Stadium';

export type Weather = 'clear' | 'hamsin' | 'rain';
const WEATHER_TEXT: Record<Weather, [string, string]> = {
  clear: ['מזג אוויר', 'בהיר ונעים. כמו תמיד, חוץ מכשלא.'],
  hamsin: ['⚠️ שרב', 'חם, יבש ואובך. שתו מים ותתרחקו מוויכוחים.'],
  rain: ['🌧️ גשם', 'יורד גשם! כולם נוהגים כאילו זה הגשם הראשון בהיסטוריה.'],
};

/**
 * Polish layer: particles (dust, smoke, splashes, sparks, flames, rain),
 * weather (clear / hamsin heat-haze / rain), motion blur + heat haze
 * parameters for the post pass, and shadow-map update throttling.
 */
export class FxSystem implements GameSystem {
  readonly particles = new Particles(5000);
  weather: Weather = 'clear';
  private weatherTimer = 0;
  private dustT = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private frame = 0;
  private lastShadowPos = new THREE.Vector3(1e9, 0, 0);
  private camDir = new THREE.Vector3();

  constructor(private game: Game) {
    game.scene.add(this.particles.group);
    this.particles.setViewportHeight(innerHeight);
    window.addEventListener('resize', () => this.particles.setViewportHeight(innerHeight));
    game.renderer.shadowMap.autoUpdate = false;
    game.renderer.shadowMap.needsUpdate = true;
  }

  setWeather(w: Weather, announce = true) {
    this.weather = w;
    const d = this.game.dayNight.weather;
    d.fogMul = w === 'hamsin' ? 2.0 : w === 'rain' ? 1.8 : 1;
    d.cover = w === 'rain' ? 0.92 : w === 'hamsin' ? 0.2 : 0.48;
    d.haze = w === 'hamsin' ? 1 : 0;
    d.dim = w === 'rain' ? 0.6 : 0;
    if (announce) this.game.phone?.push('msg', ...WEATHER_TEXT[w]);
  }

  update(dt: number, g: Game) {
    this.frame++;
    const p = g.player.position;
    const v = g.vehicles.current;

    // weather schedule (every ~3 in-game hours) + Y to cycle (testing / fun)
    this.weatherTimer += dt * g.dayNight.speed / 60;
    if (this.weatherTimer > 3) {
      this.weatherTimer = 0;
      const r = Math.random();
      const day = g.dayNight.hour > 10 && g.dayNight.hour < 17;
      this.setWeather(r < 0.12 ? 'rain' : r < 0.3 && day ? 'hamsin' : 'clear', this.weather !== 'clear' || r < 0.3);
    }
    if (g.input.wasPressed('KeyY')) this.setWeather(this.weather === 'clear' ? 'hamsin' : this.weather === 'hamsin' ? 'rain' : 'clear');

    // on foot: dust on sand, splashes while swimming
    this.dustT -= dt;
    if (!v && this.dustT <= 0) {
      if (g.player.swimming && g.player.speed > 0.3) { this.particles.emit('splash', p.clone().setY(WORLD.seaLevel), 3, 0.3, new THREE.Vector3(0, 2, 0), 1.2); this.dustT = 0.12; }
      else if (g.player.grounded && g.player.speed > 3 && p.x < -213) { this.particles.emit('dust', p.clone().setY(p.y + 0.05), 2, 0.2, new THREE.Vector3(0, 0.6, 0), 0.6); this.dustT = 0.09; }
    }
    // vehicles: tire smoke, sand dust, crash sparks, sea splashes
    if (v && !v.isPlane) {
      const back = v.forward.multiplyScalar(-v.kit.size.z * 0.8);
      const rear = v.position.clone().add(back).setY(v.position.y + 0.2);
      if (v.skid > 0.35) this.particles.emit('smoke', rear, 2, 0.6, new THREE.Vector3(0, 0.8, 0), 0.8);
      if (Math.abs(v.speed) > 4 && v.position.x < -213) this.particles.emit('dust', rear, 3, 0.8, new THREE.Vector3(0, 1.2, 0), 1.5);
      if (v.impact > 6) { this.particles.emit('spark', v.position.clone().setY(v.position.y + 0.6), 24, 0.6, undefined, 5); this.particles.emit('debris', v.position.clone().setY(v.position.y + 0.6), 10, 0.5, undefined, 3); }
      if (v.position.x < WORLD.shoreX && Math.abs(v.speed) > 2) this.particles.emit('splash', v.position.clone().setY(0.2), 6, 1.2, new THREE.Vector3(0, 3, 0), 2);
    }
    // stadium flares (flames + smoke) when nearby
    const sd = Math.hypot(p.x - STADIUM.x, p.z - STADIUM.z);
    if (sd < 160 && this.frame % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        const a = (Math.random() - 0.5) * 1.8, rr = 0.75 + Math.random() * 0.25;
        const at = new THREE.Vector3(STADIUM.x + Math.cos(a) * STADIUM.rx * rr, 4 + rr * 6, STADIUM.z + Math.sin(a) * STADIUM.rz * rr);
        this.particles.emit('flame', at, 1, 0.3, new THREE.Vector3(0, 1.5, 0), 0.5);
        if (Math.random() < 0.3) this.particles.emit('smoke', at.clone().setY(at.y + 1), 1, 0.4, new THREE.Vector3(0.5, 1.5, 0), 0.6);
      }
    }
    // rain around the camera
    if (this.weather === 'rain') {
      const c = g.camera.position;
      for (let k = 0; k < 70; k++) this.particles.emit('rain', new THREE.Vector3(c.x + (Math.random() - 0.5) * 50, c.y + 14 + Math.random() * 6, c.z + (Math.random() - 0.5) * 50), 1, 0, new THREE.Vector3(1.5, -12, 0.5), 0.2);
    }
    this.particles.update(dt);

    // motion blur from camera rotation + forward speed
    g.camera.getWorldDirection(this.camDir);
    const yaw = Math.atan2(this.camDir.x, this.camDir.z), pitch = Math.asin(THREE.MathUtils.clamp(this.camDir.y, -1, 1));
    let dyaw = yaw - this.lastYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    const speed = v ? Math.abs(v.speed) : 0;
    const blur = new THREE.Vector2(THREE.MathUtils.clamp(-dyaw * 0.35, -0.02, 0.02), THREE.MathUtils.clamp(dpitch * 0.35, -0.02, 0.02));
    if (g.cinematic) blur.multiplyScalar(0.3);
    const zoom = THREE.MathUtils.clamp((speed - 14) * 0.0016, 0, 0.05);
    // heat haze: hamsin, or hot afternoons in Jerusalem / over the Ayalon asphalt
    const zone = zoneAt(p.x, p.z);
    const hot = THREE.MathUtils.clamp(1 - Math.abs(g.dayNight.hour - 14) / 4, 0, 1) * (zone === 'jerusalem' || zone === 'ayalon' || zone === 'route1' ? 0.6 : 0);
    g.post.setCameraFX(blur.set(0, 0), 0 * zoom, this.weather === 'hamsin' ? 0.6 + hot * 0.4 : 0, performance.now() / 1000);

    // shadow map throttling: refresh when the player moved, plus a steady cadence
    const q = g.quality;
    const moved = this.lastShadowPos.distanceToSquared(p) > 1;
    const cadence = q === 'high' ? 1 : q === 'medium' ? 2 : 3;
    if (moved || this.frame % cadence === 0) { g.renderer.shadowMap.needsUpdate = true; this.lastShadowPos.copy(p); }
    g.traffic.viewer.copy(g.camera.position);
  }
}
