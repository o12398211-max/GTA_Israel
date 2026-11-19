import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../world/Materials';

/**
 * Vehicle "kits": geometry grouped by material so the same model can be drawn
 * as individual meshes (player vehicles, with spinning wheels) or as
 * InstancedMeshes (traffic: one draw call per part for all cars of a type).
 * Forward = +Z, ground at y=0.
 */
export type VehicleType = 'sedan' | 'hatch' | 'taxi' | 'police' | 'bus' | 'moto' | 'scooter' | 'ebike' | 'plane';

export interface WheelDef { x: number; y: number; z: number; r: number; width: number; steer: boolean; drive: boolean }
export interface VehicleKit {
  type: VehicleType;
  parts: { key: 'paint' | 'glass' | 'rubber' | 'metal' | 'trim' | 'light' | 'tail' | 'plate' | 'decal' | 'siren'; geometry: THREE.BufferGeometry }[];
  wheels: WheelDef[];
  wheelGeo: { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null;
  size: THREE.Vector3; // chassis half-extents for physics
  mass: number;
  seat: THREE.Vector3; // driver position (for the character)
  twoWheeler: boolean;
  /** tuning */ engine: number; maxSpeed: number; steer: number; grip: number;
}

const M = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.96, envMapIntensity: 1.4 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.25 }),
  trim: () => new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.2 }),
  light: () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 0.6, roughness: 0.2 }),
  tail: () => new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.4, roughness: 0.3 }),
  plate: () => new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }),
  decal: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, vertexColors: true }),
  siren: () => new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 2, roughness: 0.3 }),
};
export type PartKey = keyof typeof M;

let plateTex: THREE.Texture | null = null;
function plateTexture() {
  // Israeli-style yellow plate (generic digits)
  plateTex ??= canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#f7c900'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#1d3fa6'; ctx.fillRect(0, 0, 34, 64);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.fillText('IL', 8, 54);
    ctx.fillStyle = '#111'; ctx.font = 'bold 40px Arial'; ctx.fillText('12·345·67', 44, 46);
  });
  return plateTex;
}

const cache = new Map<PartKey, THREE.Material>();
/** Shared materials (paint is tinted by instanceColor / per-mesh clone). */
export function partMaterial(k: PartKey): THREE.Material {
  if (!cache.has(k)) cache.set(k, M[k]());
  return cache.get(k)!;
}

const rbox = (w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0) => new RoundedBoxGeometry(w, h, d, 2, r).translate(x, y, z);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r: number, h: number, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'y', seg = 10) => {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
};
function taper(g: THREE.BufferGeometry, yAbove: number, sx: number, sz: number, zShift = 0) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > yAbove) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz + zShift); }
  g.computeVertexNormals();
  return g;
}
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  const hasColor = prepared.some((g) => g.attributes.color);
  if (hasColor) for (const g of prepared) if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return mergeGeometries(prepared, false)!;
}
function colorize(g: THREE.BufferGeometry, c: THREE.ColorRepresentation) {
  const n = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const a = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; }
  n.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return n;
}

function wheelGeo(r: number, w: number) {
  return {
    tire: cyl(r, w, 0, 0, 0, 'x', 12),
    rim: mergeAll([cyl(r * 0.62, w + 0.02, 0, 0, 0, 'x', 8), ...[0, 1, 2].map((i) => box(w + 0.03, r * 0.95, 0.06).rotateX((i / 3) * Math.PI))]),
  };
}

