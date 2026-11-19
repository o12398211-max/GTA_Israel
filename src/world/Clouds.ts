import * as THREE from 'three';

/**
 * Procedural cloud dome: domain-warped FBM in sky-direction space, lit by the
 * sun direction/color, with silver lining near the sun and sunset tinting.
 */
export class Clouds {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
      uniforms: {
        uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.8, 0.6) }, uSky: { value: new THREE.Color(0.5, 0.6, 0.8) },
        uCover: { value: 0.48 }, uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w * 0.99999; // render at far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky; uniform float uCover; uniform float uNight;
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          if (d.y < 0.0) discard;
          // project onto a cloud plane
          vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          vec2 warp = vec2(fbm(uv * 0.7), fbm(uv * 0.7 + 5.2));
          float dens = fbm(uv + warp * 0.8);
          float c = smoothstep(uCover, uCover + 0.25, dens);
          // streaky cirrus on top
          float cirrus = smoothstep(0.55, 0.85, fbm(vec2(uv.x * 0.4, uv.y * 2.0) + 3.0)) * 0.35;
          c = max(c, cirrus);
          // self-shadow: sample toward sun
          vec2 sunUv = uSunDir.xz / (abs(uSunDir.y) + 0.12) * 0.04;
          float dens2 = fbm(uv + warp * 0.8 + sunUv);
          float shade = clamp(1.0 - (dens2 - dens) * 4.0, 0.25, 1.2);
          float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
          vec3 lit = uSunColor * (0.75 + 0.6 * pow(sunAmt, 6.0)) * shade;
          vec3 dark = mix(uSky * 0.65, vec3(0.32, 0.25, 0.42), 0.4);
          vec3 col = mix(dark, lit, clamp(shade * 0.85, 0.0, 1.0));
          col = mix(col, vec3(0.08, 0.08, 0.14), uNight * 0.85);
          float fade = smoothstep(0.0, 0.18, d.y);
          gl_FragColor = vec4(col, c * fade * 0.92);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clouds';
  }

  update(t: number, sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, night: number, focus: THREE.Vector3) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uSky.value.copy(sky);
    u.uNight.value = night;
    this.mesh.position.copy(focus);
  }
}
