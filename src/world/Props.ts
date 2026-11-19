import * as THREE from 'three';
import { colored, merge } from './Builders';

/**
 * Procedural low-poly prop geometries (vertex colored, base at y=0).
 * Each factory can later be swapped for a GLTF via the asset registry.
 */

export function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // slightly curved trunk made of stacked segments
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const r0 = 0.32 - i * 0.025, r1 = 0.3 - (i + 1) * 0.025;
    const g = new THREE.CylinderGeometry(r1, r0, 1.6, 7, 1);
    g.translate(Math.sin(i * 0.25) * 0.35, 0.8 + i * 1.55, 0);
    parts.push(colored(g, i % 2 ? 0x8a6a48 : 0x7a5c3e));
  }
  const top = new THREE.Vector3(Math.sin(segs * 0.25) * 0.35, segs * 1.55 + 0.1, 0);
  const leaf = 0x3f8a3a;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.55, 4.2, 4, 1);
    g.scale(1, 1, 0.18);
    g.translate(0, 2.1, 0);
    g.rotateZ(-Math.PI / 2 + 0.35 - (i % 2) * 0.5);
    g.rotateY(a);
    g.translate(top.x, top.y, top.z);
    parts.push(colored(g, i % 2 ? leaf : 0x4f9c44));
  }
  const coco = new THREE.IcosahedronGeometry(0.32, 0).translate(top.x, top.y - 0.35, top.z);
  parts.push(colored(coco, 0x6b4a2a));
  return merge(parts);
}

export function umbrellaGeometry(): THREE.BufferGeometry {
  const pole = colored(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(0, 1.2, 0), 0xeeeeee);
  const canopy = new THREE.ConeGeometry(1.5, 0.6, 8, 1, true).translate(0, 2.45, 0);
  // canopy is tinted per-instance via instanceColor (white vertex color)
  const c2 = colored(canopy, 0xffffff);
  const tip = colored(new THREE.SphereGeometry(0.07, 5, 4).translate(0, 2.78, 0), 0xffffff);
  return merge([pole, c2, tip]);
}

export function loungerGeometry(): THREE.BufferGeometry {
  const base = colored(new THREE.BoxGeometry(0.7, 0.08, 1.4).translate(0, 0.32, 0), 0xffffff);
  const back = colored(new THREE.BoxGeometry(0.7, 0.08, 0.6).rotateX(-0.9).translate(0, 0.55, -0.82), 0xffffff);
  const legs: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.3, -0.6], [0.3, -0.6], [-0.3, 0.6], [0.3, 0.6]])
    legs.push(colored(new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(x, 0.15, z), 0xdddddd));
  return merge([base, back, ...legs]);
}

/** The iconic white plastic chair (stars in the "מה הצבעת?" brawl). */
export function plasticChairGeometry(): THREE.BufferGeometry {
  const w = 0xf4f4f0;
  const seat = colored(new THREE.BoxGeometry(0.46, 0.05, 0.44).translate(0, 0.44, 0), w);
  const back = colored(new THREE.BoxGeometry(0.46, 0.42, 0.04).rotateX(-0.12).translate(0, 0.68, -0.22), w);
  const legs: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]])
    legs.push(colored(new THREE.CylinderGeometry(0.025, 0.03, 0.44, 4).translate(x, 0.22, z), w));
  return merge([seat, back, ...legs]);
}

export function ficusGeometry(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6).translate(0, 1.3, 0), 0x6e5844);
  const parts = [trunk];
  const blobs: [number, number, number, number][] = [[0, 3.8, 0, 2.2], [1.3, 3.4, 0.4, 1.5], [-1.1, 3.5, -0.6, 1.6], [0.2, 4.6, -0.9, 1.4], [-0.4, 3.3, 1.2, 1.3]];
  blobs.forEach(([x, y, z, r], i) => parts.push(colored(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), i % 2 ? 0x4c7f3a : 0x5a8f42)));
  return merge(parts);
}

export function cypressGeometry(): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 5).translate(0, 0.6, 0), 0x5a4632);
  const body = colored(new THREE.ConeGeometry(0.9, 8, 7, 3).translate(0, 5, 0), 0x2f5a2c);
  const mid = colored(new THREE.SphereGeometry(0.95, 7, 5).scale(1, 2.2, 1).translate(0, 3.2, 0), 0x33602f);
  return merge([trunk, body, mid]);
}

