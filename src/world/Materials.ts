import * as THREE from 'three';

/** Shared uniforms driven by the day/night cycle. */
export const worldUniforms = {
  uNight: { value: 0 }, // 0 day .. 1 night
  uTime: { value: 0 },
};

export interface FacadeStyle {
  /** horizontal window spacing (m) */ spacingX: number;
  /** floor height (m) */ floorH: number;
  /** window width fraction 0..1 */ winW: number;
  /** window height fraction 0..1 */ winH: number;
  /** balcony stripe strength (Bauhaus) */ stripe: number;
  /** glass color */ glass: THREE.Color;
  /** night light color */ lightColor: THREE.Color;
  /** fraction of lit windows at night */ litChance: number;
  /** glass curtain-wall look (towers) */ curtain?: boolean;
  /** arched windows (Jerusalem stone) */ arch?: boolean;
  /** stone block texture */ stone?: boolean;
}

/**
 * MeshStandardMaterial + procedural facade (windows, floors, stone blocks) computed
 * from world position, so a single unit-box InstancedMesh can render every building
 * without UV stretching. Night lights are emissive and react to `uNight`.
 */
export function createFacadeMaterial(style: FacadeStyle, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0, ...params });
  const defines: string[] = [];
  if (style.curtain) defines.push('#define CURTAIN');
  if (style.arch) defines.push('#define ARCH');
  if (style.stone) defines.push('#define STONE');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uSpacing = { value: style.spacingX };
    shader.uniforms.uFloorH = { value: style.floorH };
    shader.uniforms.uWin = { value: new THREE.Vector2(style.winW, style.winH) };
    shader.uniforms.uStripe = { value: style.stripe };
    shader.uniforms.uGlass = { value: style.glass };
    shader.uniforms.uLight = { value: style.lightColor };
    shader.uniforms.uLit = { value: style.litChance };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFWPos; varying vec3 vFWN; varying vec3 vFLocal; varying float vFAbove;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        vec3 fwn = objectNormal;
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
          fwn = mat3(instanceMatrix) * fwn;
        #endif
        fwp = modelMatrix * fwp;
        vFWPos = fwp.xyz;
        vFWN = normalize(mat3(modelMatrix) * fwn);
        vFLocal = transformed;
        float fsy = 1.0;
        #ifdef USE_INSTANCING
          fsy = length(instanceMatrix[1].xyz);
        #endif
        vFAbove = transformed.y * fsy;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${defines.join('\n')}
        varying vec3 vFWPos; varying vec3 vFWN; varying vec3 vFLocal; varying float vFAbove;
        uniform float uNight; uniform float uSpacing; uniform float uFloorH; uniform vec2 uWin;
        uniform float uStripe; uniform vec3 uGlass; uniform vec3 uLight; uniform float uLit;
        float fHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float fWin; float fCellRand; float fFrame;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        fWin = 0.0; fCellRand = 0.0; fFrame = 0.0;
        vec3 fn = normalize(vFWN);
        if (abs(fn.y) < 0.5) {
          vec2 tdir = normalize(vec2(-fn.z, fn.x));
          float u = dot(vFWPos.xz, tdir);
          float v = vFAbove;
          // local height from box bottom (unit box spans y 0..1 in object space)
          float hLocal = vFLocal.y;
          vec2 cell = vec2(floor(u / uSpacing), floor(v / uFloorH));
          vec2 f = vec2(fract(u / uSpacing), fract(v / uFloorH));
          fCellRand = fHash(cell + floor(vFWPos.xz * 0.01) * 17.0);
          float wx = step(0.5 - uWin.x * 0.5, f.x) * step(f.x, 0.5 + uWin.x * 0.5);
          float wy = step(0.18, f.y) * step(f.y, 0.18 + uWin.y);
          #ifdef ARCH
            // rounded top
            vec2 ac = vec2((f.x - 0.5) / (uWin.x * 0.5), (f.y - (0.18 + uWin.y * 0.7)) / (uWin.y * 0.3));
            if (f.y > 0.18 + uWin.y * 0.7) wy *= step(length(ac), 1.0);
          #endif
          fWin = wx * wy * step(0.02, hLocal) * step(hLocal, 0.985);
          // ground floor: shopfronts with wider glass
          if (v < uFloorH) fWin = step(0.08, f.x) * step(f.x, 0.92) * step(0.08, f.y) * step(f.y, 0.75);
          #ifdef CURTAIN
            fWin = step(0.04, f.x) * step(0.06, f.y) * step(hLocal, 0.99);
          #endif
          // Bauhaus balcony stripes
          float stripe = (1.0 - step(0.1, f.y)) * uStripe;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, stripe);
          diffuseColor.rgb *= 1.0 - (1.0 - step(0.02, abs(f.y - 0.1))) * 0.25 * uStripe;
          #ifdef STONE
            vec2 sb = vec2(u * 1.6 + floor(v * 2.5) * 0.5, v * 2.5);
            vec2 sf = fract(sb);
            float mortar = (1.0 - step(0.04, sf.y)) + (1.0 - step(0.025, sf.x));
            float tone = fHash(floor(sb));
            diffuseColor.rgb *= (0.9 + tone * 0.18) * (1.0 - clamp(mortar, 0.0, 1.0) * 0.18);
          #endif
          vec3 glass = uGlass * (0.75 + fCellRand * 0.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, fWin);
        } else {
          // roofs: slightly darker, dusty
          diffuseColor.rgb *= 0.88;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, fWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.6, fWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lit = step(1.0 - uLit, fCellRand) * fWin * uNight;
        vec3 warm = uLight * (0.7 + 0.6 * fHash(vec2(fCellRand, 3.1)));
        totalEmissiveRadiance += warm * lit * 0.45;`);
  };
  mat.customProgramCacheKey = () => `facade-${defines.join('|')}`;
  return mat;
}

export const FACADES = {
  bauhaus: {
    spacingX: 3.4, floorH: 3.2, winW: 0.55, winH: 0.5, stripe: 1, litChance: 0.32,
    glass: new THREE.Color(0.16, 0.22, 0.3), lightColor: new THREE.Color(1.0, 0.78, 0.48),
  } satisfies FacadeStyle,
  tower: {
    spacingX: 2.2, floorH: 3.6, winW: 0.9, winH: 0.8, stripe: 0, litChance: 0.28, curtain: true,
    glass: new THREE.Color(0.25, 0.38, 0.52), lightColor: new THREE.Color(0.85, 0.9, 1.0),
  } satisfies FacadeStyle,
  stone: {
    spacingX: 4.2, floorH: 3.6, winW: 0.3, winH: 0.52, stripe: 0, litChance: 0.35, arch: true, stone: true,
    glass: new THREE.Color(0.12, 0.1, 0.09), lightColor: new THREE.Color(1.0, 0.7, 0.35),
  } satisfies FacadeStyle,
};

/** Small canvas texture helper (signs, lane markings…). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
