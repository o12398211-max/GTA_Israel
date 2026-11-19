/**
 * Pure terrain math shared by the client and the multiplayer server (no three.js).
 * +x = east, -z = north. See src/world/Terrain.ts for the zone layout.
 */
export const WORLD = {
  minX: -420, maxX: 720, minZ: -400, maxZ: 400,
  shoreX: -305,
  seaLevel: 0,
  jerusalemHeight: 14,
  climbStart: 230, climbEnd: 440,
} as const;

export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// cheap deterministic value noise
export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x: number, z: number): number {
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

