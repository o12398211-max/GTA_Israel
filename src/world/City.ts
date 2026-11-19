import * as THREE from 'three';
import { ColliderWorld } from './Colliders';
import { Instancer, MultiInstancer, mulberry32, unitBox, type Rng } from './Builders';
import { createFacadeMaterial, createSurfaceMaterial, FACADES, canvasTexture } from './Materials';
import * as P from './Props';
import { treeKits } from './Foliage';
import { WORLD, terrainHeight, buildTerrainMesh } from './Terrain';
import { ModelInstancer, type ModelParts } from '../render/GltfInstances';

export const CITY = {
  streetsX: [-194, -142, -96, -50, -4, 42],
  streetsZ: [-270, -210, -150, -90, -30, 30, 90, 150, 210, 270],
  streetW: 10,
  marketZ: 0,
  ayalon: { west: 80, east: 130, median: [100, 110] as const },
  route1Z: 0,
  jeru: { minX: 520, maxX: 660, minZ: -70, maxZ: 70, gateZ: 0 },
};

type Step = { label: string; run: () => void };

export interface CityModels { chair: ModelParts; lamp: ModelParts; bin: ModelParts }

export interface CityRuntime {
  group: THREE.Group;
  colliders: ColliderWorld;
  nightMaterials: { mat: THREE.MeshStandardMaterial; max: number }[];
  /** additive light pools under street lamps (opacity follows night) */
  lightPools: THREE.MeshBasicMaterial;
}

/**
 * Procedural city builder (seeded – identical world on every client), using
 * CC0 PBR textures + facade shader + real CC0 models where available.
 */
export class CityBuilder {
  readonly group = new THREE.Group();
  readonly colliders = new ColliderWorld();
  readonly nightMaterials: CityRuntime['nightMaterials'] = [];
  private rng: Rng = mulberry32(5786);
  private box = unitBox();

