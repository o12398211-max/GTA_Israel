import * as THREE from 'three';
import { ColliderWorld } from './Colliders';
import { Instancer, mulberry32, unitBox, type Rng } from './Builders';
import { createFacadeMaterial, FACADES, canvasTexture, worldUniforms } from './Materials';
import * as P from './Props';
import { WORLD, terrainHeight, buildTerrainMesh } from './Terrain';

export const CITY = {
  streetsX: [-194, -142, -96, -50, -4, 42],
  streetsZ: [-270, -210, -150, -90, -30, 30, 90, 150, 210, 270],
  streetW: 10,
  marketZ: 0, // pedestrian market alley runs along z=0 between x -142..-4
  ayalon: { west: 80, east: 130, median: [100, 110] as const },
  route1Z: 0,
  jeru: { minX: 520, maxX: 660, minZ: -70, maxZ: 70, gateZ: 0 },
};

type Step = { label: string; run: () => void };

/** Things the game loop needs to animate after the city is built. */
export interface CityRuntime {
  group: THREE.Group;
  colliders: ColliderWorld;
  nightMaterials: { mat: THREE.MeshStandardMaterial; max: number }[];
}

/**
 * Procedural city builder. Runs as a list of steps so the loading screen can
 * show progress. Everything is seeded – identical world on every client.
 */
export class CityBuilder {
  readonly group = new THREE.Group();
  readonly colliders = new ColliderWorld();
  readonly nightMaterials: CityRuntime['nightMaterials'] = [];
  private rng: Rng = mulberry32(5786);

