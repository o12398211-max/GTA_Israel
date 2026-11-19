import * as THREE from 'three';
import { WORLD } from './Terrain';
import { worldUniforms } from './Materials';

/**
 * Mediterranean: animated Gerstner-ish waves in the vertex shader on a
 * standard PBR material (so it picks up sky reflections and fog), plus
 * shoreline foam.
 */
export function buildSea(): THREE.Mesh {
  const width = 900, depth = 1400;
  const geo = new THREE.PlaneGeometry(width, depth, 180, 280);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WORLD.shoreX + 8 - width / 2, 0, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f7f9a, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uShore = { value: WORLD.shoreX };
    const waves = `
      uniform float uTime; uniform float uShore;
      varying vec3 vSeaPos;
      vec3 wave(vec2 p, vec2 dir, float amp, float len, float spd, inout vec3 tangent, inout vec3 binormal) {
        float k = 6.2831 / len; float c = sqrt(9.8 / k) * spd;
        vec2 d = normalize(dir); float f = k * (dot(d, p) - c * uTime);
        float a = amp;
        tangent += vec3(-d.x * d.x * (a * k * sin(f) * 0.5), d.x * (a * k * cos(f)), -d.x * d.y * (a * k * sin(f) * 0.5));
        binormal += vec3(-d.x * d.y * (a * k * sin(f) * 0.5), d.y * (a * k * cos(f)), -d.y * d.y * (a * k * sin(f) * 0.5));
        return vec3(d.x * a * cos(f) * 0.5, a * sin(f), d.y * a * cos(f) * 0.5);
      }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${waves}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vec3 tng = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
        float shoreFade = clamp((uShore - position.x) / 40.0, 0.15, 1.0);
        vec2 p = position.xz;
        transformed += wave(p, vec2(1.0, 0.3), 0.45 * shoreFade, 38.0, 1.0, tng, bin);
        transformed += wave(p, vec2(0.8, -0.6), 0.25 * shoreFade, 19.0, 1.1, tng, bin);
        transformed += wave(p, vec2(0.3, 1.0), 0.12, 9.0, 1.2, tng, bin);
        vSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 tng0 = vec3(1.0, 0.0, 0.0), bin0 = vec3(0.0, 0.0, 1.0);
        float sf0 = clamp((uShore - position.x) / 40.0, 0.15, 1.0);
        wave(position.xz, vec2(1.0, 0.3), 0.45 * sf0, 38.0, 1.0, tng0, bin0);
        wave(position.xz, vec2(0.8, -0.6), 0.25 * sf0, 19.0, 1.1, tng0, bin0);
        wave(position.xz, vec2(0.3, 1.0), 0.12, 9.0, 1.2, tng0, bin0);
        vec3 objectNormal = normalize(cross(bin0, tng0));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uShore; uniform float uNight; varying vec3 vSeaPos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float distShore = uShore - vSeaPos.x;
        // shallow turquoise near the beach, deep blue further out
        diffuseColor.rgb = mix(vec3(0.25, 0.78, 0.8), vec3(0.05, 0.25, 0.42), smoothstep(0.0, 120.0, distShore));
        float crest = smoothstep(0.35, 0.6, vSeaPos.y);
        float foamBand = (1.0 - smoothstep(0.0, 9.0, distShore)) * (0.55 + 0.45 * sin(distShore * 1.4 - uTime * 2.2 + sin(vSeaPos.z * 0.08) * 3.0));
        float foam = clamp(crest * 0.6 + max(foamBand, 0.0), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), foam);
        diffuseColor.rgb *= mix(1.0, 0.35, uNight);
        diffuseColor.a = mix(0.95, 0.6, 1.0 - smoothstep(0.0, 6.0, distShore));`);
  };
  mat.customProgramCacheKey = () => 'sea';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'sea';
  return mesh;
}