/** Car-like body (sedan / hatch / taxi / police). */
function carKit(type: 'sedan' | 'hatch' | 'taxi' | 'police'): VehicleKit {
  const L = type === 'hatch' ? 3.9 : 4.5, W = 1.8, wheelR = 0.33;
  const paint: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [];
  const light: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [], plate: THREE.BufferGeometry[] = [], decal: THREE.BufferGeometry[] = [], siren: THREE.BufferGeometry[] = [];
  // lower body
  paint.push(rbox(W, 0.62, L, 0.16, 0, 0.62, 0));
  // hood / trunk slope
  paint.push(taper(rbox(W - 0.02, 0.2, L * 0.98, 0.1, 0, 0.98, 0), 1.0, 0.98, 0.97));
  // cabin (glass) with tapered top -> sloped windows
  const cabL = type === 'hatch' ? 2.3 : 2.4, cabZ = type === 'hatch' ? -0.35 : -0.15;
  glass.push(taper(rbox(W - 0.14, 0.62, cabL, 0.14, 0, 1.36, cabZ), 1.4, 0.88, 0.72, type === 'hatch' ? -0.05 : -0.04));
  // roof
  paint.push(taper(rbox(W - 0.3, 0.08, cabL * 0.7, 0.04, 0, 1.68, cabZ - 0.03), 1.6, 1, 1));
  // pillars
  for (const s of [-1, 1]) paint.push(box(0.06, 0.6, 0.08, s * (W / 2 - 0.12), 1.36, cabZ + cabL * 0.06).rotateX(0));
  // bumpers, grille, mirrors, side skirts
  trim.push(rbox(W + 0.04, 0.22, 0.25, 0.08, 0, 0.42, L / 2 - 0.05), rbox(W + 0.04, 0.22, 0.25, 0.08, 0, 0.42, -L / 2 + 0.05));
  trim.push(box(W * 0.55, 0.16, 0.04, 0, 0.72, L / 2 + 0.01));
  for (const s of [-1, 1]) {
    trim.push(rbox(0.12, 0.1, 0.2, 0.03, s * (W / 2 + 0.06), 1.12, cabZ + cabL / 2 - 0.1));
    trim.push(box(0.04, 0.12, L * 0.55, s * (W / 2 + 0.01), 0.36, 0));
    light.push(rbox(0.42, 0.12, 0.06, 0.03, s * (W / 2 - 0.3), 0.82, L / 2 + 0.01));
    tail.push(rbox(0.4, 0.14, 0.06, 0.03, s * (W / 2 - 0.3), 0.86, -L / 2 - 0.01));
    // door handles + door seams
    metal.push(box(0.03, 0.03, 0.16, s * (W / 2 + 0.005), 0.92, 0.15), box(0.03, 0.03, 0.16, s * (W / 2 + 0.005), 0.92, -0.85));
    trim.push(box(0.01, 0.55, 0.012, s * (W / 2 + 0.002), 0.7, -0.45));
    // wheel arches
    for (const z of [L / 2 - 0.85, -L / 2 + 0.8]) trim.push(cyl(wheelR + 0.08, 0.12, s * (W / 2 - 0.04), 0.33, z, 'x', 10));
  }
  plate.push(box(0.52, 0.12, 0.01, 0, 0.48, L / 2 + 0.19), box(0.52, 0.12, 0.01, 0, 0.5, -L / 2 - 0.19).rotateY(Math.PI));
  if (type === 'taxi') {
    decal.push(colorize(rbox(0.6, 0.18, 0.28, 0.05, 0, 1.8, cabZ), 0xffd400));
    decal.push(colorize(box(0.02, 0.12, L * 0.8, W / 2 + 0.005, 0.75, 0), 0x222222), colorize(box(0.02, 0.12, L * 0.8, -W / 2 - 0.005, 0.75, 0), 0x222222));
  }
  if (type === 'police') {
    for (const s of [-1, 1]) decal.push(colorize(box(0.02, 0.22, L * 0.9, s * (W / 2 + 0.006), 0.72, 0), 0x1b3fa8));
    trim.push(box(1.1, 0.08, 0.3, 0, 1.74, cabZ));
    siren.push(box(0.42, 0.12, 0.26, -0.3, 1.82, cabZ), box(0.42, 0.12, 0.26, 0.3, 1.82, cabZ));
  }
  const parts: VehicleKit['parts'] = [];
  const add = (key: VehicleKit['parts'][number]['key'], list: THREE.BufferGeometry[]) => { if (list.length) parts.push({ key, geometry: mergeAll(list) }); };
  add('paint', paint); add('glass', glass); add('trim', trim); add('metal', metal); add('light', light); add('tail', tail); add('plate', plate); add('decal', decal); add('siren', siren);
  const wz = [L / 2 - 0.85, -L / 2 + 0.8];
  return {
    type, parts,
    wheels: [
      { x: W / 2 - 0.12, y: wheelR, z: wz[0], r: wheelR, width: 0.24, steer: true, drive: false },
      { x: -W / 2 + 0.12, y: wheelR, z: wz[0], r: wheelR, width: 0.24, steer: true, drive: false },
      { x: W / 2 - 0.12, y: wheelR, z: wz[1], r: wheelR, width: 0.24, steer: false, drive: true },
      { x: -W / 2 + 0.12, y: wheelR, z: wz[1], r: wheelR, width: 0.24, steer: false, drive: true },
    ],
    wheelGeo: wheelGeo(wheelR, 0.24),
    size: new THREE.Vector3(W / 2, 0.45, L / 2), mass: 1200,
    seat: new THREE.Vector3(0.38, 0.45, -0.2), twoWheeler: false,
    engine: type === 'police' ? 9000 : 7200, maxSpeed: type === 'police' ? 52 : 44, steer: 0.55, grip: 2.4,
  };
}

