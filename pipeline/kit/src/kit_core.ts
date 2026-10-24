// kit.ts - Greek-myth isometric pixel-art kit (Titan Quest flavour). Pure TypeScript, no imports, deterministic:
// own sin/cos/atan (only + - * / sqrt floor), so Shotcup and a local runtime produce identical pixels.
// World: u runs screen down-right, v down-left, z up. Screen = (64 + 2(u - v), 100 + u + v - sqrt6*z). 128x128 canvas.
export type V = [number, number, number];
export type Shape = { f: (x: number, y: number, z: number) => number; lo: V; hi: V; lip: number };
export type TexOut = number | [string, number] | null;
export type Tex = (p: V) => TexOut;
export type Opts = { obj?: number; shift?: number; tex?: Tex; glow?: boolean };
type Part = { s: Shape; mat: string; shift: number; obj: number; tex: Tex | null; glow: boolean; c: V; R: number; raw?: boolean; kind?: string; body?: boolean };

// ---------------- deterministic maths ----------------
export const PI = 3.141592653589793;
function sinr(x0: number): number {
  const TAU = 2 * PI;
  let x = x0 - TAU * Math.floor((x0 + PI) / TAU);
  if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
export const sind = (d: number): number => sinr(d * PI / 180);
export const cosd = (d: number): number => sinr((d + 90) * PI / 180);
function atanr(x0: number): number {
  let x = x0 < 0 ? -x0 : x0; const inv = x > 1; if (inv) x = 1 / x;
  x = x / (1 + Math.sqrt(1 + x * x)); x = x / (1 + Math.sqrt(1 + x * x));
  const x2 = x * x;
  let r = 4 * x * (1 - x2 * (1 / 3 - x2 * (1 / 5 - x2 * (1 / 7 - x2 * (1 / 9 - x2 / 11)))));
  if (inv) r = PI / 2 - r;
  return x0 < 0 ? -r : r;
}
export function atan2d(y: number, x: number): number {
  let a: number;
  if (x > 0) a = atanr(y / x); else if (x < 0) a = atanr(y / x) + (y >= 0 ? PI : -PI);
  else a = y > 0 ? PI / 2 : (y < 0 ? -PI / 2 : 0);
  return a * 180 / PI;
}
export function hash(a: number, b: number, c = 0): number {   // stable 0..1
  let h = (Math.floor(a * 73.0) * 374761393 + Math.floor(b * 73.0) * 668265263 + Math.floor(c * 73.0) * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V): number => Math.sqrt(dot(a, a));
export const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------- palette ----------------
export const PALETTE: { [k: string]: string[] } = {
  marble: ['#151622','#2c2d3d','#47495b','#6b6b7d','#93919c','#bab8b8','#d9d5cf','#efeae1','#fffaf0'],
  limestone: ['#1a1517','#352c29','#54463e','#786555','#9c876d','#bea886','#d9c7a1','#eedfbc','#fff4d6'],
  bronze: ['#1a0f0d','#371f12','#593216','#7f4b1c','#a36824','#c58632','#dea74e','#f2ca7a','#fff0b0'],
  gold: ['#26140a','#47250d','#6a380a','#8c5210','#b06e16','#cc9023','#e9b230','#f6d26f','#fff3a8'],
  iron: ['#0c0e18','#181d2a','#262c3e','#374052','#4f5869','#697383','#8a94a1','#b2bac1','#dfe4e2'],
  terracotta: ['#1e0c0c','#3d1913','#622718','#8b3c1e','#ae5528','#cd7138','#e39255','#f3b579','#ffd9a3'],
  black: ['#07060c','#0f0d16','#15131d','#1c1924','#25202c','#2f2835','#3d3540','#514650','#6a5c62'],
  olive: ['#0e130c','#1d2516','#2d3a1e','#425128','#5a6a33','#758340','#959d54','#b6ba73','#d8d89a'],
  laurel: ['#081410','#10261c','#163b28','#1f5237','#2f6d3f','#448946','#68a654','#93c46c','#c4e38a'],
  aegean: ['#060c22','#0c1b3e','#112d5f','#194686','#2364a9','#3285c8','#51a6dd','#84c9ee','#bdeefc'],
  crimson: ['#160610','#300c18','#4e0b1e','#741023','#9a1a27','#be2b2c','#da4a36','#ef714c','#ff9c6a'],
  purple: ['#120a20','#1f1333','#2e1848','#41235f','#552f78','#703f90','#8b50a8','#ab71bd','#cc92d2'],
  linen: ['#1c1822','#322d35','#4a4449','#696260','#8a8278','#a9a091','#c9c0aa','#dfd8c6','#f6f1e2'],
  leather: ['#150b10','#271516','#391d1a','#4f2a22','#66382a','#7d4c34','#95613f','#ad7952','#c69266'],
  skin: ['#24121a','#3e1f22','#5a2c29','#7e4136','#a35844','#be7459','#da916f','#eab18d','#f9d2ad'],
  skin_olive: ['#1f1012','#351d19','#4d2a20','#6b3f2a','#8a5634','#a47044','#bf8a55','#d4a56f','#e8c08a'],
  skin_dark: ['#160a0e','#271514','#3a1c18','#50281f','#663526','#7d4630','#94573a','#ac6f4c','#c4875e'],
  skin_pale: ['#221622','#3d2834','#5a3c48','#7c5a63','#a07a80','#ba9594','#d4b0a8','#e7cbbf','#fbe6d6'],
  skin_green: ['#0c1612','#16271e','#1e3a2a','#2c4f35','#3a6440','#527c48','#6a9450','#8fb068','#b4cc80'],
  skin_grey: ['#121218','#202028','#2e2e3a','#42424f','#575866','#70717c','#8a8a92','#a9a7a7','#c8c4bc'],
  fur: ['#140e14','#271b1b','#3c2822','#55382a','#704a32','#8c5e3e','#a87852','#c2976c','#dcb88c'],
  fur_dark: ['#0c0a10','#161114','#1e1618','#2a1e1e','#362624','#45302a','#553a30','#674838','#7a5640'],
  feather: ['#14101a','#2b2025','#463330','#64493c','#83644a','#a2805b','#c2a174','#ddc193','#f4e2b6'],
  bone: ['#1b1820','#302c2f','#47413f','#666057','#878070','#a69d86','#c6ba9d','#ded4ba','#f6eed7'],
  wood: ['#1c1018','#311b1c','#47261f','#643a27','#83502f','#a36c3f','#c48a4f','#daa96c','#f0c98a'],
  snake: ['#0a140c','#132413','#183418','#23471e','#2e5a24','#44722a','#5a8a30','#80a645','#a6c25a'],
  sky: ['#0c1430','#15264c','#1e3a6a','#2c5188','#3a6aa8','#5385c0','#6aa2d8','#90bfe7','#b4dcf6'],
  shadow: ['#0a0a14','#141428','#1d1d36','#262642'],
  fire: ['#2a0a0a','#52120a','#7d1c0a','#aa2e0c','#ce5010','#ec7519','#faa12b','#ffca61','#fff3a6'],
};
export const MATS: string[] = Object.keys(PALETTE);
const RGB: { [k: string]: number[][] } = {};
for (const k of MATS) RGB[k] = PALETTE[k].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const ALIAS: { [k: string]: string } = {
  'black-figure': 'black', blackfigure: 'black', wine: 'crimson', red: 'crimson', 'aegean-blue': 'aegean', 'aegean blue': 'aegean',
  blue: 'aegean', green: 'laurel', stone: 'limestone', brown: 'leather', white: 'marble', horn: 'bone', scales: 'snake',
  flame: 'fire', cloth: 'linen', copper: 'bronze', silver: 'iron', steel: 'iron', hair: 'fur_dark', fair: 'skin_pale',
};
export function mat(name: string): string {
  if (RGB[name]) return name;
  const a = ALIAS[name]; if (a) return a;
  throw new Error('unknown material "' + name + '"; use one of: ' + MATS.join(', '));
}
export const ramp = (m: string): number[][] => RGB[mat(m)];
export const LIGHT: V = norm([0.15, 0.5, 0.85]);
export const ZK = Math.sqrt(6);
export const VIEW: V = norm([0.5, 0.5, 1 / ZK]);
const HALF: V = norm(add(LIGHT, VIEW));
const VL = Math.sqrt(0.5 + 1 / 6);
export const W = 128, H = 128, OX = 64, OY = 100;
export function proj(p: V): [number, number] { return [OX + 2 * (p[0] - p[1]), OY + p[0] + p[1] - ZK * p[2]]; }

// ---------------- shapes (signed distance functions) ----------------
const BIG = 1e6;
const bbU = (a: Shape, b: Shape): [V, V] => [[Math.min(a.lo[0], b.lo[0]), Math.min(a.lo[1], b.lo[1]), Math.min(a.lo[2], b.lo[2])],
  [Math.max(a.hi[0], b.hi[0]), Math.max(a.hi[1], b.hi[1]), Math.max(a.hi[2], b.hi[2])]];
function sdPoly2(px: number, py: number, P: number[][]): number {
  const firstX = px - P[0][0], firstY = py - P[0][1];
  let d = firstX * firstX + firstY * firstY; let s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i, i++) {
    const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], wx = px - P[i][0], wy = py - P[i][1];
    const along = (wx * ex + wy * ey) / (ex * ex + ey * ey || 1); const t = along < 0 ? 0 : along > 1 ? 1 : along;
    const bx = wx - ex * t, by = wy - ey * t; d = Math.min(d, bx * bx + by * by);
    const c1 = py >= P[i][1], c2 = py < P[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
function ext(d2: number, dz: number): number {
  const a = Math.max(d2, 0), b = Math.max(dz, 0);
  return Math.sqrt(a * a + b * b) + Math.min(Math.max(d2, dz), 0);
}
export const S = {
  sphere(c: V, r: number): Shape {
    return { f: (x, y, z) => { const offsetX = x - c[0], offsetY = y - c[1], offsetZ = z - c[2]; return Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ) - r; }, lo: [c[0] - r, c[1] - r, c[2] - r], hi: [c[0] + r, c[1] + r, c[2] + r], lip: 1 };
  },
  // radii r along axes (default world u,v,z; pass three orthonormal directions to orient it)
  ellipsoid(c: V, r: V, axes?: V[]): Shape {
    const A = axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const e: V = [0, 1, 2].map((i) => Math.sqrt((r[0] * A[0][i]) ** 2 + (r[1] * A[1][i]) ** 2 + (r[2] * A[2][i]) ** 2)) as V;
    return {
      f: (x, y, z) => {
        const offsetX = x - c[0], offsetY = y - c[1], offsetZ = z - c[2]; const axisA = A[0], axisB = A[1], axisG = A[2];
        const a = (offsetX * axisA[0] + offsetY * axisA[1] + offsetZ * axisA[2]) / r[0], b = (offsetX * axisB[0] + offsetY * axisB[1] + offsetZ * axisB[2]) / r[1], g = (offsetX * axisG[0] + offsetY * axisG[1] + offsetZ * axisG[2]) / r[2];
        const k0 = Math.sqrt(a * a + b * b + g * g);
        const scaledA = a / r[0], scaledB = b / r[1], scaledG = g / r[2];
        const k1 = Math.sqrt(scaledA * scaledA + scaledB * scaledB + scaledG * scaledG);
        return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
      }, lo: sub(c, e), hi: add(c, e), lip: 0.8,
    };
  },
  capsule(a: V, b: V, r1: number, r2?: number): Shape {
    const R2 = r2 === undefined ? r1 : r2; const ba = sub(b, a); const bb = dot(ba, ba) || 1e-9; const m = Math.max(r1, R2);
    return {
      f: (x, y, z) => {
        const offsetX = x - a[0], offsetY = y - a[1], offsetZ = z - a[2]; const along = (offsetX * ba[0] + offsetY * ba[1] + offsetZ * ba[2]) / bb; const h = along < 0 ? 0 : along > 1 ? 1 : along;
        const awayX = offsetX - ba[0] * h, awayY = offsetY - ba[1] * h, awayZ = offsetZ - ba[2] * h;
        return Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ) - (r1 + (R2 - r1) * h);
      }, lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
      hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m], lip: r1 === R2 ? 1 : 0.8,
    };
  },
  box(lo: V, hi: V, r = 0): Shape {
    const c = lerp(lo, hi, 0.5); const h = mul(sub(hi, lo), 0.5);
    return {
      f: (x, y, z) => {
        const qx = Math.abs(x - c[0]) - h[0] + r, qy = Math.abs(y - c[1]) - h[1] + r, qz = Math.abs(z - c[2]) - h[2] + r;
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
      }, lo: [lo[0], lo[1], lo[2]], hi: [hi[0], hi[1], hi[2]], lip: 1,
    };
  },
  // oriented box: centre, three orthonormal axes, half sizes
  obox(c: V, axes: V[], half: V, r = 0): Shape {
    const e: V = [0, 1, 2].map((i) => Math.abs(half[0] * axes[0][i]) + Math.abs(half[1] * axes[1][i]) + Math.abs(half[2] * axes[2][i])) as V;
    return {
      f: (x, y, z) => {
        const offsetX = x - c[0], offsetY = y - c[1], offsetZ = z - c[2]; const axisX = axes[0], axisY = axes[1], axisZ = axes[2];
        const qx = Math.abs(offsetX * axisX[0] + offsetY * axisX[1] + offsetZ * axisX[2]) - half[0] + r, qy = Math.abs(offsetX * axisY[0] + offsetY * axisY[1] + offsetZ * axisY[2]) - half[1] + r, qz = Math.abs(offsetX * axisZ[0] + offsetY * axisZ[1] + offsetZ * axisZ[2]) - half[2] + r;
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
      }, lo: sub(c, e), hi: add(c, e), lip: 1,
    };
  },
  // capped cylinder (r1 equal r2) or cone frustum between points a and b
  cyl(a: V, b: V, r1: number, r2?: number): Shape {
    const R2 = r2 === undefined ? r1 : r2; const ba = sub(b, a); const L = len(ba) || 1e-9; const n = mul(ba, 1 / L); const m = Math.max(r1, R2);
    return {
      f: (x, y, z) => {
        const offsetX = x - a[0], offsetY = y - a[1], offsetZ = z - a[2]; const t = offsetX * n[0] + offsetY * n[1] + offsetZ * n[2];
        const awayX = offsetX - n[0] * t, awayY = offsetY - n[1] * t, awayZ = offsetZ - n[2] * t;
        const radial = Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ); const fraction = t / L; const rr = r1 + (R2 - r1) * (fraction < 0 ? 0 : fraction > 1 ? 1 : fraction);
        const sideDistance = radial - rr, capDistance = Math.abs(t - L / 2) - L / 2;
        const outsideSide = Math.max(sideDistance, 0), outsideCap = Math.max(capDistance, 0);
        return Math.sqrt(outsideSide * outsideSide + outsideCap * outsideCap) + Math.min(Math.max(sideDistance, capDistance), 0);
      }, lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
      hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m], lip: r1 === R2 ? 0.9 : 0.7,
    };
  },
  // solid of revolution around a vertical axis through base: prof = [[h, r], ...] with h rising
  lathe(base: V, prof: number[][]): Shape {
    const h0 = prof[0][0], h1 = prof[prof.length - 1][0]; let rm = 0; for (const q of prof) rm = Math.max(rm, q[1]);
    const rAt = (h: number): number => {
      if (h <= h0) return prof[0][1];
      for (let i = 1; i < prof.length; i++) if (h <= prof[i][0]) { const t = (h - prof[i - 1][0]) / ((prof[i][0] - prof[i - 1][0]) || 1e-9); return prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t; }
      return prof[prof.length - 1][1];
    };
    return {
      f: (x, y, z) => {
        const h = z - base[2]; const offsetX = x - base[0], offsetY = y - base[1]; const radial = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
        const sideDistance = radial - rAt(h), capDistance = Math.max(h0 - h, h - h1);
        const outsideSide = Math.max(sideDistance, 0), outsideCap = Math.max(capDistance, 0);
        return Math.sqrt(outsideSide * outsideSide + outsideCap * outsideCap) + Math.min(Math.max(sideDistance, capDistance), 0);
      },
      lo: [base[0] - rm, base[1] - rm, base[2] + h0], hi: [base[0] + rm, base[1] + rm, base[2] + h1], lip: 0.55,
    };
  },
  // flat plate with thickness: a planar polygon (blades, wings, capes, banners, axe heads); may be concave
  plate(pts: V[], thick = 0.6): Shape {
    let n: V = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
    n = norm(n); const o = pts[0]; let e1 = sub(pts[1], o); e1 = norm(sub(e1, mul(n, dot(e1, n)))); const e2 = cross(n, e1);
    const P = pts.map((p) => [dot(sub(p, o), e1), dot(sub(p, o), e2)]);
    const lo: V = [BIG, BIG, BIG], hi: V = [-BIG, -BIG, -BIG]; const t = thick / 2;
    for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - t); hi[i] = Math.max(hi[i], p[i] + t); }
    return {
      f: (x, y, z) => {
        const offsetX = x - o[0], offsetY = y - o[1], offsetZ = z - o[2];
        const sideDistance = sdPoly2(offsetX * e1[0] + offsetY * e1[1] + offsetZ * e1[2], offsetX * e2[0] + offsetY * e2[1] + offsetZ * e2[2], P);
        const capDistance = Math.abs(offsetX * n[0] + offsetY * n[1] + offsetZ * n[2]) - t;
        const outsideSide = Math.max(sideDistance, 0), outsideCap = Math.max(capDistance, 0);
        return Math.sqrt(outsideSide * outsideSide + outsideCap * outsideCap) + Math.min(Math.max(sideDistance, capDistance), 0);
      }, lo, hi, lip: 0.9,
    };
  },
  // torus: centre, axis normal, big radius R, tube radius r (shield rims, rings, belts, bowl lips)
  ring(c: V, n0: V, R: number, r: number): Shape {
    const n = norm(n0); const e: V = [0, 1, 2].map((i) => R * Math.sqrt(Math.max(0, 1 - n[i] * n[i])) + r) as V;
    return {
      f: (x, y, z) => {
        const offsetX = x - c[0], offsetY = y - c[1], offsetZ = z - c[2]; const h = offsetX * n[0] + offsetY * n[1] + offsetZ * n[2];
        const awayX = offsetX - n[0] * h, awayY = offsetY - n[1] * h, awayZ = offsetZ - n[2] * h; const rad = Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ);
        const tubeOffset = rad - R; return Math.sqrt(tubeOffset * tubeOffset + h * h) - r;
      },
      lo: sub(c, e), hi: add(c, e), lip: 1,
    };
  },
  // half-space: inside where dot(x - p, n) < 0. Only useful inside S.inter / S.sub.
  half(p: V, n0: V): Shape { const n = norm(n0); return { f: (x, y, z) => (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2], lo: [-BIG, -BIG, -BIG], hi: [BIG, BIG, BIG], lip: 1 }; },
  // muscled limb: capsule from a to b whose radius swells by `bulge` around fraction `at` (biceps, thigh, calf)
  limb(a: V, b: V, r1: number, r2: number, bulge = 0, at = 0.4): Shape {
    const ba = sub(b, a); const bb = dot(ba, ba) || 1e-9; const m = Math.max(r1, r2) + Math.max(bulge, 0);
    return {
      f: (x, y, z) => {
        const offsetX = x - a[0], offsetY = y - a[1], offsetZ = z - a[2]; const along = (offsetX * ba[0] + offsetY * ba[1] + offsetZ * ba[2]) / bb; const h = along < 0 ? 0 : along > 1 ? 1 : along;
        const u = (h - at) / (h < at ? Math.max(at, 0.1) : Math.max(1 - at, 0.1)); const bump = u * u < 1 ? (1 - u * u) : 0;
        const awayX = offsetX - ba[0] * h, awayY = offsetY - ba[1] * h, awayZ = offsetZ - ba[2] * h;
        return Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ) - (r1 + (r2 - r1) * h + bulge * bump * bump * (3 - 2 * bump) * 1.0);
      }, lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
      hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m], lip: 0.7,
    };
  },
  // tapered tube through a list of points (snake hair, tails, tendrils, horns); radii per point
  tube(pts: V[], radii: number[]): Shape {
    const lo: V = [BIG, BIG, BIG], hi: V = [-BIG, -BIG, -BIG];
    for (let i = 0; i < pts.length; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pts[i][k] - radii[i]); hi[k] = Math.max(hi[k], pts[i][k] + radii[i]); }
    const n = pts.length - 1; const bas: V[] = [], bbs: number[] = [];
    for (let i = 0; i < n; i++) { const ba = sub(pts[i + 1], pts[i]); bas.push(ba); bbs.push(dot(ba, ba) || 1e-9); }
    return {
      f: (x, y, z) => {
        let d = BIG;
        for (let i = 0; i < n; i++) {
          const a = pts[i]; const segment = bas[i]; const offsetX = x - a[0], offsetY = y - a[1], offsetZ = z - a[2];
          const along = (offsetX * segment[0] + offsetY * segment[1] + offsetZ * segment[2]) / bbs[i]; const h = along < 0 ? 0 : along > 1 ? 1 : along;
          const awayX = offsetX - segment[0] * h, awayY = offsetY - segment[1] * h, awayZ = offsetZ - segment[2] * h;
          d = Math.min(d, Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ) - (radii[i] + (radii[i + 1] - radii[i]) * h));
        }
        return d;
      }, lo, hi, lip: 0.8,
    };
  },
  // pleated frustum around an axis (chiton skirts, pteruges straps, tunics): n folds, depth amp, deeper towards b
  fold(a: V, b: V, r1: number, r2: number, nf: number, amp: number): Shape {
    const ba = sub(b, a); const L = len(ba) || 1e-9; const n = mul(ba, 1 / L); const t0: V = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(n, t0)); const e2 = cross(n, e1); const m = Math.max(r1, r2) + Math.abs(amp);
    return {
      f: (x, y, z) => {
        const offsetX = x - a[0], offsetY = y - a[1], offsetZ = z - a[2]; const t = offsetX * n[0] + offsetY * n[1] + offsetZ * n[2]; const fraction = t / L; const q = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        const ax = offsetX * e1[0] + offsetY * e1[1] + offsetZ * e1[2], ay = offsetX * e2[0] + offsetY * e2[1] + offsetZ * e2[2]; const radial = Math.sqrt(ax * ax + ay * ay);
        const th = atan2d(ay, ax); const wob = sind(th * nf) * amp * (0.35 + 0.65 * q);
        const sideDistance = radial - (r1 + (r2 - r1) * q + wob), capDistance = Math.abs(t - L / 2) - L / 2;
        const outsideSide = Math.max(sideDistance, 0), outsideCap = Math.max(capDistance, 0);
        return (Math.sqrt(outsideSide * outsideSide + outsideCap * outsideCap) + Math.min(Math.max(sideDistance, capDistance), 0)) * 0.85;
      }, lo: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m],
      hi: [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m], lip: 0.6,
    };
  },
  // hanging cloth: top-centre o, width direction e1, drop direction e2; widths w0 (top) .. w1 (hem); length H; vertical folds
  drape(o: V, e1: V, e2: V, w0: number, w1: number, H: number, thick: number, folds: number, amp: number): Shape {
    const E1 = norm(e1); const E2 = norm(sub(e2, mul(E1, dot(e2, E1)))); const N = cross(E1, E2); const wm = Math.max(w0, w1);
    const lo: V = [BIG, BIG, BIG], hi: V = [-BIG, -BIG, -BIG]; const mm = thick + Math.abs(amp);
    for (const aa of [-wm, wm]) for (const bb of [0, H]) for (const cc of [-mm, mm]) { const p = add(o, add(mul(E1, aa), add(mul(E2, bb), mul(N, cc)))); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } }
    return {
      f: (x, y, z) => {
        const offsetX = x - o[0], offsetY = y - o[1], offsetZ = z - o[2];
        const a = offsetX * E1[0] + offsetY * E1[1] + offsetZ * E1[2], b = offsetX * E2[0] + offsetY * E2[1] + offsetZ * E2[2], c = offsetX * N[0] + offsetY * N[1] + offsetZ * N[2];
        const fraction = b / H; const tt = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        const w = w0 + (w1 - w0) * tt; const off = sind(a / (wm || 1) * folds * 180) * amp * (0.25 + 0.75 * tt);
        const d2 = Math.max(Math.abs(a) - w, -b, b - H); const capDistance = Math.abs(c - off) - thick / 2;
        const outsideSide = Math.max(d2, 0), outsideCap = Math.max(capDistance, 0);
        return (Math.sqrt(outsideSide * outsideSide + outsideCap * outsideCap) + Math.min(Math.max(d2, capDistance), 0)) * 0.7;
      }, lo, hi, lip: 0.5,
    };
  },
  union(...s: Shape[]): Shape {
    let lo = s[0].lo, hi = s[0].hi; for (const q of s.slice(1)) { const b = bbU({ f: s[0].f, lo, hi, lip: 1 }, q); lo = b[0]; hi = b[1]; }
    return { f: (x, y, z) => { let d = BIG; for (let shapeIndex = 0; shapeIndex < s.length; shapeIndex++) d = Math.min(d, s[shapeIndex].f(x, y, z)); return d; }, lo, hi, lip: Math.min(...s.map((q) => q.lip)) };
  },
  smooth(k: number, ...s: Shape[]): Shape {
    const u = S.union(...s);
    return {
      f: (x, y, z) => {
        let d = s[0].f(x, y, z);
        for (let shapeIndex = 1; shapeIndex < s.length; shapeIndex++) { const b = s[shapeIndex].f(x, y, z); const blend = 0.5 + 0.5 * (b - d) / k; const h = blend < 0 ? 0 : blend > 1 ? 1 : blend; d = b + (d - b) * h - k * h * (1 - h); }
        return d;
      },
      lo: sub(u.lo, [k, k, k]), hi: add(u.hi, [k, k, k]), lip: u.lip * 0.9,
    };
  },
  sub(a: Shape, b: Shape): Shape { return { f: (x, y, z) => Math.max(a.f(x, y, z), -b.f(x, y, z)), lo: a.lo, hi: a.hi, lip: Math.min(a.lip, b.lip) }; },
  inter(a: Shape, b: Shape): Shape {
    return { f: (x, y, z) => Math.max(a.f(x, y, z), b.f(x, y, z)), lo: [Math.max(a.lo[0], b.lo[0]), Math.max(a.lo[1], b.lo[1]), Math.max(a.lo[2], b.lo[2])],
      hi: [Math.min(a.hi[0], b.hi[0]), Math.min(a.hi[1], b.hi[1]), Math.min(a.hi[2], b.hi[2])], lip: Math.min(a.lip, b.lip) };
  },
};

// ---------------- frames ----------------
// A character's own frame: f = forward, l = its left, z = up. facing 0 = +u (screen down-right): the viewer sees its front and
// its left side (a true 3/4 view). facing 90 = +v (down-left).
export class Frame {
  o: V; F: V; L: V;
  constructor(at: number[] = [0, 0], facing = 0, z = 0) { this.o = [at[0] || 0, at[1] || 0, z]; this.F = [cosd(facing), sind(facing), 0]; this.L = [-sind(facing), cosd(facing), 0]; }
  p(f: number, l: number, z: number): V { return [this.o[0] + f * this.F[0] + l * this.L[0], this.o[1] + f * this.F[1] + l * this.L[1], this.o[2] + z]; }
  d(f: number, l: number, z: number): V { return [f * this.F[0] + l * this.L[0], f * this.F[1] + l * this.L[1], z]; }
  local(p: V): V { const q = sub(p, this.o); return [q[0] * this.F[0] + q[1] * this.F[1], q[0] * this.L[0] + q[1] * this.L[1], q[2]]; }
}
