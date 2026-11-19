import * as THREE from 'three';
import { tex } from '../render/Textures';
import { PBR_GLSL } from './Materials';

/**
 * World layout (meters). +x = east, -z = north.
 *   Sea        x < -330
 *   Beach      -330 .. -200   (טיילת וחוף)
 *   City/Shuk  -200 ..   70   (שוק ודוכני אוכל, בניינים לבנים)
 *   Ayalon       70 ..  220   (נתיבי איילון + מגדלים)
 *   Route 1     220 ..  460   (העלייה לירושלים)
 *   Jerusalem   460 ..  720   (העיר העתיקה, אבן ירושלמית)
 */
export { WORLD, terrainHeight } from '../../shared/terrain';
import { WORLD, terrainHeight, hash2 } from '../../shared/terrain';

export type ZoneId = 'sea' | 'beach' | 'market' | 'city' | 'ayalon' | 'route1' | 'jerusalem';

export interface ZoneInfo { id: ZoneId; en: string; he: string }

export const ZONES: Record<ZoneId, ZoneInfo> = {
  sea: { id: 'sea', en: 'Mediterranean', he: 'הים התיכון – המציל כבר צועק' },
  beach: { id: 'beach', en: 'Gordon Beach Promenade', he: 'הטיילת והחוף' },
  market: { id: 'market', en: 'The Shuk', he: 'השוק – "רק בשבילך, מותק!"' },
  city: { id: 'city', en: 'White City', he: 'העיר הלבנה' },
  ayalon: { id: 'ayalon', en: 'Ayalon Highway', he: 'נתיבי איילון – פקק קבוע' },
  route1: { id: 'route1', en: 'Route 1', he: 'כביש 1 – העלייה לירושלים' },
  jerusalem: { id: 'jerusalem', en: 'Old Jerusalem', he: 'ירושלים העתיקה' },
};