export function oliveGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(0.22, 0.4, 1.8, 6).rotateZ(0.15).translate(0, 0.9, 0), 0x6b5a48),
    colored(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 5).rotateZ(-0.6).translate(0.5, 1.9, 0), 0x6b5a48),
  ];
  const blobs: [number, number, number, number][] = [[0, 2.8, 0, 1.6], [1.2, 2.6, 0.3, 1.1], [-1, 2.5, -0.4, 1.2], [0.2, 2.4, 1.1, 1]];
  blobs.forEach(([x, y, z, r], i) => parts.push(colored(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.7, 1).translate(x, y, z), i % 2 ? 0x7d8f5c : 0x8a9b68)));
  return merge(parts);
}

export function lampPoleGeometry(): THREE.BufferGeometry {
  return merge([
    colored(new THREE.CylinderGeometry(0.08, 0.12, 7, 6).translate(0, 3.5, 0), 0x3d4148),
    colored(new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0, 7, 0.85), 0x3d4148),
  ]);
}
/** Lamp head, separate so it can glow at night. */
export function lampHeadGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.35, 0.14, 0.7).translate(0, 6.9, 1.6);
}

/** "דוד שמש" – solar water heater, a mandatory accessory on every Israeli roof. */
export function solarHeaterGeometry(): THREE.BufferGeometry {
  const panel = colored(new THREE.BoxGeometry(1.0, 0.06, 1.8).rotateX(-0.6).translate(0, 0.75, 0.2), 0x1d2a45);
  const frame = colored(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(0.45, 0.5, -0.5), 0x999999);
  const frame2 = colored(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(-0.45, 0.5, -0.5), 0x999999);
  const tank = colored(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8).rotateZ(Math.PI / 2).translate(0, 1.25, -0.6), 0xd8d8d8);
  return merge([panel, frame, frame2, tank]);
}

export function stallGeometry(): THREE.BufferGeometry {
  const counter = colored(new THREE.BoxGeometry(3.2, 0.9, 1.2).translate(0, 0.45, 0), 0x8b6b4a);
  const poles: THREE.BufferGeometry[] = [];
  for (const x of [-1.5, 1.5]) for (const z of [-0.55, 0.55])
    poles.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 4).translate(x, 1.3, z), 0x666666));
  // produce crates on top (colors via vertex)
  const fruitColors = [0xff7a1a, 0xd8262e, 0x7cc142, 0xffd23f, 0x9b3fb5];
  const crates: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    crates.push(colored(new THREE.BoxGeometry(0.55, 0.22, 0.8).translate(-1.25 + i * 0.62, 1.0, 0.05), fruitColors[i]));
  }
  return merge([counter, ...poles, ...crates]);
}
/** Awning sloped toward the street; tinted per instance. */
export function awningGeometry(): THREE.BufferGeometry {
  return colored(new THREE.BoxGeometry(3.4, 0.06, 2.0).rotateX(0.25).translate(0, 2.65, 0.35), 0xffffff);
}

export function lifeguardTowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4])
    parts.push(colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).translate(x, 1.6, z), 0xeeeeee));
  parts.push(colored(new THREE.BoxGeometry(3.6, 0.2, 3.6).translate(0, 3.2, 0), 0xd9d2c2));
  parts.push(colored(new THREE.BoxGeometry(3.2, 2.2, 3.2).translate(0, 4.4, 0), 0xf3efe6));
  parts.push(colored(new THREE.BoxGeometry(3.3, 0.6, 0.1).translate(0, 4.9, 1.62), 0x1e2a3a)); // window
  parts.push(colored(new THREE.BoxGeometry(4.2, 0.25, 4.2).translate(0, 5.6, 0), 0xe04a3a)); // roof
  parts.push(colored(new THREE.BoxGeometry(0.8, 0.1, 3).rotateX(0.85).translate(1.0, 1.6, 2.6), 0xbbbbbb)); // ramp
  parts.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 2, 4).translate(1.6, 6.6, 1.6), 0xcccccc));
  parts.push(colored(new THREE.BoxGeometry(0.02, 0.6, 0.9).translate(1.6, 7.3, 2.05), 0x000000)); // black flag – the sea is wild today
  return merge(parts);
}

export function benchGeometry(): THREE.BufferGeometry {
  return merge([
    colored(new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.45, 0), 0x9a6b3f),
    colored(new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.75, -0.22), 0x9a6b3f),
    colored(new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.8, 0.22, 0), 0x333333),
    colored(new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.8, 0.22, 0), 0x333333),
  ]);
}