  // shared instancers
  private box = unitBox();
  private mats = {
    bauhaus: createFacadeMaterial(FACADES.bauhaus, { color: 0xffffff }),
    tower: createFacadeMaterial(FACADES.tower, { color: 0xffffff, roughness: 0.4, metalness: 0.3 }),
    stone: createFacadeMaterial(FACADES.stone, { color: 0xffffff, roughness: 0.95 }),
    plain: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x33353a, roughness: 0.92 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.5 }),
    bulbs: new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.4 }),
  };
  private I = {
    bauhaus: new Instancer(this.box, this.mats.bauhaus, { castShadow: true, name: 'bauhaus' }),
    tower: new Instancer(this.box, this.mats.tower, { castShadow: true, name: 'towers' }),
    towerRound: new Instancer(new THREE.CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0), this.mats.tower, { castShadow: true, name: 'round-towers' }),
    stone: new Instancer(this.box, this.mats.stone, { castShadow: true, name: 'stone' }),
    plain: new Instancer(this.box, this.mats.plain, { castShadow: true, name: 'plain' }),
    road: new Instancer(this.box, this.mats.asphalt, { receiveShadow: true, name: 'roads' }),
    paint: new Instancer(this.box, this.mats.paint, { name: 'markings' }),
    balcony: new Instancer(this.box, this.mats.plain, { castShadow: true, name: 'balconies' }),
    dome: new Instancer(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.stone, { castShadow: true, name: 'domes' }),
    palm: new Instancer(P.palmGeometry(), this.mats.vcol, { castShadow: true, name: 'palms' }),
    ficus: new Instancer(P.ficusGeometry(), this.mats.vcol, { castShadow: true, name: 'ficus' }),
    cypress: new Instancer(P.cypressGeometry(), this.mats.vcol, { castShadow: true, name: 'cypress' }),
    olive: new Instancer(P.oliveGeometry(), this.mats.vcol, { castShadow: true, name: 'olive' }),
    umbrella: new Instancer(P.umbrellaGeometry(), this.mats.vcol, { castShadow: true, name: 'umbrellas' }),
    lounger: new Instancer(P.loungerGeometry(), this.mats.vcol, { castShadow: true, name: 'loungers' }),
    chair: new Instancer(P.plasticChairGeometry(), this.mats.vcol, { castShadow: true, name: 'plastic-chairs' }),
    lampPole: new Instancer(P.lampPoleGeometry(), this.mats.vcol, { castShadow: true, name: 'lamp-poles' }),
    lampHead: new Instancer(P.lampHeadGeometry(), this.mats.glow, { name: 'lamp-heads' }),
    solar: new Instancer(P.solarHeaterGeometry(), this.mats.vcol, { castShadow: true, name: 'solar-heaters' }),
    stall: new Instancer(P.stallGeometry(), this.mats.vcol, { castShadow: true, name: 'stalls' }),
    awning: new Instancer(P.awningGeometry(), this.mats.vcol, { castShadow: true, name: 'awnings' }),
    lifeguard: new Instancer(P.lifeguardTowerGeometry(), this.mats.vcol, { castShadow: true, name: 'lifeguard' }),
    bench: new Instancer(P.benchGeometry(), this.mats.vcol, { castShadow: true, name: 'benches' }),
    bulb: new Instancer(new THREE.SphereGeometry(0.05, 6, 4), this.mats.bulbs, { name: 'string-lights' }),
  };

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
  private roadSegment(x0: number, z0: number, x1: number, z1: number, w: number, dashed = true, y = 0.02) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(x1 - x0, z1 - z0);
    this.I.road.add(cx, y, cz, w, 0.04, len, rot);
    if (dashed) for (let d = -len / 2 + 2; d < len / 2 - 2; d += 6) {
      this.I.paint.add(cx + Math.sin(rot) * d, y + 0.045, cz + Math.cos(rot) * d, 0.15, 0.01, 3, rot);
    }
  }

  private buildRoads() {
    const { streetsX, streetsZ, streetW } = CITY;
    const zMin = streetsZ[0] - 20, zMax = streetsZ[streetsZ.length - 1] + 20;
    for (const x of streetsX) this.roadSegment(x, zMin, x, zMax, x === -194 ? 12 : streetW);
    for (const z of streetsZ) this.roadSegment(-200, z, CITY.ayalon.west, z, streetW);
    // connectors east of Ayalon into the tower district
    for (const z of [-150, 90]) this.roadSegment(CITY.ayalon.east, z, 215, z, streetW);
    // crosswalks at intersections
    for (const x of streetsX) for (const z of streetsZ) {
      for (let k = -3; k <= 3; k++) {
        this.I.paint.add(x + k * 1.2, 0.07, z + streetW / 2 + 1.5, 0.6, 0.01, 2.2);
        this.I.paint.add(x + streetW / 2 + 1.5, 0.07, z + k * 1.2, 2.2, 0.01, 0.6);
      }
    }
    this.buildRoute1();
  }

  /** Route 1: a ribbon that follows the climbing terrain up to Jerusalem. */
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
      // center dashes + guard rails following the slope
      if (i < n && i % 2 === 0) {
        const xn = x + step, yn = terrainHeight(xn, 0) + 0.06;
        const slope = Math.atan2(yn - y, step);
        this.I.paint.add(x + step / 2, (y + yn) / 2 + 0.02, 0, 3, 0.02, 0.15, 0, undefined, 0, slope);
        for (const side of [-1, 1]) {
          this.I.plain.add(x + step / 2, (y + yn) / 2 + 0.55, side * (w / 2 + 0.6), step * 2, 0.3, 0.12, 0, 0xb8bcc2, 0, slope);
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
  private addBuilding(kind: 'bauhaus' | 'tower' | 'stone' | 'round', x: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, baseY = 0, frontRot = 0) {
    if (kind === 'round') {
      this.I.towerRound.add(x, baseY, z, w, h, w, 0, color);
      this.colliders.addBox(x, z, w * 0.85, w * 0.85, h, baseY);
      return;
    }
    this.I[kind].add(x, baseY - 0.5, z, w, h + 0.5, d, 0, color);
    this.colliders.addBox(x, z, w, d, h, baseY);
    // roof parapet + rooftop clutter
    if (kind !== 'tower') {
      const rnd = this.rng;
      if (kind === 'bauhaus' && rnd.chance(0.85)) {
        const n = rnd.int(1, Math.max(1, Math.floor((w * d) / 70)));
        for (let i = 0; i < n; i++) {
          this.I.solar.add(x + rnd.range(-w / 2 + 1, w / 2 - 1), baseY + h, z + rnd.range(-d / 2 + 1.2, d / 2 - 1.2), 1, 1, 1, Math.PI);
        }
      }
      if (kind === 'stone' && rnd.chance(0.18)) {
        const r = Math.min(w, d) * 0.32;
        this.I.dome.add(x, baseY + h, z, r, r * 0.9, r, 0, 0xe8dcc0);
      }
    }
    // Bauhaus balconies on street-facing side
    if (kind === 'bauhaus') {
      const floors = Math.floor(h / 3.2);
      const fx = Math.sin(frontRot), fz = Math.cos(frontRot);
      const along = Math.abs(fx) > 0.5 ? d : w;
      const depthOff = (Math.abs(fx) > 0.5 ? w : d) / 2 + 0.6;
      for (let f = 1; f < floors; f++) {
        this.I.balcony.add(x + fx * depthOff, baseY + f * 3.2 - 0.15, z + fz * depthOff, Math.abs(fx) > 0.5 ? 1.2 : along * 0.7, 0.22, Math.abs(fx) > 0.5 ? along * 0.7 : 1.2, 0, color);
        // railings
        this.I.balcony.add(x + fx * (depthOff + 0.55), baseY + f * 3.2 + 0.05, z + fz * (depthOff + 0.55), Math.abs(fx) > 0.5 ? 0.08 : along * 0.7, 0.9, Math.abs(fx) > 0.5 ? along * 0.7 : 0.08, 0, color);
      }
    }
  }

  private buildCityBlocks() {
    const { streetsX, streetsZ, streetW } = CITY;
    const bauhausColors = [0xf6f3ea, 0xf1ece0, 0xebe4d4, 0xfafafa, 0xe9e2d6, 0xf3e7d3];
    const xs = [...streetsX, CITY.ayalon.west - 4];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < streetsZ.length - 1; j++) {
        const bx0 = xs[i] + streetW / 2 + 3, bx1 = xs[i + 1] - streetW / 2 - 3;
        const bz0 = streetsZ[j] + streetW / 2 + 3, bz1 = streetsZ[j + 1] - streetW / 2 - 3;
        const marketBlock = (bz0 < 6 && bz1 > -6);
        // split block in two along z for the market alley
        const zRanges: [number, number][] = marketBlock && i >= 1 && i <= 3
          ? [[bz0, -7], [7, bz1]]
          : [[bz0, bz1]];
        // boulevard: z=-90 street has a tree-lined median, buildings stay
        for (const [z0, z1] of zRanges) this.fillLot(i, bx0, bx1, z0, z1, bauhausColors, marketBlock && i >= 1 && i <= 3);
      }
    }
    // northern / southern edges: a few extra rows so the city doesn't end abruptly
    for (let x = -185; x < 70; x += 24) for (const z of [-300, 300]) {
      this.addBuilding('bauhaus', x, z + Math.sign(z) * 12, 18, 16, this.rng.range(10, 20), this.rng.pick(bauhausColors), 0, Math.sign(z) > 0 ? Math.PI : 0);
    }
  }

  private fillLot(col: number, x0: number, x1: number, z0: number, z1: number, colors: number[], market: boolean) {
    const rnd = this.rng;
    const w = x1 - x0, d = z1 - z0;
    if (w < 6 || d < 6) return;
    const nx = w > 26 ? 2 : 1;
    const nz = Math.max(1, Math.round(d / 18));
    const lw = w / nx, ld = d / nz;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const cx = x0 + lw * (a + 0.5), cz = z0 + ld * (b + 0.5);
      const bw = lw - rnd.range(1.5, 3.5), bd = ld - rnd.range(1.5, 3.5);
      let h: number;
      let kind: 'bauhaus' | 'tower' = 'bauhaus';
      if (market) h = rnd.range(6.4, 10);
      else if (col === 0) { h = rnd.range(30, 62); if (rnd.chance(0.4)) kind = 'tower'; } // seafront hotels
      else if (col === xsLast()) { h = rnd.range(40, 90); kind = 'tower'; }
      else h = rnd.pick([9.6, 12.8, 12.8, 16, 16, 19.2]);
      // face the nearest street on x
      const front = (a === 0) ? -Math.PI / 2 : Math.PI / 2;
      const color = kind === 'tower' ? rnd.pick([0xd7e3ee, 0xc8d6e2, 0xe6e9ee]) : rnd.pick(colors);
      this.addBuilding(kind, cx, cz, bw, bd, h, color, 0, front);
    }
    function xsLast() { return CITY.streetsX.length - 1; }
  }

  private buildTowers() {
    // tower district east of Ayalon – original skyline, no real-world logos
    const rnd = this.rng;
    const spots: [number, number][] = [];
    for (let x = 150; x <= 205; x += 28) for (let z = -260; z <= 260; z += 34) {
      if (Math.abs(z) < 22) continue; // keep Route 1 corridor clear
      spots.push([x + rnd.range(-3, 3), z + rnd.range(-3, 3)]);
    }
    for (const [x, z] of spots) {
      const h = rnd.range(50, 150);
      if (rnd.chance(0.25)) this.addBuilding('round', x, z, rnd.range(16, 22), 0, h, rnd.pick([0xc9d9e8, 0xdde6ee]));
      else this.addBuilding('tower', x, z, rnd.range(16, 22), rnd.range(16, 22), h, rnd.pick([0xbccfe0, 0xd0dce8, 0xa9bfd4]));
    }
    // three signature towers: circle, triangle, square – our own design
    this.addBuilding('round', 168, -48, 28, 0, 170, 0xb5c9dc);
    this.addBuilding('tower', 200, -48, 26, 26, 160, 0xc2d4e6);
    this.addBuilding('tower', 184, -78, 24, 24, 150, 0xaec4d8);
  }

  // ---------------------------------------------------------------- market
  private buildMarket() {
    const rnd = this.rng;
    const awnings = [0xd8262e, 0xffc93c, 0x2a9d8f, 0x3d5af1, 0xf28c28, 0xffffff, 0x8e44ad];
    // paved pedestrian alley
    this.I.plain.add(-73, -0.45, 0, 138, 0.5, 14, 0, 0xb59f82);
    for (let x = -138; x < -8; x += 3.8) {
      for (const side of [-1, 1]) {
        if (rnd.chance(0.12)) continue;
        const rot = side < 0 ? 0 : Math.PI;
        const z = side * 4.6;
        this.I.stall.add(x, 0, z, 1, 1, 1, rot);
        this.I.awning.add(x, 0, z, 1, 1, 1, rot, rnd.pick(awnings));
        this.colliders.addBox(x, z, 3.2, 1.2, 1.0);
      }
      // string lights across the alley
      if (Math.round(x) % 3 === 0) for (let k = -5; k <= 5; k++) {
        const sag = 3.4 - (1 - (k / 5) ** 2) * 0.5;
        this.I.bulb.add(x, sag, k * 0.9);
      }
    }
    // shade tarps over the alley
    for (let x = -130; x < -10; x += 26) this.I.plain.add(x, 5.2, 0, 10, 0.05, 5, rnd.range(-0.1, 0.1), rnd.pick([0xff5a5f, 0xf3d9a4, 0x2a9d8f, 0xffc93c]));

    // the famous falafel stand – its own sign texture
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
    const booth = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 3.5), new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8 }));
    booth.position.y = 1.6; booth.castShadow = booth.receiveShadow = true;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.55), new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 }));
    signMesh.position.set(0, 3.9, 1.8);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a9d8f }));
    counter.position.set(0, 0.55, 2.1); counter.castShadow = true;
    // rotating shawarma spit
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x9c5a2a, roughness: 0.6 }));
    spit.position.set(-1.8, 1.9, 1.2); spit.name = 'shawarma-spit';
    stand.add(booth, signMesh, counter, spit);
    stand.position.set(-60, 0, -11);
    this.group.add(stand);
    this.colliders.addBox(-60, -11, 6, 4.4, 3.2);
    this.nightMaterials.push({ mat: signMesh.material as THREE.MeshStandardMaterial, max: 1.4 });

    // plastic chairs around the stand
    for (let i = 0; i < 10; i++) this.I.chair.add(-64 + rnd.range(0, 8), 0, -6 + rnd.range(-1, 1.5), 1, 1, 1, rnd.range(0, Math.PI * 2));
  }

  // ---------------------------------------------------------------- beach
  private buildBeach() {
    const rnd = this.rng;
    // promenade tiles + low wall
    this.I.plain.add(-206.5, -0.4, 0, 13, 0.5, 820, 0, 0xd8c6a8);
    for (let z = -390; z < 390; z += 8) this.I.plain.add(-213.2, 0, z + 4, 0.5, 0.5, 7.8, 0, z % 16 === 0 ? 0xe9e3d8 : 0xd9d1c3);
    const umbrellaColors = [0xff3b6b, 0x3ad1ff, 0xffd23f, 0x7cfc5a, 0xff8c1a, 0x9b5cff, 0xffffff];
    for (let i = 0; i < 160; i++) {
      const x = rnd.range(-292, -222), z = rnd.range(-380, 380);
      const y = terrainHeight(x, z);
      this.I.umbrella.add(x, y, z, 1, 1, 1, rnd.range(0, 6.28), rnd.pick(umbrellaColors), rnd.range(-0.08, 0.08), rnd.range(-0.08, 0.08));
      if (rnd.chance(0.7)) this.I.lounger.add(x + rnd.range(-1.2, 1.2), y, z + rnd.range(-1.2, 1.2), 1, 1, 1, rnd.range(-0.4, 0.4) + Math.PI / 2, rnd.pick([0xffffff, 0x3ad1ff, 0xff7aa8]));
      if (rnd.chance(0.25)) this.I.chair.add(x + rnd.range(-2, 2), y, z + rnd.range(-2, 2), 1, 1, 1, rnd.range(0, 6.28));
    }
    for (const z of [-260, -90, 80, 250]) {
      const x = -275, y = terrainHeight(x, z);
      this.I.lifeguard.add(x, y, z, 1, 1, 1, -Math.PI / 2);
      this.colliders.addBox(x, z, 3.6, 3.6, 5.8, y + 3.0); // standing on the deck is possible; legs pass-through
    }
    for (let z = -380; z < 390; z += 14) {
      this.I.palm.add(-207, 0, z, rnd.range(0.85, 1.15), rnd.range(0.9, 1.2), rnd.range(0.85, 1.15), rnd.range(0, 6.28));
      if (z % 28 === 0) this.I.bench.add(-209.5, 0, z + 7, 1, 1, 1, -Math.PI / 2);
    }
  }

  // ---------------------------------------------------------------- Ayalon
  private buildAyalon() {
    const { west, east, median } = CITY.ayalon;
    const zMin = -400, zMax = 400;
    this.roadSegment((west + median[0]) / 2, zMin, (west + median[0]) / 2, zMax, median[0] - west, false);
    this.roadSegment((median[1] + east) / 2, zMin, (median[1] + east) / 2, zMax, east - median[1], false);
    // lane markings: 4 lanes each direction
    for (const [a, b] of [[west, median[0]], [median[1], east]] as const) {
      const lw = (b - a) / 4;
      for (let l = 1; l < 4; l++) for (let z = zMin; z < zMax; z += 9) this.I.paint.add(a + l * lw, 0.07, z, 0.15, 0.01, 4);
      this.I.paint.add(a + 0.4, 0.07, 0, 0.15, 0.01, 800);
      this.I.paint.add(b - 0.4, 0.07, 0, 0.15, 0.01, 800, 0, 0xffd23f);
    }
    // median with train tracks (yes, the train really runs in the middle)
    this.I.plain.add((median[0] + median[1]) / 2, 0, 0, median[1] - median[0], 0.25, 800, 0, 0x7d746a);
    for (const tx of [103, 107]) {
      for (const off of [-0.72, 0.72]) this.I.plain.add(tx + off, 0.25, 0, 0.1, 0.15, 800, 0, 0x8a8f96);
      for (let z = zMin; z < zMax; z += 1.2) this.I.plain.add(tx, 0.22, z, 2.4, 0.1, 0.25, 0, 0x5a4a3a);
    }
    // barriers & noise walls (gaps at crossings)
    const gaps = [0, -150, 90, ...CITY.streetsZ.filter((z) => z === -150 || z === 90)];
    const wallSeg = (x: number, h: number, thick: number, color: number) => {
      let z = zMin;
      const cuts = [...new Set(gaps)].sort((a, b) => a - b);
      for (const g of cuts) {
        const zEnd = g - 9;
        if (zEnd > z) { this.I.plain.add(x, 0, (z + zEnd) / 2, thick, h, zEnd - z, 0, color); this.colliders.addBox(x, (z + zEnd) / 2, thick, zEnd - z, h); }
        z = g + 9;
      }
      this.I.plain.add(x, 0, (z + zMax) / 2, thick, h, zMax - z, 0, color);
      this.colliders.addBox(x, (z + zMax) / 2, thick, zMax - z, h);
    };
    wallSeg(median[0] - 0.3, 1.0, 0.6, 0xc9c4bb);
    wallSeg(median[1] + 0.3, 1.0, 0.6, 0xc9c4bb);
    wallSeg(west - 1.5, 3.5, 0.4, 0xa9b2a0);
    wallSeg(east + 1.5, 3.5, 0.4, 0xa9b2a0);

    // overhead sign gantries
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
      for (const x of [west - 1, east + 1]) this.I.plain.add(x, 0, z, 0.5, 8, 0.5, 0, 0x8d939b);
      this.I.plain.add((west + east) / 2, 7.6, z, east - west + 2, 0.5, 0.5, 0, 0x8d939b);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05 }));
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
    const stoneColors = [0xe8d6b0, 0xe2cca0, 0xedddb9, 0xd9c193, 0xf0e2c2];
    const wallH = 12, wallT = 3;
    const wallColor = 0xdcc595;
    // walls with a gate on the west side and the east side
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = Math.abs(x1 - x0) || wallT, d = Math.abs(z1 - z0) || wallT;
      this.I.stone.add(cx, base - 2, cz, w, wallH + 2, d, 0, wallColor);
      this.colliders.addBox(cx, cz, w, d, wallH, base);
      // crenellations
      const len = Math.max(w, d);
      for (let t = -len / 2 + 1; t < len / 2; t += 2.4) {
        const px = w > d ? cx + t : cx, pz = w > d ? cz : cz + t;
        this.I.stone.add(px, base + wallH, pz, w > d ? 1.2 : wallT, 1.3, w > d ? wallT : 1.2, 0, wallColor);
      }
    };
    const gateHalf = 5;
    wall(minX, minZ, minX, gateZ - gateHalf); wall(minX, gateZ + gateHalf, minX, maxZ);
    wall(maxX, minZ, maxX, gateZ - gateHalf); wall(maxX, gateZ + gateHalf, maxX, maxZ);
    wall(minX, minZ, maxX, minZ); wall(minX, maxZ, maxX, maxZ);
    // gate towers + arch lintel (walk underneath)
    for (const gx of [minX, maxX]) {
      for (const s of [-1, 1]) {
        this.I.stone.add(gx, base - 2, gateZ + s * (gateHalf + 3), 7, wallH + 6, 6, 0, 0xd4bb88);
        this.colliders.addBox(gx, gateZ + s * (gateHalf + 3), 7, 6, wallH + 4, base);
      }
      this.I.stone.add(gx, base + 7, gateZ, 7, wallH - 3, gateHalf * 2, 0, 0xd4bb88);
      this.colliders.addBox(gx, gateZ, 7, gateHalf * 2, wallH - 3, base + 7);
    }
    // corner towers
    for (const cx of [minX, maxX]) for (const cz of [minZ, maxZ]) {
      this.I.stone.add(cx, base - 2, cz, 9, wallH + 7, 9, 0, 0xd4bb88);
      this.colliders.addBox(cx, cz, 9, 9, wallH + 5, base);
    }
    // ground paving inside
    this.I.plain.add((minX + maxX) / 2, base - 0.45, (minZ + maxZ) / 2, maxX - minX, 0.5, maxZ - minZ, 0, 0xcdb994);

    // dense alleys: grid of small stone houses with 3.5m lanes
    const cell = 11, lane = 3.6;
    const plaza = { x: 590, z: 0, r: 20 };
    for (let x = minX + 6; x < maxX - 6; x += cell) {
      for (let z = minZ + 6; z < maxZ - 6; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        if (Math.abs(cz - gateZ) < 6) continue; // main east-west market lane
        if (Math.abs(cx - 590) < 5) continue; // north-south lane
        if (Math.hypot(cx - plaza.x, cz - plaza.z) < plaza.r) continue;
        const w = cell - lane + rnd.range(-0.5, 0.8), d = cell - lane + rnd.range(-0.5, 0.8);
        const h = rnd.range(5, 11);
        this.addBuilding('stone', cx, cz, w, d, h, rnd.pick(stoneColors), base - 0.4);
      }
    }
    // a golden-hour landmark: a big generic stone dome on a drum in the plaza edge (not a real building)
    this.I.stone.add(plaza.x + 30, base, plaza.z - 30, 14, 10, 14, 0, 0xead9b5);
    this.I.dome.add(plaza.x + 30, base + 10, plaza.z - 30, 6.5, 6.5, 6.5, 0, 0xd8b45a);
    this.colliders.addBox(plaza.x + 30, plaza.z - 30, 14, 14, 16.5, base);
    // string lights along the main lane
    for (let x = minX + 8; x < maxX - 8; x += 1.2) this.I.bulb.add(x, base + 4.2 + Math.sin(x * 0.5) * 0.25, gateZ + 2.2);
    for (let i = 0; i < 6; i++) this.I.olive.add(plaza.x + rnd.range(-12, 12), base, plaza.z + rnd.range(-12, 12), 1, 1, 1, rnd.range(0, 6.28));

    // new city outside the walls
    for (let i = 0; i < 70; i++) {
      const x = rnd.range(470, 700), z = rnd.range(-250, 250);
      if (x > minX - 25 && x < maxX + 25 && z > minZ - 25 && z < maxZ + 25) continue;
      if (Math.abs(z) < 18 && x < minX) continue; // keep the road in
      const y = terrainHeight(x, z);
      this.addBuilding('stone', x, z, rnd.range(10, 18), rnd.range(10, 18), rnd.range(9, 20), rnd.pick(stoneColors), y - 1.5);
    }
    // road from Route 1 end into the west gate
    this.I.road.add((minX - 6 + minX - 60) / 2, base + 0.02, 0, 56, 0.06, 12);
  }

  // ---------------------------------------------------------------- vegetation + lights
  private buildVegetationAndLights() {
    const rnd = this.rng;
    const { streetsX, streetsZ, streetW } = CITY;
    // street trees + lamps on city sidewalks
    for (const x of streetsX.slice(1)) for (let z = -290; z < 290; z += 22) {
      if (Math.abs(z) < 10) continue;
      for (const side of [-1, 1]) {
        const px = x + side * (streetW / 2 + 1.4);
        if (rnd.chance(0.6)) this.I.ficus.add(px, 0, z + rnd.range(-2, 2), rnd.range(0.8, 1.15), rnd.range(0.8, 1.2), rnd.range(0.8, 1.15), rnd.range(0, 6.28));
        if ((z / 22) % 2 === 0) this.addLamp(px, 0, z + 11, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    // boulevard median on z=-90 (benches + trees, à la the famous boulevard)
    this.I.plain.add(-73, 0, -90, 138, 0.25, 4, 0, 0xc2a77e);
    for (let x = -136; x < -10; x += 9) {
      this.I.ficus.add(x, 0.25, -90, 1, 1.1, 1, rnd.range(0, 6.28));
      if (rnd.chance(0.5)) this.I.bench.add(x + 4.5, 0.25, -91.2, 1, 1, 1, 0);
    }
    for (const z of streetsZ) for (let x = -170; x < 60; x += 46) this.addLamp(x, 0, z + streetW / 2 + 1.2, Math.PI);
    // Ayalon lamps
    for (let z = -390; z < 400; z += 30) this.addLamp(CITY.ayalon.west - 2.5, 0, z, Math.PI / 2), this.addLamp(CITY.ayalon.east + 2.5, 0, z, -Math.PI / 2);
    // Route 1: lamps + cypress & olive trees on the Judean hills
    for (let x = CITY.ayalon.east + 20; x < CITY.jeru.minX - 10; x += 40) {
      this.addLamp(x, terrainHeight(x, 0), 9.5, Math.PI);
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd.range(220, 710), z = rnd.range(-390, 390);
      if (Math.abs(z) < 14) continue;
      const { minX, maxX, minZ, maxZ } = CITY.jeru;
      if (x > minX - 8 && x < maxX + 8 && z > minZ - 8 && z < maxZ + 8) continue;
      const y = terrainHeight(x, z);
      if (rnd.chance(0.55)) this.I.cypress.add(x, y - 0.2, z, rnd.range(0.7, 1.3), rnd.range(0.7, 1.4), rnd.range(0.7, 1.3), 0);
      else this.I.olive.add(x, y - 0.2, z, rnd.range(0.7, 1.3), rnd.range(0.7, 1.2), rnd.range(0.7, 1.3), rnd.range(0, 6.28));
    }
    // palms in the tower district
    for (let z = -380; z < 380; z += 20) if (Math.abs(z) > 14) this.I.palm.add(142, 0, z, 1, 1, 1, rnd.range(0, 6.28));
  }

  private addLamp(x: number, y: number, z: number, rot: number) {
    this.I.lampPole.add(x, y, z, 1, 1, 1, rot);
    this.I.lampHead.add(x, y, z, 1, 1, 1, rot);
  }

  private finalize() {
    for (const inst of Object.values(this.I)) if (inst.count > 0) this.group.add(inst.build());
    this.nightMaterials.push({ mat: this.mats.glow, max: 3.0 }, { mat: this.mats.bulbs, max: 4.0 });
    // tiny ground decals to break up flat sidewalks could go here (stage 7)
    void worldUniforms;
  }

  runtime(): CityRuntime {
    return { group: this.group, colliders: this.colliders, nightMaterials: this.nightMaterials };
  }
}
