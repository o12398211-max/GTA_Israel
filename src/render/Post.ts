import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, Effect, BlendFunction, EffectAttribute,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** Exposure (before tone mapping) – driven by the day/night cycle. */
class ExposureEffect extends Effect {
  constructor() {
    super('Exposure', /* glsl */ `
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`, { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }
  set exposure(v: number) { this.uniforms.get('exposure')!.value = v; }
}

/**
 * "Vice-sunset" color grade: split toning (violet shadows, peach-pink highlights),
 * gentle S-curve and saturation. Strength follows golden hour / night.
 */
class GradeEffect extends Effect {
  constructor() {
    super('Grade', /* glsl */ `
      uniform float strength; uniform float night;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadowTint = mix(vec3(0.42, 0.25, 0.62), vec3(0.2, 0.22, 0.55), night);
        vec3 highTint = vec3(1.0, 0.7, 0.62);
        vec3 split = mix(shadowTint, highTint, smoothstep(0.05, 0.75, l));
        c = mix(c, c * split * 1.6, 0.13 * strength);
        // S-curve
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
        // saturation
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l2), c, 1.12 + 0.1 * strength);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, { uniforms: new Map([['strength', new THREE.Uniform(1)], ['night', new THREE.Uniform(0)]]) });
  }
  set strength(v: number) { this.uniforms.get('strength')!.value = v; }
  set night(v: number) { this.uniforms.get('night')!.value = v; }
}

/**
 * Heat haze (shimmer near the horizon on hot afternoons in Jerusalem / on the
 * Ayalon asphalt). No motion blur – the image stays sharp while the camera moves.
 */
class CameraFXEffect extends Effect {
  constructor() {
    super('CameraFX', /* glsl */ `
      uniform vec2 blurDir; uniform float zoom; uniform float haze; uniform float time;
      float hn(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 q = uv;
        // heat haze: stronger below the horizon line, animated
        if (haze > 0.001) {
          float band = smoothstep(0.65, 0.35, uv.y) * smoothstep(0.0, 0.25, uv.y);
          q.x += sin(uv.y * 160.0 + time * 6.0) * 0.0012 * haze * band;
          q.y += cos(uv.x * 120.0 + time * 4.0) * 0.0008 * haze * band;
        }
        vec4 c = texture2D(inputBuffer, q);
        outputColor = c;
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['blurDir', new THREE.Uniform(new THREE.Vector2())], ['zoom', new THREE.Uniform(0)], ['haze', new THREE.Uniform(0)], ['time', new THREE.Uniform(0)]]),
    });
  }
}

export class PostFX {
  readonly composer: EffectComposer;
  private exposure = new ExposureEffect();
  private grade = new GradeEffect();
  private ao: N8AOPostPass;
  readonly bloom: BloomEffect;
  private camfx = new CameraFXEffect();
  motionBlur = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: 'low' | 'high' = 'high') {
    renderer.toneMapping = THREE.NoToneMapping;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    const size = renderer.getSize(new THREE.Vector2());
    this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
    this.ao.configuration.aoRadius = 2.5;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.intensity = 2.2;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.gammaCorrection = false;
    this.ao.setQualityMode('Medium');
    if (quality === 'high') this.composer.addPass(this.ao);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, intensity: 0.5, radius: 0.6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55, blendFunction: BlendFunction.NORMAL });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.exposure, tone, this.grade, vignette));
    this.composer.addPass(new EffectPass(camera, this.camfx));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
    this.motionBlur = quality !== 'low';
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); }

  /** blur: screen-space blur vector + radial zoom amount; haze 0..1 */
  setCameraFX(blur: THREE.Vector2, zoom: number, haze: number, time: number) {
    const u = this.camfx.uniforms;
    (u.get('blurDir')!.value as THREE.Vector2).copy(this.motionBlur ? blur : new THREE.Vector2());
    u.get('zoom')!.value = this.motionBlur ? zoom : 0;
    u.get('haze')!.value = haze;
    u.get('time')!.value = time;
  }

  update(exposure: number, golden: number, night: number) {
    this.exposure.exposure = exposure;
    this.grade.strength = 0.5 + golden * 0.8 + night * 0.4;
    this.grade.night = night;
    this.bloom.intensity = 0.35 + night * 0.7;
  }

  render(dt: number) { this.composer.render(dt); }
  get renderInfo() { return this.renderer.info; }
}
