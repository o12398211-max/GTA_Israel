import * as THREE from 'three';
import { mulberry32 } from './Builders';

/**
 * Card-based foliage (the standard game technique): canopies are made of many
 * alpha-tested leaf-cluster quads with spherical normals for soft lighting;
 * palm fronds are bent, V-folded strips with a painted frond texture.
 * All textures are painted procedurally on canvas at startup.
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}
function toTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const hsl = (h: number, s: number, l: number) => `hsl(${h},${s}%,${l}%)`;

/** Broad-leaf cluster texture (ficus / generic street tree / olive). */
function leafClusterTexture(seed: number, hue: number, sat: number, light: number, narrow = false): THREE.Texture {
  const { c, ctx } = canvas(512, 512);
  const r = mulberry32(seed);
  for (let i = 0; i < 420; i++) {
    const x = 256 + (r.next() - 0.5) * 2 * 230 * Math.sqrt(r.next());
    const y = 256 + (r.next() - 0.5) * 2 * 230 * Math.sqrt(r.next());
    if (Math.hypot(x - 256, y - 256) > 240) continue;
    const len = narrow ? r.range(22, 34) : r.range(16, 26);
    const wid = narrow ? len * 0.22 : len * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r.range(0, Math.PI * 2));
    const l = light + r.range(-10, 10);
    const g = ctx.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, hsl(hue + r.range(-6, 6), sat, l + 8));
    g.addColorStop(1, hsl(hue + r.range(-6, 6), sat, l - 8));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hsl(hue, sat - 10, l - 16);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.restore();
  }
  // a few twigs
  ctx.strokeStyle = 'rgba(80,60,40,0.9)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(256, 256); ctx.lineTo(256 + r.range(-200, 200), 256 + r.range(-200, 200)); ctx.stroke(); }
  return toTex(c);
}

/** Palm frond: rachis + leaflets, tip at v=1. */
function frondTexture(): THREE.Texture {
  const { c, ctx } = canvas(256, 1024);
  const r = mulberry32(77);
  const cx = 128;
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    const y = 1000 - t * 980;
    const len = (1 - Math.pow(t, 1.6)) * 115 * r.range(0.85, 1.05) + 8;
    for (const s of [-1, 1]) {
      ctx.strokeStyle = hsl(95 + r.range(-8, 8), 45, 26 + r.range(-6, 10) + t * 6);
      ctx.lineWidth = r.range(3, 5) * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + s * len * 0.5, y - 20, cx + s * len, y - 50 - r.range(0, 25));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = hsl(60, 35, 40);
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(cx, 1024); ctx.lineTo(cx, 10); ctx.stroke();
  return toTex(c);
}