function busKit(): VehicleKit {
  const L = 11, W = 2.5, H = 3.0;
  const paintG = [rbox(W, H - 0.4, L, 0.2, 0, 0.4 + (H - 0.4) / 2, 0)];
  const glassG: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) glassG.push(box(0.02, 1.0, L - 1.4, s * (W / 2 + 0.005), 2.1, -0.2));
  glassG.push(box(W - 0.3, 1.3, 0.02, 0, 1.9, L / 2 + 0.005));
  const decalG = [colorize(box(W + 0.02, 0.35, L - 0.4, 0, 1.2, 0), 0x1f8a4c), colorize(box(W - 0.6, 0.3, 0.02, 0, 2.75, L / 2 + 0.01), 0xff8c00)];
  const trimG = [rbox(W + 0.04, 0.3, 0.3, 0.1, 0, 0.5, L / 2), rbox(W + 0.04, 0.3, 0.3, 0.1, 0, 0.5, -L / 2)];
  const wheelR = 0.5;
  return {
    type: 'bus',
    parts: [{ key: 'paint', geometry: mergeAll(paintG) }, { key: 'glass', geometry: mergeAll(glassG) }, { key: 'decal', geometry: mergeAll(decalG) }, { key: 'trim', geometry: mergeAll(trimG) },
      { key: 'light', geometry: mergeAll([box(0.4, 0.15, 0.04, 0.9, 0.8, L / 2 + 0.02), box(0.4, 0.15, 0.04, -0.9, 0.8, L / 2 + 0.02)]) }],
    wheels: [
      { x: W / 2 - 0.2, y: wheelR, z: L / 2 - 2, r: wheelR, width: 0.35, steer: true, drive: false },
      { x: -W / 2 + 0.2, y: wheelR, z: L / 2 - 2, r: wheelR, width: 0.35, steer: true, drive: false },
      { x: W / 2 - 0.2, y: wheelR, z: -L / 2 + 2.4, r: wheelR, width: 0.35, steer: false, drive: true },
      { x: -W / 2 + 0.2, y: wheelR, z: -L / 2 + 2.4, r: wheelR, width: 0.35, steer: false, drive: true },
    ],
    wheelGeo: wheelGeo(wheelR, 0.35),
    size: new THREE.Vector3(W / 2, 1.2, L / 2), mass: 9000, seat: new THREE.Vector3(0.7, 1.0, L / 2 - 1.2), twoWheeler: false,
    engine: 30000, maxSpeed: 25, steer: 0.5, grip: 2.0,
  };
}

