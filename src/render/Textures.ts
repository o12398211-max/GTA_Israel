import * as THREE from 'three';

export type TexKey = 'plaster' | 'jstone' | 'asphalt' | 'pavers' | 'sand' | 'rock' | 'slabs';
export interface PBRSet { diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture }

const BASE = `${import.meta.env.BASE_URL}assets/textures/`;
const loader = new THREE.TextureLoader();
const cache = new Map<TexKey, PBRSet>();
let maxAniso = 8;

export function setMaxAnisotropy(a: number) { maxAniso = a; }

function load(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(t);
    }, undefined, reject);
  });
}

/** Load all CC0 PBR sets used by the world (call once during loading). */
export async function loadTextures(keys: TexKey[], onProgress?: (p: number) => void): Promise<void> {
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const [diff, nor, arm] = await Promise.all([
      load(`${BASE}${k}/diff.jpg`, true), load(`${BASE}${k}/nor.jpg`, false), load(`${BASE}${k}/arm.jpg`, false),
    ]);
    cache.set(k, { diff, nor, arm });
    onProgress?.(++done / keys.length);
  }));
}

export function tex(k: TexKey): PBRSet {
  const t = cache.get(k);
  if (!t) throw new Error(`texture not loaded: ${k}`);
  return t;
}
