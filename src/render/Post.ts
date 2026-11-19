import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, Effect, BlendFunction,
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

export class PostFX {
  readonly composer: EffectComposer;
  private exposure = new ExposureEffect();
  private grade = new GradeEffect();
  private ao: N8AOPostPass;
  readonly bloom: BloomEffect;

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
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.75 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55, blendFunction: BlendFunction.NORMAL });
    this.composer.addPass(new EffectPass(camera, this.bloom, this.exposure, tone, this.grade, vignette));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); }

  update(exposure: number, golden: number, night: number) {
    this.exposure.exposure = exposure;
    this.grade.strength = 0.5 + golden * 0.8 + night * 0.4;
    this.grade.night = night;
    this.bloom.intensity = 0.6 + night * 0.9;
  }

  render(dt: number) { this.composer.render(dt); }
  get renderInfo() { return this.renderer.info; }
}