function twoWheelKit(type: 'moto' | 'scooter' | 'ebike'): VehicleKit {
  const paintG: THREE.BufferGeometry[] = [], trimG: THREE.BufferGeometry[] = [], metalG: THREE.BufferGeometry[] = [], lightG: THREE.BufferGeometry[] = [];
  let r = 0.32, wb = 1.4, seatY = 0.8;
  if (type === 'moto') {
    paintG.push(taper(rbox(0.34, 0.32, 0.9, 0.12, 0, 0.82, 0.15), 0.85, 0.9, 0.8), rbox(0.3, 0.12, 0.7, 0.05, 0, 0.92, -0.35));
    trimG.push(rbox(0.3, 0.3, 0.5, 0.08, 0, 0.5, 0), box(0.6, 0.04, 0.04, 0, 1.08, 0.6));
    metalG.push(cyl(0.035, 0.8, 0, 0.75, 0.62, 'y').rotateX(-0.3), cyl(0.05, 0.7, 0.14, 0.4, -0.45, 'z'));
    lightG.push(cyl(0.09, 0.05, 0, 0.95, 0.72, 'z'));
  } else if (type === 'scooter') {
    r = 0.11; wb = 0.85; seatY = 0.2;
    trimG.push(rbox(0.16, 0.05, 0.7, 0.02, 0, 0.14, 0));
    metalG.push(cyl(0.022, 1.0, 0, 0.62, 0.4, 'y').rotateX(-0.08), box(0.45, 0.03, 0.03, 0, 1.12, 0.45));
    paintG.push(rbox(0.12, 0.1, 0.2, 0.03, 0, 0.25, 0.42));
    lightG.push(cyl(0.03, 0.03, 0, 0.92, 0.46, 'z'));
  } else {
    r = 0.33; wb = 1.1; seatY = 0.78;
    metalG.push(cyl(0.025, 0.75, 0, 0.55, 0.1, 'z').rotateX(0.25), cyl(0.025, 0.6, 0, 0.55, -0.25, 'y').rotateX(0.35), cyl(0.022, 0.7, 0, 0.75, 0.48, 'y').rotateX(-0.25), box(0.55, 0.03, 0.03, 0, 1.08, 0.42));
    paintG.push(rbox(0.12, 0.28, 0.42, 0.04, 0, 0.5, -0.05)); // battery
    trimG.push(rbox(0.16, 0.06, 0.26, 0.03, 0, 0.88, -0.35));
    lightG.push(cyl(0.035, 0.04, 0, 0.95, 0.5, 'z'));
  }
  const parts: VehicleKit['parts'] = [];
  if (paintG.length) parts.push({ key: 'paint', geometry: mergeAll(paintG) });
  parts.push({ key: 'trim', geometry: mergeAll(trimG) }, { key: 'metal', geometry: mergeAll(metalG) }, { key: 'light', geometry: mergeAll(lightG) });
  // physics uses 4 wheels close together for stability; visuals show 2 (x = 0)
  const tw = type === 'scooter' ? 0.12 : 0.18;
  return {
    type, parts,
    wheels: [
      { x: tw, y: r, z: wb / 2, r, width: 0.1, steer: true, drive: false }, { x: -tw, y: r, z: wb / 2, r, width: 0.1, steer: true, drive: false },
      { x: tw, y: r, z: -wb / 2, r, width: 0.1, steer: false, drive: true }, { x: -tw, y: r, z: -wb / 2, r, width: 0.1, steer: false, drive: true },
    ],
    wheelGeo: wheelGeo(r, type === 'scooter' ? 0.05 : 0.09),
    size: new THREE.Vector3(0.25, 0.25, wb / 2 + 0.1), mass: type === 'moto' ? 220 : 60,
    seat: new THREE.Vector3(0, seatY, type === 'scooter' ? 0 : -0.15), twoWheeler: true,
    engine: type === 'moto' ? 2400 : type === 'ebike' ? 420 : 300, maxSpeed: type === 'moto' ? 50 : type === 'ebike' ? 9 : 7, steer: 0.6, grip: 2.6,
  };
}

