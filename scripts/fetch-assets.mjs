#!/usr/bin/env node
/**
 * Downloads the CC0 assets used by the game from Poly Haven (https://polyhaven.com, CC0 1.0)
 * into public/assets. The files are committed to the repo, so this only needs to run
 * when adding/upgrading assets:   node scripts/fetch-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OUT = new URL('../public/assets/', import.meta.url).pathname;
const RES = '1k';

export const TEXTURES = {
  plaster: 'white_plaster_rough_01',      // Bauhaus walls
  jstone: 'white_sandstone_blocks_02',    // Jerusalem stone
  asphalt: 'asphalt_02',
  pavers: 'concrete_pavers_02',           // sidewalks
  sand: 'coast_sand_01',
  rock: 'rocky_terrain_02',               // Judean hills
  slabs: 'seaworn_stone_tiles',           // old-city alleys / shuk floor
};
export const MODELS = {
  chair: 'plastic_monobloc_chair_01',     // the white plastic chair
  lamp: 'street_lamp_01',
  bin: 'metal_trash_can',
};

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); }
  }
}
async function save(path, buf) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, buf); }

const credits = ['# Asset credits', '', 'All assets below are CC0 1.0 (public domain) from [Poly Haven](https://polyhaven.com).', ''];

for (const [key, id] of Object.entries(TEXTURES)) {
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
  for (const [map, name] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['arm', 'arm']]) {
    const url = files[map]?.[RES]?.jpg?.url;
    if (!url) continue;
    await save(join(OUT, 'textures', key, `${name}.jpg`), await get(url));
  }
  credits.push(`- textures/${key}: [${id}](https://polyhaven.com/a/${id})`);
  console.log('texture', key, id);
}
for (const [key, id] of Object.entries(MODELS)) {
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
  const g = files.gltf[RES].gltf;
  const dir = join(OUT, 'models', key);
  await save(join(dir, `${key}.gltf`), await get(g.url));
  for (const [rel, f] of Object.entries(g.include ?? {})) await save(join(dir, rel), await get(f.url));
  credits.push(`- models/${key}: [${id}](https://polyhaven.com/a/${id})`);
  console.log('model', key, id);
}
await save(join(OUT, 'CREDITS.md'), Buffer.from(credits.join('\n') + '\n'));
