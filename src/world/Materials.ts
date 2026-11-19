import * as THREE from 'three';
import { tex, type TexKey } from '../render/Textures';

/** Shared uniforms driven by the day/night cycle. */
export const worldUniforms = {
  uNight: { value: 0 }, // 0 day .. 1 night
  uTime: { value: 0 },
};

export interface FacadeStyle {
  wall: TexKey;
  /** meters per texture tile */ texScale: number;
  /** use texture luminance only, color comes from instance tint */ detail: boolean;
  detailAvg?: number;
  spacingX: number; floorH: number;
  winW: number; winH: number; sill: number;
  /** window recess depth (m) */ recess: number;
  litChance: number;
  shutters: THREE.Color[];
  shutterChance: number;
  kind: 'bauhaus' | 'tower' | 'stone';
  shops?: boolean;
  round?: boolean;
  /** plain wall, no windows (city walls) */ noWindows?: boolean;
  /** regular pattern (bricks): don't mix scales */ structured?: boolean;
}

/** GLSL shared by world-space PBR materials. */
export const PBR_GLSL = /* glsl */ `
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
    return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
  float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
  // sample a tiling texture twice at different scales/rotations to hide repetition
  vec4 untile(sampler2D t, vec2 uv){
    vec4 a = texture(t, uv);
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + 0.31;
    vec4 b = texture(t, uv2);
    float m = smoothstep(0.35, 0.65, vnoise(uv * 0.35));
    return mix(a, b, m * 0.5);
  }
`;

/**
 * Building facade material. A unit-box InstancedMesh per style renders every
 * building; windows are computed per-pixel:
 *  - real CC0 PBR wall texture (plaster / Jerusalem stone) in facade space
 *  - recessed windows with parallax reveal, sills, frames
 *  - interior mapping (fake 3D rooms behind the glass) – lit randomly at night
 *  - Israeli roller shutters ("תריסים") at random heights
 *  - ground-floor shop fronts with sign bands
 *  - grime near the ground and streaks under windows
 */
