/**
 * Static world collision: axis-aligned boxes in a uniform spatial hash.
 * Stage 2 will mirror these into Rapier; the hash stays for cheap camera/AI queries.
 */
export interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

const CELL = 16;

export class ColliderWorld {
  readonly boxes: AABB[] = [];
  private grid = new Map<number, number[]>();

  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }

  add(b: AABB): void {
    const idx = this.boxes.push(b) - 1;
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
      for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(idx);
      }
  }

  addBox(cx: number, cz: number, w: number, d: number, h: number, baseY = 0): void {
    this.add({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: baseY, maxY: baseY + h });
  }

  private seen = new Set<number>();
  /** Boxes overlapping the XZ rectangle. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: AABB[] = []): AABB[] {
    out.length = 0;
    this.seen.clear();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.seen.has(i)) continue;
          this.seen.add(i);
          const b = this.boxes[i];
          if (b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ) out.push(b);
        }
      }
    return out;
  }

  /** Is the point inside any box? */
  pointInside(x: number, y: number, z: number): boolean {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const i of list) {
      const b = this.boxes[i];
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < b.maxY) return true;
    }
    return false;
  }

  /** Highest box top under (x,z) that is at or below `maxY` (for standing on roofs/props). */
  supportHeight(x: number, z: number, r: number, maxY: number): number {
    let best = -Infinity;
    const list = this.query(x - r, z - r, x + r, z + r, this.tmp);
    for (const b of list) {
      if (x + r * 0.5 > b.minX && x - r * 0.5 < b.maxX && z + r * 0.5 > b.minZ && z - r * 0.5 < b.maxZ && b.maxY <= maxY && b.maxY > best)
        best = b.maxY;
    }
    return best;
  }
  private tmp: AABB[] = [];
}