  private mats = {
    bauhaus: createFacadeMaterial(FACADES.bauhaus),
    tower: createFacadeMaterial(FACADES.tower),
    towerRound: createFacadeMaterial(FACADES.towerRound),
    stone: createFacadeMaterial(FACADES.stone),
    stoneWall: createFacadeMaterial(FACADES.stoneWall),
    concrete: createSurfaceMaterial('plaster', { scale: 3, detail: true, detailAvg: 0.42, triplanar: true, normalScale: 0.6 }),
    plaster: createSurfaceMaterial('plaster', { scale: 2.5, detail: true, detailAvg: 0.42, triplanar: true }),
    sidewalk: createSurfaceMaterial('pavers', { scale: 2.2, detail: true, detailAvg: 0.4, triplanar: true, color: 0xc9c6c0, structured: true }),
    slabs: createSurfaceMaterial('slabs', { scale: 3, triplanar: true, color: 0xfff2dc, structured: true }),
    asphalt: createSurfaceMaterial('asphalt', { scale: 6, color: 0x8a8a8a, roughness: 1 }),
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.45, metalness: 0.8 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.65 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.5 }),
    bulbs: new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.4 }),
    ac: createSurfaceMaterial('plaster', { scale: 0.6, detail: true, detailAvg: 0.42, triplanar: true, color: 0xdedbd2 }),
  };

  private poolMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial();
  private I = {
    bauhaus: new Instancer(this.box, this.mats.bauhaus, { castShadow: true, name: 'bauhaus' }),
    tower: new Instancer(this.box, this.mats.tower, { castShadow: true, name: 'towers' }),
    towerRound: new Instancer(new THREE.CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0), this.mats.towerRound, { castShadow: true, name: 'round-towers' }),
    stone: new Instancer(this.box, this.mats.stone, { castShadow: true, name: 'stone' }),
    stoneWall: new Instancer(this.box, this.mats.stoneWall, { castShadow: true, name: 'stone-walls' }),
    concrete: new Instancer(this.box, this.mats.concrete, { castShadow: true, name: 'concrete' }),
    sidewalk: new Instancer(this.box, this.mats.sidewalk, { castShadow: false, name: 'sidewalks' }),
    slabs: new Instancer(this.box, this.mats.slabs, { name: 'slab-paving' }),
    road: new Instancer(this.box, this.mats.asphalt, { name: 'roads' }),
    paint: new Instancer(this.box, this.mats.paint, { name: 'markings' }),
    balcony: new Instancer(this.box, this.mats.plaster, { castShadow: true, name: 'balconies' }),
    railing: new Instancer(this.box, this.mats.metal, { castShadow: true, name: 'railings' }),
    ac: new Instancer(P.acUnitGeometry(), this.mats.ac, { castShadow: true, name: 'ac-units' }),
    dome: new Instancer(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.stoneWall, { castShadow: true, name: 'domes' }),
    umbrella: new Instancer(P.umbrellaGeometry(), this.mats.vcol, { castShadow: true, name: 'umbrellas' }),
    lounger: new Instancer(P.loungerGeometry(), this.mats.vcol, { castShadow: true, name: 'loungers' }),
    lampPole: new Instancer(P.lampPoleGeometry(), this.mats.metal, { castShadow: true, name: 'lamp-poles' }),
    lampHead: new Instancer(P.lampHeadGeometry(), this.mats.glow, { name: 'lamp-heads' }),
    solar: new Instancer(P.solarHeaterGeometry(), this.mats.vcol, { castShadow: true, name: 'solar-heaters' }),
    stall: new Instancer(P.stallGeometry(), this.mats.vcol, { castShadow: true, name: 'stalls' }),
    awning: new Instancer(P.awningGeometry(), this.mats.vcol, { castShadow: true, name: 'awnings' }),
    lifeguard: new Instancer(P.lifeguardTowerGeometry(), this.mats.vcol, { castShadow: true, name: 'lifeguard' }),
    bench: new Instancer(P.benchGeometry(), this.mats.vcol, { castShadow: true, name: 'benches' }),
    bulb: new Instancer(new THREE.SphereGeometry(0.05, 6, 4), this.mats.bulbs, { name: 'string-lights' }),
    pool: new Instancer(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), this.poolMaterial(), { name: 'light-pools', receiveShadow: false }),
  };

  private poolMaterial(): THREE.MeshBasicMaterial {
    const tex = canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,200,130,1)'); g.addColorStop(0.35, 'rgba(255,170,90,0.55)'); g.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    });
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false, polygonOffset: true, polygonOffsetFactor: -4 });
    return this.poolMat;
  }
  private trees = (() => {
    const k = treeKits();
    return {
      palm: new MultiInstancer(k.palm, { castShadow: true, name: 'palms' }),
      ficus: new MultiInstancer(k.ficus, { castShadow: true, name: 'ficus' }),
      cypress: new MultiInstancer(k.cypress, { castShadow: true, name: 'cypress' }),
      olive: new MultiInstancer(k.olive, { castShadow: true, name: 'olive' }),
    };
  })();
  private M: { chair: ModelInstancer; lamp: ModelInstancer; bin: ModelInstancer };

  constructor(models: CityModels) {
    this.M = {
      chair: new ModelInstancer(models.chair, { name: 'plastic-chairs' }),
      lamp: new ModelInstancer(models.lamp, { name: 'park-lamps' }),
      bin: new ModelInstancer(models.bin, { name: 'bins' }),
    };
    for (const p of models.lamp.parts) {
      const m = p.material as THREE.MeshStandardMaterial;
      if (/bulb|glass/i.test(m.name)) {
        m.emissive = new THREE.Color(0xffc27a);
        m.emissiveIntensity = 0;
        this.nightMaterials.push({ mat: m, max: /bulb/i.test(m.name) ? 30 : 4 });
      }
    }
  }

  steps(): Step[] {
    return [
      { label: 'מפזרים חול על החוף…', run: () => this.group.add(buildTerrainMesh()) },
      { label: 'סוללים כבישים (בלי מכרז)…', run: () => this.buildRoads() },
      { label: 'בונים את העיר הלבנה…', run: () => this.buildCityBlocks() },
      { label: 'מעמידים מגדלים ליד איילון…', run: () => this.buildTowers() },
      { label: 'פותחים את השוק…', run: () => this.buildMarket() },
      { label: 'פורסים שמשיות וממנים מציל…', run: () => this.buildBeach() },
      { label: 'מזמינים פקק לאיילון…', run: () => this.buildAyalon() },
      { label: 'חוצבים אבן ירושלמית…', run: () => this.buildJerusalem() },
      { label: 'שותלים עצים ותאורה…', run: () => this.buildVegetationAndLights() },
      { label: 'מרכיבים הכל…', run: () => this.finalize() },
    ];
  }

  // ---------------------------------------------------------------- roads
  private roadSegment(x0: number, z0: number, x1: number, z1: number, w: number, dashed = true, y = 0.0) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(x1 - x0, z1 - z0);
    this.I.road.add(cx, y - 0.3, cz, w, 0.33, len, rot);
    if (dashed) for (let d = -len / 2 + 2; d < len / 2 - 2; d += 6) {
      this.I.paint.add(cx + Math.sin(rot) * d, y + 0.035, cz + Math.cos(rot) * d, 0.14, 0.01, 3, rot);
    }
  }

  private buildRoads() {
    const { streetsX, streetsZ, streetW } = CITY;
    const zMin = streetsZ[0] - 20, zMax = streetsZ[streetsZ.length - 1] + 20;
    for (const x of streetsX) this.roadSegment(x, zMin, x, zMax, x === -194 ? 12 : streetW);
    for (const z of streetsZ) this.roadSegment(-200, z, CITY.ayalon.west, z, streetW);
    for (const z of [-150, 90]) this.roadSegment(CITY.ayalon.east, z, 215, z, streetW);
    for (const x of streetsX) for (const z of streetsZ) {
      for (let k = -3; k <= 3; k++) {
        this.I.paint.add(x + k * 1.2, 0.04, z + streetW / 2 + 1.8, 0.55, 0.01, 2.6);
        this.I.paint.add(x + streetW / 2 + 1.8, 0.04, z + k * 1.2, 2.6, 0.01, 0.55);
      }
    }
    this.buildRoute1();
  }

  private buildRoute1() {
    const x0 = CITY.ayalon.east, x1 = CITY.jeru.minX - 4, w = 14;
    const step = 4;
    const n = Math.ceil((x1 - x0) / step);
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step;
      const y = terrainHeight(x, 0) + 0.06;
      pos.push(x, y, -w / 2, x, y, w / 2);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      if (i < n && i % 2 === 0) {
        const xn = x + step, yn = terrainHeight(xn, 0) + 0.06;
        const slope = Math.atan2(yn - y, step);
        this.I.paint.add(x + step / 2, (y + yn) / 2 + 0.02, 0, 3, 0.02, 0.14, 0, undefined, 0, slope);
        for (const side of [-1, 1]) {
          this.I.railing.add(x + step / 2, (y + yn) / 2 + 0.55, side * (w / 2 + 0.6), step * 2, 0.3, 0.06, 0, 0xc8ccd2, 0, slope);
          this.I.railing.add(x + step / 2, (y + yn) / 2, side * (w / 2 + 0.6), 0.1, 0.6, 0.1, 0, 0x8a8f96);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, this.mats.asphalt);
    road.receiveShadow = true;
    road.name = 'route1';
    this.group.add(road);
  }

  // ---------------------------------------------------------------- buildings
  private addBuilding(kind: 'bauhaus' | 'tower' | 'stone' | 'round', x: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, baseY = 0, opts: { balconies?: boolean } = {}) {
    if (kind === 'round') {
      this.I.towerRound.add(x, baseY, z, w, h, w, 0, color);
      this.colliders.addBox(x, z, w * 0.85, w * 0.85, h, baseY);
      this.I.concrete.add(x, baseY + h, z, w * 0.7, 4, w * 0.7, 0, 0x9aa3ad);
      return;
    }
    this.I[kind].add(x, baseY - 0.5, z, w, h + 0.5, d, 0, color);
    this.colliders.addBox(x, z, w, d, h, baseY);
    const rnd = this.rng;
    const top = baseY + h;
    if (kind === 'tower') {
      this.I.concrete.add(x, top, z, w * 0.6, rnd.range(2, 6), d * 0.6, 0, 0x8d949c);
      return;
    }
    const pT = 0.25, pH = kind === 'stone' ? 0.8 : 1.0;
    const inst = this.I[kind];
    inst.add(x, top, z - d / 2 + pT / 2, w, pH, pT, 0, color);
    inst.add(x, top, z + d / 2 - pT / 2, w, pH, pT, 0, color);
    inst.add(x - w / 2 + pT / 2, top, z, pT, pH, d - pT * 2, 0, color);
    inst.add(x + w / 2 - pT / 2, top, z, pT, pH, d - pT * 2, 0, color);
    if (kind === 'bauhaus') {
      const n = rnd.int(1, Math.max(1, Math.floor((w * d) / 60)));
      for (let i = 0; i < n; i++) this.I.solar.add(x + rnd.range(-w / 2 + 1.2, w / 2 - 1.2), top, z + rnd.range(-d / 2 + 1.4, d / 2 - 1.4), 1, 1, 1, Math.PI);
      if (rnd.chance(0.6)) this.I.bauhaus.add(x + rnd.range(-w / 4, w / 4), top, z + rnd.range(-d / 4, d / 4), 3.2, 2.6, 3.2, 0, color);
      this.addFacadeDetails(x, z, w, d, h, baseY, color, opts.balconies ?? true);
    }
    if (kind === 'stone' && rnd.chance(0.16)) {
      const r = Math.min(w, d) * 0.3;
      this.I.dome.add(x, top, z, r, r * 0.85, r, 0, 0xe6d6b4);
    }
  }

  /** AC units under windows + Bauhaus balconies, aligned to the shader's window grid. */
  private addFacadeDetails(x: number, z: number, w: number, d: number, h: number, baseY: number, color: THREE.ColorRepresentation, balconies: boolean) {
    const st = FACADES.bauhaus;
    const floors = Math.floor((h - 0.7) / st.floorH);
    const rnd = this.rng;
    const faces = [
      { nx: 0, nz: 1, width: w, cx: x, cz: z + d / 2, tx: 1, tz: 0 },
      { nx: 0, nz: -1, width: w, cx: x, cz: z - d / 2, tx: -1, tz: 0 },
      { nx: 1, nz: 0, width: d, cx: x + w / 2, cz: z, tx: 0, tz: -1 },
      { nx: -1, nz: 0, width: d, cx: x - w / 2, cz: z, tx: 0, tz: 1 },
    ];
    const balconyFace = balconies ? rnd.int(0, 3) : -1;
    faces.forEach((f, fi) => {
      const n = Math.max(0, Math.floor((f.width - 1.2) / st.spacingX));
      const off = (f.width - n * st.spacingX) / 2;
      const rotY = Math.atan2(f.nx, f.nz);
      if (fi === balconyFace && floors > 1) {
        const bw = Math.min(f.width * 0.75, n * st.spacingX);
        for (let fl = 1; fl < floors; fl++) {
          const y = baseY + fl * st.floorH - 0.12;
          const bx = f.cx + f.nx * 0.75, bz = f.cz + f.nz * 0.75;
          this.I.balcony.add(bx, y, bz, f.nx ? 1.5 : bw, 0.2, f.nx ? bw : 1.5, 0, color);
          this.I.balcony.add(bx + f.nx * 0.7, y + 0.2, bz + f.nz * 0.7, f.nx ? 0.12 : bw, 0.75, f.nx ? bw : 0.12, 0, color);
          this.I.railing.add(bx + f.nx * 0.7, y + 1.0, bz + f.nz * 0.7, f.nx ? 0.05 : bw, 0.04, f.nx ? bw : 0.05, 0, 0x777777);
        }
        return;
      }
      for (let fl = 1; fl < floors; fl++) for (let i = 0; i < n; i++) {
        if (!rnd.chance(0.14)) continue;
        const u = off + (i + 0.5) * st.spacingX - f.width / 2;
        const side = rnd.chance(0.5) ? -1 : 1;
        const px = f.cx + f.tx * (u + side * 0.55) + f.nx * 0.2;
        const pz = f.cz + f.tz * (u + side * 0.55) + f.nz * 0.2;
        this.I.ac.add(px, baseY + fl * st.floorH + st.sill - 0.62, pz, 1, 1, 1, rotY);
      }
    });
  }

  private buildCityBlocks() {
    const { streetsX, streetsZ, streetW } = CITY;
    const bauhausColors = [0xf4f1ea, 0xefe9dc, 0xe8e0cf, 0xf7f7f5, 0xe6ddcc, 0xf0e2c8, 0xe9d7c0, 0xdfe3e4];
    const xs = [...streetsX, CITY.ayalon.west - 4];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < streetsZ.length - 1; j++) {
        const sx0 = xs[i] + streetW / 2, sx1 = xs[i + 1] - streetW / 2;
        const sz0 = streetsZ[j] + streetW / 2, sz1 = streetsZ[j + 1] - streetW / 2;
        this.I.sidewalk.add((sx0 + sx1) / 2, -0.4, (sz0 + sz1) / 2, sx1 - sx0, 0.55, sz1 - sz0);
        this.colliders.addBox((sx0 + sx1) / 2, (sz0 + sz1) / 2, sx1 - sx0, sz1 - sz0, 0.15, 0);
        this.addCurbs(sx0, sx1, sz0, sz1);
        const bx0 = sx0 + 3, bx1 = sx1 - 3, bz0 = sz0 + 3, bz1 = sz1 - 3;
        const marketBlock = (bz0 < 6 && bz1 > -6);
        const zRanges: [number, number][] = marketBlock && i >= 1 && i <= 3 ? [[bz0, -7], [7, bz1]] : [[bz0, bz1]];
        for (const [z0, z1] of zRanges) this.fillLot(i, bx0, bx1, z0, z1, bauhausColors, marketBlock && i >= 1 && i <= 3);
      }
    }
    for (let x = -185; x < 70; x += 24) for (const z of [-300, 300]) {
      this.addBuilding('bauhaus', x, z + Math.sign(z) * 12, 18, 16, this.rng.range(10, 20), this.rng.pick(bauhausColors));
    }
  }

  private addCurbs(x0: number, x1: number, z0: number, z1: number) {
    const c = 0xd8d6cf, h = 0.2, t = 0.3;
    this.I.concrete.add((x0 + x1) / 2, -0.05, z0 + t / 2, x1 - x0, h, t, 0, c);
    this.I.concrete.add((x0 + x1) / 2, -0.05, z1 - t / 2, x1 - x0, h, t, 0, c);
    this.I.concrete.add(x0 + t / 2, -0.05, (z0 + z1) / 2, t, h, z1 - z0, 0, c);
    this.I.concrete.add(x1 - t / 2, -0.05, (z0 + z1) / 2, t, h, z1 - z0, 0, c);
  }

  private fillLot(col: number, x0: number, x1: number, z0: number, z1: number, colors: number[], market: boolean) {
    const rnd = this.rng;
    const w = x1 - x0, d = z1 - z0;
    if (w < 6 || d < 6) return;
    const nx = w > 26 ? 2 : 1;
    const nz = Math.max(1, Math.round(d / 17));
    const lw = w / nx, ld = d / nz;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const cx = x0 + lw * (a + 0.5), cz = z0 + ld * (b + 0.5);
      const bw = lw - rnd.range(1.5, 3.5), bd = ld - rnd.range(2, 4);
      let h: number;
      let kind: 'bauhaus' | 'tower' = 'bauhaus';
      if (market) h = rnd.pick([6.6, 9.8]);
      else if (col === 0) { h = rnd.range(30, 62); if (rnd.chance(0.4)) kind = 'tower'; }
      else if (col === CITY.streetsX.length - 1) { h = rnd.range(40, 90); kind = 'tower'; }
      else h = rnd.pick([9.8, 13, 13, 16.2, 16.2, 19.4]) + 0.7;
      const color = kind === 'tower' ? rnd.pick([0xd7e3ee, 0xc8d6e2, 0xe6e9ee]) : rnd.pick(colors);
      this.addBuilding(kind, cx, cz, bw, bd, h, color, 0);
      if (kind === 'bauhaus' && !market && rnd.chance(0.5)) this.M.bin.add(cx + bw / 2 + 1.2, 0.15, cz + rnd.range(-bd / 3, bd / 3), rnd.range(0, 6.28));
    }
  }

  private buildTowers() {
    const rnd = this.rng;
    const spots: [number, number][] = [];
    for (let x = 150; x <= 205; x += 28) for (let z = -260; z <= 260; z += 34) {
      if (Math.abs(z) < 22) continue;
      spots.push([x + rnd.range(-3, 3), z + rnd.range(-3, 3)]);
    }
    for (const [x, z] of spots) {
      const h = rnd.range(50, 150);
      if (rnd.chance(0.25)) this.addBuilding('round', x, z, rnd.range(16, 22), 0, h, rnd.pick([0xc9d9e8, 0xdde6ee]));
      else this.addBuilding('tower', x, z, rnd.range(16, 22), rnd.range(16, 22), h, rnd.pick([0xbccfe0, 0xd0dce8, 0xa9bfd4]));
    }
    this.addBuilding('round', 168, -48, 28, 0, 170, 0xb5c9dc);
    this.addBuilding('tower', 200, -48, 26, 26, 160, 0xc2d4e6);
    this.addBuilding('tower', 184, -78, 24, 24, 150, 0xaec4d8);
  }

  // ---------------------------------------------------------------- market
  private buildMarket() {
    const rnd = this.rng;
    const awnings = [0xc8323a, 0xf0b42c, 0x2a8d80, 0x3550c8, 0xe07a22, 0xf2efe6, 0x7e3d9c];
    this.I.slabs.add(-73, -0.35, 0, 138, 0.5, 14);
    this.colliders.addBox(-73, 0, 138, 14, 0.15, 0);
    for (let x = -138; x < -8; x += 3.8) {
      for (const side of [-1, 1]) {
        if (rnd.chance(0.12)) continue;
        const rot = side < 0 ? 0 : Math.PI;
        const z = side * 4.6;
        this.I.stall.add(x, 0.15, z, 1, 1, 1, rot);
        this.I.awning.add(x, 0.15, z, 1, 1, 1, rot, rnd.pick(awnings));
        this.colliders.addBox(x, z, 3.2, 1.2, 1.15);
      }
      if (Math.round(x) % 3 === 0) for (let k = -5; k <= 5; k++) {
        const sag = 3.6 - (1 - (k / 5) ** 2) * 0.5;
        this.I.bulb.add(x, sag, k * 0.9);
      }
    }

    const sign = canvasTexture(1024, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 1024, 0);
      g.addColorStop(0, '#ffcc00'); g.addColorStop(0.5, '#ff7a00'); g.addColorStop(1, '#ff2d6f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = '#1a0b2e'; ctx.font = 'bold 120px Rubik, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';
      ctx.fillText('פלאפל אבי • שווארמה', 512, 110);
      ctx.font = 'bold 44px Arial'; ctx.fillStyle = '#fff';
      ctx.fillText('"הכי טוב בעיר, תשאל את אמא שלי"', 512, 210);
    });
    const stand = new THREE.Group();
    const booth = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 3.5), this.mats.plaster);
    booth.position.y = 1.6; booth.castShadow = booth.receiveShadow = true;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.55), new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 }));
    signMesh.position.set(0, 3.9, 1.8);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.4, metalness: 0.3 }));
    counter.position.set(0, 0.55, 2.1); counter.castShadow = true;
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.4, 16), new THREE.MeshStandardMaterial({ color: 0x9c5a2a, roughness: 0.5 }));
    spit.position.set(-1.8, 1.9, 1.2); spit.name = 'shawarma-spit';
    stand.add(booth, signMesh, counter, spit);
    stand.position.set(-60, 0.15, -11);
    this.group.add(stand);
    this.colliders.addBox(-60, -11, 6, 4.4, 3.35);
    this.nightMaterials.push({ mat: signMesh.material as THREE.MeshStandardMaterial, max: 1.4 });
    for (let i = 0; i < 12; i++) this.M.chair.add(-64 + rnd.range(0, 8), 0.15, -6 + rnd.range(-1, 1.5), rnd.range(0, Math.PI * 2));
  }

  // ---------------------------------------------------------------- beach
  private buildBeach() {
    const rnd = this.rng;
    this.I.sidewalk.add(-206.5, -0.35, 0, 13, 0.5, 820, 0, 0xd9cbb4);
    this.colliders.addBox(-206.5, 0, 13, 820, 0.15, 0);
    for (let z = -390; z < 390; z += 8) this.I.concrete.add(-213.2, 0, z + 4, 0.5, 0.55, 7.8, 0, 0xe9e3d8);
    const umbrellaColors = [0xe8365f, 0x2fb5e0, 0xf2c335, 0x5fd047, 0xf07c16, 0x8a54e6, 0xffffff, 0x1f4fb0];
    for (let i = 0; i < 160; i++) {
      const x = rnd.range(-292, -222), z = rnd.range(-380, 380);
      const y = terrainHeight(x, z);
      this.I.umbrella.add(x, y, z, 1, 1, 1, rnd.range(0, 6.28), rnd.pick(umbrellaColors), rnd.range(-0.08, 0.08), rnd.range(-0.08, 0.08));
      if (rnd.chance(0.7)) this.I.lounger.add(x + rnd.range(-1.2, 1.2), y, z + rnd.range(-1.2, 1.2), 1, 1, 1, rnd.range(-0.4, 0.4) + Math.PI / 2, rnd.pick([0xffffff, 0x2fb5e0, 0xf07aa8]));
      if (rnd.chance(0.35)) this.M.chair.add(x + rnd.range(-2, 2), y, z + rnd.range(-2, 2), rnd.range(0, 6.28));
    }
    for (const z of [-260, -90, 80, 250]) {
      const x = -275, y = terrainHeight(x, z);
      this.I.lifeguard.add(x, y, z, 1, 1, 1, -Math.PI / 2);
      this.colliders.addBox(x, z, 3.6, 3.6, 5.8, y + 3.0);
    }
    for (let z = -380; z < 390; z += 14) {
      this.trees.palm.add(-207, 0.15, z, rnd.range(0.85, 1.15), rnd.range(0.85, 1.2), rnd.range(0.85, 1.15), rnd.range(0, 6.28));
      if (z % 28 === 0) this.I.bench.add(-209.5, 0.15, z + 7, 1, 1, 1, -Math.PI / 2);
      if (z % 28 === 14) this.addParkLamp(-211.8, 0.15, z + 7, 1.3);
    }
  }

  // ---------------------------------------------------------------- Ayalon
  private buildAyalon() {
    const { west, east, median } = CITY.ayalon;
    const zMin = -400, zMax = 400;
    this.roadSegment((west + median[0]) / 2, zMin, (west + median[0]) / 2, zMax, median[0] - west, false);
    this.roadSegment((median[1] + east) / 2, zMin, (median[1] + east) / 2, zMax, east - median[1], false);
    for (const [a, b] of [[west, median[0]], [median[1], east]] as const) {
      const lw = (b - a) / 4;
      for (let l = 1; l < 4; l++) for (let z = zMin; z < zMax; z += 9) this.I.paint.add(a + l * lw, 0.035, z, 0.14, 0.01, 4);
      this.I.paint.add(a + 0.4, 0.035, 0, 0.15, 0.01, 800);
      this.I.paint.add(b - 0.4, 0.035, 0, 0.15, 0.01, 800, 0, 0xf2c335);
    }
    this.I.concrete.add((median[0] + median[1]) / 2, -0.2, 0, median[1] - median[0], 0.4, 800, 0, 0x8d847a);
    for (const tx of [103, 107]) {
      for (const off of [-0.72, 0.72]) this.I.railing.add(tx + off, 0.25, 0, 0.08, 0.14, 800, 0, 0x9aa0a8);
      for (let z = zMin; z < zMax; z += 1.0) this.I.concrete.add(tx, 0.2, z, 2.5, 0.08, 0.24, 0, 0x6a625a);
    }
    const gaps = [0, -150, 90];
    const wallSeg = (x: number, h: number, thick: number, color: number) => {
      let z = zMin;
      for (const g of [...gaps].sort((a, b) => a - b)) {
        const zEnd = g - 9;
        if (zEnd > z) { this.I.concrete.add(x, 0, (z + zEnd) / 2, thick, h, zEnd - z, 0, color); this.colliders.addBox(x, (z + zEnd) / 2, thick, zEnd - z, h); }
        z = g + 9;
      }
      this.I.concrete.add(x, 0, (z + zMax) / 2, thick, h, zMax - z, 0, color);
      this.colliders.addBox(x, (z + zMax) / 2, thick, zMax - z, h);
    };
    wallSeg(median[0] - 0.3, 1.0, 0.6, 0xd2cdc4);
    wallSeg(median[1] + 0.3, 1.0, 0.6, 0xd2cdc4);
    wallSeg(west - 1.5, 3.5, 0.4, 0xb4b9ad);
    wallSeg(east + 1.5, 3.5, 0.4, 0xb4b9ad);

    const signTex = (lines: [string, string][]) => canvasTexture(1024, 384, (ctx) => {
      ctx.fillStyle = '#0d6b3a'; ctx.fillRect(0, 0, 1024, 384);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 1000, 360);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach(([he, en], i) => {
        ctx.font = 'bold 86px Rubik, Arial'; ctx.direction = 'rtl'; ctx.fillText(he, 512, 80 + i * 180);
        ctx.font = 'bold 54px Arial'; ctx.direction = 'ltr'; ctx.fillText(en, 512, 150 + i * 180);
      });
    });
    const gantry = (z: number, tex: THREE.Texture) => {
      for (const x of [west - 1, east + 1]) this.I.railing.add(x, 0, z, 0.5, 8, 0.5, 0, 0x8d939b);
      this.I.railing.add((west + east) / 2, 7.6, z, east - west + 2, 0.5, 0.5, 0, 0x8d939b);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05 }));
      m.position.set((west + median[0]) / 2, 6.5, z + 0.3);
      const m2 = m.clone(); m2.position.x = (median[1] + east) / 2;
      this.group.add(m, m2);
      this.nightMaterials.push({ mat: m.material as THREE.MeshStandardMaterial, max: 0.5 });
    };
    gantry(-60, signTex([['ירושלים  ←', 'Jerusalem  1'], ['חיפה  ↑  (בעוד 3 שעות)', 'Haifa  ↑  (in 3 hours)']]));
    gantry(60, signTex([['ירושלים  ←', 'Jerusalem  1'], ['החוף  →', 'Beach  →']]));
  }

  // ---------------------------------------------------------------- Jerusalem
  private buildJerusalem() {
    const rnd = this.rng;
    const { minX, maxX, minZ, maxZ, gateZ } = CITY.jeru;
    const base = WORLD.jerusalemHeight;
    const stoneColors = [0xfff4e0, 0xf6e6c8, 0xfff0d8, 0xefdcbc, 0xfff8ea];
    const wallH = 12, wallT = 3;
    const wallColor = 0xf3e2c0;
    const W = this.I.stoneWall;
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = Math.abs(x1 - x0) || wallT, d = Math.abs(z1 - z0) || wallT;
      W.add(cx, base - 2, cz, w, wallH + 2, d, 0, wallColor);
      this.colliders.addBox(cx, cz, w, d, wallH, base);
      const len = Math.max(w, d);
      for (let t = -len / 2 + 1; t < len / 2; t += 2.4) {
        const px = w > d ? cx + t : cx, pz = w > d ? cz : cz + t;
        W.add(px, base + wallH, pz, w > d ? 1.3 : wallT, 1.4, w > d ? wallT : 1.3, 0, wallColor);
      }
    };
    const gateHalf = 5;
    wall(minX, minZ, minX, gateZ - gateHalf); wall(minX, gateZ + gateHalf, minX, maxZ);
    wall(maxX, minZ, maxX, gateZ - gateHalf); wall(maxX, gateZ + gateHalf, maxX, maxZ);
    wall(minX, minZ, maxX, minZ); wall(minX, maxZ, maxX, maxZ);
    for (const gx of [minX, maxX]) {
      for (const s of [-1, 1]) {
        W.add(gx, base - 2, gateZ + s * (gateHalf + 3), 7, wallH + 6, 6, 0, 0xead6ae);
        this.colliders.addBox(gx, gateZ + s * (gateHalf + 3), 7, 6, wallH + 4, base);
      }
      W.add(gx, base + 7, gateZ, 7, wallH - 3, gateHalf * 2, 0, 0xead6ae);
      this.colliders.addBox(gx, gateZ, 7, gateHalf * 2, wallH - 3, base + 7);
    }
    for (const cx of [minX, maxX]) for (const cz of [minZ, maxZ]) {
      W.add(cx, base - 2, cz, 9, wallH + 7, 9, 0, 0xead6ae);
      this.colliders.addBox(cx, cz, 9, 9, wallH + 5, base);
    }

    const cell = 11, lane = 3.6;
    const plaza = { x: 590, z: 0, r: 20 };
    for (let x = minX + 6; x < maxX - 6; x += cell) {
      for (let z = minZ + 6; z < maxZ - 6; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        if (Math.abs(cz - gateZ) < 6) continue;
        if (Math.abs(cx - 590) < 5) continue;
        if (Math.hypot(cx - plaza.x, cz - plaza.z) < plaza.r) continue;
        const w = cell - lane + rnd.range(-0.5, 0.8), d = cell - lane + rnd.range(-0.5, 0.8);
        const h = rnd.pick([3.5, 7, 7, 10.5]) + 0.6;
        this.addBuilding('stone', cx, cz, w, d, h, rnd.pick(stoneColors), base - 0.4);
      }
    }
    W.add(plaza.x + 30, base, plaza.z - 30, 14, 10, 14, 0, 0xf4e6c8);
    this.I.dome.add(plaza.x + 30, base + 10, plaza.z - 30, 6.5, 6.5, 6.5, 0, 0xd8b45a);
    this.colliders.addBox(plaza.x + 30, plaza.z - 30, 14, 14, 16.5, base);
    for (let x = minX + 8; x < maxX - 8; x += 1.2) this.I.bulb.add(x, base + 4.2 + Math.sin(x * 0.5) * 0.25, gateZ + 2.2);
    for (let x = minX + 10; x < maxX - 10; x += 16) this.addParkLamp(x, base, gateZ - 4.4, 1.1);
    for (let i = 0; i < 6; i++) this.trees.olive.add(plaza.x + rnd.range(-12, 12), base, plaza.z + rnd.range(-12, 12), 1, 1, 1, rnd.range(0, 6.28));

    for (let i = 0; i < 70; i++) {
      const x = rnd.range(470, 700), z = rnd.range(-250, 250);
      if (x > minX - 25 && x < maxX + 25 && z > minZ - 25 && z < maxZ + 25) continue;
      if (Math.abs(z) < 18 && x < minX) continue;
      const y = terrainHeight(x, z);
      this.addBuilding('stone', x, z, rnd.range(10, 18), rnd.range(10, 18), rnd.pick([7, 10.5, 14, 17.5]) + 0.6, rnd.pick(stoneColors), y - 1.5);
    }
    this.I.road.add((minX - 6 + minX - 60) / 2, base - 0.28, 0, 56, 0.33, 12);
  }

  // ---------------------------------------------------------------- vegetation + lights
  private buildVegetationAndLights() {
    const rnd = this.rng;
    const { streetsX, streetsZ, streetW } = CITY;
    for (const x of streetsX.slice(1)) for (let z = -290; z < 290; z += 18) {
      if (Math.abs(z) < 10) continue;
      if (streetsZ.some((sz) => Math.abs(sz - z) < 8)) continue;
      for (const side of [-1, 1]) {
        const px = x + side * (streetW / 2 + 1.6);
        if (rnd.chance(0.7)) this.trees.ficus.add(px, 0.15, z + rnd.range(-2, 2), rnd.range(0.85, 1.15), rnd.range(0.85, 1.2), rnd.range(0.85, 1.15), rnd.range(0, 6.28), new THREE.Color().setHSL(0.28, 0.2, rnd.range(0.85, 1.0)));
        if (Math.round(z / 18) % 2 === 0) this.addLamp(px - side * 0.6, 0.15, z + 9, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    this.I.slabs.add(-73, -0.2, -90, 138, 0.5, 4.5, 0, 0xd8c7a4);
    for (let x = -136; x < -10; x += 9) {
      this.trees.ficus.add(x, 0.3, -90, 1.15, 1.25, 1.15, rnd.range(0, 6.28));
      if (rnd.chance(0.5)) this.I.bench.add(x + 4.5, 0.3, -91.2, 1, 1, 1, 0);
      if (rnd.chance(0.35)) this.addParkLamp(x + 4.5, 0.3, -88.8, 1.1);
    }
    for (let z = -390; z < 400; z += 30) this.addLamp(CITY.ayalon.west - 2.5, 0, z, Math.PI / 2), this.addLamp(CITY.ayalon.east + 2.5, 0, z, -Math.PI / 2);
    for (let x = CITY.ayalon.east + 20; x < CITY.jeru.minX - 10; x += 40) this.addLamp(x, terrainHeight(x, 0), 9.5, Math.PI);
    for (let i = 0; i < 1100; i++) {
      const x = rnd.range(220, 710), z = rnd.range(-390, 390);
      if (Math.abs(z) < 14) continue;
      const { minX, maxX, minZ, maxZ } = CITY.jeru;
      if (x > minX - 8 && x < maxX + 8 && z > minZ - 8 && z < maxZ + 8) continue;
      const y = terrainHeight(x, z);
      if (rnd.chance(0.45)) this.trees.cypress.add(x, y - 0.2, z, rnd.range(0.8, 1.2), rnd.range(0.8, 1.4), rnd.range(0.8, 1.2), rnd.range(0, 6.28));
      else this.trees.olive.add(x, y - 0.2, z, rnd.range(0.7, 1.3), rnd.range(0.7, 1.2), rnd.range(0.7, 1.3), rnd.range(0, 6.28), new THREE.Color().setHSL(0.2, 0.15, rnd.range(0.8, 1)));
    }
    for (let z = -380; z < 380; z += 20) if (Math.abs(z) > 14) this.trees.palm.add(142, 0, z, 1, 1, 1, rnd.range(0, 6.28));
  }

  private addLamp(x: number, y: number, z: number, rot: number) {
    this.I.lampPole.add(x, y, z, 1, 1, 1, rot);
    this.I.lampHead.add(x, y, z, 1, 1, 1, rot);
    this.I.pool.add(x + Math.sin(rot) * 1.6, y + 0.06, z + Math.cos(rot) * 1.6, 7.5, 1, 7.5);
  }
  private addParkLamp(x: number, y: number, z: number, scale: number) {
    this.M.lamp.add(x, y, z, 0, scale);
    this.I.pool.add(x, y + 0.06, z, 4.5, 1, 4.5);
  }

  private finalize() {
    for (const inst of Object.values(this.I)) if (inst.count > 0) this.group.add(inst.build());
    for (const t of Object.values(this.trees)) if (t.count > 0) this.group.add(...t.build());
    for (const m of Object.values(this.M)) this.group.add(m.build());
    this.nightMaterials.push({ mat: this.mats.glow, max: 3.0 }, { mat: this.mats.bulbs, max: 4.0 });
  }

  runtime(): CityRuntime {
    return { group: this.group, colliders: this.colliders, nightMaterials: this.nightMaterials, lightPools: this.poolMat };
  }
}
