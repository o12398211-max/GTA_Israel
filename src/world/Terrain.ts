import * as THREE from 'three';

/**
 * World layout (meters). +x = east, -z = north.
 *   Sea        x < -330
 *   Beach      -330 .. -200   (טיילת וחוף)
 *   City/Shuk  -200 ..   70   (שוק ודוכני אוכל, בניינים לבנים)
 *   Ayalon       70 ..  220   (נתיבי איילון + מגדלים)
 *   Route 1     220 ..  460   (העלייה לירושלים)
 *   Jerusalem   460 ..  720   (העיר העתיקה, אבן ירושלמית)
 */
export const WORLD = {
  minX: -420, maxX: 720, minZ: -400, maxZ: 400,
  shoreX: -305,
  seaLevel: 0,
  jerusalemHeight: 14,
  climbStart: 230, climbEnd: 440,
} as const;

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

// cheap deterministic value noise
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Analytic terrain height – the single source of truth for ground. */
export function terrainHeight(x: number, z: number): number {
  // beach slopes into the sea
  if (x < WORLD.shoreX + 40) {
    const beach = 0.35 * smooth(WORLD.shoreX - 2, WORLD.shoreX + 40, x);
    const under = -5 * (1 - smooth(WORLD.shoreX - 70, WORLD.shoreX, x));
    return beach + under;
  }
  let h = WORLD.jerusalemHeight * smooth(WORLD.climbStart, WORLD.climbEnd, x);
  // Judean hills on both sides of Route 1 – road corridor stays smooth
  if (x > 190 && x < 520) {
    const away = smooth(16, 70, Math.abs(z));
    const fade = smooth(190, 260, x) * (1 - smooth(470, 520, x));
    const n = vnoise(x * 0.012, z * 0.012) * 0.7 + vnoise(x * 0.04, z * 0.04) * 0.3;
    h += away * fade * (6 + n * 34);
  }
  // Jerusalem: gentle hills outside the walls
  if (x >= 460) {
    const outside = smooth(110, 170, Math.max(Math.abs(z), Math.abs(x - 580) + 0));
    h += outside * vnoise(x * 0.02, z * 0.02) * 14;
  }
  return h;
}

/** Ground color per zone, used for terrain vertex colors. */
export function groundColor(x: number, z: number, out: THREE.Color): THREE.Color {
  const n = hash2(Math.floor(x * 0.5), Math.floor(z * 0.5)) * 0.06;
  if (x < WORLD.shoreX + 3) return out.setRGB(0.76 + n, 0.68 + n, 0.5, THREE.SRGBColorSpace);
  if (x < -213) {
    const wet = 1 - smooth(WORLD.shoreX, WORLD.shoreX + 10, x);
    return out.setRGB(0.84 - wet * 0.2 + n, 0.74 - wet * 0.18 + n, 0.55 - wet * 0.12, THREE.SRGBColorSpace);
  }
  if (x < 70) return out.setRGB(0.62 + n, 0.6 + n, 0.56 + n, THREE.SRGBColorSpace); // sidewalk concrete
  if (x < 220) return out.setRGB(0.5 + n, 0.52 + n, 0.42, THREE.SRGBColorSpace);
  if (x < 460) {
    const rock = smooth(4, 20, terrainHeight(x, z) - WORLD.jerusalemHeight * smooth(WORLD.climbStart, WORLD.climbEnd, x));
    return out.setRGB(0.5 - rock * 0.06 + n, 0.46 - rock * 0.04 + n, 0.3 + rock * 0.06, THREE.SRGBColorSpace);
  }
  return out.setRGB(0.6 + n, 0.52 + n, 0.38 + n, THREE.SRGBColorSpace); // jerusalem earth
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
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    groundColor(x, z, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