function barkTexture(): THREE.Texture {
  const { c, ctx } = canvas(128, 512);
  const r = mulberry32(5);
  ctx.fillStyle = '#7a6047'; ctx.fillRect(0, 0, 128, 512);
  for (let y = 0; y < 512; y += r.range(10, 16)) {
    ctx.fillStyle = hsl(30, 25, r.range(22, 38));
    ctx.fillRect(0, y, 128, r.range(3, 6));
    for (let x = 0; x < 128; x += 8) { ctx.fillStyle = `rgba(40,25,15,${r.range(0, 0.35)})`; ctx.fillRect(x, y + 4, 8, r.range(2, 8)); }
  }
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Canopy of crossed leaf cards inside an ellipsoid. */
function canopyGeometry(seed: number, count: number, radius: THREE.Vector3, center: THREE.Vector3, cardSize: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < count; i++) {
    // point in ellipsoid, biased to the shell
    const d = new THREE.Vector3().randomDirection();
    const k = 0.55 + 0.45 * Math.cbrt(r.next());
    const p = d.clone().multiply(radius).multiplyScalar(k).add(center);
    e.set(r.range(-1.2, 1.2), r.range(0, Math.PI * 2), r.range(-1.2, 1.2));
    q.setFromEuler(e);
    const s = cardSize * r.range(0.75, 1.25);
    const base = pos.length / 3;
    // spherical normals -> soft, volumetric lighting
    const n = p.clone().sub(center).divide(radius).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
    for (const [cx, cy] of corners) {
      const v = new THREE.Vector3(cx * s * 0.5, cy * s * 0.5, 0).applyQuaternion(q).add(p);
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      uv.push((cx + 1) / 2, (cy + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Bent trunk with bark UVs. */
function trunkGeometry(height: number, r0: number, r1: number, bend: number, segs = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, 9, segs, true);
  g.translate(0, height / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / height;
    p.setX(i, p.getX(i) + bend * t * t);
    // slight swelling at the base
    const sw = 1 + 0.35 * Math.max(0, 1 - t * 8);
    p.setX(i, p.getX(i) * (t < 0.12 ? sw : 1));
    p.setZ(i, p.getZ(i) * (t < 0.12 ? sw : 1));
  }
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * height / 1.5);
  g.computeVertexNormals();
  return g;
}

/** One palm crown of bent, V-folded frond strips. */
function frondsGeometry(top: THREE.Vector3, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const N = 14, L = 10, W = 3;
  for (let f = 0; f < N; f++) {
    const dead = f >= 12;
    const yaw = (f / 12) * Math.PI * 2 + r.range(-0.2, 0.2);
    const lift = dead ? -1.2 : r.range(-0.15, 0.55);
    const len = dead ? 3.2 : r.range(4.0, 5.0);
    const width = dead ? 0.6 : r.range(1.3, 1.7);
    const droop = dead ? 0.2 : r.range(0.9, 1.5);
    const tint = dead ? [0.75, 0.55, 0.32] : [1, 1, 1];
    const base = pos.length / 3;
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i <= L; i++) {
      const t = i / L;
      const along = t * len;
      const h = Math.sin(lift) * along - droop * t * t * len * 0.45;
      const center = top.clone().addScaledVector(dir, Math.cos(lift) * along).add(new THREE.Vector3(0, h, 0));
      const tangent = dir.clone().multiplyScalar(Math.cos(lift)).add(new THREE.Vector3(0, Math.sin(lift) - droop * t * 0.9, 0)).normalize();
      for (let j = 0; j < W; j++) {
        const s = j / (W - 1) - 0.5;
        const fold = -Math.abs(s) * width * 0.35; // V-shape
        const v = center.clone().addScaledVector(side, s * width * (1 - t * 0.4)).add(new THREE.Vector3(0, fold, 0));
        pos.push(v.x, v.y, v.z);
        const n = new THREE.Vector3().crossVectors(side, tangent).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(s + 0.5, t);
        col.push(tint[0], tint[1], tint[2]);
      }
    }
    for (let i = 0; i < L; i++) for (let j = 0; j < W - 1; j++) {
      const a = base + i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export interface TreeKit { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] }

let kits: Record<'palm' | 'ficus' | 'cypress' | 'olive', TreeKit> | null = null;

export function treeKits() {
  if (kits) return kits;
  const bark = barkTexture();
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, color: 0xb8a48c });
  const leafMat = (map: THREE.Texture, color = 0xffffff, vertexColors = false) => new THREE.MeshStandardMaterial({
    map, color, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, vertexColors,
  });
  const palmTop = new THREE.Vector3(0.9, 8.6, 0);
  kits = {
    palm: { parts: [
      { geometry: trunkGeometry(8.8, 0.3, 0.22, 0.9), material: barkMat },
      { geometry: frondsGeometry(palmTop, 3), material: leafMat(frondTexture(), 0xffffff, true) },
    ] },
    ficus: { parts: [
      { geometry: trunkGeometry(3.2, 0.24, 0.16, 0.1, 4), material: barkMat },
      { geometry: canopyGeometry(11, 90, new THREE.Vector3(2.6, 1.9, 2.6), new THREE.Vector3(0, 4.4, 0), 1.6), material: leafMat(leafClusterTexture(1, 100, 45, 28)) },
    ] },
    cypress: { parts: [
      { geometry: trunkGeometry(1.5, 0.14, 0.1, 0, 2), material: barkMat },
      { geometry: canopyGeometry(21, 70, new THREE.Vector3(0.85, 4.2, 0.85), new THREE.Vector3(0, 5.0, 0), 1.1), material: leafMat(leafClusterTexture(2, 115, 40, 20, true)) },
    ] },
    olive: { parts: [
      { geometry: trunkGeometry(1.8, 0.32, 0.2, 0.4, 4), material: barkMat },
      { geometry: canopyGeometry(31, 60, new THREE.Vector3(2.0, 1.2, 2.0), new THREE.Vector3(0.3, 2.8, 0), 1.3), material: leafMat(leafClusterTexture(3, 80, 18, 45, true)) },
    ] },
  };
  return kits;
}