export function zoneAt(x: number, z: number): ZoneId {
  if (x < WORLD.shoreX - 3) return 'sea';
  if (x < -200) return 'beach';
  if (x < 70) return (x > -160 && x < -30 && Math.abs(z) < 40) ? 'market' : 'city';
  if (x < 220) return 'ayalon';
  if (x < 460) return 'route1';
  return 'jerusalem';
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Splat weights (sand, pavers, dry-earth/rock, stone slabs) per position. */
export function groundSplat(x: number, z: number, out: number[]): number[] {
  const sm = (a: number, b: number, v: number) => smooth(a, b, v);
  const sand = 1 - sm(-216, -211, x);
  const city = sm(-216, -211, x) * (1 - sm(74, 79, x));
  const towers = sm(133, 137, x) * (1 - sm(214, 222, x)) * (1 - sm(16, 22, Math.abs(z)) * 0);
  const inWalls = sm(516, 522, x) * (1 - sm(658, 664, x)) * (1 - sm(66, 72, Math.abs(z)));
  const gateRoad = sm(456, 462, x) * (1 - sm(658, 664, x)) * (1 - sm(5, 8, Math.abs(z)));
  const slabs = Math.max(inWalls, gateRoad);
  const pav = Math.max(city, towers) * (1 - slabs);
  const rock = Math.max(0, 1 - sand - pav - slabs);
  out[0] = sand; out[1] = pav; out[2] = rock; out[3] = slabs;
  return out;
}

/** Subtle per-vertex tint (wet sand, dusty Jerusalem, greener hills). */
export function groundColor(x: number, z: number, out: THREE.Color): THREE.Color {
  const n = hash2(Math.floor(x * 0.25), Math.floor(z * 0.25)) * 0.05;
  const wet = 1 - smooth(WORLD.shoreX, WORLD.shoreX + 12, x);
  if (x < -211) return out.setRGB(1 - wet * 0.35 + n, 0.97 - wet * 0.35 + n, 0.92 - wet * 0.32 + n, THREE.SRGBColorSpace);
  return out.setRGB(0.97 + n, 0.97 + n, 0.97 + n, THREE.SRGBColorSpace);
}

export function buildTerrainMesh(): THREE.Mesh {
  const w = WORLD.maxX - WORLD.minX + 200;
  const d = WORLD.maxZ - WORLD.minZ + 200;
  const seg = 4; // meters per cell
  const geo = new THREE.PlaneGeometry(w, d, Math.round(w / seg), Math.round(d / seg));
  geo.rotateX(-Math.PI / 2);
  geo.translate((WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.minZ + WORLD.maxZ) / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  const sp = [0, 0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    groundColor(x, z, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    groundSplat(x, z, sp);
    splat.set(sp, i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, createTerrainMaterial());
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** 4-layer splat terrain with CC0 PBR textures sampled in world space. */
function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const L = [tex('sand'), tex('pavers'), tex('rock'), tex('slabs')];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  mat.onBeforeCompile = (shader) => {
    L.forEach((t, i) => {
      shader.uniforms[`uD${i}`] = { value: t.diff };
      shader.uniforms[`uN${i}`] = { value: t.nor };
      shader.uniforms[`uA${i}`] = { value: t.arm };
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat; varying vec4 vSplat; varying vec3 vTWPos; varying vec3 vTWN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSplat = splat; vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${PBR_GLSL}
        varying vec4 vSplat; varying vec3 vTWPos; varying vec3 vTWN;
        uniform sampler2D uD0, uD1, uD2, uD3, uN0, uN1, uN2, uN3, uA0, uA1, uA2, uA3;
        vec3 tN; float tR;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vTWPos.xz;
          vec4 w = vSplat;
          // break up layer borders with noise
          float nz = vnoise(p * 0.15) - 0.5;
          w = max(w + vec4(nz, -nz, nz * 0.6, -nz * 0.6) * 0.35 * (1.0 - step(0.98, max(max(w.x, w.y), max(w.z, w.w)))), 0.0);
          w /= max(1e-3, w.x + w.y + w.z + w.w);
          vec2 u0 = p / 4.0, u1 = p / 2.4, u2 = p / 6.0, u3 = p / 4.5;
          vec3 c0 = untile(uD0, u0).rgb;
          c0 = vec3(1.0, 0.84, 0.58) * clamp(lum(c0) / 0.33, 0.75, 1.3);
          vec3 c1 = texture(uD1, u1).rgb;
          // sidewalks: neutral grey Tel Aviv pavers from the (brown) paver texture
          c1 = vec3(lum(c1)) * vec3(1.02, 1.0, 0.97) * 1.25;
          vec3 c2 = untile(uD2, u2).rgb;
          // Judean hills: dry, sun-bleached – reuse sand grain + rock luminance
          vec3 dry = vec3(0.62, 0.53, 0.38) * clamp(lum(c2) / 0.32, 0.6, 1.4);
          vec3 grass = c2 * vec3(1.05, 0.95, 0.7);
          c2 = mix(dry, grass, smoothstep(0.55, 0.8, vnoise(p * 0.03)) * 0.5);
          vec3 c3 = texture(uD3, u3).rgb;
          c3 = mix(vec3(lum(c3)), c3, 0.5) * vec3(1.45, 1.32, 1.12);
          vec3 albedo = c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w;
          // big-scale variation
          albedo *= 0.88 + 0.24 * vnoise(p * 0.02);
          diffuseColor.rgb *= albedo;
          vec3 n0 = texture(uN0, u0).xyz, n1 = texture(uN1, u1).xyz, n2 = texture(uN2, u2).xyz, n3 = texture(uN3, u3).xyz;
          vec3 nn = (n0 * w.x + n1 * w.y + n2 * w.z + n3 * w.w) * 2.0 - 1.0;
          nn.xy *= 0.6;
          vec3 a = texture(uA0, u0).rgb * w.x + texture(uA1, u1).rgb * w.y + texture(uA2, u2).rgb * w.z + texture(uA3, u3).rgb * w.w;
          diffuseColor.rgb *= mix(1.0, a.r, 0.35);
          tR = a.g;
          vec3 N = normalize(vTWN);
          vec3 T = normalize(cross(vec3(0.0, 0.0, -1.0), N));
          vec3 B = cross(T, N);
          tN = normalize(T * nn.x + B * nn.y + N * nn.z);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.7, 1.0, tR);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat';
  return mat;
}