function planeKit(): VehicleKit {
  const paintG = [
    taper(rbox(1.3, 1.3, 6.5, 0.5, 0, 1.5, 0), 1.4, 0.8, 1),
    rbox(10.5, 0.14, 1.5, 0.06, 0, 2.1, 0.4), // wing
    rbox(3.4, 0.1, 0.9, 0.04, 0, 1.75, -3.0), // tail plane
    rbox(0.1, 1.3, 1.0, 0.04, 0, 2.3, -3.0), // fin
  ];
  const glassG = [taper(rbox(1.15, 0.6, 1.6, 0.25, 0, 2.15, 1.0), 2.2, 0.8, 0.7)];
  const trimG = [cyl(0.05, 1.1, 0.9, 0.55, 0.6, 'y'), cyl(0.05, 1.1, -0.9, 0.55, 0.6, 'y'), rbox(0.4, 0.4, 0.3, 0.1, 0, 1.5, 3.35)];
  const decal = [colorize(box(1.32, 0.18, 6.3, 0, 1.3, 0), 0xd8262e)];
  return {
    type: 'plane',
    parts: [{ key: 'paint', geometry: mergeAll(paintG) }, { key: 'glass', geometry: mergeAll(glassG) }, { key: 'trim', geometry: mergeAll(trimG) }, { key: 'decal', geometry: mergeAll(decal) },
      { key: 'metal', geometry: mergeAll([box(0.1, 1.9, 0.12, 0, 0, 0)]) }],
    wheels: [
      { x: 0.9, y: 0.28, z: 0.6, r: 0.28, width: 0.15, steer: false, drive: false }, { x: -0.9, y: 0.28, z: 0.6, r: 0.28, width: 0.15, steer: false, drive: false },
      { x: 0, y: 0.2, z: -2.6, r: 0.2, width: 0.1, steer: true, drive: false },
    ],
    wheelGeo: wheelGeo(0.28, 0.15),
    size: new THREE.Vector3(0.7, 0.7, 3.3), mass: 800, seat: new THREE.Vector3(0, 1.4, 0.8), twoWheeler: false,
    engine: 0, maxSpeed: 70, steer: 0.5, grip: 1,
  };
}

/** Far-LOD car: a handful of boxes (body tinted by instance color, dark cabin, wheels). */
export function lowPolyGeometry(kit: VehicleKit): THREE.BufferGeometry {
  const { x: hx, y: hy, z: hz } = kit.size;
  const parts = [
    colorize(box(hx * 2, hy * 1.3, hz * 2, 0, hy * 0.65 + 0.25, 0), 0xffffff),
    colorize(box(hx * 1.7, hy * 1.1, hz * 1.05, 0, hy * 1.3 + 0.25 + hy * 0.5, -hz * 0.08), 0x1a1d22),
  ];
  for (const w of kit.wheels) parts.push(colorize(box(w.width, w.r * 2, w.r * 2, w.x, w.r, w.z), 0x151515));
  return mergeAll(parts);
}

const kits = new Map<VehicleType, VehicleKit>();
export function getKit(t: VehicleType): VehicleKit {
  if (!kits.has(t)) {
    kits.set(t, t === 'bus' ? busKit() : t === 'plane' ? planeKit() : (t === 'moto' || t === 'scooter' || t === 'ebike') ? twoWheelKit(t) : carKit(t));
  }
  return kits.get(t)!;
}

export const PAINTS = [0xf2f2f2, 0x202226, 0x9aa1aa, 0xb3122a, 0x1d4e9e, 0x6a7a52, 0xe8e2d0, 0x3c3f46, 0xd9a520, 0x5b2a86];

/** Build a stand-alone vehicle model (player vehicles). */
export function buildVehicleModel(kit: VehicleKit, paint: THREE.ColorRepresentation): { group: THREE.Group; wheels: THREE.Object3D[]; sirens: THREE.Mesh | null } {
  const group = new THREE.Group();
  let sirens: THREE.Mesh | null = null;
  const paintMat = (partMaterial('paint') as THREE.MeshPhysicalMaterial).clone();
  paintMat.color.set(paint);
  for (const p of kit.parts) {
    const mat = p.key === 'paint' ? paintMat : p.key === 'siren' ? partMaterial('siren').clone() : partMaterial(p.key);
    const m = new THREE.Mesh(p.geometry, mat);
    m.castShadow = true; m.receiveShadow = true;
    if (p.key === 'siren') sirens = m;
    group.add(m);
  }
  const wheels: THREE.Object3D[] = [];
  if (kit.wheelGeo) {
    const vis = kit.twoWheeler ? [kit.wheels[0], kit.wheels[2]].map((w) => ({ ...w, x: 0 })) : kit.wheels;
    for (const w of vis) {
      const pivot = new THREE.Group();
      pivot.position.set(w.x, w.y, w.z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(kit.wheelGeo.tire, partMaterial('rubber')); t.castShadow = true;
      const r = new THREE.Mesh(kit.wheelGeo.rim, partMaterial('metal'));
      spin.add(t, r);
      pivot.add(spin);
      group.add(pivot);
      wheels.push(pivot);
    }
  }
  return { group, wheels, sirens };
}