export function createFacadeMaterial(style: FacadeStyle): THREE.MeshStandardMaterial {
  const t = tex(style.wall);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const defines: Record<string, string> = {};
  defines[`KIND_${style.kind.toUpperCase()}`] = '';
  if (style.detail) defines.DETAIL = '';
  if (style.shops) defines.SHOPS = '';
  if (style.round) defines.ROUND = '';
  if (style.noWindows) defines.NOWIN = '';
  if (style.structured) defines.STRUCTURED = '';
  mat.defines = { ...(mat.defines ?? {}), ...defines };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNight: worldUniforms.uNight,
      uDiff: { value: t.diff }, uNor: { value: t.nor }, uArm: { value: t.arm },
      uTexScale: { value: style.texScale }, uDetailAvg: { value: style.detailAvg ?? 0.45 },
      uCell: { value: new THREE.Vector2(style.spacingX, style.floorH) },
      uWin: { value: new THREE.Vector3(style.winW, style.winH, style.sill) },
      uRecess: { value: style.recess },
      uLit: { value: style.litChance },
      uShutterChance: { value: style.shutterChance },
      uShutterA: { value: style.shutters[0] }, uShutterB: { value: style.shutters[1] ?? style.shutters[0] },
    });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFWPos; varying vec3 vFWN; varying vec3 vFT;
        varying vec2 vFFace; varying float vFAbove; varying float vFHeight; flat varying float vFSeed;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 fIM = mat4(1.0);
        #ifdef USE_INSTANCING
          fIM = instanceMatrix;
        #endif
        vec3 fsc = vec3(length(fIM[0].xyz), length(fIM[1].xyz), length(fIM[2].xyz));
        vec4 fwp = modelMatrix * fIM * vec4(transformed, 1.0);
        vFWPos = fwp.xyz;
        vFWN = normalize(mat3(modelMatrix) * mat3(fIM) * objectNormal);
        #ifdef ROUND
          float ang = atan(transformed.z, transformed.x);
          vFFace = vec2((ang + 3.14159265) * 0.5 * fsc.x, 6.2831853 * 0.5 * fsc.x);
          vFT = normalize(mat3(modelMatrix) * mat3(fIM) * vec3(-sin(ang), 0.0, cos(ang)));
        #else
          bool fx = abs(objectNormal.x) > 0.5;
          vec3 lt = fx ? vec3(0.0, 0.0, -sign(objectNormal.x)) : vec3(sign(objectNormal.z), 0.0, 0.0);
          float along = fx ? dot(transformed, lt) * fsc.z : dot(transformed, lt) * fsc.x;
          float width = fx ? fsc.z : fsc.x;
          vFFace = vec2(along + width * 0.5, width);
          vFT = normalize(mat3(modelMatrix) * mat3(fIM) * lt);
        #endif
        vFAbove = transformed.y * fsc.y;
        vFHeight = fsc.y;
        vFSeed = fract(sin(dot(fIM[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${PBR_GLSL}
        varying vec3 vFWPos; varying vec3 vFWN; varying vec3 vFT;
        varying vec2 vFFace; varying float vFAbove; varying float vFHeight; flat varying float vFSeed;
        uniform float uNight; uniform sampler2D uDiff; uniform sampler2D uNor; uniform sampler2D uArm;
        uniform float uTexScale; uniform float uDetailAvg; uniform vec2 uCell; uniform vec3 uWin;
        uniform float uRecess; uniform float uLit; uniform float uShutterChance; uniform vec3 uShutterA; uniform vec3 uShutterB;
        vec3 gAlbedo; float gRough; float gMetal; vec3 gNormalW; vec3 gEmit;

        // fake room behind glass. o: entry point in cell space (m), rd: ray dir (x along wall, y up, z inward)
        vec3 interior(vec2 o, vec3 rd, vec2 room, float seed, out float lightMask) {
          float D = room.x * 1.3;
          vec3 ard = max(abs(rd), vec3(1e-4));
          float tx = rd.x > 0.0 ? (room.x - o.x) / ard.x : o.x / ard.x;
          float ty = rd.y > 0.0 ? (room.y - o.y) / ard.y : o.y / ard.y;
          float tz = D / ard.z;
          float tt = min(tx, min(ty, tz));
          vec3 hp = vec3(o, 0.0) + rd * tt;
          vec3 wallC = mix(vec3(0.85, 0.8, 0.7), vec3(0.6, 0.7, 0.75), h12(vec2(seed, 1.7)));
          vec3 c;
          if (tt == tz) {
            c = wallC;
            float shelf = step(0.4, hp.x / room.x) * step(hp.x / room.x, 0.75) * step(hp.y, 1.1);
            c = mix(c, vec3(0.35, 0.25, 0.18), shelf * step(0.5, h12(vec2(seed, 4.2))));
            float frame = step(0.2, hp.x / room.x) * step(hp.x / room.x, 0.38) * step(1.4, hp.y) * step(hp.y, 2.0);
            c = mix(c, vec3(0.2, 0.3, 0.5), frame * 0.8);
          } else if (tt == ty) {
            c = rd.y > 0.0 ? vec3(0.92) : vec3(0.42, 0.3, 0.2);
          } else {
            c = wallC * 0.78;
          }
          float depthShade = mix(1.0, 0.55, clamp(hp.z / D, 0.0, 1.0));
          vec2 lamp = vec2(room.x * 0.5, room.y);
          lightMask = depthShade * (0.6 + 0.6 * exp(-length(hp.xy - lamp) * 0.8));
          return c * depthShade;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
        vec3 N = normalize(vFWN);
        bool isWall = abs(N.y) < 0.5;
        vec3 T = isWall ? normalize(vFT) : vec3(1.0, 0.0, 0.0);
        vec3 B = isWall ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        vec2 wm = isWall ? vec2(vFFace.x, vFAbove) : vFWPos.xz;
        vec2 tuv = wm / uTexScale + vFSeed * 7.0;
        #ifdef STRUCTURED
          vec3 td = texture(uDiff, tuv).rgb;
        #else
          vec3 td = untile(uDiff, tuv).rgb;
        #endif
        vec3 tn = texture(uNor, tuv).xyz * 2.0 - 1.0;
        vec3 ta = texture(uArm, tuv).rgb;
        vec3 tint = diffuseColor.rgb;
        #ifdef DETAIL
          vec3 wallC = tint * clamp(lum(td) / uDetailAvg, 0.7, 1.25);
        #else
          vec3 wallC = td * tint;
        #endif
        wallC *= 0.9 + 0.2 * vnoise(wm * vec2(0.15, 0.05) + vFSeed * 13.0);
        if (isWall) wallC *= mix(0.72, 1.0, smoothstep(0.0, 1.4, vFAbove));
        gAlbedo = wallC; gRough = mix(0.75, 1.0, ta.g); gMetal = 0.0;
        gNormalW = normalize(T * tn.x * 0.8 + B * tn.y * 0.8 + N * tn.z);
        gEmit = vec3(0.0);
        if (!isWall) { gAlbedo *= 0.8; }

        #ifndef NOWIN
        if (isWall && vFAbove < vFHeight - 0.7) {
          vec3 V = normalize(cameraPosition - vFWPos);
          vec3 vt = vec3(dot(V, T), dot(V, B), max(dot(V, N), 0.05));
          vec2 cellSz = uCell;
          float n = max(0.0, floor((vFFace.y - 1.2) / cellSz.x));
          float off = (vFFace.y - n * cellSz.x) * 0.5;
          float cx = floor((wm.x - off) / cellSz.x);
          float cy = floor(wm.y / cellSz.y);
          vec2 lc = vec2(wm.x - off - cx * cellSz.x, wm.y - cy * cellSz.y);
          bool validCell = cx >= 0.0 && cx < n;
          float r = h12(vec2(cx, cy) + vFSeed * 91.7);
          float rBld = h12(vec2(vFSeed * 31.0, 2.0));

          vec2 w0 = vec2((cellSz.x - uWin.x) * 0.5, uWin.z);
          vec2 w1 = w0 + uWin.xy;
          float recess = uRecess;
          bool shop = false;
          #ifdef SHOPS
            if (cy < 0.5) { shop = true; w0 = vec2(0.12, 0.08); w1 = vec2(cellSz.x - 0.12, cellSz.y - 0.75); recess = 0.12; }
          #endif
          #ifdef KIND_TOWER
            w0 = vec2(0.05, 0.95); w1 = vec2(cellSz.x - 0.05, cellSz.y - 0.05); recess = 0.06;
          #endif
          #ifdef KIND_BAUHAUS
            if (!shop && rBld > 0.55) { w0.x = 0.15; w1.x = cellSz.x - 0.15; }
          #endif

          vec2 pb = lc - vt.xy / vt.z * recess;
          bool inO = validCell && all(greaterThan(lc, w0)) && all(lessThan(lc, w1));
          bool inI = validCell && all(greaterThan(pb, w0)) && all(lessThan(pb, w1));
          #ifdef KIND_STONE
            float hw = (w1.x - w0.x) * 0.5;
            float archY = w1.y - hw;
            vec2 ac = vec2(lc.x - (w0.x + w1.x) * 0.5, lc.y - archY) / hw;
            if (lc.y > archY && length(ac) > 1.0) inO = false;
            vec2 acb = vec2(pb.x - (w0.x + w1.x) * 0.5, pb.y - archY) / hw;
            if (pb.y > archY && length(acb) > 1.0) inI = false;
          #endif

          if (validCell && !shop && lc.x > w0.x - 0.08 && lc.x < w1.x + 0.08 && lc.y < w0.y && lc.y > w0.y - 0.09) {
            gAlbedo = wallC * 1.18; gNormalW = normalize(N + B * 0.4);
          } else if (validCell && !shop && lc.x > w0.x && lc.x < w1.x && lc.y < w0.y) {
            float s = 1.0 - lc.y / w0.y;
            gAlbedo *= 1.0 - 0.18 * (1.0 - s) * vnoise(vec2(lc.x * 9.0, lc.y * 0.6) + r * 10.0);
          }
          #ifdef SHOPS
            if (cy < 0.5 && lc.y > cellSz.y - 0.7 && lc.y < cellSz.y - 0.12 && validCell) {
              vec3 signC = vec3(h12(vec2(r, 1.0)), h12(vec2(r, 2.0)), h12(vec2(r, 3.0)));
              signC = mix(vec3(0.95, 0.9, 0.8), signC, 0.85);
              gAlbedo = signC; gRough = 0.5; gNormalW = N;
              gEmit = signC * uNight * 0.6 * step(0.4, r);
            }
          #endif
          #ifdef KIND_TOWER
            if (validCell && lc.y < 0.95) { gAlbedo = vec3(0.32, 0.34, 0.37) * (0.9 + 0.1 * lum(td)); gRough = 0.6; gMetal = 0.2; }
          #endif

          if (inO && !inI) {
            gAlbedo = wallC * 0.62;
            vec2 dq = pb - clamp(pb, w0, w1);
            gNormalW = abs(dq.x) > abs(dq.y) ? normalize(T * -sign(dq.x) + N * 0.3) : normalize(B * -sign(dq.y) + N * 0.3);
          } else if (inI) {
            vec2 wl = pb - w0; vec2 wsz = w1 - w0;
            float frameW = 0.05;
            bool frame = wl.x < frameW || wl.y < frameW || wsz.x - wl.x < frameW || wsz.y - wl.y < frameW
                         || (abs(wl.x - wsz.x * 0.5) < frameW * 0.5 && wsz.x > 1.2);
            float shutterFrac = r < uShutterChance ? (r < uShutterChance * 0.25 ? 1.0 : fract(r * 7.13) * 0.75) : 0.0;
            if (shop) shutterFrac = (uNight > 0.5 && r < 0.5) ? 1.0 : 0.0;
            bool shutter = wl.y > wsz.y * (1.0 - shutterFrac);
            gNormalW = N;
            if (frame) {
              gAlbedo = vec3(0.85); gRough = 0.4; gMetal = 0.3;
            } else if (shutter) {
              vec3 sc = mix(uShutterA, uShutterB, step(0.5, rBld));
              float slat = 0.82 + 0.18 * smoothstep(0.3, 0.5, fract(wl.y * 22.0));
              gAlbedo = sc * slat; gRough = 0.55;
              gNormalW = normalize(N + B * (fract(wl.y * 22.0) - 0.5) * 0.8);
            } else {
              vec3 rd = normalize(vec3(-vt.x, -vt.y, vt.z));
              float lm;
              vec3 ic = interior(pb, rd, cellSz, r * 17.0 + vFSeed, lm);
              #ifdef KIND_TOWER
                ic = mix(ic, vec3(0.75, 0.8, 0.85), 0.4);
              #endif
              bool lit = h12(vec2(r, 9.1)) < uLit;
              vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.92, 1.0), step(0.75, h12(vec2(r, 3.3))));
              gEmit = ic * ((shop ? 0.3 : 0.12) * (1.0 - uNight) + (lit ? 1.1 * lm : 0.015) * uNight * warm);
              gAlbedo = vec3(0.04);
              gRough = 0.04; gMetal = 0.85;
              #ifdef KIND_TOWER
                gAlbedo = vec3(0.32, 0.42, 0.5); gMetal = 0.9;
              #endif
              if (!shop && h12(vec2(r, 5.5)) > 0.6 && (wl.x < wsz.x * 0.22 || wl.x > wsz.x * 0.78)) {
                vec3 cc = mix(vec3(0.9, 0.88, 0.8), vec3(0.7, 0.4, 0.35), h12(vec2(r, 6.6)));
                gEmit = cc * (0.08 * (1.0 - uNight) + (lit ? 0.5 : 0.01) * uNight * warm);
                gAlbedo = cc * 0.3; gMetal = 0.0; gRough = 0.9;
              }
            }
          }
        }
        #endif
        diffuseColor.rgb = gAlbedo;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = gRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = gMetal;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(gNormalW, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmit;`);
  };
  mat.customProgramCacheKey = () => `facade-${style.kind}-${style.wall}-${Object.keys(defines).join('|')}`;
  return mat;
}

const C = (h: number) => new THREE.Color(h);
export const FACADES = {
  bauhaus: {
    kind: 'bauhaus', wall: 'plaster', texScale: 2.5, detail: true, detailAvg: 0.42,
    spacingX: 3.4, floorH: 3.2, winW: 1.5, winH: 1.45, sill: 0.85, recess: 0.22,
    litChance: 0.35, shutterChance: 0.65, shutters: [C(0xe8e4da), C(0xb9bec4)], shops: true,
  } satisfies FacadeStyle,
  tower: {
    kind: 'tower', wall: 'pavers', texScale: 3, detail: true, detailAvg: 0.4,
    spacingX: 1.6, floorH: 3.8, winW: 1.5, winH: 2.7, sill: 0.95, recess: 0.06,
    litChance: 0.3, shutterChance: 0, shutters: [C(0xcccccc)],
  } satisfies FacadeStyle,
  towerRound: {
    kind: 'tower', wall: 'pavers', texScale: 3, detail: true, detailAvg: 0.4, round: true,
    spacingX: 1.6, floorH: 3.8, winW: 1.5, winH: 2.7, sill: 0.95, recess: 0.06,
    litChance: 0.3, shutterChance: 0, shutters: [C(0xcccccc)],
  } satisfies FacadeStyle,
  stone: {
    kind: 'stone', wall: 'jstone', texScale: 2.6, detail: false, structured: true,
    spacingX: 3.6, floorH: 3.5, winW: 0.95, winH: 1.7, sill: 0.9, recess: 0.35,
    litChance: 0.4, shutterChance: 0.55, shutters: [C(0x3f6f5a), C(0x41627e)], shops: true,
  } satisfies FacadeStyle,
  stoneWall: {
    kind: 'stone', wall: 'jstone', texScale: 3.4, detail: false, noWindows: true, structured: true,
    spacingX: 3.6, floorH: 3.5, winW: 0.95, winH: 1.7, sill: 0.9, recess: 0.35,
    litChance: 0, shutterChance: 0, shutters: [C(0x3f6f5a)],
  } satisfies FacadeStyle,
};

/** World-space textured material for flat surfaces (roads, paving, walls of props). */
export function createSurfaceMaterial(key: TexKey, opts: { scale: number; detail?: boolean; detailAvg?: number; triplanar?: boolean; normalScale?: number; roughness?: number; color?: THREE.ColorRepresentation; vertexColors?: boolean; structured?: boolean }): THREE.MeshStandardMaterial {
  const t = tex(key);
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 0.9, vertexColors: !!opts.vertexColors });
  const defines: Record<string, string> = {};
  if (opts.detail) defines.DETAIL = '';
  if (opts.triplanar) defines.TRIPLANAR = '';
  if (opts.structured) defines.STRUCTURED = '';
  mat.defines = defines;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uDiff: { value: t.diff }, uNor: { value: t.nor }, uArm: { value: t.arm },
      uScale: { value: opts.scale }, uDetailAvg: { value: opts.detailAvg ?? 0.45 }, uNS: { value: opts.normalScale ?? 1 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSWPos; varying vec3 vSWN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 sIM = mat4(1.0);
        #ifdef USE_INSTANCING
          sIM = instanceMatrix;
        #endif
        vSWPos = (modelMatrix * sIM * vec4(transformed, 1.0)).xyz;
        vSWN = normalize(mat3(modelMatrix) * mat3(sIM) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${PBR_GLSL}
        varying vec3 vSWPos; varying vec3 vSWN;
        uniform sampler2D uDiff; uniform sampler2D uNor; uniform sampler2D uArm; uniform float uScale; uniform float uDetailAvg; uniform float uNS;
        vec3 sN; float sR;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 N = normalize(vSWN);
          vec2 uv; vec3 T, B;
          #ifdef TRIPLANAR
            vec3 an = abs(N);
            if (an.y > an.x && an.y > an.z) { uv = vSWPos.xz; T = vec3(1,0,0); B = vec3(0,0,1); }
            else if (an.x > an.z) { uv = vec2(vSWPos.z, vSWPos.y); T = vec3(0,0,1); B = vec3(0,1,0); }
            else { uv = vec2(vSWPos.x, vSWPos.y); T = vec3(1,0,0); B = vec3(0,1,0); }
          #else
            uv = vSWPos.xz; T = vec3(1,0,0); B = vec3(0,0,1);
          #endif
          uv /= uScale;
          #ifdef STRUCTURED
            vec3 d = texture(uDiff, uv).rgb;
          #else
            vec3 d = untile(uDiff, uv).rgb;
          #endif
          vec3 nn = texture(uNor, uv).xyz * 2.0 - 1.0;
          vec3 a = texture(uArm, uv).rgb;
          #ifdef DETAIL
            diffuseColor.rgb *= clamp(lum(d) / uDetailAvg, 0.6, 1.35);
          #else
            diffuseColor.rgb *= d;
          #endif
          diffuseColor.rgb *= mix(1.0, a.r, 0.6);
          sR = a.g;
          sN = normalize(T * nn.x * uNS + B * nn.y * uNS + N * nn.z);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= mix(0.6, 1.0, sR);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(sN, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => `surface-${key}-${Object.keys(defines).join('')}-${opts.vertexColors ? 'v' : ''}`;
  return mat;
}

/** Small canvas texture helper (signs, lane markings…). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
