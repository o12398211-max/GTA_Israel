import { CITY } from '../world/City';
import { WORLD } from '../world/Terrain';

/**
 * Pre-renders the whole world map once (1 px = 1 m) from the city layout data.
 * Used by the minimap (rotated crop) and the phone/full-screen map.
 */
let cached: HTMLCanvasElement | null = null;
export const MAP_ORIGIN = { x: WORLD.minX, z: WORLD.minZ };
export const MAP_SIZE = { w: WORLD.maxX - WORLD.minX, h: WORLD.maxZ - WORLD.minZ };

export function worldToMap(x: number, z: number) { return { u: x - MAP_ORIGIN.x, v: z - MAP_ORIGIN.z }; }

export function mapCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = MAP_SIZE.w; c.height = MAP_SIZE.h;
  const g = c.getContext('2d')!;
  const X = (x: number) => x - MAP_ORIGIN.x, Z = (z: number) => z - MAP_ORIGIN.z;
  // land
  g.fillStyle = '#3d4a3a'; g.fillRect(0, 0, c.width, c.height);
  // Judean hills
  const hills = g.createLinearGradient(X(220), 0, X(460), 0);
  hills.addColorStop(0, '#47513f'); hills.addColorStop(1, '#6b6248');
  g.fillStyle = hills; g.fillRect(X(220), 0, X(720) - X(220), c.height);
  // sea + beach
  g.fillStyle = '#1f5f86'; g.fillRect(0, 0, X(WORLD.shoreX), c.height);
  g.fillStyle = '#c9b58a'; g.fillRect(X(WORLD.shoreX), 0, X(-213) - X(WORLD.shoreX), c.height);
  // city fabric
  g.fillStyle = '#5c5f63'; g.fillRect(X(-213), Z(-300), X(76) - X(-213), Z(300) - Z(-300));
  g.fillStyle = '#585c66'; g.fillRect(X(134), Z(-290), X(218) - X(134), Z(290) - Z(-290));
  // blocks (buildings)
  g.fillStyle = '#8d9096';
  const xs = [...CITY.streetsX, CITY.ayalon.west - 4];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < CITY.streetsZ.length - 1; j++) {
    const x0 = xs[i] + 8, x1 = xs[i + 1] - 8, z0 = CITY.streetsZ[j] + 8, z1 = CITY.streetsZ[j + 1] - 8;
    g.fillRect(X(x0), Z(z0), x1 - x0, z1 - z0);
  }
  // roads
  g.strokeStyle = '#e8e4da'; g.lineCap = 'round';
  g.lineWidth = 9;
  const zMin = CITY.streetsZ[0] - 20, zMax = CITY.streetsZ[CITY.streetsZ.length - 1] + 20;
  for (const x of CITY.streetsX) { g.beginPath(); g.moveTo(X(x), Z(zMin)); g.lineTo(X(x), Z(zMax)); g.stroke(); }
  for (const z of CITY.streetsZ) { g.beginPath(); g.moveTo(X(-200), Z(z)); g.lineTo(X(CITY.ayalon.west), Z(z)); g.stroke(); }
  // shuk alley
  g.strokeStyle = '#e9a23b'; g.lineWidth = 8; g.beginPath(); g.moveTo(X(-140), Z(0)); g.lineTo(X(-6), Z(0)); g.stroke();
  // Ayalon (wide, orange like a highway)
  g.strokeStyle = '#f0b44a'; g.lineWidth = 44;
  g.beginPath(); g.moveTo(X(105), 0); g.lineTo(X(105), c.height); g.stroke();
  g.strokeStyle = '#7a6f62'; g.lineWidth = 6; g.beginPath(); g.moveTo(X(105), 0); g.lineTo(X(105), c.height); g.stroke();
  // Route 1
  g.strokeStyle = '#f0b44a'; g.lineWidth = 14; g.beginPath(); g.moveTo(X(130), Z(0)); g.lineTo(X(CITY.jeru.minX), Z(0)); g.stroke();
  g.lineWidth = 8; g.strokeStyle = '#e8e4da';
  for (const z of [-150, 90]) { g.beginPath(); g.moveTo(X(130), Z(z)); g.lineTo(X(215), Z(z)); g.stroke(); }
  // Jerusalem old city
  const j = CITY.jeru;
  g.fillStyle = '#b9a477'; g.fillRect(X(j.minX), Z(j.minZ), j.maxX - j.minX, j.maxZ - j.minZ);
  g.strokeStyle = '#7d6a45'; g.lineWidth = 5; g.strokeRect(X(j.minX), Z(j.minZ), j.maxX - j.minX, j.maxZ - j.minZ);
  g.strokeStyle = '#e8dcc0'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(X(j.minX - 40), Z(0)); g.lineTo(X(j.maxX), Z(0)); g.stroke();
  g.beginPath(); g.moveTo(X(590), Z(j.minZ)); g.lineTo(X(590), Z(j.maxZ)); g.stroke();
  // labels
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 22px Rubik, Arial'; g.textAlign = 'center';
  g.direction = 'rtl';
  const label = (t: string, x: number, z: number) => { g.save(); g.shadowColor = '#000'; g.shadowBlur = 4; g.fillText(t, X(x), Z(z)); g.restore(); };
  label('הים התיכון', -370, -200); label('החוף', -260, -360); label('השוק', -73, -18); label('העיר הלבנה', -100, 200);
  label('איילון', 105, -360); label('כביש 1', 330, -20); label('ירושלים', 590, -90); label('מגדלים', 176, 320);
  cached = c;
  return c;
}
