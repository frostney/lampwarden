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
const sq = (x: number): number => x * x;
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
    const e: V = [0, 1, 2].map((i) => Math.sqrt(sq(r[0] * A[0][i]) + sq(r[1] * A[1][i]) + sq(r[2] * A[2][i]))) as V;
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

// ---------------- the scene + renderer ----------------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export type Rendered = {
  w: number; h: number; rgba: Uint8Array; part: Int32Array; obj: Int32Array; depth: Float64Array; shade: Int8Array; matOf: string[];
  parts: number; stats: { [k: string]: number | string | boolean };
};
export class Kit {
  sanitized = false; parts: Part[] = []; nobj = 0; shadow = true; ground: string | null = null; ox = OX; oy = OY; fit: string = ''; dropped = 0; snapped = 0;
  mono: string | null = null; noScale = false; scaled = 0; scaleF = 1; inBody = false; guarded = 0; fireKept = 0;
  obj(): number { return ++this.nobj; }
  // add any raw shape with a material. tex(p) may return a shade shift (int) or [material, shift] for decals.
  solid(s: Shape, m: string, o: Opts = {}): number {
    let mm = mat(m); const ob = o.obj === undefined ? this.obj() : o.obj;
    let tx: Tex | null = o.tex || null;
    if (this.mono && mm !== 'fire') { mm = this.mono; }   // single-material mode (statues, automatons): every part and decal uses one material
    if (this.mono && tx) { const mo = this.mono; const t0 = tx; tx = (p: V): TexOut => { const q = t0(p); return (q !== null && typeof q === 'object') ? (q[0] === 'fire' ? q : [mo, q[1]]) : q; }; }
    const c = lerp(s.lo, s.hi, 0.5); const R = len(sub(s.hi, s.lo)) / 2;
    if (!(R < 1e5)) throw new Error('solid(): unbounded shape (use S.half only inside S.inter / S.sub)');
    this.parts.push({ s, mat: mm, shift: o.shift || 0, obj: ob, tex: tx, glow: !!o.glow || mm === 'fire', c, R, body: this.inBody });
    return ob;
  }
  // internal builders (used by the kit's own prop/creature code); the public names below mark parts as model-added "raw" shapes
  isphere(c: V, r: number, m: string, o: Opts = {}): number { return this.solid(S.sphere(c, r), m, o); }
  iellipsoid(c: V, r: V, m: string, o: Opts = {}, axes?: V[]): number { return this.solid(S.ellipsoid(c, r, axes), m, o); }
  icapsule(a: V, b: V, r1: number, r2: number | undefined, m: string, o: Opts = {}): number { return this.solid(S.capsule(a, b, r1, r2), m, o); }
  ibox(lo: V, hi: V, m: string, o: Opts = {}, r = 0): number { return this.solid(S.box(lo, hi, r), m, o); }
  icyl(a: V, b: V, r1: number, r2: number | undefined, m: string, o: Opts = {}): number { return this.solid(S.cyl(a, b, r1, r2), m, o); }
  ilathe(base: V, prof: number[][], m: string, o: Opts = {}): number { return this.solid(S.lathe(base, prof), m, o); }
  iplate(pts: V[], thick: number, m: string, o: Opts = {}): number { return this.solid(S.plate(pts, thick), m, o); }
  iring(c: V, n: V, R: number, r: number, m: string, o: Opts = {}): number { return this.solid(S.ring(c, n, R, r), m, o); }
  raw(ob: number, kind = ''): number { const q = this.parts[this.parts.length - 1]; q.raw = true; q.kind = kind; return ob; }
  sphere(c: V, r: number, m: string, o: Opts = {}): number { return this.raw(this.isphere(c, r, m, o), 'sphere'); }
  ellipsoid(c: V, r: V, m: string, o: Opts = {}, axes?: V[]): number { return this.raw(this.iellipsoid(c, r, m, o, axes), 'ellipsoid'); }
  capsule(a: V, b: V, r1: number, r2: number | undefined, m: string, o: Opts = {}): number { return this.raw(this.icapsule(a, b, r1, r2, m, o), 'capsule'); }
  box(lo: V, hi: V, m: string, o: Opts = {}, r = 0): number { return this.raw(this.ibox(lo, hi, m, o, r), 'box'); }
  cyl(a: V, b: V, r1: number, r2: number | undefined, m: string, o: Opts = {}): number { return this.raw(this.icyl(a, b, r1, r2, m, o), 'cyl'); }
  lathe(base: V, prof: number[][], m: string, o: Opts = {}): number { return this.raw(this.ilathe(base, prof, m, o), 'lathe'); }
  plate(pts: V[], thick: number, m: string, o: Opts = {}): number { return this.raw(this.iplate(pts, thick, m, o), 'plate'); }
  ring(c: V, n: V, R: number, r: number, m: string, o: Opts = {}): number { return this.raw(this.iring(c, n, R, r, m, o), 'ring'); }

  // ---- raw-shape sanitiser: model-added shapes must touch the body/prop. Detached ones snap to the nearest surface (<= 9 units) or are dropped.
  sanitize(): void {
    const raws: number[] = []; const base: number[] = [];
    for (let i = 0; i < this.parts.length; i++) (this.parts[i].raw ? raws : base).push(i);
    if (!raws.length || !base.length) return;
    const anchors = base.slice(); const drop: { [k: number]: boolean } = {};
    // v5 guards. (1) fire protection: a raw shape that buries a builder's flame is dropped. (2) a large raw sphere/ellipsoid/ring/cylinder whose centre
    // is buried inside a builder body part (head, neck, torso, limb) and is as big as that part is wrapped round it: dropped, so it cannot swallow the figure.
    const fireParts = base.filter((j) => this.parts[j].mat === 'fire');
    const bodyParts = base.filter((j) => this.parts[j].body);
    for (const ri of raws) {
      const P = this.parts[ri]; if (P.glow || P.mat === 'fire') continue;
      let hit = false;
      for (const j of fireParts) { const Q = this.parts[j]; if (P.s.f(Q.c[0], Q.c[1], Q.c[2]) < -0.2) { hit = true; break; } }
      if (hit) { drop[ri] = true; this.fireKept++; continue; }
      const kd = P.kind || ''; if (!(kd === 'ring' || kd === 'ellipsoid' || kd === 'sphere' || kd === 'cyl')) continue;
      if (P.R < 2.2) continue;
      for (const j of bodyParts) {
        const Q = this.parts[j]; if (len(sub(P.c, Q.c)) > Q.R + 0.5) continue;
        if (Q.s.f(P.c[0], P.c[1], P.c[2]) < -0.3 && (kd === 'ring' || P.R >= 0.8 * Q.R)) { drop[ri] = true; this.guarded++; break; }
      }
    }
    const dist = (q: V, list: number[], self: number): number => {
      let md = BIG;
      for (const j of list) { if (j === self) continue; const Q = this.parts[j]; const dc = len(sub(q, Q.c)) - Q.R; if (dc > md) continue; md = Math.min(md, Q.s.f(q[0], q[1], q[2])); }
      return md;
    };
    for (const ri of raws) {
      if (drop[ri]) continue;
      const P = this.parts[ri]; const lo = P.s.lo, hi = P.s.hi;
      if (hi[2] < -1 || lo[2] > 46 || Math.abs(P.c[0]) > 20 || Math.abs(P.c[1]) > 20) { drop[ri] = true; continue; }
      const pts: V[] = [P.c];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) pts.push([lo[0] + (hi[0] - lo[0]) * a / 2, lo[1] + (hi[1] - lo[1]) * b / 2, lo[2] + (hi[2] - lo[2]) * c / 2]);
      let gap = BIG; let bp: V = P.c;
      for (const q of pts) { if (!(P.s.f(q[0], q[1], q[2]) < 0.2)) continue; const d = dist(q, anchors, ri); if (d < gap) { gap = d; bp = q; } }
      if (gap > BIG / 2) { gap = dist(P.c, anchors, ri); bp = P.c; }
      if (gap <= 0.4 || lo[2] < 0.3) { anchors.push(ri); continue; }       // touches the body, or stands on the ground
      if (gap > 9) { drop[ri] = true; continue; }
      const e = 0.06; const g: V = norm([dist([bp[0] + e, bp[1], bp[2]], anchors, ri) - dist([bp[0] - e, bp[1], bp[2]], anchors, ri), dist([bp[0], bp[1] + e, bp[2]], anchors, ri) - dist([bp[0], bp[1] - e, bp[2]], anchors, ri), dist([bp[0], bp[1], bp[2] + e], anchors, ri) - dist([bp[0], bp[1], bp[2] - e], anchors, ri)]);
      const mv: V = mul(g, -(gap + 0.15));
      const s0 = P.s; const t0 = P.tex;
      const ns: Shape = { f: (x, y, z) => s0.f(x - mv[0], y - mv[1], z - mv[2]), lo: add(s0.lo, mv), hi: add(s0.hi, mv), lip: s0.lip };
      this.parts[ri] = { ...P, s: ns, tex: t0 ? ((p: V) => t0([p[0] - mv[0], p[1] - mv[1], p[2] - mv[2]])) : null, c: add(P.c, mv) };
      this.snapped++; anchors.push(ri);
    }
    const kept: Part[] = []; for (let i = 0; i < this.parts.length; i++) { if (drop[i]) this.dropped++; else kept.push(this.parts[i]); }
    this.parts = kept;
  }

  // render with auto-fit: if the sprite touches the canvas edge, slide it on the canvas (pure screen offset) and render again.
  // Every pass rasterises without the ground shadow; the shadow is cast once, onto the final pass. It only fills empty pixels,
  // so it never changes the fit, and the auto-scale probe is reused as the first pass when it did not rescale the scene.
  render(): Rendered {
    if (!this.sanitized) { this.sanitized = true; this.sanitize(); }
    let rendered: Rendered | null = null;
    if (!this.scaled && !this.noScale) rendered = this.autoscale();
    if (!rendered) rendered = this.render1(false);
    let tries = 0;
    while (tries < 5) {
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let i = 0; i < W * H; i++) if (rendered.part[i] >= 0) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      let dx = 0, dy = 0;
      if (y0 <= 2 && y1 < H - 10) dy = 6; else if (y1 >= H - 3 && y0 > 10) dy = -6;
      if (x0 <= 2 && x1 < W - 10) dx = 6; else if (x1 >= W - 3 && x0 > 10) dx = -6;
      if (dx === 0 && dy === 0) break;
      this.ox += dx; this.oy += dy; this.fit += (this.fit ? ',' : '') + dx + ':' + dy; tries++;
      rendered = this.render1(false);
    }
    if (this.shadow) this.castShadow(rendered);
    return rendered;
  }

  // v5 auto-fill-the-frame: if the subject is small (largest sprite extent < 62 px) scale the whole scene about the ground origin to ~78 px (max 2.2x).
  // Returns the probe pass when the scene was left as it is (the caller reuses it), null when there was no probe or the scene was rescaled.
  autoscale(): Rendered | null {
    this.scaled = 1; if (!this.parts.length) return null;
    const r = this.render1(false); let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let i = 0; i < W * H; i++) if (r.part[i] >= 0) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return r; const ex = Math.max((y1 - y0 + 1), (x1 - x0 + 1) * 0.85);
    if (ex >= 62) return r; const f = Math.min(78 / ex, 2.2); if (f < 1.08) return r;
    this.scaleF = f;
    this.parts = this.parts.map((P) => {
      const s0 = P.s; const t0 = P.tex;
      const ns: Shape = { f: (x, y, z) => s0.f(x / f, y / f, z / f) * f, lo: mul(s0.lo, f), hi: mul(s0.hi, f), lip: s0.lip };
      return { ...P, s: ns, tex: t0 ? ((p: V) => t0([p[0] / f, p[1] / f, p[2] / f])) : null, c: mul(P.c, f), R: P.R * f };
    });
    return null;
  }
  pj(q: V): [number, number] { return [this.ox + 2 * (q[0] - q[1]), this.oy + q[0] + q[1] - ZK * q[2]]; }
  render1(withShadow: boolean): Rendered {
    const N = W * H; const depth = new Float64Array(N).fill(-BIG); const part = new Int32Array(N).fill(-1);
    const nrm = new Float64Array(N * 3); const pos = new Float64Array(N * 3);
    for (let pi = 0; pi < this.parts.length; pi++) {
      const P = this.parts[pi]; const s = P.s; const lo = s.lo, hi = s.hi;
      let x0 = BIG, x1 = -BIG, y0 = BIG, y1 = -BIG;
      for (let c = 0; c < 8; c++) {
        const q: V = [(c & 1) ? hi[0] : lo[0], (c & 2) ? hi[1] : lo[1], (c & 4) ? hi[2] : lo[2]]; const sp = this.pj(q);
        x0 = Math.min(x0, sp[0]); x1 = Math.max(x1, sp[0]); y0 = Math.min(y0, sp[1]); y1 = Math.max(y1, sp[1]);
      }
      const px0 = Math.max(0, Math.floor(x0) - 1), px1 = Math.min(W - 1, Math.ceil(x1) + 1), py0 = Math.max(0, Math.floor(y0) - 1), py1 = Math.min(H - 1, Math.ceil(y1) + 1);
      const sLo = lo[0] + lo[1] - 0.5, sHi = hi[0] + hi[1] + 0.5;
      const lip = s.lip;
      for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) {
        const d = (px + 0.5 - this.ox) / 2; const cy = py + 0.5;
        // s range from u, v, z bounds: u=(s+d)/2, v=(s-d)/2, z=(this.oy+s-cy)/ZK
        let a = Math.max(sLo, 2 * lo[0] - d, 2 * lo[1] + d, ZK * lo[2] - this.oy + cy);
        let b = Math.min(sHi, 2 * hi[0] - d, 2 * hi[1] + d, ZK * hi[2] - this.oy + cy);
        if (a > b) continue;
        const idx = py * W + px;
        let t = b + 0.05; let hit = false; let guard = 0;
        while (t >= a - 0.05 && guard < 220) {
          guard++;
          if (t <= depth[idx]) break;
          const x = (t + d) / 2, y = (t - d) / 2, z = (this.oy + t - cy) / ZK;
          const dist = s.f(x, y, z);
          if (dist < 0.02) { hit = true; break; }
          t -= Math.max(dist * lip, 0.01) / VL;
        }
        if (!hit || t <= depth[idx]) continue;
        // refine with a few bisection steps
        let ta = t, tb = t + 0.06;
        for (let r = 0; r < 4; r++) { const tm = (ta + tb) / 2; const x = (tm + d) / 2, y = (tm - d) / 2, z = (this.oy + tm - cy) / ZK; if (s.f(x, y, z) < 0) ta = tm; else tb = tm; }
        t = (ta + tb) / 2;
        depth[idx] = t; part[idx] = pi;
      }
    }
    // surface point and normal, once per pixel for the part that ended up in front (a part drawn over later needs neither)
    for (let idx = 0; idx < N; idx++) {
      const frontPart = part[idx]; if (frontPart < 0) continue;
      const frontShape = this.parts[frontPart].s; const pixelX = idx % W, pixelY = (idx - pixelX) / W;
      const diagonal = (pixelX + 0.5 - this.ox) / 2; const pixelCentreY = pixelY + 0.5; const surfaceDepth = depth[idx];
      const surfaceX = (surfaceDepth + diagonal) / 2, surfaceY = (surfaceDepth - diagonal) / 2, surfaceZ = (this.oy + surfaceDepth - pixelCentreY) / ZK; const normalStep = 0.04;
      const normal = norm([frontShape.f(surfaceX + normalStep, surfaceY, surfaceZ) - frontShape.f(surfaceX - normalStep, surfaceY, surfaceZ),
        frontShape.f(surfaceX, surfaceY + normalStep, surfaceZ) - frontShape.f(surfaceX, surfaceY - normalStep, surfaceZ),
        frontShape.f(surfaceX, surfaceY, surfaceZ + normalStep) - frontShape.f(surfaceX, surfaceY, surfaceZ - normalStep)]);
      nrm[idx * 3] = normal[0]; nrm[idx * 3 + 1] = normal[1]; nrm[idx * 3 + 2] = normal[2];
      pos[idx * 3] = surfaceX; pos[idx * 3 + 1] = surfaceY; pos[idx * 3 + 2] = surfaceZ;
    }
    // shade
    const rgba = new Uint8Array(N * 4); const shade = new Int8Array(N).fill(-1); const obj = new Int32Array(N).fill(-1);
    const matOf: string[] = new Array(N).fill('');
    for (let i = 0; i < N; i++) {
      const pi = part[i]; if (pi < 0) continue; const P = this.parts[pi];
      const n: V = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]; const p: V = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      let m = P.mat; let sh = P.shift;
      if (P.tex) { const tv = P.tex(p); if (typeof tv === 'number') sh += tv; else if (tv) { m = mat(tv[0]); sh += tv[1]; } }
      const R = RGB[m]; const NN = R.length; let k: number;
      if (P.glow && m === 'fire') {
        const tz = clamp((p[2] - P.s.lo[2]) / ((P.s.hi[2] - P.s.lo[2]) || 1), 0, 1);
        k = Math.round(NN - 1 - tz * (NN - 3) - hash(p[0], p[1], p[2]) * 1.2) + sh;
      } else {
        const lam = Math.max(0, dot(n, LIGHT));
        // form shading: banded lambert + ground bounce on undersides + lit rim + ordered dither on band seams (smooth, not noisy)
        let kf = 1 + (NN - 2) * (0.12 + 0.88 * lam);
        if (n[2] < 0) kf += Math.min(1, -n[2]) * 0.55 * (1 - lam);
        const ndv = dot(n, VIEW); if (ndv < 0.38 && lam > 0.2) kf += (0.38 - ndv) * 1.4;
        const kb = Math.floor(kf), fr = kf - kb; const bx = i % W, by = (i - bx) / W;
        if (fr > 0.3 && fr < 0.7) k = kb + (((fr - 0.3) / 0.4) > BAYER[(by & 3) * 4 + (bx & 3)] / 16 ? 1 : 0); else k = Math.round(kf);
        k += sh;
        if ((m === 'bronze' || m === 'gold' || m === 'iron') && dot(n, HALF) > 0.965) k = NN - 1;
        else if (m.charAt(0) === 's' && m.charAt(1) === 'k' && dot(n, HALF) > 0.985) k += 1;
        else if (m === 'snake' && dot(n, HALF) > 0.97) k += 1;
      }
      k = clamp(k, 1, NN - 1);
      const c = R[k]; rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
      shade[i] = k; obj[i] = P.obj; matOf[i] = m;
    }
    const rendered: Rendered = { w: W, h: H, rgba, part, obj, depth, shade, matOf, parts: this.parts.length, stats: {} };
    if (withShadow) this.castShadow(rendered);
    return rendered;
  }
  // cast shadow on the ground plane z=0 (translucent), only on empty pixels
  castShadow(rendered: Rendered): void {
    const { rgba, part, shade } = rendered;
    if (this.shadow && this.parts.length) {
      const sc = RGB.shadow; let gx0 = BIG, gx1 = -BIG, gy0 = BIG, gy1 = -BIG;
      for (const P of this.parts) for (let c = 0; c < 8; c++) {
        const q: V = [(c & 1) ? P.s.hi[0] : P.s.lo[0], (c & 2) ? P.s.hi[1] : P.s.lo[1], (c & 4) ? P.s.hi[2] : P.s.lo[2]];
        const zz = Math.max(q[2], 0); const g: V = [q[0] - LIGHT[0] * zz / LIGHT[2], q[1] - LIGHT[1] * zz / LIGHT[2], 0];
        for (const pt of [g, [q[0], q[1], 0] as V]) { const sp = this.pj(pt); gx0 = Math.min(gx0, sp[0]); gx1 = Math.max(gx1, sp[0]); gy0 = Math.min(gy0, sp[1]); gy1 = Math.max(gy1, sp[1]); }
      }
      const X0 = Math.max(0, Math.floor(gx0)), X1 = Math.min(W - 1, Math.ceil(gx1)), Y0 = Math.max(0, Math.floor(gy0)), Y1 = Math.min(H - 1, Math.ceil(gy1));
      // Exact speed-ups of the march toward the light (same steps, same shadow pixels as visiting every part at every step):
      // - per pixel, each part's bounding-sphere distance from the whole ray (t from 0.15 to 60) is a lower bound of the per-step sphere
      //   distance, so a part whose bound exceeds the nearest distance found so far is skipped, as the per-step test would have skipped it;
      // - the parts are split into a near list (bound within shadowNearSlack of the smallest bound) and a far list, which can only matter at
      //   steps whose nearest distance is beyond every near bound; the nearest part of the previous step goes first. The nearest distance
      //   is a minimum, so the order changes nothing, but starting low lets the bounds skip most parts;
      // - a pixel whose ray never comes within the 0.03 hit distance of any sphere is not marched, and the march stops once the ray has
      //   left every sphere grown by the hit distance, because no later step can come closer than 0.03.
      const parts = this.parts; const partCount = parts.length;
      const centreX = new Float64Array(partCount), centreY = new Float64Array(partCount), centreZ = new Float64Array(partCount);
      const radius = new Float64Array(partCount); const rayBound = new Float64Array(partCount);
      const nearParts = new Int32Array(partCount), farParts = new Int32Array(partCount);
      for (let partIndex = 0; partIndex < partCount; partIndex++) {
        const centre = parts[partIndex].c; centreX[partIndex] = centre[0]; centreY[partIndex] = centre[1]; centreZ[partIndex] = centre[2]; radius[partIndex] = parts[partIndex].R;
      }
      const lightX = LIGHT[0], lightY = LIGHT[1], lightZ = LIGHT[2];
      const boundMargin = 1e-6;   // covers rounding: a bound may only ever be below the distance the march computes, an exit only beyond it
      const hitDistance = 0.03; const shadowNearSlack = 2;
      for (let py = Y0; py <= Y1; py++) for (let px = X0; px <= X1; px++) {
        const i = py * W + px; if (part[i] >= 0) continue;
        const d = (px + 0.5 - this.ox) / 2; const sg = py + 0.5 - this.oy; const groundX = (sg + d) / 2, groundY = (sg - d) / 2;
        let nearestBound = BIG; let rayExit = -BIG;
        for (let partIndex = 0; partIndex < partCount; partIndex++) {
          const offsetX = centreX[partIndex] - groundX, offsetY = centreY[partIndex] - groundY, offsetZ = centreZ[partIndex];
          const alongLine = offsetX * lightX + offsetY * lightY + offsetZ * lightZ;
          const lineX = offsetX - lightX * alongLine, lineY = offsetY - lightY * alongLine, lineZ = offsetZ - lightZ * alongLine;
          const lineDistanceSquared = lineX * lineX + lineY * lineY + lineZ * lineZ;
          const grownRadius = radius[partIndex] + hitDistance + boundMargin;
          if (lineDistanceSquared < grownRadius * grownRadius) { const leaves = alongLine + Math.sqrt(grownRadius * grownRadius - lineDistanceSquared); if (leaves > rayExit) rayExit = leaves; }
          const along = alongLine < 0.15 ? 0.15 : alongLine > 60 ? 60 : alongLine;
          const awayX = offsetX - lightX * along, awayY = offsetY - lightY * along, awayZ = offsetZ - lightZ * along;
          const bound = Math.sqrt(awayX * awayX + awayY * awayY + awayZ * awayZ) - radius[partIndex] - boundMargin;
          rayBound[partIndex] = bound; if (bound < nearestBound) nearestBound = bound;
        }
        if (nearestBound >= hitDistance) continue;
        const nearLimit = nearestBound + shadowNearSlack; let nearCount = 0, farCount = 0;
        for (let partIndex = 0; partIndex < partCount; partIndex++) { if (rayBound[partIndex] <= nearLimit) nearParts[nearCount++] = partIndex; else farParts[farCount++] = partIndex; }
        let t = 0.15; let inShadow = false; let previousNearestPart = -1;
        for (let step = 0; step < 90 && t < 60; step++) {
          if (t > rayExit) break;
          const pointX = groundX + lightX * t, pointY = groundY + lightY * t, pointZ = 0 + lightZ * t;
          let nearest = BIG; let nearestPart = -1;
          for (let order = -1; order < nearCount + farCount; order++) {
            let partIndex: number;
            if (order < 0) { partIndex = previousNearestPart; if (partIndex < 0) continue; }
            else if (order < nearCount) { partIndex = nearParts[order]; if (partIndex === previousNearestPart) continue; }
            else { if (nearest <= nearLimit) break; partIndex = farParts[order - nearCount]; if (partIndex === previousNearestPart) continue; }
            if (rayBound[partIndex] > nearest) continue;
            const deltaX = pointX - centreX[partIndex], deltaY = pointY - centreY[partIndex], deltaZ = pointZ - centreZ[partIndex];
            const sphereDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) - radius[partIndex]; if (sphereDistance > nearest) continue;
            const partDistance = Math.max(sphereDistance, parts[partIndex].s.f(pointX, pointY, pointZ));
            if (partDistance < nearest) nearestPart = partIndex;
            nearest = Math.min(nearest, partDistance);
          }
          previousNearestPart = nearestPart;
          if (nearest < hitDistance) { inShadow = true; break; }
          t += Math.max(nearest * 0.8, 0.05);
        }
        if (inShadow) { const c = sc[1]; rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 150; shade[i] = -2; }
      }
    }
  }
}

// ---------------- post step (no LLM): outline, palette clamp, bounds, coverage ----------------
let PALFLAT: number[][] | null = null;
export function post(r: Rendered): Rendered {
  const N = r.w * r.h; const out = new Uint8Array(r.rgba); const { obj, depth, matOf, part } = r;
  const nb = [-1, 1, -r.w, r.w];
  let outer = 0, inner = 0;
  for (let i = 0; i < N; i++) {
    const x = i % r.w;
    if (obj[i] < 0) {
      // outer outline: darkest shade of the front-most neighbouring part
      let best = -1, bd = -BIG;
      for (const o of nb) { const j = i + o; if (j < 0 || j >= N) continue; if ((o === -1 && x === 0) || (o === 1 && x === r.w - 1)) continue; if (obj[j] >= 0 && depth[j] > bd) { bd = depth[j]; best = j; } }
      if (best >= 0) { const c = RGB[matOf[best]][0]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; outer++; }
    } else {
      // interior line where a different object sits clearly in front of this pixel
      for (const o of nb) {
        const j = i + o; if (j < 0 || j >= N) continue; if ((o === -1 && x === 0) || (o === 1 && x === r.w - 1)) continue;
        if (obj[j] >= 0 && obj[j] !== obj[i] && depth[j] > depth[i] + 1.0) {
          const R = RGB[matOf[i]]; const c = R[Math.min(1, R.length - 1)]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; inner++; break;
        }
      }
    }
  }
  // palette clamp
  if (!PALFLAT) { PALFLAT = []; for (const k of MATS) for (const c of RGB[k]) PALFLAT.push(c); }
  let clamped = 0;
  // the nearest palette colour depends only on the pixel's colour, and a sprite has few distinct colours: search once per colour
  const nearestByColour = new Map<number, number[] | null>();   // packed rgb -> nearest palette colour, or null when it is in the palette
  for (let i = 0; i < N; i++) {
    if (out[i * 4 + 3] !== 255) continue;
    const packedColour = (out[i * 4] * 256 + out[i * 4 + 1]) * 256 + out[i * 4 + 2];
    let nearestColour = nearestByColour.get(packedColour);
    if (nearestColour === undefined) {
      let bd = BIG, bc = PALFLAT[0];
      for (const c of PALFLAT) { const dd = (c[0] - out[i * 4]) * (c[0] - out[i * 4]) + (c[1] - out[i * 4 + 1]) * (c[1] - out[i * 4 + 1]) + (c[2] - out[i * 4 + 2]) * (c[2] - out[i * 4 + 2]); if (dd < bd) { bd = dd; bc = c; } }
      nearestColour = bd > 0 ? bc : null; nearestByColour.set(packedColour, nearestColour);
    }
    if (nearestColour !== null) { clamped++; out[i * 4] = nearestColour[0]; out[i * 4 + 1] = nearestColour[1]; out[i * 4 + 2] = nearestColour[2]; }
  }
  // bounds / coverage
  let cnt = 0, minx = r.w, maxx = -1, miny = r.h, maxy = -1, edge = 0;
  for (let i = 0; i < N; i++) if (out[i * 4 + 3] === 255) {
    const x = i % r.w, y = (i - x) / r.w; cnt++;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1) edge++;
  }
  const cov = cnt / N; const flags: string[] = [];
  if (edge > 0) flags.push('clipped_at_edge');
  if (cov < 0.03) flags.push('too_small'); if (cov > 0.6) flags.push('too_big');
  if (maxy - miny + 1 < 24) flags.push('too_short');
  let used = 0; for (let i = 0; i < N; i++) if (part[i] >= 0) used++;
  const st = { coverage: Math.round(cov * 1000) / 1000, bbox: minx + ',' + miny + ',' + maxx + ',' + maxy, outer, inner, clamped, edge, parts: r.parts, flags: flags.join('|') || 'ok' };
  return { ...r, rgba: out, stats: st };
}

// ---------------- image helpers (montage, scaling, labels with a built-in 3x5 font) ----------------
export type Img = { w: number; h: number; rgba: Uint8Array };
const FONT: { [k: string]: string } = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  '-': '000000111000000', '.': '000000000000010', '/': '001001010100100', ':': '000010000010000', '(': '010100100100010', ')': '010001001001010',
  '+': '000010111010000', '#': '101111101111101', ' ': '000000000000000', '_': '000000000000111', '!': '010010010000010', '?': '110001010000010',
};
export function text(img: Img, x: number, y: number, s: string, col: number[], scale = 1): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] || FONT['?'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1')
      for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
        const px = cx + c * scale + b, py = y + r * scale + a; if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
        const i = (py * img.w + px) * 4; img.rgba[i] = col[0]; img.rgba[i + 1] = col[1]; img.rgba[i + 2] = col[2]; img.rgba[i + 3] = 255;
      }
    cx += 4 * scale;
  }
}
export function blank(w: number, h: number, bg: number[]): Img {
  const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = bg.length > 3 ? bg[3] : 255; }
  return { w, h, rgba };
}
// alpha-over (integer maths, deterministic)
export function blit(dst: Img, src: Img, ox: number, oy: number, scale = 1): void {
  for (let y = 0; y < src.h * scale; y++) for (let x = 0; x < src.w * scale; x++) {
    const dx = ox + x, dy = oy + y; if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
    const si = (((y / scale) | 0) * src.w + ((x / scale) | 0)) * 4; const a = src.rgba[si + 3]; if (a === 0) continue;
    const di = (dy * dst.w + dx) * 4;
    for (let c = 0; c < 3; c++) dst.rgba[di + c] = ((src.rgba[si + c] * a + dst.rgba[di + c] * (255 - a)) / 255 + 0.5) | 0;
    dst.rgba[di + 3] = 255;
  }
}
export function onBg(src: Img, bg: number[] = [46, 46, 56], scale = 1): Img { const d = blank(src.w * scale, src.h * scale, bg); blit(d, src, 0, 0, scale); return d; }
export function montage(tiles: { img: Img; label: string; tag?: string }[], cols = 4, scale = 2): Img {
  const tw = 128 * scale, th = 128 * scale + 10; const rows = Math.ceil(tiles.length / cols);
  const m = blank(cols * tw, rows * th, [30, 28, 36]);
  tiles.forEach((t, i) => {
    const x = (i % cols) * tw, y = Math.floor(i / cols) * th; const cell = blank(tw - 2, th - 2, [46, 46, 56]);
    blit(cell, t.img, -0, 0, scale); blit(m, cell, x + 1, y + 1, 1);
    text(m, x + 4, y + 128 * scale - 1, t.label.slice(0, Math.floor((tw - 8) / 4)), [235, 225, 200]);
    if (t.tag) text(m, x + tw - 4 - t.tag.length * 4, y + 4, t.tag, t.tag.indexOf('FAIL') >= 0 ? [230, 90, 80] : [140, 220, 120]);
  });
  return m;
}

// ---------------- rig space: build in a character's local (f, l, z) frame, then ground/fall/place ----------------
class Xf {
  fr: Frame; fall: number; dz: number; df: number;
  constructor(fr: Frame, fall: number, dz: number, df = 0) { this.fr = fr; this.fall = fall; this.dz = dz; this.df = df; }
  w(p: V): V { const c = cosd(this.fall), s = sind(this.fall); return this.fr.p(p[0] * c - p[2] * s - this.df, p[1], p[0] * s + p[2] * c + this.dz); }
  d(p: V): V { const c = cosd(this.fall), s = sind(this.fall); return this.fr.d(p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c); }
  loc(pw: V): V { const q = this.fr.local(pw); const z = q[2] - this.dz; const c = cosd(this.fall), s = sind(this.fall); const x = q[0] + this.df; return [x * c + z * s, q[1], -x * s + z * c]; }
}
type LTex = (p: V) => TexOut;
type LO = { obj?: number; shift?: number; tex?: LTex; glow?: boolean };
class Rig {
  ops: ((X: Xf) => void)[] = []; keys: { p: V; r: number }[] = [];
  k: Kit;
  constructor(k: Kit) { this.k = k; }
  o(X: Xf, o: LO): Opts { const t = o.tex; return { obj: o.obj, shift: o.shift, glow: o.glow, tex: t ? ((pw: V) => t(X.loc(pw))) : undefined }; }
  key(p: V, r: number): void { this.keys.push({ p, r }); }
  sph(c: V, r: number, m: string, o: LO = {}): void { this.key(c, r); this.ops.push((X) => this.k.solid(S.sphere(X.w(c), r), m, this.o(X, o))); }
  ell(c: V, r: V, ax: V[], m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.ellipsoid(X.w(c), r, ax.map((a) => X.d(a))), m, this.o(X, o))); }
  cap(a: V, b: V, r1: number, r2: number, m: string, o: LO = {}): void { this.key(a, r1); this.key(b, r2); this.ops.push((X) => this.k.solid(S.capsule(X.w(a), X.w(b), r1, r2), m, this.o(X, o))); }
  cyl(a: V, b: V, r1: number, r2: number, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.cyl(X.w(a), X.w(b), r1, r2), m, this.o(X, o))); }
  plate(pts: V[], t: number, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.plate(pts.map((p) => X.w(p)), t), m, this.o(X, o))); }
  ring(c: V, n: V, R: number, r: number, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.ring(X.w(c), X.d(n), R, r), m, this.o(X, o))); }
  limb(a: V, b: V, r1: number, r2: number, bulge: number, at: number, m: string, o: LO = {}): void { this.key(a, r1); this.key(b, r2); this.ops.push((X) => this.k.solid(S.limb(X.w(a), X.w(b), r1, r2, bulge, at), m, this.o(X, o))); }
  tube(pts: V[], radii: number[], m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.tube(pts.map((p) => X.w(p)), radii), m, this.o(X, o))); }
  fold(a: V, b: V, r1: number, r2: number, nf: number, amp: number, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.fold(X.w(a), X.w(b), r1, r2, nf, amp), m, this.o(X, o))); }
  drape(c: V, e1: V, e2: V, w0: number, w1: number, H: number, th: number, nf: number, amp: number, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(S.drape(X.w(c), X.d(e1), X.d(e2), w0, w1, H, th, nf, amp), m, this.o(X, o))); }
  shape(fn: (X: Xf) => Shape, m: string, o: LO = {}): void { this.ops.push((X) => this.k.solid(fn(X), m, this.o(X, o))); }
  emit(fr: Frame, fall = 0, lift = 0): Xf {
    const c = cosd(fall), s = sind(fall); let mz = BIG;
    let mx = 0, xa = BIG, xb = -BIG; for (const q of this.keys) { mz = Math.min(mz, q.p[0] * s + q.p[2] * c - q.r); const x = q.p[0] * c - q.p[2] * s; xa = Math.min(xa, x); xb = Math.max(xb, x); }
    if (fall > 30 && xa < BIG) mx = (xa + xb) / 2;
    const X = new Xf(fr, fall, (mz < BIG ? -mz : 0) + lift + fr.o[2], mx);
    X.fr = new Frame([fr.o[0], fr.o[1]], 0, 0); X.fr.F = fr.F; X.fr.L = fr.L;
    const ib = this.k.inBody; this.k.inBody = true;
    for (const op of this.ops) op(X);
    this.k.inBody = ib;
    return X;
  }
}

// ---------------- poses ----------------
export type Pose = { wy?: number; hipL?: number; hipR?: number; kneeL?: number; kneeR?: number; shL?: number; shR?: number; abL?: number; abR?: number;
  elL?: number; elR?: number; lean?: number; wpn?: number; head?: number; fall?: number; bob?: number; spread?: number; flap?: number;
  abd?: number; yaw?: number; sway?: number; breath?: number; draw?: number;
  whirl?: number; rel?: number; shot?: number };   // v6: sling whirl angle (-1 hanging, 1000 extended), projectile flight (rel>0 flying, -1 gone), arrow flight
export const POSE_NAMES = ['idle', 'idle1', 'idle2', 'idle3', 'idle4', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'hurt', 'death'];
const wclass = (w: string): string => (w === 'spear' || w === 'trident' || w === 'staff' || w === 'torch') ? 'pole'
  : (w === 'xiphos' || w === 'kopis' || w === 'sword' || w === 'thunderbolt') ? 'sword' : (w === 'club' || w === 'labrys' || w === 'axe' || w === 'hammer') ? 'heavy' : w === 'bow' ? 'bow' : w === 'pipes' ? 'pipes'
  : (w === 'javelin' || w === 'throwspear') ? 'throw' : w === 'sling' ? 'sling' : 'none';
// pose(name, weapon, hasShield) -> joint angles in degrees. sh = shoulder pitch forward, ab = abduction outwards, el = elbow bend,
// hip = thigh pitch forward, knee = bend, abd = leg spread sideways, lean = torso forward, yaw = torso twist, wpn = weapon pitch
export function pose(name: string, weapon = 'none', shield = false): Pose {
  const wc = wclass(weapon);
  const p: Pose = { hipL: 13, hipR: -10, kneeL: 4, kneeR: 11, shL: 12, abL: 14, elL: 25, shR: 12, abR: 14, elR: 25, lean: 0, wpn: 0, head: 0, bob: 0, spread: 1, flap: 0, abd: 8, yaw: 0, sway: 0, breath: 0.5, draw: 0.45 };
  if (wc === 'pole') { p.shR = 14; p.abR = 20; p.elR = 85; p.wpn = 76; }
  if (wc === 'sword') { p.shR = 38; p.abR = 22; p.elR = 70; p.wpn = 68; }
  if (wc === 'heavy') { p.shR = 20; p.abR = 18; p.elR = 70; p.wpn = 62; }
  if (wc === 'throw') { p.shR = 20; p.abR = 18; p.elR = 80; p.wpn = 62; }
  if (wc === 'sling') { p.shR = 28; p.abR = 14; p.elR = 55; p.wpn = 0; p.whirl = -1; }
  if (wc === 'bow') { p.shL = 80; p.abL = 6; p.elL = 6; p.shR = 78; p.abR = 4; p.elR = 140; p.wpn = 90; }
  if (wc === 'pipes') { p.shL = 50; p.abL = 22; p.elL = 125; p.shR = 50; p.abR = 22; p.elR = 125; p.wpn = 0; p.head = 6; }
  if (shield) { p.shL = 30; p.abL = 16; p.elL = 82; }
  const freeL = !shield && wc !== 'bow' && wc !== 'pipes'; const freeR = wc === 'none';
  const num = (s: string, pre: string): number => (s.indexOf(pre) === 0 ? parseInt(s.slice(pre.length), 10) : 0);
  const iw = num(name, 'idle');
  if (iw > 0 || name === 'idle') {
    const ph = (iw > 0 ? (iw - 1) * 90 : 90); const br = iw > 0 ? 0.5 - 0.5 * cosd(ph) : 0.5; const sw = iw > 0 ? sind(ph) : 0;
    p.breath = br; p.sway = sw * 0.55; p.bob = 0.5 * br; p.lean = -2 * br; p.head = 2.5 * br - 1 * sw; p.abL = (p.abL || 0) + 5 * br; p.abR = (p.abR || 0) + 5 * br;
    p.kneeL = (p.kneeL || 0) + 4 * (1 - br) + 5 * Math.max(0, -sw); p.kneeR = (p.kneeR || 0) + 4 * (1 - br) + 5 * Math.max(0, sw);
    p.hipL = (p.hipL || 0) + 2 * sw; p.hipR = (p.hipR || 0) - 2 * sw; p.yaw = 2.5 * sw;
    if (freeL) p.shL = 12 - 5 * sw + 4 * br; if (freeR) p.shR = 12 + 5 * sw + 4 * br;
    p.draw = 0.4 + 0.1 * br; p.flap = -0.4 + 0.5 * br; if (wc === 'bow') p.draw = 0.12 + 0.08 * br;
  }
  const wk = num(name, 'walk');
  if (wk > 0) {
    const ang = 90 + (wk - 1) * 60; const hl = 26 * sind(ang); const cl = cosd(ang);
    p.hipL = hl; p.hipR = -hl; p.kneeL = 8 + 55 * Math.max(0, cl); p.kneeR = 8 + 55 * Math.max(0, -cl); p.abd = 5;
    p.lean = 5; p.bob = 0.3 * cosd(2 * (ang - 90)); p.yaw = 7 * sind(ang); p.sway = 0.25 * cosd(ang - 90); p.head = -2;
    if (freeL) { p.shL = 12 - 0.9 * hl; p.elL = 28 + 20 * Math.max(0, cosd(ang + 180)); }
    if (freeR) { p.shR = 12 + 0.9 * hl; p.elR = 28 + 20 * Math.max(0, cl); }
    p.flap = cl; p.draw = 0.4;
  }
  const at = num(name, 'attack');
  if (at > 0) {
    const L = (a: number, b: number, c: number, d: number): void => { p.hipL = a; p.kneeL = b; p.hipR = c; p.kneeR = d; };
    const lunge = (): void => L(34, 34, -26, 4);
    p.abd = 11; p.sway = 0; p.bob = 0; p.breath = 0.5;
    const i = at - 1;
    p.lean = [-4, -9, 14, 12, 3][i]; p.yaw = [-10, -22, 20, 14, 0][i]; p.head = [0, -4, 4, 4, 0][i]; p.flap = [0.5, 1, -1, -0.5, 0][i];
    if (i === 0) L(14, 14, -12, 14); if (i === 1) L(10, 24, -20, 26); if (i === 2) lunge();
    if (i === 3) L(30, 28, -24, 8); if (i === 4) L(16, 12, -14, 10);
    if (wc === 'pole') { p.shR = [-5, -35, 100, 95, 40][i]; p.abR = [24, 28, 45, 50, 18][i]; p.elR = [100, 112, 10, 12, 60][i]; p.wpn = [30, 22, 22, 16, 50][i]; p.wy = [0, 0, 60, 65, 0][i]; }
    else if (wc === 'sword' || wc === 'heavy' || wc === 'none') {
      p.shR = [110, 160, 62, 30, 35][i]; p.abR = [22, 24, 10, 12, 16][i]; p.elR = [70, 50, 12, 14, 40][i]; p.wpn = [95, 130, -50, -80, -10][i];
      if (wc === 'none') { p.wpn = 0; p.shR = [60, 95, 80, 60, 30][i]; p.elR = [110, 120, 10, 30, 60][i]; }
      if (wc === 'heavy') p.wpn = [105, 150, -50, -85, -5][i];
    }
    else if (wc === 'bow') { p.draw = [0.6, 1, 0.1, 0, 0.25][i]; p.yaw = [0, 4, -4, 0, 0][i]; p.shot = [0, 0, 0.45, 1, -1][i]; }
    else if (wc === 'throw') { p.shR = [-40, -62, 120, 100, 35][i]; p.abR = [20, 22, 14, 16, 18][i]; p.elR = [30, 20, 8, 15, 60][i]; p.wpn = [24, 22, 28, 20, 60][i]; p.rel = [0, 0, 0, 14, -1][i]; p.shL = [70, 75, 55, 40, 25][i]; p.abL = [10, 10, 20, 22, 20][i]; }
    else if (wc === 'sling') { p.shR = [30, 150, 168, 100, 40][i]; p.abR = [14, 30, 34, 20, 16][i]; p.elR = [50, 55, 40, 12, 55][i]; p.whirl = [-1, 40, 210, 1000, -1][i]; p.rel = [0, 0, 0, 12, -1][i]; p.shL = [40, 55, 60, 70, 30][i]; }
    else if (wc === 'pipes') { p.head = [10, 16, 4, 0, 6][i]; p.lean = [-3, -6, 3, 0, 0][i]; p.bob = [0.3, 0.6, 0, 0, 0.2][i]; }
    if (freeL && wc !== 'none' && !shield) { p.shL = [30, 20, 55, 45, 25][i]; p.abL = [30, 34, 20, 22, 20][i]; }
  }
  if (name === 'hurt') { p.lean = -16; p.head = -18; p.abL = (p.abL || 0) + 22; p.abR = (p.abR || 0) + 22; p.kneeL = 20; p.kneeR = 22; p.hipL = 12; p.hipR = 8; p.spread = 0.6; p.yaw = -12; }
  if (name === 'death') { p.fall = 84; p.lean = -10; p.head = -25; p.shL = 140; p.abL = 40; p.elL = 20; p.shR = 150; p.abR = 45; p.elR = 15; p.hipL = 12; p.kneeL = 25; p.hipR = 4; p.kneeR = 8; p.wpn = 160; p.spread = 0.3; p.sway = 0; p.bob = 0; }
  return p;
}

// ---------------- humanoid ----------------
export type HumanoidP = {
  at?: number[]; facing?: number; height?: number; build?: string; pose?: string | Pose; skin?: string;
  head?: { type?: string; hair?: string; helmet?: string; helmetMat?: string; crest?: string; beard?: string; eyes?: string; hairStyle?: string };
  torso?: { armour?: string; colour?: string; trim?: string; skirtColour?: string };
  legs?: { greaves?: boolean | string; sandals?: boolean | string; lower?: string; colour?: string };
  arms?: { bracers?: boolean | string; colour?: string };
  weapon?: string; weaponMat?: string; shield?: string | { type?: string; colour?: string; emblem?: string; emblemColour?: string; rim?: string };
  stow?: string[]; fem?: boolean; skirt?: string; cape?: string; capeStyle?: string; wings?: { type?: string; colour?: string; span?: number }; upperOnly?: { z: number; f?: number }; rig?: Rig;
};
const BUILD: { [k: string]: number } = { slim: 0.85, average: 1, heavy: 1.2, giant: 1.35 };
// two-bone IK: shoulder s, target t, bone lengths a, b, elbow bends towards pole -> [elbow, hand]
function ik(s: V, t: V, a: number, b: number, pole: V): V[] {
  const d = sub(t, s); const L = len(d) || 1e-6; const Lc = clamp(L, Math.abs(a - b) + 0.05, a + b - 0.05); const u = mul(d, 1 / L);
  const x = (a * a - b * b + Lc * Lc) / (2 * Lc); const y = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = norm(sub(pole, mul(u, dot(pole, u))));
  return [add(s, add(mul(u, x), mul(pp, y))), add(s, mul(u, Lc))];
}
const tg = (t: LTex | undefined, gf: (p: V) => number): LTex => (p) => {
  const r = t ? t(p) : 0; const gv = gf(p);
  if (r !== null && typeof r === 'object') return [r[0], r[1] + gv];
  return (r || 0) + gv;
};
export function humanoidCore(k: Kit, P: HumanoidP = {}): { top: V } {
  const build = P.build || 'average'; const bw = BUILD[build] === undefined ? 1 : BUILD[build];
  const Ht = P.height || (build === 'giant' ? 30 : 22); const h = Ht / 22;  // h = scale factor relative to a 22-unit man
  const skin = mat(P.skin || 'skin'); const hd = P.head || {}; const htype = hd.type || 'human';
  const skeleton = htype === 'skull' || skin === 'bone';
  const weapon = P.weapon || 'none';
  const sh0 = typeof P.shield === 'string' ? { type: P.shield } : (P.shield || { type: 'none' });
  const shield = sh0.type || 'none'; const hasShield = shield !== 'none';
  const po: Pose = typeof P.pose === 'object' ? { ...pose('idle', weapon, hasShield), ...P.pose } : pose(P.pose || 'idle', weapon, hasShield);
  const g = (x: number | undefined): number => x || 0;
  const R = P.rig || new Rig(k);
  const torsoA = P.torso || {}; const armour = torsoA.armour || (skeleton ? 'none' : 'chiton');
  const legsA = P.legs || {}; const lower = legsA.lower || 'human';
  const heavy = build === 'giant' ? 1.45 : build === 'heavy' ? 1.2 : 1;   // muscle bulk
  const limbK = skeleton ? 0.5 : (armour === 'none' && build !== 'average' && build !== 'slim') ? 0.8 : 1; const bwl = bw * limbK;
  const up = P.upperOnly;
  const hipZ = up ? up.z : (lower === 'goat' || lower === 'bird' ? 10.6 : 11) * h;
  const fo = up ? (up.f || 0) : 0;
  const lean = g(po.lean) + (up ? 6 : 0); const yaw = g(po.yaw);
  const piv: V = [fo, 0, hipZ]; const swY = g(po.sway) * h, bobZ = g(po.bob) * h;
  const LD = (d: V): V => {   // pitch (lean) about l, then twist about z
    const c = cosd(lean), s = sind(lean); const x = d[0] * c + d[2] * s, z = -d[0] * s + d[2] * c; const cy = cosd(yaw), sy = sind(yaw);
    return [x * cy - d[1] * sy, x * sy + d[1] * cy, z];
  };
  const LP = (p: V): V => add(add(piv, LD(sub(p, piv))), [0, swY, bobZ]);
  const aF = LD([1, 0, 0]), aL = LD([0, 1, 0]), aZ = LD([0, 0, 1]);
  const U = (f: number, l: number, z: number): V => LP([fo + f * h, l * h, hipZ + z * h]);   // upper-body point (leaned, twisted, swayed)
  const hipsW = (f: number, l: number, z: number): V => [fo + f * h, l * h + swY * 0.4, hipZ + z * h];
  const tmat = mat(armour === 'none' ? skin : armour === 'feathers' ? (torsoA.colour || 'feather') : (torsoA.colour || (armour === 'muscle-cuirass' ? 'bronze' : armour === 'linothorax' ? 'linen' : armour === 'chiton' ? 'linen' : skin)));
  const trim = mat(torsoA.trim || (armour === 'linothorax' ? 'crimson' : armour === 'chiton' ? 'crimson' : 'leather'));
  const clothM = mat(torsoA.colour || 'linen');
  const anat = armour === 'none' && !skeleton;
  const oTorso = k.obj(), oHead = k.obj(), oArmL = k.obj(), oArmR = k.obj(), oLegL = k.obj(), oLegR = k.obj(), oW = k.obj(), oS = k.obj(), oCape = k.obj(), oSk = k.obj();

  // ---- torso
  const chestC = U(0, 0, 4.3), waistC = U(0, 0, 1.5);
  const brt = 1 + 0.045 * g(po.breath);
  const fem = !!P.fem;
  const chestR: V = [2.3 * h * bw * brt, 3.5 * h * bw * brt * (fem ? 0.9 : 1), 3.0 * h], waistR: V = [1.9 * h * bw * (fem ? 0.92 : 1), 2.6 * h * bw * (fem ? 0.8 : 1), 2.1 * h];
  const axes = [aF, aL, aZ];
  const mkA = (ob: number): AC => ({ R, h, bw, bwl, heavy, axes, aF, aL, aZ, U, skin, ob });
  const rel = (p: V, c: V): V => { const q = sub(p, c); return [dot(q, aF), dot(q, aL), dot(q, aZ)]; };
  const sgrad = (p: V): number => { const q = rel(p, chestC); const fz = q[2] / h; return fz > 2.0 ? 1 : fz < -2.6 ? -1 : 0; };
  if (skeleton) {
    const ribTex: LTex = (p) => { const q = rel(p, chestC); const band = Math.floor((q[2] / h + 3) / 0.85); return (band % 2 === 0 && Math.abs(q[1]) > 0.35 * h && q[0] > -0.8 * h) ? ['black', 0] : (band % 2 === 0 ? -1 : 0); };
    R.ell(chestC, [chestR[0] * 0.8, chestR[1] * 0.78, chestR[2] * 0.98], axes, 'bone', { obj: oTorso, tex: ribTex });
    R.cap(U(-0.9, 0, 1.0), U(-0.9, 0, 6.8), 0.5 * h, 0.5 * h, 'bone', { obj: oTorso, shift: -1 });          // spine
    R.ell(U(1.3, 0, 5.6), [0.35 * h, 0.35 * h, 1.7 * h], axes, 'bone', { obj: oTorso, shift: 1 });           // sternum
    R.ell(U(0, 0, 0.1), [1.5 * h, 2.5 * h, 1.1 * h], axes, 'bone', { obj: oTorso, shift: -1, tex: (p) => { const q = rel(p, waistC); return (q[0] > 0.8 * h && Math.abs(Math.abs(q[1]) - 0.9 * h) < 0.45 * h && q[2] > -0.2 * h) ? ['black', 0] : 0; } });   // pelvis
    R.ell(U(0, 3.0, 6.7), [0.9 * h, 1.7 * h, 0.5 * h], axes, 'bone', { obj: oTorso });                      // collar bones
    R.ell(U(0, -3.0, 6.7), [0.9 * h, 1.7 * h, 0.5 * h], axes, 'bone', { obj: oTorso });
  } else {
    let tex: LTex | undefined;
    if (armour === 'muscle-cuirass') tex = (p) => {
      const q = rel(p, chestC); const fz = q[2] / h, fl = Math.abs(q[1] / h);
      if (q[0] > 0.8 * h && fl < 0.16) return -2;
      if (q[0] > 0.8 * h && fz > 0.05 && fz < 0.45 && fl < 2.4) return -2;
      if (q[0] > 0.9 * h && fl < 1.9 && (Math.abs(fz + 1.15) < 0.14 || Math.abs(fz + 2.15) < 0.14)) return -2;
      if (fz > 2.55) return [trim, 0];
      if (fz < -2.7) return ['gold', 0];
      if (fl > 3.2 && fz > -2) return 1;     // side plate edge
      return 0;
    };
    if (armour === 'linothorax') tex = (p) => {
      const q = rel(p, chestC); const fz = q[2] / h, fl = q[1] / h;
      if (fz > 1.9 && Math.abs(Math.abs(fl) - 1.7) < 0.55) return [trim, 0];
      if (fz < -0.9 && fz > -2.5) return (Math.floor((fl + 9) / 0.8) + Math.floor((fz + 9) / 0.6)) % 2 === 0 ? ['bronze', -1] : ['bronze', 1];
      if (fz < -2.6) return [trim, -1];
      if (fz > 1.0 && fz < 1.15) return [trim, 0];
      return 0;
    };
    if (armour === 'chiton') tex = (p) => {
      const q = rel(p, chestC); const fz = q[2] / h; const fl = q[1] / h;
      if (fz < -2.7) return [trim, 0];
      if (fz > 2.3 && fz < 2.7 && Math.abs(fl) < 2.2) return [trim, 0];
      if (Math.floor((atan2d(q[1], q[0]) + 360) / 13) % 2 === 0 && fz > -2.7) return -1;      // pleats
      if (fz > 0.3 && fz < 0.55 && q[0] > 0.5 * h && Math.abs(fl) < 2.0) return -2;       // breast band
      return 0;
    };
    if (armour === 'feathers') tex = featherTex(h, chestC, axes);
    R.shape((X) => S.smooth(1.0 * h, S.ellipsoid(X.w(chestC), chestR, axes.map((a) => X.d(a))), S.ellipsoid(X.w(waistC), waistR, axes.map((a) => X.d(a)))), tmat, { obj: oTorso, tex: tg(tex, sgrad) });
    R.key(chestC, chestR[2]);
    if (anat) anatTorso(mkA(oTorso));
    if (armour === 'feathers') harpyParts(mkA(oTorso), tmat, hipsW);
    if (armour === 'muscle-cuirass') {   // plate edges: collar, shoulder guards, abdominal segments, side seam
      R.ring(U(0, 0, 6.65), aZ, 1.75 * h * bw, 0.38 * h, 'gold', { obj: oTorso });
      for (const s of [-1, 1]) R.ell(U(0, s * 3.45 * bw, 6.7), [1.7 * h, 1.45 * h, 0.95 * h], axes, tmat, { obj: oTorso, shift: 1, tex: (p) => { const q = rel(p, U(0, s * 3.45 * bw, 6.7)); return Math.abs(q[0]) > 1.35 * h ? ['gold', 0] : 0; } });
    }
    if (fem && !skeleton && armour !== 'none') for (const s of [-1, 1]) R.ell(U(1.45, s * 1.3 * bw, 4.9), [1.3 * h, 1.2 * h, 1.1 * h], axes, tmat, { obj: oTorso, shift: 1 });   // v6 shaped bust
    if (fem && (armour === 'muscle-cuirass' || armour === 'linothorax')) R.ring(U(0.2, 0, 1.9), aZ, 1.55 * h * bw, 0.3 * h, 'gold', { obj: oTorso });   // waist band
    if (armour === 'linothorax') for (const s of [-1, 1]) R.ell(U(0, s * 3.5 * bw, 6.6), [1.6 * h, 1.3 * h, 0.9 * h], axes, trim, { obj: oTorso, shift: 0 });
    // skirt: pteruges straps (armour) / pleated chiton / loincloth (none)
    if (!up) {
      const wr = waistR[0] * 1.0 + 0.2 * h; const spr = 0.72 + 0.28 * g(po.spread);
      const shortSk = P.skirt === 'chiton' && (armour === 'muscle-cuirass' || armour === 'linothorax');
      if ((armour === 'muscle-cuirass' || armour === 'linothorax') && !shortSk) {
        const lm = armour === 'linothorax' ? 'linen' : 'leather';
        const stripes = (zb: number): LTex => (p) => { const a = atan2d(p[1], p[0] - fo); const b = Math.floor((a + 360) / 15); return (p[2] < zb + 0.45 * h) ? ['gold', 0] : (b % 2 === 0 ? -1 : 0); };
        R.fold(hipsW(0, 0, 0.7), hipsW(0, 0, -2.1), wr, 3.1 * h * bw * spr + 0.3 * h, 12, 0.32 * h, lm, { obj: oSk, tex: stripes(hipZ - 2.1 * h) });
        R.fold(hipsW(0, 0, 0.5), hipsW(0, 0, -3.9), wr + 0.15 * h, 3.55 * h * bw * spr + 0.3 * h, 12, 0.3 * h, lm, { obj: oSk, shift: -1, tex: stripes(hipZ - 3.9 * h) });
      } else if (armour === 'chiton' && (P as any).robe) {   // v5 long robe: a pleated tube hanging from the waist to the ankles (hourglass, not a cone)
        const zb = hipZ - 10.3 * h; const rm = 3.0 * h * bw * spr + 0.3 * h, rh = 3.55 * h * bw * spr + 0.35 * h;
        const rt = (p: V): TexOut => (p[2] < zb + 0.7 * h ? [trim, 0] : (Math.floor((atan2d(p[1], p[0] - fo) + 360) / 18) % 2 === 0 ? -1 : 0));
        R.fold(hipsW(0, 0, 0.8), hipsW(0, 0, -5.2), wr, rm, 10, 0.42 * h, tmat, { obj: oSk, tex: rt });
        R.fold(hipsW(0, 0, -5.0), hipsW(0, 0, -10.3), rm - 0.1 * h, rh, 10, 0.55 * h, tmat, { obj: oSk, tex: rt });
        R.ring(hipsW(0, 0, 0.9), [0, 0, 1], wr + 0.05 * h, 0.3 * h, trim, { obj: oSk });   // girdle
      } else if (armour === 'chiton' || shortSk) {   // v6: short chiton skirt (also under a cuirass with skirt:'chiton')
        const zb = hipZ - 5.0 * h; const skm = shortSk && torsoA.skirtColour ? mat(torsoA.skirtColour) : tmat;
        R.fold(hipsW(0, 0, 0.8), hipsW(0, 0, -5.0), wr, 3.4 * h * bw * spr * (fem ? 1.12 : 1) + 0.35 * h, 9, (fem ? 0.62 : 0.5) * h, skm, { obj: oSk, tex: (p) => (p[2] < zb + 0.55 * h ? [trim, 0] : (Math.floor((atan2d(p[1], p[0] - fo) + 360) / 20) % 2 === 0 ? -1 : 0)) });
      } else if (lower === 'human') {   // loincloth: front and back drapes + belt
        const cm = clothM; const sw = 0.7 + 0.3 * g(po.spread);
        R.drape(hipsW(1.5, 0, 0.9), [0, 1, 0], [0.12, 0, -1], 1.7 * h * bw, 2.2 * h * bw * sw, 4.0 * h, 0.55 * h, 2, 0.28 * h, cm, { obj: oSk, tex: (p) => (p[2] < hipZ - 3.4 * h ? [trim, 0] : 0) });
        R.drape(hipsW(-1.5, 0, 0.9), [0, 1, 0], [-0.1, 0, -1], 1.7 * h * bw, 2.2 * h * bw * sw, 3.6 * h, 0.55 * h, 2, 0.28 * h, cm, { obj: oSk, shift: -1 });
        R.ell(hipsW(0, 0, 0.8), [2.1 * h * bw, 2.75 * h * bw, 0.55 * h], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'leather', { obj: oSk, shift: 0 });
        R.sph(hipsW(2.1 * bw, 0, 0.8), 0.45 * h, 'gold', { obj: oSk });
      }
    }
  }
  // ---- head
  const neckZ = 7.2; const hr = (build === 'giant' ? 2.05 : 1.85) * h * (htype === 'cyclops' ? 1.08 : 1); const Hc = U(0.15, 0, anat && build === 'giant' ? 9.3 : 8.85);
  const hz = g(po.head);
  const hF0 = norm(LD([cosd(-hz), 0, sind(-hz)])); const fA = P.facing === undefined ? 0 : P.facing;
  const yh0 = htype === 'cyclops' ? 45 + clamp((fA - 45) * 0.25, -10, 10) - fA : 0.35 * (45 - fA);
  const yh = P.rig ? 0 : clamp(yh0, htype === 'cyclops' ? -75 : -25, htype === 'cyclops' ? 75 : 25);   // heads turn towards the camera; the cyclops eye must face it
  const hF = norm(add(mul(hF0, cosd(yh)), mul(aL, sind(yh)))); const hL = norm(add(mul(aL, cosd(yh)), mul(hF0, -sind(yh)))); const hZ = norm(cross(hF, hL));
  const hrel = (p: V): V => { const q = sub(p, Hc); return [dot(q, hF) / hr, dot(q, hL) / hr, dot(q, hZ) / hr]; };
  R.cap(U(0, 0, neckZ - 0.8), add(Hc, mul(hZ, -0.6 * hr)), 0.7 * h * (skeleton ? 0.5 : 1) * (heavy > 1.1 ? 1.25 : 1), 0.6 * h * (skeleton ? 0.5 : 1), skeleton ? 'bone' : skin, { obj: oHead, shift: -1 });
  const hax = [hF, hL, hZ];
  const eyesM = mat(hd.eyes || (htype === 'gorgon' ? 'gold' : 'black'));
  const faceTex = (eyeW: number, extra?: LTex): LTex => (p) => {
    const q = hrel(p); if (extra) { const e = extra(p); if (e !== 0 && e !== null) return e; }
    if (q[0] > 0.5 && Math.abs(q[2] - 0.1) < 0.15 && Math.abs(Math.abs(q[1]) - 0.36) < eyeW) return [eyesM, 0];
    if (q[0] > 0.5 && Math.abs(q[2] - 0.32) < 0.07 && Math.abs(Math.abs(q[1]) - 0.38) < 0.2) return -2;     // brows
    if (q[0] > 0.7 && Math.abs(q[2] + 0.45) < 0.06 && Math.abs(q[1]) < 0.22) return -2;              // mouth
    if (q[0] > 0.6 && q[2] < -0.2 && Math.abs(q[2] + 0.6) < 0.1) return -1;                         // chin shade
    return 0;
  };
  const hair = hd.hair === undefined ? 'fur_dark' : hd.hair; const helmet = hd.helmet || 'none';
  const hm = mat(hd.helmetMat || 'bronze'); const crest = hd.crest === undefined ? (helmet !== 'none' ? 'crimson' : 'none') : hd.crest;
  const cp = (f: number, z: number): V => add(add(Hc, mul(hF, f * hr)), mul(hZ, z * hr));
  const isGorgon = htype === 'gorgon', isCyc = htype === 'cyclops', isGoat = htype === 'goat';
  if (htype === 'skull') {
    const skTex: LTex = (p) => {
      const q = hrel(p);
      if (q[0] > 0.45 && Math.abs(q[2] - 0.0) < 0.27 && Math.abs(Math.abs(q[1]) - 0.38) < 0.22) return ['black', 0];      // eye sockets
      if (q[0] > 0.75 && q[2] < -0.05 && q[2] > -0.38 && Math.abs(q[1]) < 0.1 + (-q[2] - 0.05) * 0.2) return ['black', 0];  // nose hole
      if (q[2] > 0.55) return 1;
      return 0;
    };
    R.ell(add(Hc, mul(hZ, 0.08 * hr)), [hr * 1.0, hr * 0.88, hr * 1.04], hax, 'bone', { obj: oHead, tex: skTex });
    for (const s of [-1, 1]) R.sph(add(cp(0.6, -0.3), mul(hL, s * 0.62 * hr)), 0.3 * hr, 'bone', { obj: oHead, shift: 0 });      // cheekbones
    R.ell(add(cp(0.4, -0.78), mul(hL, 0)), [0.58 * hr, 0.6 * hr, 0.3 * hr], hax, 'bone', { obj: oHead, shift: -1, tex: (p) => { const q = hrel(p); return (q[0] > 0.5 && q[2] > -0.9 && q[2] < -0.55 && Math.floor((q[1] + 3) / 0.17) % 2 === 0) ? -2 : 0; } });  // jaw + teeth
  } else if (htype === 'bull') {
    const fur = mat(hair === 'none' ? 'fur' : hair || 'fur');
    R.ell(add(Hc, mul(hZ, 0.2 * hr)), [hr * 1.05, hr * 1.0, hr * 1.05], hax, fur, { obj: oHead, tex: faceTex(0.12, (p) => { const q = hrel(p); return (q[0] > 0.3 && q[2] > 0.0 && q[2] < 0.3 && Math.abs(Math.abs(q[1]) - 0.55) < 0.14) ? ['crimson', 4] : 0; }) });
    const snC = add(Hc, add(mul(hF, 0.95 * hr), mul(hZ, -0.45 * hr)));
    R.ell(snC, [0.75 * hr, 0.78 * hr, 0.58 * hr], hax, 'skin_pale', { obj: oHead, shift: -1, tex: (p) => { const q = hrel(p); return (q[0] > 1.5 && Math.abs(Math.abs(q[1]) - 0.3) < 0.13 && Math.abs(q[2] + 0.45) < 0.15) ? ['black', 0] : 0; } });
    R.ell(add(Hc, add(mul(hF, 0.3 * hr), mul(hZ, 1.0 * hr))), [0.5 * hr, 0.9 * hr, 0.35 * hr], hax, fur, { obj: oHead, shift: -1 });   // forelock
    for (const s of [-1, 1]) {
      const b0 = add(Hc, add(mul(hL, s * 0.75 * hr), mul(hZ, 0.75 * hr))); const b1 = add(b0, add(mul(hL, s * 1.0 * hr), mul(hZ, 0.25 * hr)));
      const b2 = add(b1, add(mul(hL, s * 0.4 * hr), add(mul(hZ, 0.9 * hr), mul(hF, 0.3 * hr))));
      R.tube([b0, b1, b2], [0.34 * hr, 0.26 * hr, 0.07 * hr], 'bone', { obj: oHead });
      R.ell(add(Hc, add(mul(hL, s * 1.05 * hr), mul(hZ, 0.25 * hr))), [0.2 * hr, 0.45 * hr, 0.18 * hr], hax, fur, { obj: oHead });
    }
  } else {
    const cycTex: LTex = (p) => {
      const q = hrel(p); const dd = Math.sqrt(q[1] * q[1] + (q[2] - 0.12) * (q[2] - 0.12));
      if (q[0] > 0.5 && dd < 0.11) return ['black', 0]; if (q[0] > 0.5 && dd < 0.27) return ['gold', 0]; if (q[0] > 0.5 && dd < 0.42) return ['marble', 3]; if (q[0] > 0.5 && dd < 0.5) return ['crimson', 0];
      if (q[0] > 0.7 && Math.abs(q[2] + 0.5) < 0.1 && Math.abs(q[1]) < 0.4) return -3;
      return 0;
    };
    R.ell(Hc, [hr * 0.95, hr * 0.88, hr * 1.02], hax, skin, { obj: oHead, tex: isCyc ? cycTex : faceTex(0.11) });
    R.ell(add(Hc, add(mul(hF, 0.92 * hr), mul(hZ, -0.1 * hr))), [0.26 * hr, 0.2 * hr, 0.32 * hr], hax, skin, { obj: oHead });   // nose
    for (const s of [-1, 1]) R.ell(add(Hc, add(mul(hL, s * 0.93 * hr), mul(hF, -0.1 * hr))), [0.14 * hr, 0.14 * hr, 0.35 * hr], hax, skin, { obj: oHead, shift: -1 });   // ears
    if (isCyc) {   // a real eyeball that bulges out of the socket
      R.ell(cp(0.88, 0.1), [0.3 * hr, 0.46 * hr, 0.4 * hr], hax, 'marble', { obj: oHead, shift: 1, tex: (p) => { const q = hrel(p); const dd = Math.sqrt(q[1] * q[1] + (q[2] - 0.1) * (q[2] - 0.1)); if (q[0] < 0.9) return 0; if (dd < 0.15) return ['black', 0]; if (dd < 0.31) return ['aegean', 0]; return 0; } });
      R.ell(cp(0.8, 0.42), [0.34 * hr, 0.62 * hr, 0.14 * hr], hax, skin, { obj: oHead, shift: -2 });   // lid shadow
    }
    if (isCyc) {   // heavy brow ridge over the single eye, jutting jaw, broken nose
      R.ell(add(Hc, add(mul(hF, 0.62 * hr), mul(hZ, 0.4 * hr))), [0.5 * hr, 1.0 * hr, 0.22 * hr], hax, skin, { obj: oHead, shift: -1 });
      R.ell(add(Hc, add(mul(hF, 0.4 * hr), mul(hZ, -0.7 * hr))), [0.75 * hr, 0.8 * hr, 0.45 * hr], hax, skin, { obj: oHead, shift: -1 });
      for (const s of [-1, 1]) R.cap(add(cp(0.8, -0.62), mul(hL, s * 0.38 * hr)), add(cp(0.9, -0.1), mul(hL, s * 0.4 * hr)), 0.1 * hr, 0.04 * hr, 'bone', { obj: oHead });  // tusks
    }
    if (helmet === 'none' && hair !== 'none' && !isGorgon) {
      R.shape((X) => S.inter(S.sphere(X.w(add(Hc, add(mul(hF, -0.1 * hr), mul(hZ, 0.08 * hr)))), hr * 1.08), S.half(X.w(add(Hc, add(mul(hF, 0.25 * hr), mul(hZ, 0.25 * hr)))), X.d(norm(add(mul(hF, 0.8), mul(hZ, -0.6)))))), mat(hair), { obj: oHead, tex: (p) => { const q = hrel(p); return Math.floor((q[1] + 3) / 0.22) % 2 === 0 ? -1 : (q[2] > 0.8 ? 1 : 0); } });
    }
    const hst = hd.hairStyle; const hmt = mat(hair === 'none' ? 'fur_dark' : hair);
    if (hst && hst !== 'short' && hair !== 'none' && !isGorgon && !skeleton) {   // v6 hair styles: 'ponytail' | 'long' | 'bun'
      const hq = (f: number, z: number, l = 0): V => add(add(add(Hc, mul(hF, f * hr)), mul(hZ, z * hr)), mul(hL, l * hr));
      const sw2 = g(po.flap) * 0.5 + 0.4;
      if (hst === 'ponytail') {
        R.tube([hq(-0.8, 0.45), hq(-1.55, 0.3, 0.2), hq(-2.0, -0.7, 0.5 + 0.5 * sw2), hq(-1.9, -2.0, 0.9 + 0.8 * sw2), hq(-1.6, -3.1, 0.9 + 0.9 * sw2)], [0.5 * hr, 0.55 * hr, 0.5 * hr, 0.38 * hr, 0.12 * hr], hmt, { obj: oHead, shift: 0, tex: (q) => (Math.floor(q[2] / hr * 3) % 2 === 0 ? -1 : 0) });
        R.cap(hq(-0.95, 0.35, -0.3), hq(-0.95, 0.35, 0.3), 0.3 * hr, 0.3 * hr, 'gold', { obj: oHead, shift: 1 });
      } else if (hst === 'long') {
        R.ell(hq(-0.7, -0.9), [0.55 * hr, 1.0 * hr, 1.7 * hr], hax, hmt, { obj: oHead, shift: -1 });
        for (const sd of [-1, 1]) R.cap(hq(0.0, 0.2, sd * 0.98), hq(-0.4, -2.3, sd * 1.05), 0.34 * hr, 0.3 * hr, hmt, { obj: oHead, shift: sd > 0 ? 0 : -1 });
      } else if (hst === 'bun') {
        R.sph(hq(-0.85, 0.75), 0.6 * hr, hmt, { obj: oHead, shift: 1 });
      }
    }
    const beard = hd.beard || (isGoat || isCyc ? (hair === 'none' ? 'fur_dark' : hair) : '');
    if (beard && beard !== 'none') R.ell(add(Hc, add(mul(hF, 0.7 * hr), mul(hZ, -0.8 * hr))), [0.45 * hr, 0.6 * hr, 0.6 * hr], hax, mat(beard), { obj: oHead, shift: -1, tex: (p) => { const q = hrel(p); return Math.floor((q[1] + 3) / 0.2) % 2 === 0 ? -1 : 0; } });
    if (isGoat) for (const s of [-1, 1]) {
      const b0 = add(Hc, add(mul(hL, s * 0.45 * hr), mul(hZ, 0.85 * hr))); const b1 = add(b0, add(mul(hF, -0.55 * hr), mul(hZ, 0.55 * hr)));
      const b2 = add(b1, add(mul(hF, -0.45 * hr), add(mul(hZ, -0.25 * hr), mul(hL, s * 0.2 * hr))));
      R.tube([b0, b1, b2], [0.26 * hr, 0.2 * hr, 0.05 * hr], 'bone', { obj: oHead, shift: -1 });
      R.cap(add(Hc, mul(hL, s * 0.85 * hr)), add(Hc, add(mul(hL, s * 1.5 * hr), add(mul(hZ, 0.2 * hr), mul(hF, -0.2 * hr)))), 0.2 * hr, 0.06 * hr, skin, { obj: oHead });
    }
    if (isGorgon) {   // snake hair: curved tapered tubes with heads
      for (let i = 0; i < 12; i++) {
        const a = i * 30 + 10; const el = 15 + (i % 4) * 20; const dir = norm(add(add(mul(hF, cosd(a) * cosd(el) * 0.8), mul(hL, sind(a) * cosd(el))), mul(hZ, sind(el))));
        if (dot(dir, hF) > 0.5) continue;
        const sg = (i % 2) * 2 - 1; const up2 = mul(hZ, 1.0); const sdw = norm(cross(dir, hZ));
        const b0 = add(Hc, mul(dir, 0.8 * hr)); const b1 = add(b0, add(mul(dir, 0.7 * hr), add(mul(up2, 0.45 * hr), mul(sdw, sg * 0.3 * hr))));
        const b2 = add(b1, add(mul(dir, 0.5 * hr), add(mul(up2, 0.55 * hr), mul(sdw, -sg * 0.35 * hr))));
        const b3 = add(b2, add(mul(dir, 0.25 * hr), add(mul(up2, 0.3 * hr), add(mul(sdw, sg * 0.3 * hr), mul(hF, 0.35 * hr)))));
        R.tube([b0, b1, b2, b3], [0.26 * hr, 0.22 * hr, 0.17 * hr, 0.12 * hr], 'snake', { obj: oHead, shift: i % 2, tex: (p) => (Math.floor((dot(sub(p, b0), up2) / hr + 5) * 3.5) % 2 === 0 ? -1 : 0) });
        R.ell(add(b3, mul(hF, 0.12 * hr)), [0.3 * hr, 0.2 * hr, 0.16 * hr], hax, 'snake', { obj: oHead, shift: 1, tex: (p) => { const q = sub(p, b3); return (dot(q, hF) > 0.2 * hr && Math.abs(dot(q, hL)) > 0.1 * hr) ? ['gold', 0] : 0; } });
      }
    }
  }
  if (helmet === 'corinthian' || helmet === 'attic') {
    const sk = htype === 'skull';
    const Rh = hr * (sk ? 1.1 : 1.2); const hc = add(Hc, add(mul(hZ, (sk ? 0.42 : 0.1) * hr), mul(hF, (sk ? -0.2 : 0) * hr)));
    const helTex: LTex = (p) => {
      const q = hrel(p);
      if (q[2] > 0.88 && Math.abs(q[1]) < 0.12) return 1;       // dome ridge highlight
      if (q[0] < 0.4 || helmet !== 'corinthian' || sk) return 0;
      if (Math.abs(q[2] - 0.05) < 0.17 && Math.abs(q[1]) > 0.14 && Math.abs(q[1]) < 0.78) return ['black', 0];                   // eye slits
      if (q[2] < 0.0 && Math.abs(q[1]) < 0.14 && q[2] > -1.0) return ['black', 0];                                                 // nasal opening
      if (q[2] < -0.5 && Math.abs(q[1]) > 0.5) return -1;
      return 0;
    };
    if (helmet === 'corinthian' && !sk) {
      R.ell(hc, [Rh, Rh * 0.97, Rh * 1.08], hax, hm, { obj: oHead, tex: helTex });
      R.ell(add(cp(0.5, 0.42), [0, 0, 0]), [0.7 * hr, 1.05 * hr, 0.16 * hr], hax, hm, { obj: oHead, shift: 1 });                  // brow ridge
      R.cap(cp(1.0, 0.25), cp(1.02, -0.62), 0.13 * hr, 0.1 * hr, hm, { obj: oHead, shift: 1 });                                      // nasal guard
      for (const s of [-1, 1]) R.ell(add(cp(0.55, -0.5), mul(hL, s * 0.7 * hr)), [0.45 * hr, 0.22 * hr, 0.55 * hr], hax, hm, { obj: oHead, shift: -1 });   // cheek guards
    } else if (helmet === 'attic' && !sk) {
      R.shape((X) => S.sub(S.ellipsoid(X.w(hc), [Rh, Rh * 0.97, Rh * 1.02], hax.map((a) => X.d(a))), S.ellipsoid(X.w(add(hc, add(mul(hF, 1.0 * hr), mul(hZ, -0.35 * hr)))), [0.55 * hr, 0.55 * hr, 0.6 * hr], hax.map((a) => X.d(a)))), hm, { obj: oHead, tex: helTex });
      for (const s of [-1, 1]) R.ell(add(cp(0.25, -0.45), mul(hL, s * 0.95 * hr)), [0.55 * hr, 0.16 * hr, 0.6 * hr], hax, hm, { obj: oHead, shift: -1 });       // cheek flaps
      R.ell(cp(-0.3, -0.05), [1.0 * hr, 1.15 * hr, 0.25 * hr], hax, hm, { obj: oHead, shift: 1 });                                       // neck guard rim
    } else {   // skull under a helmet: only the cranium is covered
      R.shape((X) => S.inter(S.ellipsoid(X.w(hc), [Rh, Rh * 0.98, Rh * 1.05], hax.map((a) => X.d(a))), S.half(X.w(add(Hc, mul(hZ, 0.32 * hr))), X.d(mul(hZ, -1)))), hm, { obj: oHead, tex: helTex });
      R.ell(cp(0.7, 0.52), [0.5 * hr, 0.95 * hr, 0.14 * hr], hax, hm, { obj: oHead, shift: 1 });
      R.cap(cp(1.0, 0.45), cp(1.0, -0.1), 0.1 * hr, 0.1 * hr, hm, { obj: oHead });                                                        // nasal bar
    }
    if (crest !== 'none') {
      const cb = add(Hc, mul(hZ, 0.1 * hr)); const cq = (f: number, z: number): V => add(add(cb, mul(hF, f * hr)), mul(hZ, (z + (sk ? 0.35 : 0)) * hr));
      R.cap(cq(0.55, 1.02), cq(-1.2, 0.8), 0.12 * hr, 0.12 * hr, hm, { obj: oHead });
      R.plate([cq(0.6, 1.0), cq(0.3, 1.55), cq(-0.3, 1.95), cq(-0.95, 1.8), cq(-1.45, 1.25), cq(-1.65, 0.45), cq(-1.25, 0.8), cq(-0.7, 1.0), cq(0, 1.05)], 0.65 * hr, mat(crest), { obj: oHead, tex: (p) => { const q = hrel(p); return Math.floor((q[0] + 6) / 0.28) % 2 === 0 ? -2 : 0; } });
      R.key(cq(-0.3, 2.0), 0.3);
    }
  }
  R.key(add(Hc, mul(hZ, hr)), 0.3);
  // ---- cape: short mantle, or 'big' = wide back panel plus side panels that flare out so the drape reads from the camera
  if (P.cape && P.cape !== 'none' && !skeleton) {
    const fl = g(po.flap); const cm = mat(P.cape); const big = P.capeStyle === 'big'; const Hh = (up ? 3.4 : big ? 15.5 : 7.2) * h;
    const hem = (c0: V, H0: number): LTex => (p) => { const d = sub(p, c0); const dz = -dot(d, aZ); return dz > H0 * 0.92 ? ['gold', 0] : 0; };
    const bc = U(-1.9, 0, 6.9);
    R.drape(bc, aL, LD([(big ? -0.34 : -0.16) - 0.14 * fl, 0, -1]), (big ? 4.4 : 3.0) * h * bw, (big ? 9.2 : 4.5) * h * bw, Hh, (big ? 1.0 : 0.8) * h, 3, (big ? 0.9 : 0.55) * h, cm, { obj: oCape, tex: hem(bc, Hh) });
    if (big && !up) for (const s of [-1, 1]) {
      const sc = U(-0.4, s * 3.7 * bw, 6.8); const Hs = 11.5 * h;
      R.drape(sc, aF, LD([-0.22 - 0.1 * fl, s * 0.62, -1]), 2.6 * h, 4.6 * h, Hs, 0.8 * h, 3, 0.7 * h, cm, { obj: oCape, shift: s > 0 ? 0 : -1, tex: hem(sc, Hs) });
    }
    for (const s of [-1, 1]) R.sph(U(0.5, s * 2.7 * bw, 6.8), 0.55 * h, 'gold', { obj: oCape, shift: 1 });
  }
  // ---- wings
  if (P.wings) {
    const wt = P.wings.type || 'feather'; const wm = mat(P.wings.colour || (wt === 'bat' ? 'leather' : 'feather')); const span = (P.wings.span || 12) * h;
    const fl = g(po.flap);
    for (const s of [-1, 1]) {
      const root = U(-1.6, s * 1.0, 5.8); const o = norm(add(mul(aF, -0.12), mul(aL, s))); const zz = norm(add(aZ, mul(aF, -0.55)));
      const lift = 0.75 + 0.25 * fl;
      const W2 = (a: number, b: number): V => add(root, add(mul(o, a * span), mul(zz, b * span)));
      const pts = wt === 'bat' ? [W2(0, 0), W2(0.35, 0.45 * lift), W2(1, 0.55 * lift), W2(0.8, 0.1), W2(0.6, -0.05 * lift), W2(0.45, -0.25), W2(0.25, -0.15), W2(0.1, -0.35)]
        : [W2(0, 0.05), W2(0.3, 0.5 * lift), W2(0.65, 0.75 * lift), W2(1, 0.8 * lift), W2(0.92, 0.45 * lift), W2(0.78, 0.2 * lift), W2(0.62, 0.0), W2(0.46, -0.2), W2(0.3, -0.35), W2(0.15, -0.4), W2(0.05, -0.25)];
      R.plate(pts, 0.5 * h, wm, { obj: k.obj(), tex: (p) => { const q = sub(p, root); const a = dot(q, o) / span; const b = dot(q, zz) / span; if (wt === 'bat') return Math.abs(b - (0.5 - a * 0.1)) < 0.03 ? -2 : 0; return (Math.floor(a * 9) % 2 === 0 ? 0 : -1) + (b > 0.35 ? 1 : 0); } });
    }
  }
  // ---- arms: muscled limbs with deltoid, bicep and forearm swell; IK for bow and pipes
  const armM = skeleton ? 'bone' : skin; const brac = P.arms && P.arms.bracers ? mat(P.arms.bracers === true ? 'bronze' : String(P.arms.bracers)) : '';
  const wcl = wclass(weapon);
  const bowG = U(6.0, 1.0, 7.0), drawN = g(po.draw);
  const pipeM = add(Hc, add(mul(hF, 1.5 * hr), mul(hZ, -0.75 * hr)));
  const hands: V[] = []; const elbows: V[] = [];
  for (const s of [1, -1]) {   // +1 = left (towards viewer side), -1 = right
    const L = s > 0; const shp = g(L ? po.shL : po.shR), ab = g(L ? po.abL : po.abR), el = g(L ? po.elL : po.elR);
    const S0 = U(0, s * 3.3 * bw, 6.2); const l1 = 3.7 * h, l2 = 3.3 * h;
    let E: V, Hn: V;
    if (wcl === 'bow' || wcl === 'pipes') {
      const tgt = wcl === 'bow' ? (L ? bowG : U(6.0 - 1.45 - 4.2 * drawN, 0.9, 7.0))
        : add(pipeM, add(mul(hL, s * 2.7 * h), add(mul(hZ, -0.9 * h), mul(hF, -0.3 * h))));
      const pole = wcl === 'bow' ? (L ? add(mul(aL, 0.6), mul(aZ, -0.8)) : add(add(mul(aF, -0.7), mul(aL, -0.6)), mul(aZ, 0.25))) : add(mul(aL, s * 0.8), mul(aZ, -0.7));
      const r = ik(S0, tgt, l1, l2, pole); E = r[0]; Hn = r[1];
    } else {
      const d0: V = [cosd(ab) * sind(shp), s * sind(ab), -cosd(ab) * cosd(shp)];
      const ePitch = shp + el; const d1: V = [cosd(ab * 0.5) * sind(ePitch), s * sind(ab * 0.5), -cosd(ab * 0.5) * cosd(ePitch)];
      E = add(S0, mul(LD(d0), l1)); Hn = add(E, mul(LD(d1), l2));
    }
    const ob = L ? oArmL : oArmR;
    if ((armour === 'muscle-cuirass' || armour === 'linothorax') && !skeleton) R.sph(S0, 1.15 * h * bw, armour === 'muscle-cuirass' ? tmat : trim, { obj: ob });
    else if (!skeleton && !anat) R.sph(S0, 1.2 * h * bw * Math.sqrt(heavy), armM, { obj: ob });                       // deltoid
    const gr1: LTex = (p) => { const d = sub(p, S0); const t = dot(d, sub(E, S0)) / (l1 * l1); return t > 0.2 && t < 0.6 && dot(d, aZ) > 0.2 * h ? 1 : 0; };
    R.limb(S0, E, 0.95 * h * bwl, 0.72 * h * bwl, 0.3 * h * bwl * heavy, 0.38, armM, { obj: ob, tex: skeleton ? undefined : gr1 });
    if (skeleton) R.sph(E, 0.55 * h, 'bone', { obj: ob });
    R.limb(E, Hn, 0.78 * h * bwl, 0.55 * h * bwl, 0.22 * h * bwl * heavy, 0.22, brac || armM, { obj: ob, tex: brac ? (p) => (Math.floor(dot(sub(p, E), sub(Hn, E)) / (0.25 * h * l2)) % 2 === 0 ? 1 : 0) : undefined });
    if (anat) anatArm(mkA(ob), S0, E, Hn, armM);
    R.sph(Hn, 0.74 * h * bwl * (build === 'giant' ? 1.25 : 1), armM, { obj: ob, shift: -1 });
    if (!skeleton) R.ell(add(Hn, mul(sub(Hn, E), 0.12)), [0.55 * h, 0.5 * h, 0.4 * h], axes, armM, { obj: ob, shift: 1 });
    hands.push(Hn); elbows.push(E);
  }
  const [HL, HR0] = hands;
  // ---- hand-held props, scaled to read at 128 px
  const wyaw = g(po.wy); const wd = LD([cosd(g(po.wpn)) * cosd(wyaw), -cosd(g(po.wpn)) * sind(wyaw), sind(g(po.wpn))]); const wl = aL; const wperp = norm(cross(wl, wd));
  const wm = P.weaponMat ? mat(P.weaponMat) : '';
  const HR: V = (g(po.rel) > 0 && wcl === 'throw') ? add(HR0, mul(wd, g(po.rel) * h)) : HR0;
  const weaponD = (g(po.rel) < 0 && wcl === 'throw') ? 'none' : weapon;
  const camA = 45 - (P.facing === undefined ? -35 : P.facing); const wcam: V = norm(add(mul(aF, -sind(camA)), mul(aL, cosd(camA))));
  const wpc: V = norm(sub(wcam, mul(wd, dot(wcam, wd))));   // blade width axis, turned to face the camera so blades never go edge-on
  const ptsC = (b: V, list: number[][]): V[] => list.map((q) => add(b, add(mul(wd, q[0] * h), mul(wpc, q[1] * h))));
  const along = (b: V, t: number): V => add(b, mul(wd, t * h));
  const pts2 = (b: V, list: number[][]): V[] => list.map((q) => add(b, add(mul(wd, q[0] * h), mul(wperp, q[1] * h))));
  if (weaponD === 'spear' || weaponD === 'trident' || weaponD === 'staff' || weaponD === 'torch' || weaponD === 'javelin' || weaponD === 'throwspear') {
    const jv = weaponD === 'javelin'; const L0 = weaponD === 'torch' ? -1.5 : jv ? -6 : -7, L1 = weaponD === 'torch' ? 5 : weaponD === 'staff' ? 14 : jv ? 12 : 15;
    R.cap(along(HR, L0), along(HR, L1), 0.4 * h, 0.36 * h, 'wood', { obj: oW, tex: (p) => (Math.floor(dot(sub(p, HR), wd) / h / 2.2) % 2 === 0 ? 0 : -1) });
    R.ring(along(HR, 0.9), wd, 0.45 * h, 0.12 * h, 'leather', { obj: oW });
    if (weaponD === 'spear' || jv || weaponD === 'throwspear') {
      R.plate(ptsC(along(HR, L1 - 0.6), [[0, 0.7], [1.4, 1.5], [3.4, 1.75], [5.8, 1.15], [8.6, 0], [5.8, -1.15], [3.4, -1.75], [1.4, -1.5], [0, -0.7]]), 0.8 * h, wm || 'bronze', { obj: oW, tex: (p) => { const cw = Math.abs(dot(sub(p, HR), wpc)); return cw < 0.28 * h ? 2 : (cw > 1.25 * h ? 1 : 0); } });
      R.cap(along(HR, L1 - 1.2), along(HR, L1 + 0.6), 0.5 * h, 0.5 * h, wm || 'bronze', { obj: oW });
      R.cap(along(HR, L0), along(HR, L0 - 1.8), 0.46 * h, 0.1 * h, wm || 'bronze', { obj: oW });
    }
    if (weaponD === 'trident') {
      const b = along(HR, L1); R.cap(add(b, mul(wperp, -2.2 * h)), add(b, mul(wperp, 2.2 * h)), 0.4 * h, 0.4 * h, wm || 'bronze', { obj: oW });
      for (const q of [-2.1, 0, 2.1]) R.cap(add(b, mul(wperp, q * h)), add(along(b, q === 0 ? 5.0 : 4.0), mul(wperp, q * 1.05 * h)), 0.36 * h, 0.1 * h, wm || 'bronze', { obj: oW });
      for (const q of [-2.1, 2.1]) R.cap(add(along(b, 4.0), mul(wperp, q * 1.05 * h)), add(along(b, 5.0), mul(wperp, q * 1.1 * h)), 0.12 * h, 0.04 * h, wm || 'bronze', { obj: oW });
    }
    if (weaponD === 'torch') R.ell(along(HR, L1 + 2.0), [1.5 * h, 1.5 * h, 2.8 * h], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'fire', { obj: oW, glow: true });
    if (weaponD === 'staff') R.sph(along(HR, L1), 0.95 * h, wm || 'gold', { obj: oW });
  } else if (weaponD === 'xiphos' || weaponD === 'kopis' || weaponD === 'sword') {
    R.cap(add(HR, mul(wpc, -1.7 * h)), add(HR, mul(wpc, 1.7 * h)), 0.45 * h, 0.45 * h, 'gold', { obj: oW });            // crossguard
    R.cap(along(HR, -1.6), along(HR, 0.4), 0.38 * h, 0.38 * h, 'leather', { obj: oW });                                    // grip
    R.sph(along(HR, -1.8), 0.6 * h, 'gold', { obj: oW });                                                                 // pommel
    const blade = weaponD !== 'kopis' ? [[0.4, 0.75], [4.0, 1.2], [8.0, 0.85], [12.0, 0], [8.0, -0.85], [4.0, -1.2], [0.4, -0.75]] : [[0.4, 0.45], [3.0, 0.5], [6.5, 1.4], [8.4, 0.5], [7.0, -0.3], [3.0, -0.25], [0.4, -0.45]];
    R.plate(ptsC(HR, blade), 0.55 * h, wm || 'iron', { obj: oW, tex: (p) => { const cw = Math.abs(dot(sub(p, HR), wpc)); return cw < 0.25 * h ? -2 : (cw > 0.8 * h ? 2 : 1); } });
  } else if (weaponD === 'club') {
    R.cap(along(HR, -2.0), along(HR, 10.5), 0.55 * h, 1.55 * h * (build === 'giant' ? 1.15 : 1), wm || 'wood', { obj: oW, tex: (p) => (hash(p[0] * 0.7, p[1] * 0.7, p[2] * 0.7) > 0.8 ? -2 : (Math.floor(dot(sub(p, HR), wd) / h / 2.5) % 2 === 0 ? 0 : -1)) });
    for (const q of [[5.0, 1.2], [7.0, -1.3], [8.8, 1.3], [9.6, -0.8], [6.5, 0.2]]) R.sph(add(along(HR, q[0]), mul(wperp, q[1] * h)), 0.6 * h, wm || 'wood', { obj: oW, shift: -1 });
    R.ring(along(HR, 0.8), wd, 0.62 * h, 0.14 * h, 'leather', { obj: oW });
  } else if (weaponD === 'labrys') {
    R.cap(along(HR, -4), along(HR, 12), 0.4 * h, 0.4 * h, 'wood', { obj: oW, tex: (p) => (Math.floor(dot(sub(p, HR), wd) / h / 2.2) % 2 === 0 ? 0 : -1) });
    const b = along(HR, 11);
    for (const sd of [-1, 1]) R.plate(pts2(b, [[-0.9, sd * 0.4], [-2.4, sd * 4.4], [0.0, sd * 3.6], [2.4, sd * 4.4], [0.9, sd * 0.4]]), 0.55 * h, wm || 'bronze', { obj: oW, tex: (p) => { const q = sub(p, b); return Math.abs(dot(q, wperp)) > 3.6 * h ? 2 : (Math.abs(dot(q, wperp)) > 3.0 * h ? 1 : 0); } });
    R.cap(along(HR, 10.2), along(HR, 12.2), 0.58 * h, 0.58 * h, 'gold', { obj: oW });
    R.cap(along(HR, 12.0), along(HR, 13.4), 0.3 * h, 0.08 * h, 'bronze', { obj: oW });
  } else if (weaponD === 'axe') {   // v6 single-bit axe: long haft, wide bearded bronze head with a bright edge, back spike
    R.cap(along(HR, -3.2), along(HR, 11.2), 0.5 * h, 0.46 * h, 'wood', { obj: oW, tex: (p) => (Math.floor(dot(sub(p, HR), wd) / h / 2.4) % 2 === 0 ? 0 : -1) });
    const b = along(HR, 9.2);
    R.plate(ptsC(b, [[-1.9, 0.3], [-2.9, 3.6], [-0.4, 4.9], [2.4, 4.4], [3.0, 2.2], [2.0, 0.3]]), 0.75 * h, wm || 'iron', { obj: oW, tex: (p) => { const cw = dot(sub(p, b), wpc); return cw > 4.0 * h ? 2 : (cw > 3.3 * h ? 1 : (cw < 0.9 * h ? -1 : 0)); } });
    R.cap(add(b, mul(wpc, -0.3 * h)), add(b, mul(wpc, -2.6 * h)), 0.5 * h, 0.14 * h, wm || 'iron', { obj: oW });
    R.cap(along(HR, 8.0), along(HR, 10.6), 0.68 * h, 0.68 * h, 'gold', { obj: oW, shift: -1 });
    R.cap(along(HR, 11.0), along(HR, 12.4), 0.3 * h, 0.08 * h, wm || 'iron', { obj: oW });
    R.ring(along(HR, 0.8), wd, 0.62 * h, 0.14 * h, 'leather', { obj: oW });
  } else if (weaponD === 'hammer') {   // v6 war hammer: long haft, big flat-faced head across it, bands, pommel
    R.cap(along(HR, -3.4), along(HR, 11.6), 0.52 * h, 0.5 * h, 'wood', { obj: oW, tex: (p) => (dot(sub(p, HR), wd) < 3.2 * h ? ['leather', 0] : (Math.floor(dot(sub(p, HR), wd) / h / 2.4) % 2 === 0 ? 0 : -1)) });
    const b = along(HR, 10.6);
    R.cap(add(b, mul(wpc, -3.5 * h)), add(b, mul(wpc, 3.5 * h)), 1.75 * h, 1.75 * h, wm || 'iron', { obj: oW, tex: (p) => { const cw = Math.abs(dot(sub(p, b), wpc)) / h; return cw > 3.0 ? ['gold', 1] : (cw > 2.5 ? -1 : 0); } });
    R.cap(add(b, mul(wd, 1.0 * h)), add(b, mul(wd, 2.4 * h)), 0.5 * h, 0.4 * h, 'gold', { obj: oW });
    R.sph(along(HR, -3.6), 0.78 * h, 'gold', { obj: oW });
  } else if (weaponD === 'thunderbolt') {   // v6 thunderbolt: gold grip + zigzag forks both ends, bright tips
    R.cap(along(HR, -2.4), along(HR, 2.4), 0.62 * h, 0.62 * h, 'gold', { obj: oW, tex: (p) => (Math.floor(dot(sub(p, HR), wd) / h / 1.2) % 2 === 0 ? 0 : -1) });
    R.sph(along(HR, 2.5), 0.9 * h, 'gold', { obj: oW, shift: 1 }); R.sph(along(HR, -2.5), 0.9 * h, 'gold', { obj: oW, shift: 1 });
    const zig = (sgn: number, fan: number, L: number): void => {
      const sp = [[0, 0], [0.22, 0.34], [0.36, -0.34], [0.62, 0.3], [0.8, -0.24], [1.0, 0.0]];
      let prev = along(HR, sgn * 2.6);
      for (let i = 1; i < sp.length; i++) {
        const nx = add(add(along(HR, sgn * (2.6 + sp[i][0] * L)), mul(wpc, (sp[i][1] * 2.2 + fan * sp[i][0] * 3.0) * h)), mul(aZ, 0));
        R.cap(prev, nx, (0.62 - 0.08 * i) * h, (0.62 - 0.08 * (i + 1)) * h, 'gold', { obj: oW, shift: 2 }); prev = nx;
      }
      R.sph(prev, 0.34 * h, 'marble', { obj: oW, shift: 2 });
    };
    zig(1, 0, 8.5 * h / h); zig(1, 1, 6.5); zig(1, -1, 6.5); zig(-1, 0, 5.5); zig(-1, 0.8, 4.2); zig(-1, -0.8, 4.2);
  } else if (weaponD === 'sling') {   // v6 sling: cord from the fist to a leather pouch holding a stone; whirls overhead, then flies
    const wh = g(po.whirl); const fwd = aF;
    let pc: V; const cs = 5.6 * h;
    if (wh >= 1000) pc = add(add(HR0, mul(fwd, cs)), mul(aZ, 0.6 * h));
    else if (wh >= 0) pc = add(add(HR0, mul(aZ, 1.3 * h)), add(mul(fwd, cosd(wh) * cs), mul(aL, sind(wh) * cs)));
    else pc = add(add(HR0, mul(aZ, -cs * 0.95)), mul(fwd, 1.1 * h));
    const pm = lerp(HR0, pc, 0.5);
    R.cap(HR0, pc, 0.34 * h, 0.34 * h, 'linen', { obj: oW, shift: 3 });
    R.cap(add(HR0, mul(aL, 0.5 * h)), add(pc, mul(aL, 0.3 * h)), 0.3 * h, 0.3 * h, 'linen', { obj: oW, shift: 2 });
    R.cap(HR0, add(HR0, mul(aZ, -1.4 * h)), 0.62 * h, 0.5 * h, 'leather', { obj: oW });
    void pm;
    if (wh >= 0 && wh < 1000) { const ang = [0, 60, 120, 180, 240, 300]; for (let i = 0; i < 6; i++) { const a1 = (wh + 20 + i * 12); const q: V = add(add(HR0, mul(aZ, 1.3 * h)), add(mul(fwd, cosd(a1) * cs), mul(aL, sind(a1) * cs))); R.sph(q, 0.3 * h, 'marble', { obj: oW, shift: 2 }); } void ang; }
    R.ell(pc, [1.5 * h, 1.2 * h, 0.85 * h], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'leather', { obj: oW, shift: 1 });
    if (g(po.rel) >= 0) R.sph(add(pc, mul(aZ, 0.3 * h)), 0.75 * h, 'limestone', { obj: oW, shift: 2 });
    if (g(po.rel) > 0) R.sph(add(add(pc, mul(fwd, g(po.rel) * h)), mul(aZ, 1.0 * h)), 0.8 * h, 'limestone', { obj: oW, shift: 2 });
  } else if (weaponD === 'pipes') {
    const rh = [6.4, 5.7, 5.0, 4.3, 3.6, 3.0, 2.4];
    for (let i = 0; i < 7; i++) {
      const t = add(pipeM, mul(hL, (i - 3) * 0.86 * h)); const bt = add(t, mul(hZ, -rh[i] * h));
      R.cap(t, bt, 0.44 * h, 0.44 * h, 'feather', { obj: oW, shift: i % 2 ? -1 : 1, tex: (p) => { const d = dot(sub(p, t), hZ); return (d > -0.2 * h) ? ['black', 0] : (Math.floor(-d / (0.9 * h)) % 2 === 0 ? 0 : -1); } });
    }
    for (const dz of [-1.0, -2.0]) R.cap(add(pipeM, add(mul(hL, -3.0 * h), mul(hZ, dz * h))), add(pipeM, add(mul(hL, 3.0 * h), mul(hZ, dz * h))), 0.3 * h, 0.3 * h, 'leather', { obj: oW });
  } else if (weaponD === 'bow') {   // v5: a bigger, thicker recurved bow with a bright bowstring and a nocked arrow, so it reads at 128 px
    const c = HL; const rb = 9.2 * h; const tips: V[] = [];
    for (let i = 0; i <= 10; i++) { const a = -75 + i * 15; tips.push(add(c, add(mul(aZ, sind(a) * rb), mul(aF, (cosd(a) - 0.55) * rb * 0.5)))); }
    for (let i = 0; i < 10; i++) { const mid = Math.abs(i - 4.5) / 5; R.cap(tips[i], tips[i + 1], (0.62 + 0.42 * (1 - mid)) * h, (0.62 + 0.42 * (1 - Math.abs(i - 3.5) / 5)) * h, wm || 'wood', { obj: oW, shift: i > 2 && i < 7 ? -1 : 1 }); }
    R.cap(add(c, mul(aZ, -1.2 * h)), add(c, mul(aZ, 1.2 * h)), 0.9 * h, 0.9 * h, 'leather', { obj: oW });                      // grip wrap
    for (const t of [tips[0], tips[10]]) R.sph(t, 0.55 * h, 'bone', { obj: oW });                                               // horn tips
    const st = lerp(HL, HR, 0.0); const shot = g(po.shot); const pull = shot !== 0 ? HL : add(HL, mul(norm(sub(HR, HL)), Math.min(len(sub(HR, HL)), 4.2 * h)));
    R.cap(tips[0], pull, 0.26 * h, 0.26 * h, 'linen', { obj: oW, shift: 4 }); R.cap(tips[10], pull, 0.26 * h, 0.26 * h, 'linen', { obj: oW, shift: 4 });
    const ad = shot !== 0 ? norm(sub(HL, HR)) : norm(sub(HL, pull)); const base0 = shot > 0 ? add(HL, mul(ad, shot * 17 * h)) : HL; const tip = add(base0, mul(ad, 5.0 * h));
    if (shot >= 0) R.cap(shot > 0 ? base0 : pull, tip, 0.22 * h, 0.22 * h, 'wood', { obj: oW, shift: 2 });
    const pb = shot > 0 ? base0 : pull;
    if (shot >= 0) R.plate([add(tip, mul(ad, 1.9 * h)), add(add(tip, mul(ad, -0.2 * h)), mul(aZ, 0.8 * h)), add(add(tip, mul(ad, -0.2 * h)), mul(aZ, -0.8 * h))], 0.4 * h, 'iron', { obj: oW, shift: 1 });
    if (shot >= 0) for (const sd of [-1, 1]) R.plate([add(pb, mul(ad, 0.2 * h)), add(add(pb, mul(ad, 1.5 * h)), mul(aZ, sd * 0.8 * h)), add(add(pb, mul(ad, 2.0 * h)), mul(aZ, sd * 0.8 * h)), add(pb, mul(ad, 0.9 * h))], 0.2 * h, 'crimson', { obj: oW });
    void st;
  }
  // ---- v6 stowed gear: quiver + baldric (bow / javelins), hip scabbard / axe / club / sling pouch, back-slung bow / spear
  {
    const stw: string[] = P.stow || [];
    const has = (n: string): boolean => weapon === n || stw.indexOf(n) >= 0;
    const ammo = has('bow') ? 'arrow' : has('javelin') ? 'jav' : '';
    const surf = (l: number, z: number): V => { const fz = (z - 4.3) / 3.0; const f = 2.3 * Math.sqrt(Math.max(0.04, 1 - sq(l / 3.5) - fz * fz)) + 0.3; return U(f, l, z); };
    const zz = (a: V, b: V): V => norm(sub(b, a));
    const pcm = (d: V): V => norm(sub(wcam, mul(d, dot(wcam, d))));
    if (ammo) {
      const qa = U(-3.1, 2.0, -0.2), qb = U(-3.5, 2.9, 7.2); const qd = zz(qa, qb);
      R.cap(qa, qb, 1.05 * h, 1.25 * h, 'leather', { obj: oW, tex: (p) => { const t = dot(sub(p, qa), qd) / h; return (t < 0.9 || (t > 6.2 && t < 7.0)) ? ['bronze', 0] : (Math.floor(t * 1.4) % 2 === 0 ? 0 : -1); } });
      R.cap(add(qb, mul(qd, -0.2 * h)), add(qb, mul(qd, 0.4 * h)), 1.35 * h, 1.35 * h, 'leather', { obj: oW, shift: -1 });
      const nA = ammo === 'jav' ? 3 : 5; const sl = (ammo === 'jav' ? 7.5 : 4.4) * h;
      for (let i = 0; i < nA; i++) {
        const off = add(mul(aL, (i - (nA - 1) / 2) * 0.55 * h), mul(aF, (i % 2 ? 0.45 : -0.35) * h)); const b0 = add(qb, off); const t0 = add(b0, mul(add(qd, mul(aL, (i - (nA - 1) / 2) * 0.07)), sl));
        R.cap(b0, t0, ammo === 'jav' ? 0.26 * h : 0.21 * h, ammo === 'jav' ? 0.26 * h : 0.21 * h, 'wood', { obj: oW, shift: 2 });
        if (ammo === 'jav') R.cap(t0, add(t0, mul(qd, 1.9 * h)), 0.42 * h, 0.08 * h, 'iron', { obj: oW, shift: 1 });
        else { const fp = pcm(qd); R.plate([add(t0, mul(qd, -2.2 * h)), add(add(t0, mul(qd, -2.2 * h)), mul(fp, 0.9 * h)), add(add(t0, mul(qd, 0.2 * h)), mul(fp, 0.9 * h)), t0], 0.25 * h, i % 2 ? 'crimson' : 'marble', { obj: oW, shift: 1 }); }
      }
      const pts: V[] = []; for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(surf(-2.6 + 6.0 * t, 6.5 - 6.4 * t)); }
      R.tube(pts, [0.42 * h, 0.42 * h, 0.42 * h, 0.42 * h, 0.42 * h, 0.42 * h], 'leather', { obj: oW, shift: 1 });   // baldric across the chest
    }
    for (const n of stw) {
      if (n === 'xiphos' || n === 'sword' || n === 'kopis') {
        const a = U(1.2, 3.8, 0.8), b = U(-3.6, 4.0, -5.6); const d = zz(b, a); const fp = pcm(d);
        R.cap(a, b, 0.78 * h, 0.55 * h, 'leather', { obj: oW, tex: (p) => (dot(sub(p, b), d) < 1.4 * h ? ['gold', 0] : (dot(sub(p, a), d) > -1.3 * h ? ['gold', 0] : 0)) });
        R.sph(b, 0.65 * h, 'gold', { obj: oW });
        const g1 = add(a, mul(d, 2.3 * h)); R.cap(a, g1, 0.38 * h, 0.38 * h, 'leather', { obj: oW });
        R.cap(add(a, add(mul(d, 0.3 * h), mul(aL, -1.5 * h))), add(a, add(mul(d, 0.3 * h), mul(aL, 1.5 * h))), 0.42 * h, 0.42 * h, 'gold', { obj: oW });
        R.sph(add(g1, mul(d, 0.3 * h)), 0.58 * h, 'gold', { obj: oW }); void fp;
      } else if (n === 'axe' || n === 'club') {
        const a = U(1.6, 3.9, 1.4), b = U(-3.6, 4.1, -5.0); const d = zz(b, a); const fp = norm(cross(aL, d));
        if (n === 'axe') {
          R.cap(b, a, 0.42 * h, 0.42 * h, 'wood', { obj: oW });
          R.plate([add(a, add(mul(d, -1.6 * h), mul(fp, 0.3 * h))), add(a, add(mul(d, -2.3 * h), mul(fp, 3.4 * h))), add(a, add(mul(d, 0.2 * h), mul(fp, 4.4 * h))), add(a, add(mul(d, 2.4 * h), mul(fp, 3.6 * h))), add(a, add(mul(d, 1.8 * h), mul(fp, 0.3 * h)))], 0.7 * h, 'iron', { obj: oW, tex: (p) => (dot(sub(p, a), fp) > 3.1 * h ? 2 : 0) });
        } else R.cap(b, add(a, mul(d, 2.4 * h)), 0.5 * h, 1.4 * h, 'wood', { obj: oW, tex: (p) => (hash(p[0] * 0.7, p[1] * 0.7, p[2] * 0.7) > 0.8 ? -2 : 0) });
      } else if (n === 'sling') {
        R.ell(U(0.9, 4.1, -0.4), [1.5 * h, 0.9 * h, 1.8 * h], [aF, aL, aZ], 'leather', { obj: oW, shift: 1 });
        R.ring(U(0.9, 4.9, -0.2), aL, 1.2 * h, 0.3 * h, 'linen', { obj: oW, shift: 2 });
        R.sph(U(1.6, 5.0, -1.2), 0.65 * h, 'limestone', { obj: oW, shift: 2 });
        R.cap(U(0.9, 4.2, 0.9), U(0.0, 4.4, -3.4), 0.3 * h, 0.3 * h, 'linen', { obj: oW, shift: 2 });
      } else if (n === 'spear' || n === 'throwspear') {
        const a = U(-3.4, -2.2, -8.0), b = U(-3.9, 3.2, n === 'spear' ? 15.5 : 13.0); const d = zz(a, b); const fp = pcm(d);
        R.cap(a, b, 0.4 * h, 0.36 * h, 'wood', { obj: oW, tex: (p) => (Math.floor(dot(sub(p, a), d) / h / 2.2) % 2 === 0 ? 0 : -1) });
        R.plate([add(b, mul(d, -0.5 * h)), add(add(b, mul(d, 1.2 * h)), mul(fp, 1.4 * h)), add(add(b, mul(d, 3.2 * h)), mul(fp, 1.6 * h)), add(b, mul(d, 7.5 * h)), add(add(b, mul(d, 3.2 * h)), mul(fp, -1.6 * h)), add(add(b, mul(d, 1.2 * h)), mul(fp, -1.4 * h))], 0.7 * h, 'bronze', { obj: oW });
        R.cap(add(a, mul(d, -0.5 * h)), a, 0.1 * h, 0.4 * h, 'bronze', { obj: oW });
      } else if (n === 'bow') {
        const nn = 8; const pts: V[] = [];
        for (let i = 0; i <= nn; i++) { const t = i / nn; pts.push(U(-2.6 - 0.4 * sind(180 * t), 4.7 + 1.9 * sind(180 * t), -5.0 + 18.5 * t)); }   // slung behind the left shoulder: limb curves out so it shows
        for (let i = 0; i < nn; i++) R.cap(pts[i], pts[i + 1], 0.55 * h, 0.55 * h, 'wood', { obj: oW, shift: 1 });
        R.cap(pts[0], pts[nn], 0.2 * h, 0.2 * h, 'linen', { obj: oW, shift: 3 });
        R.sph(pts[nn], 0.55 * h, 'bone', { obj: oW }); R.sph(pts[0], 0.5 * h, 'bone', { obj: oW });
      }
    }
  }
  // ---- shield on the left forearm
  if (hasShield) {
    const n = norm(add(mul(aF, 0.55), mul(aL, 0.83))); const e1 = norm(cross(aZ, n)); const e2 = norm(cross(n, e1));
    const mid = lerp(elbows[0], HL, 0.5); const Rs = (shield === 'pelte' ? 4.6 : 5.8) * h; const c = add(mid, mul(n, 0.9 * h));
    const sm = mat(sh0.colour || (shield === 'hoplon' ? 'bronze' : 'leather')); const em = mat(sh0.emblemColour || (sm === 'bronze' ? 'black' : 'bronze'));
    const emb = sh0.emblem || 'lambda';
    const etex: LTex = (p) => {
      const q = sub(p, c); const a = dot(q, e1) / Rs, b = dot(q, e2) / Rs; const r2 = Math.sqrt(a * a + b * b);
      if (r2 > 0.86) return [sh0.rim ? mat(sh0.rim) : 'bronze', 1];
      if (r2 > 0.8) return -2;
      if (emb === 'disc' && r2 < 0.4) return [em, 0];
      if (emb === 'ring' && r2 > 0.42 && r2 < 0.62) return [em, 0];
      if (emb === 'lambda' && b > -0.58 && b < 0.58 && (Math.abs(a - (0.58 - b) * 0.5) < 0.2 || Math.abs(a + (0.58 - b) * 0.5) < 0.2)) return [em, 0];
      if (emb === 'eye') { const d1 = Math.sqrt(a * a / 0.36 + b * b); if (Math.sqrt(a * a + b * b) < 0.15) return [em, 0]; if (d1 < 0.42 && d1 > 0.32) return [em, 0]; }
      if (emb === 'star') { const ang = atan2d(b, a); const k2 = Math.abs(((ang + 360) % 45) - 22.5) / 22.5; if (r2 < 0.2 + 0.36 * (1 - k2)) return [em, 0]; }
      return 0;
    };
    if (shield === 'pelte') {
      const pts: V[] = []; for (let i = 0; i <= 10; i++) { const a = 200 + i * 14; pts.push(add(c, add(mul(e1, cosd(a) * Rs), mul(e2, sind(a) * Rs)))); }
      for (let i = 10; i >= 0; i--) { const a = 200 + i * 14; pts.push(add(c, add(mul(e1, cosd(a) * Rs * 0.55), mul(e2, (sind(a) * 0.55 + 0.55) * Rs)))); }
      R.plate(pts.reverse(), 0.7 * h, sm, { obj: oS, tex: etex });
    } else {
      R.shape((X) => S.inter(S.ellipsoid(X.w(c), [1.5 * h, Rs, Rs], [X.d(n), X.d(e1), X.d(e2)]), S.half(X.w(add(c, mul(n, -0.5 * h))), X.d(mul(n, -1)))), sm, { obj: oS, tex: etex });
      R.ring(add(c, mul(n, -0.3 * h)), n, Rs * 0.94, 0.5 * h, sh0.rim ? mat(sh0.rim) : 'bronze', { obj: oS });
      R.sph(add(c, mul(n, 1.1 * h)), 0.55 * h, 'bronze', { obj: oS, shift: 1 });
    }
    R.key(add(c, mul(e2, -Rs)), 0.3);
  }
  // ---- legs (muscled thigh, calf, greaves, knee plates) with a wide idle stance
  const abd = g(po.abd);
  if (!up) {
    if (lower === 'serpent') {
      const sm = mat(legsA.colour || 'snake'); let prev: V = [fo, 0, hipZ - 0.5 * h];
      for (let i = 1; i <= 14; i++) {
        const a = i * 34 + 120; const rr = (4.5 - i * 0.12) * h; const z = Math.max(hipZ - 0.5 * h - i * 1.4 * h, (1.3 - i * 0.06) * h);
        const p: V = [fo - 1.5 * h + cosd(a) * rr * (i > 3 ? 1 : i / 3), sind(a) * rr * (i > 3 ? 1 : i / 3), z];
        R.cap(prev, p, (2.1 - i * 0.1) * h, (2.0 - i * 0.1) * h, sm, { obj: oLegL, tex: (q) => (Math.floor((q[2] / h) * 2.5) % 2 === 0 ? 0 : -1) });
        prev = p;
      }
      R.tube([prev, add(prev, [-2.0 * h, 1.8 * h, 0.1 * h]), add(prev, [-3.2 * h, 3.4 * h, 0.4 * h]), add(prev, [-3.6 * h, 4.8 * h, 0.9 * h])], [0.9 * h, 0.65 * h, 0.4 * h, 0.15 * h], sm, { obj: oLegL });
    } else {
      const gre = legsA.greaves ? mat(legsA.greaves === true ? 'bronze' : String(legsA.greaves)) : '';
      const san = legsA.sandals === false ? '' : mat(legsA.sandals && legsA.sandals !== true ? String(legsA.sandals) : 'leather');
      for (const s of [1, -1]) {
        const L = s > 0; const hp = g(L ? po.hipL : po.hipR), kn = g(L ? po.kneeL : po.kneeR); const ob = L ? oLegL : oLegR;
        const Hj: V = [fo, s * 1.9 * h * bw * (0.8 + 0.2 * g(po.spread)), hipZ];
        const dl = (t: number, ab: number): V => [sind(t) * cosd(ab), s * sind(ab), -cosd(t) * cosd(ab)];
        if (lower === 'goat' || lower === 'bird') {
          const lm = mat(legsA.colour || (lower === 'goat' ? 'fur' : 'feather'));
          const t1 = hp + 25, t2 = hp - 55 - kn, t3 = hp + 20 - kn * 0.4;
          const K = add(Hj, mul(add(dl(t1, abd), [0, 0, 0]), 4.6 * h)); const A = add(K, mul(dl(t2, abd * 0.3), 4.0 * h)); const F = add(A, mul(dl(t3, 0), 2.6 * h));
          if (lower === 'goat') satyrLeg({ ...mkA(ob), skin: lm }, Hj, K, A, F, lm, s);
          else {
            R.limb(Hj, K, 1.7 * h * bwl, 1.05 * h * bwl, 0.55 * h * bwl, 0.35, lm, { obj: ob, tex: featherTex(h, Hj, axes) });
            R.sph(K, 1.05 * h * bwl, lm, { obj: ob, shift: -1 });
            R.limb(K, A, 0.8 * h * bwl, 0.5 * h * bwl, 0.12 * h, 0.3, 'gold', { obj: ob, shift: -2 });
            R.cap(A, F, 0.5 * h, 0.45 * h, 'gold', { obj: ob, shift: -2 });
            talons({ ...mkA(ob), skin: lm }, F, ob);
            R.key(F, 0.6 * h);
          }
        } else {
          const K = add(Hj, mul(dl(hp, abd), 5.3 * h)); const a2 = hp - kn; const A = add(K, mul(dl(a2, abd * 0.4), 5.0 * h));
          const legM = skeleton ? 'bone' : (legsA.colour ? mat(legsA.colour) : skin);
          const thigh = (p: V): number => { const d = sub(p, Hj); const t = dot(d, sub(K, Hj)) / (28 * h * h); return (dot(d, aF) > 0.4 * h && t > 0.25 && t < 0.7) ? 1 : (dot(d, aF) < -0.5 * h ? -1 : 0); };
          R.limb(Hj, K, 1.4 * h * bwl, 1.05 * h * bwl, 0.35 * h * bwl * heavy, 0.35, legM, { obj: ob, tex: skeleton ? undefined : thigh });
          if (anat) anatLeg({ ...mkA(ob), skin: legM }, Hj, K, A, s, !!gre);
          if (skeleton) { R.sph(K, 0.7 * h, 'bone', { obj: ob }); R.cap(Hj, K, 0.55 * h, 0.5 * h, 'bone', { obj: ob }); R.cap(K, A, 0.45 * h, 0.4 * h, 'bone', { obj: ob }); }
          if (!skeleton) {
            const front = (p: V): number => { const ax = sub(A, K); const d = sub(p, K); const t = clamp(dot(d, ax) / dot(ax, ax), 0, 1); const rr = sub(d, mul(ax, t)); const rl = len(rr) || 1; return dot(rr, aF) / rl; };
            R.limb(K, A, (gre ? 1.12 : 1.05) * h * bwl, (gre ? 0.78 : 0.7) * h * bwl, (gre ? 0.22 : 0.4) * h * bwl * heavy, 0.3, gre || legM, { obj: ob, tex: gre ? (p) => (front(p) > 0.8 ? 2 : (p[2] > K[2] - 0.7 * h ? 1 : (p[2] < A[2] + 0.5 * h ? -1 : 0))) : (p) => (front(p) > 0.82 ? 1 : (front(p) < -0.4 ? -1 : 0)) });
            if (gre) R.sph(add(K, mul(aF, 0.3 * h)), 1.1 * h * bwl, gre, { obj: ob, shift: 1 });       // knee plate
          }
          const toe = add(A, [2.4 * h, s * 0.2 * h, -0.4 * h]);
          R.cap(add(A, [-0.4 * h, 0, -0.4 * h]), toe, 0.7 * h * (build === 'giant' ? 1.2 : 1), 0.5 * h, skeleton ? 'bone' : (san || skin), { obj: ob, tex: san && !skeleton ? (p) => (p[2] < A[2] - 0.6 * h ? ['leather', -1] : (Math.floor(dot(sub(p, A), [1, 0, 0]) / (0.55 * h)) % 2 === 0 ? [skin, 0] : ['leather', 0])) : undefined });
          if (san && !skeleton) R.cap(A, add(A, [0, 0, 1.4 * h]), 0.84 * h * bwl, 0.84 * h * bwl, gre || legM, { obj: ob, tex: (p) => (Math.floor((p[2] - A[2]) / (0.45 * h)) % 2 === 0 ? ['leather', 0] : 0) });
        }
      }
    }
  }
  if (!P.rig) R.emit(new Frame(P.at || [0, 0], P.facing || 0, (P.at && P.at[2]) || 0), g(po.fall));
  return { top: add(Hc, mul(hZ, hr)) };
}
export function winged(k: Kit, P: HumanoidP & { span?: number } = {}): { top: V } {
  return humanoid(k, { ...P, wings: { type: (P.wings && P.wings.type) || 'feather', colour: P.wings && P.wings.colour, span: P.span || (P.wings && P.wings.span) || 12 } });
}

// ---------------- v3 anatomy: muscle groups, joints, digitigrade goat legs, feathered harpy parts, and the creature wrappers ----------------
type AC = { R: Rig; h: number; bw: number; bwl: number; heavy: number; axes: V[]; aF: V; aL: V; aZ: V; U: (f: number, l: number, z: number) => V; skin: string; ob: number };
// one muscle belly: an ellipsoid whose underside reads as a crease and whose crown takes a highlight
function mus(R: Rig, c: V, r: V, ax: V[], m: string, ob: number, shift = 0, cr = -2): void {
  R.ell(c, r, ax, m, { obj: ob, shift, tex: (p) => {
    const d = sub(p, c); const b = dot(d, ax[1]) / r[1], z = dot(d, ax[2]) / r[2];
    if (z < -0.55) return cr; if (z > 0.5 && Math.abs(b) < 0.85) return 1; return 0;
  } });
}
function anatTorso(A: AC): void {
  const { R, h, bw, heavy: hv, axes, U, skin, ob } = A;
  for (const s of [-1, 1]) {
    mus(R, U(1.4, s * 1.55 * bw, 4.7), [1.2 * h * hv, 1.65 * h * bw, 1.15 * h], axes, skin, ob);                   // pectoral
    mus(R, U(0.1, s * 3.0 * bw, 3.6), [1.3 * h, 0.95 * h * bw, 2.1 * h], axes, skin, ob, -1);                      // lat / serratus
    mus(R, U(0.55, s * 2.4 * bw, 1.3), [1.35 * h, 1.0 * h * bw, 1.7 * h], axes, skin, ob, -1);                     // oblique
    mus(R, U(-0.6, s * 1.6 * bw, 6.2), [1.2 * h, 1.5 * h * bw, 0.7 * h], axes, skin, ob);                          // trapezius
    mus(R, U(-1.7, s * 0.9 * bw, 3.4), [0.9 * h, 0.9 * h * bw, 2.8 * h], axes, skin, ob);                          // erector spinae
    for (let i = 0; i < 3; i++) mus(R, U(1.5 - i * 0.04, s * 0.68 * bw, 3.0 - i * 1.05), [0.62 * h, 0.7 * h * bw, 0.58 * h], axes, skin, ob);   // abs 3x2
  }
  R.ell(U(1.45, 0, 3.0), [0.5 * h, 0.1 * h, 2.4 * h], axes, skin, { obj: ob, shift: -2 });                                       // linea alba
}
function anatArm(A: AC, S0: V, E: V, Hn: V, mat0: string): void {
  const { R, h, bwl, heavy: hv, axes, ob } = A; const hs = Math.sqrt(hv);
  mus(R, add(S0, mul(A.aZ, 0.25 * h)), [1.35 * h * hs, 1.4 * h * hs * Math.sqrt(A.bw), 1.45 * h * hs], axes, mat0, ob);     // deltoid cap
  const u = norm(sub(E, S0)); mus(R, add(lerp(S0, E, 0.5), mul(A.aF, 0.15 * h)), [1.7 * h, 0.9 * h * bwl * hs, 0.9 * h * bwl * hs], [u, A.aF, norm(cross(u, A.aF))], mat0, ob, 0, -1);   // biceps
  R.sph(E, 0.88 * h * bwl, mat0, { obj: ob, shift: 1 });                                                                // elbow
  R.ring(E, norm(add(u, norm(sub(Hn, E)))), 0.72 * h * bwl, 0.13 * h, mat0, { obj: ob, shift: -2 });                   // elbow crease
  const w = norm(sub(Hn, E)); mus(R, add(lerp(E, Hn, 0.3), mul(A.aZ, 0.2 * h)), [1.6 * h, 0.7 * h * bwl * hs, 0.7 * h * bwl * hs], [w, A.aF, norm(cross(w, A.aF))], mat0, ob, 0, -1);   // forearm flexors
}
function anatLeg(A: AC, Hj: V, K: V, Ak: V, s: number, greaves: boolean): void {
  const { R, h, bw, bwl, heavy: hv, aF, ob } = A; const hs = Math.sqrt(hv);
  const d = norm(sub(K, Hj)); const e1 = norm(cross(d, A.aL)); const e2 = norm(cross(d, e1));
  mus(R, add(lerp(Hj, K, 0.5), mul(e1, 0.4 * h)), [2.5 * h, 1.2 * h * hs, 1.25 * h * bwl * hs], [d, e1, e2], A.skin, ob);                // quadriceps
  mus(R, add(add(lerp(Hj, K, 0.52), mul(e1, 0.1 * h)), mul(e2, s * 0.75 * h)), [2.2 * h, 0.8 * h, 0.8 * h * bwl], [d, e1, e2], A.skin, ob, -1);  // vastus lateralis
  mus(R, add(lerp(Hj, K, 0.45), mul(e1, -0.55 * h)), [2.3 * h, 1.0 * h * hs, 1.2 * h * bwl], [d, e1, e2], A.skin, ob, -1);                // hamstring
  R.sph(add(K, mul(aF, 0.45 * h)), 0.92 * h * bwl, A.skin, { obj: ob, shift: 1 });                                                      // kneecap
  R.ring(K, d, 0.95 * h * bwl, 0.12 * h, A.skin, { obj: ob, shift: -2 });                                                               // knee crease
  if (greaves) return;
  const d2 = norm(sub(Ak, K)); const f2 = norm(cross(d2, A.aL)); const g2 = norm(cross(d2, f2));
  mus(R, add(lerp(K, Ak, 0.3), mul(f2, -0.6 * h)), [2.1 * h, 0.95 * h * hs, 0.95 * h * bwl], [d2, f2, g2], A.skin, ob);                  // gastrocnemius
  R.cap(add(K, mul(d2, 0.8 * h)), add(Ak, mul(d2, -0.5 * h)), 0.55 * h * bwl, 0.5 * h * bwl, A.skin, { obj: ob, shift: 1, tex: (p) => (dot(sub(p, K), f2) > 0.3 * h ? 1 : 0) });       // shin crest
}
// digitigrade goat leg: thigh forward-down, hock back, cannon forward-down, cloven hooves
function satyrLeg(A: AC, Hj: V, K: V, Ak: V, F: V, lm: string, s: number): void {
  const { R, h, bwl, heavy: hv, ob } = A; const hs = Math.sqrt(hv);
  const fur: LTex = (p) => (hash(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3) > 0.62 ? -1 : (hash(p[0], p[1], p[2]) > 0.9 ? 1 : 0));
  R.limb(Hj, K, 1.5 * h * bwl * hs, 1.1 * h * bwl, 0.5 * h * bwl, 0.35, lm, { obj: ob, tex: fur });
  const d = norm(sub(K, Hj)); const e1 = norm(cross(d, A.aL)); const e2 = norm(cross(d, e1));
  mus(R, add(lerp(Hj, K, 0.5), mul(e1, 0.45 * h)), [2.3 * h, 1.0 * h * hs, 1.1 * h * bwl], [d, e1, e2], lm, ob);                          // thigh muscle
  R.sph(K, 1.1 * h * bwl, lm, { obj: ob, shift: 0, tex: fur });
  R.limb(K, Ak, 1.15 * h * bwl, 0.62 * h * bwl, 0.35 * h * bwl, 0.3, lm, { obj: ob, tex: fur });                                          // calf
  R.sph(Ak, 0.78 * h * bwl, lm, { obj: ob, shift: 0, tex: fur });                                                                       // hock
  R.cap(Ak, add(Ak, mul(norm(sub(Ak, K)), 1.1 * h)), 0.5 * h, 0.2 * h, 'bone', { obj: ob });                                            // calcaneus point
  R.cap(Ak, F, 0.55 * h, 0.48 * h, lm, { obj: ob, tex: fur });                                                                          // cannon
  const dn = norm(sub(F, Ak)); const fw: V = norm(add(A.aF, mul(dn, -dot(A.aF, dn))));
  R.sph(F, 0.62 * h, lm, { obj: ob, tex: fur });
  for (const q of [-1, 1]) {   // two hoof halves with a dark cleft between them
    const t0 = add(F, mul(A.aL, q * 0.32 * h)); const t1 = add(add(add(F, mul(fw, 1.3 * h)), mul(A.aL, q * 0.34 * h)), [0, 0, -0.95 * h]);
    R.cap(t0, t1, 0.55 * h, 0.4 * h, 'black', { obj: ob, shift: 3 });
  }
  R.cap(add(F, [0, 0, -0.2 * h]), add(add(F, mul(fw, 1.3 * h)), [0, 0, -0.9 * h]), 0.1 * h, 0.1 * h, 'black', { obj: ob });
  R.key(add(add(F, mul(fw, 0.7 * h)), [0, 0, -1.0 * h]), 0.35 * h);
}
// harpy parts: scalloped feather torso, neck ruff, tail fan, big talons
function featherTex(h: number, cz: V, ax: V[]): LTex {
  return (p) => {
    const d = sub(p, cz); const z = dot(d, ax[2]) / h * 2.2; const row = Math.floor(z); const off = (row % 2 === 0) ? 0 : 0.5;
    const a = dot(d, ax[1]) / h * 1.6 + off; const fx = a - Math.floor(a) - 0.5; const fz = z - row;
    const sc = fz - 0.55 * Math.abs(fx) * 1.2;
    return sc < 0.2 ? -3 : (fz > 0.6 ? 2 : 0);
  };
}
function harpyParts(A: AC, tmat: string, hipsW: (f: number, l: number, z: number) => V): void {
  const { R, h, bw, aF, aL, aZ, U, ob } = A;
  for (let i = -2; i <= 2; i++) {   // neck ruff: overlapping feather spikes around the collar
    const a = i * 38; const dir = norm(add(add(mul(aF, cosd(a)), mul(aL, sind(a))), mul(aZ, 0.25)));
    R.cap(add(U(0, 0, 6.5), mul(dir, 1.3 * h)), add(add(U(0, 0, 6.5), mul(dir, 2.8 * h)), mul(aZ, 0.5 * h)), 0.5 * h, 0.1 * h, tmat, { obj: ob, shift: i % 2 ? 1 : 0 });
  }
  R.ell(U(-0.4, 0, 6.5), [2.0 * h, 2.7 * h * bw, 0.8 * h], A.axes, tmat, { obj: ob, shift: 1, tex: featherTex(h, U(-0.4, 0, 6.5), A.axes) });
  for (let i = -3; i <= 3; i++) {   // tail fan behind the hips
    const a = i * 17; const dir = norm(add(add(mul(aF, -cosd(a)), mul(aL, sind(a))), mul(aZ, -0.45)));
    const b0 = hipsW(-1.5, 0, 0.6); const b1 = add(b0, mul(dir, 7.5 * h)); const side = norm(cross(dir, aZ));
    R.plate([add(b0, mul(side, 0.5 * h)), add(add(b0, mul(dir, 3.5 * h)), mul(side, 1.1 * h)), add(b1, mul(side, 0.2 * h)), add(add(b0, mul(dir, 3.5 * h)), mul(side, -1.1 * h)), add(b0, mul(side, -0.5 * h))], 0.35 * h, tmat, { obj: ob, shift: i % 2 ? -1 : 0, tex: (p) => (Math.abs(dot(sub(p, b0), side)) < 0.2 * h ? -2 : 0) });
  }
}
function talons(A: AC, F: V, ob: number): void {
  const { R, h } = A;
  for (const q of [-38, 0, 38]) {
    const t1 = add(F, [cosd(q) * 2.7 * h, sind(q) * 2.7 * h, -0.55 * h]);
    R.cap(F, t1, 0.46 * h, 0.3 * h, 'gold', { obj: ob });
    R.cap(t1, add(t1, [cosd(q) * 1.0 * h, sind(q) * 1.0 * h, -0.6 * h]), 0.26 * h, 0.04 * h, 'iron', { obj: ob });
  }
  R.cap(F, add(F, [-1.7 * h, 0, -0.4 * h]), 0.38 * h, 0.2 * h, 'gold', { obj: ob });
  R.cap(add(F, [-1.7 * h, 0, -0.4 * h]), add(F, [-2.4 * h, 0, -1.0 * h]), 0.2 * h, 0.04 * h, 'iron', { obj: ob });
}
// ---- creature wrappers: sensible defaults merged under whatever the caller passes
function dm(a: any, b: any): any {
  if (!b) return a; if (!a) return b; const o: any = {};
  for (const key of Object.keys(a)) o[key] = a[key];
  for (const key of Object.keys(b)) { const bv = b[key]; const av = o[key]; o[key] = (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' && !Array.isArray(av)) ? dm(av, bv) : bv; }
  return o;
}
export function spartan(k: Kit, P: HumanoidP = {}): { top: V } {
  return humanoid(k, dm({ facing: 15, pose: 'idle', skin: 'skin_olive', build: 'heavy', weapon: 'xiphos', cape: 'crimson', capeStyle: 'big',
    head: { helmet: 'corinthian', helmetMat: 'bronze', crest: 'crimson', hair: 'none' }, torso: { armour: 'none', colour: 'crimson', trim: 'crimson' },
    legs: { greaves: 'bronze', sandals: 'leather' }, arms: { bracers: 'bronze' }, shield: { type: 'hoplon', colour: 'bronze', emblem: 'lambda', emblemColour: 'crimson', rim: 'gold' } }, P));
}
export function cyclops(k: Kit, P: HumanoidP = {}): { top: V } {
  return humanoid(k, dm({ facing: 20, pose: 'idle', skin: 'skin_olive', build: 'giant', height: 31, weapon: 'club',
    head: { type: 'cyclops', hair: 'fur_dark', beard: 'fur_dark' }, torso: { armour: 'none', colour: 'leather' }, legs: { sandals: false } }, P));
}
export function minotaur(k: Kit, P: HumanoidP = {}): { top: V } {
  return humanoid(k, dm({ facing: 20, pose: 'idle', skin: 'fur_dark', build: 'giant', height: 31, weapon: 'labrys',
    head: { type: 'bull', hair: 'fur_dark' }, torso: { armour: 'none', colour: 'leather' }, legs: { sandals: false, colour: 'fur_dark' }, arms: { bracers: 'bronze' } }, P));
}
export function satyr(k: Kit, P: HumanoidP = {}): { top: V } {
  return humanoid(k, dm({ facing: -10, pose: 'idle', skin: 'skin_olive', build: 'heavy', height: 29, weapon: 'pipes',
    head: { type: 'goat', hair: 'fur_dark', beard: 'fur_dark' }, torso: { armour: 'none', colour: 'leather' }, legs: { lower: 'goat', colour: 'fur' } }, P));
}
export function harpy(k: Kit, P: HumanoidP & { span?: number } = {}): { top: V } {
  return humanoid(k, dm({ facing: 20, pose: 'idle', skin: 'skin', build: 'slim', height: 24, wings: { type: 'feather', colour: 'fur', span: 15 },
    head: { type: 'human', hair: 'fur_dark', helmet: 'none' }, torso: { armour: 'feathers', colour: 'fur' }, legs: { lower: 'bird', colour: 'fur' } }, P));
}

// ---------------- quadrupeds and centaurs: always turned 15-50 degrees from side-on so the legs, barrel and tail read ----------------
export type QuadP = { at?: number[]; facing?: number; kind?: string; colour?: string; mane?: string; size?: number; pose?: string; rider?: HumanoidP };
export function quadruped(k: Kit, P: QuadP = {}): void {
  const kind = P.kind || 'horse'; const s = (P.size || 1) * (kind === 'dog' ? 0.6 : kind === 'lion' ? 1.0 : kind === 'boar' ? 0.78 : 1); const lk = kind === 'boar' ? 0.72 : kind === 'lion' ? 0.74 : 1; const LN = kind === 'lion';   // v6: heavier lion, shorter legs
  const cm = mat(P.colour || (kind === 'horse' ? 'fur' : kind === 'lion' ? 'gold' : kind === 'bull' ? 'fur_dark' : 'fur')); const mm = mat(P.mane || (kind === 'lion' ? 'fur' : 'fur_dark'));
  const fc = P.facing === undefined ? -35 : clamp(P.facing, -50, -15);
  const R = new Rig(k); const ob = k.obj(), oLeg = k.obj(), oLeg2 = k.obj(), oHead = k.obj(), oTail = k.obj();
  const name = P.pose || 'idle';
  const num = (pre: string): number => (name.indexOf(pre) === 0 ? parseInt(name.slice(pre.length), 10) : 0);
  const wk = num('walk'), at = num('attack'), id = num('idle');
  const ang = 90 + (wk - 1) * 60; const iph = (id > 0 ? (id - 1) * 90 : 90); const br = 0.5 - 0.5 * cosd(iph);
  // per-leg: hip angle a, lift (knee/ankle fold). order: LF, RF, LH, RH. trot: diagonal pairs.
  const leg = (i: number): number[] => {
    if (wk > 0) { const ph = ang + (i === 1 || i === 2 ? 180 : 0); return [24 * sind(ph), 55 * Math.max(0, cosd(ph))]; }
    if (at > 0) { const j = at - 1; const lf = [8, 25, 58, 40, 8][j], lfl = [6, 40, 70, 50, 10][j];
      if (i < 2) return [i === 0 ? lf : lf * 0.7, i === 0 ? lfl : lfl * 0.8]; return [i === 2 ? -6 : 10, 4]; }
    return [[10, -6, -8, 9][i], 0];
  };
  const bl = 6.8 * s; const by = 9.6 * s + (id > 0 ? 0.25 * br * s : 0) - (at === 2 ? 0.6 * s : 0);
  const fur: LTex = (p) => { const v = hash(p[0] * 0.6, p[1] * 0.6, p[2] * 0.6); const r = p[2] - by; return (r < -1.4 * s ? -1 : r > 1.7 * s ? 1 : 0) + (v > 0.93 ? -1 : 0); };
  const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const slim = 1;
  R.shape((X) => S.smooth(1.4 * s, S.ellipsoid(X.w([0, 0, by]), [bl, (LN ? 3.4 : 2.7) * s * slim, (LN ? 3.4 : 2.9) * s * slim]),
    S.smooth(1.0 * s, S.ellipsoid(X.w([bl * 0.62, 0, by + (LN ? -0.1 : 0.5) * s]), [(LN ? 3.4 : 2.9) * s, (LN ? 3.6 : 2.8) * s, (LN ? 4.4 : 3.3) * s * slim]), S.ellipsoid(X.w([-bl * 0.62, 0, by + 0.3 * s]), [2.9 * s, 2.9 * s, 3.1 * s * slim]))), cm, { obj: ob, tex: fur });
  R.key([0, 0, by + 2.9 * s], 0);
  for (const sd of [-1, 1]) {
    R.ell([bl * 0.58, sd * 2.0 * s, by - 0.2 * s], [1.9 * s, 1.0 * s, 2.5 * s], ax, cm, { obj: ob, shift: 1 });      // shoulder
    R.ell([-bl * 0.58, sd * 2.1 * s, by - 0.4 * s], [2.5 * s, 1.1 * s, 2.8 * s], ax, cm, { obj: ob, shift: 1 });     // haunch
  }
  const hoofM = kind === 'lion' || kind === 'dog' ? cm : 'black';
  for (let i = 0; i < 4; i++) {
    const [a, lift] = leg(i); const front = i < 2; const sd = i % 2 === 0 ? 1 : -1; const ol = sd > 0 ? oLeg : oLeg2;
    const top: V = [front ? bl * 0.62 : -bl * 0.62, sd * (front ? 1.5 : 1.8) * s, by - 0.6 * s];
    const dir = (t: number): V => [sind(t), 0, -cosd(t)];
    let kne: V, ank: V, hoof: V;
    if (front) { kne = add(top, mul(dir(a), 4.2 * s * lk)); const a2 = a - lift; ank = add(kne, mul(dir(a2), 4.0 * s * lk)); hoof = add(ank, mul(dir(a2 + 8), 1.0 * s)); }
    else { kne = add(top, mul(dir(a + 18), 4.2 * s * lk)); const a2 = a - 22 - lift; ank = add(kne, mul(dir(a2), 3.8 * s * lk)); hoof = add(ank, mul(dir(a2 + 14 + lift * 0.3), 1.0 * s)); }
    R.limb(top, kne, (LN ? 2.0 : 1.4) * s, (LN ? 1.2 : 0.7) * s, 0.35 * s, 0.3, cm, { obj: ol, tex: (p) => (p[0] > top[0] && front ? 1 : 0) });
    R.sph(kne, 0.72 * s, cm, { obj: ol, shift: -1 });
    R.cap(kne, ank, (LN ? 1.05 : 0.6) * s, (LN ? 0.85 : 0.46) * s, cm, { obj: ol, shift: -1 });
    R.sph(ank, 0.55 * s, cm, { obj: ol, shift: -2 });
    R.cap(ank, hoof, (LN ? 0.9 : 0.5) * s, (LN ? 1.1 : 0.6) * s, cm, { obj: ol, shift: -1 });
    R.cap(add(hoof, [0, 0, 0.1 * s]), add(hoof, [0.3 * s, 0, -0.55 * s]), (LN ? 1.15 : 0.66) * s, (LN ? 1.2 : 0.72) * s, hoofM, { obj: ol });
    R.key(add(hoof, [0.2 * s, 0, -0.8 * s]), 0);
  }
  // tail: a tapered curved tube
  const tsw = (wk > 0 ? sind(ang) * 0.9 : id > 0 ? sind(iph) * 0.6 : 0) * s; const tm = kind === 'horse' ? mm : cm;
  const t0: V = [-bl * 0.95, 0, by + 1.4 * s];
  R.tube([t0, [-bl * 1.18, tsw * 0.3, by + 0.3 * s], [-bl * 1.28, tsw * 0.8, by - 2.2 * s], [-bl * 1.2, tsw * 1.2, by - 5.0 * s]], [0.9 * s, 0.95 * s, 0.75 * s, kind === 'lion' ? 0.55 * s : 0.2 * s], tm, { obj: oTail, tex: (p) => (Math.floor(p[2] / s * 2) % 2 === 0 ? -1 : 0) });
  if (kind === 'lion') R.ell([-bl * 1.2, tsw * 1.2, by - 5.8 * s], [1.3 * s, 1.3 * s, 2.2 * s], ax, mm, { obj: oTail, tex: (p) => (hash(p[0] * 1.4, p[1] * 1.4, p[2] * 1.4) > 0.5 ? -1 : 1) });   // tail tuft
  const nk0: V = [bl * 0.8, 0, by + (LN ? 0.6 : 1.2) * s];
  if (P.rider) {
    R.ell([bl * 0.8, 0, by + 1.6 * s], [2.6 * s, 3.1 * s, 2.3 * s], ax, cm, { obj: ob, shift: 0 });    // chest blends into the human torso
    humanoid(k, { ...P.rider, rig: R, upperOnly: { z: by + 1.1 * s, f: bl * 0.78 }, pose: P.rider.pose || name });
  } else {
    const nup = id > 0 ? 0.25 * br : 0; const nk1: V = kind === 'horse' ? [bl * 1.22, 0, by + 5.4 * s + nup * s] : [bl * (LN ? 1.12 : 1.18), 0, by + (LN ? 2.3 : 2.4) * s];
    R.limb(nk0, nk1, (LN ? 3.2 : 1.9) * s, (LN ? 2.3 : 1.15) * s, 0.3 * s, 0.4, cm, { obj: ob });
    if (kind === 'horse') R.tube([add(nk0, [-0.5 * s, 0, 2.0 * s]), add(nk1, [-0.9 * s, 0, 1.0 * s]), add(nk1, [-1.1 * s, 0, 0.2 * s])], [0.7 * s, 0.7 * s, 0.5 * s], mm, { obj: oHead, tex: (p) => (Math.floor(p[2] / s * 2) % 2 === 0 ? -1 : 0) });
    if (kind === 'lion') {   // v5 mane: a thick ruff BEHIND and below the face (never a ball over it), shaggy tufts, bare lighter face and muzzle in front
      const mc = add(nk1, [(LN ? -1.8 : -1.1) * s, 0, -0.1 * s]); const mtex: LTex = (p) => (hash(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3) > 0.55 ? -1 : (hash(p[0], p[1], p[2] + 9) > 0.8 ? 1 : 0));
      R.ell(mc, [(LN ? 3.4 : 2.4) * s, (LN ? 4.2 : 4.1) * s, (LN ? 5.0 : 4.4) * s], ax, mm, { obj: oHead, tex: mtex });
      R.ell(add(nk1, [0.0 * s, 0, -2.0 * s]), [2.4 * s, 3.2 * s, 2.2 * s], ax, mm, { obj: oHead, shift: -1, tex: mtex });
      R.ell(add(nk1, [-1.8 * s, 0, -2.4 * s]), [3.0 * s, 3.6 * s, 2.0 * s], ax, mm, { obj: ob, shift: -1, tex: mtex });   // chest ruff
      for (let i = 0; i < 9; i++) { const a2 = -150 + i * 37.5; R.cap(add(mc, [cosd(a2) * 0.4 * s, sind(a2) * 3.3 * s, cosd(a2 * 0.5) * 3.2 * s * (i % 2 ? 1 : 0.9)]), add(mc, [-1.0 * s, sind(a2) * 3.9 * s, cosd(a2 * 0.5) * 3.9 * s]), 0.7 * s, 0.25 * s, mm, { obj: oHead, shift: i % 2 ? -1 : 0 }); }
    }
    const mtex2: LTex = (p) => (hash(p[0] * 1.1, p[1] * 1.1, p[2] * 1.1 + 3) > 0.55 ? -1 : 0); const hc = add(nk1, [(kind === 'lion' ? 2.7 : 1.3) * s, 0, (kind === 'boar' ? -0.9 : kind === 'lion' ? -0.4 : 0.1) * s]);
    const fmat = kind === 'lion' ? 'limestone' : cm;   // lion face/muzzle lighter than the mane
    R.ell(hc, [(LN ? 2.3 : 1.6) * s, (LN ? 2.0 : 1.1) * s, (LN ? 1.9 : 1.2) * s], ax, fmat, { obj: oHead, tex: (p) => (p[0] > hc[0] + 0.2 * s && p[2] > hc[2] + 0.2 * s && Math.abs(Math.abs(p[1]) - 0.75 * s) < 0.3 * s ? ['black', 0] : 0) });
    R.cap(hc, add(hc, kind === 'horse' ? [2.4 * s, 0, -1.6 * s] : LN ? [3.0 * s, 0, -0.9 * s] : [1.7 * s, 0, -0.5 * s]), kind === 'horse' ? 0.95 * s : LN ? 1.5 * s : 0.85 * s, LN ? 0.95 * s : 0.7 * s, fmat, { obj: oHead, shift: -1 });
    if (kind === 'lion') { for (let i = 0; i < 0; i++) { const a3 = i * 25.7, c3 = cosd(a3), s3 = sind(a3), rr = i % 2 ? 4.5 : 4.0; R.cap(add(hc, [-0.9 * s, c3 * 2.6 * s, s3 * 2.5 * s]), add(hc, [-0.5 * s, c3 * rr * s, s3 * rr * 1.05 * s]), 1.15 * s, 0.5 * s, mm, { obj: oHead, shift: i % 2 ? -1 : 0, tex: mtex2 }); } R.sph(add(hc, [3.9 * s, 0, -0.65 * s]), 0.7 * s, 'black', { obj: oHead }); R.ell(add(hc, [-0.3 * s, 0, -1.8 * s]), [2.0 * s, 1.7 * s, 1.5 * s], ax, mm, { obj: oHead, shift: -1, tex: mtex2 }); R.ell(add(hc, [0.9 * s, 0, 0.85 * s]), [0.7 * s, 0.55 * s, 0.35 * s], ax, cm, { obj: oHead, shift: -1 }); }
    for (const sd of [-1, 1]) R.cap(add(hc, [-0.4 * s, sd * 0.5 * s, 0.8 * s]), add(hc, [-0.6 * s, sd * 0.8 * s, 2.0 * s]), 0.4 * s, 0.1 * s, cm, { obj: oHead });
    if (kind === 'bull' || kind === 'goat') for (const sd of [-1, 1]) { const b0 = add(hc, [0, sd * 0.8 * s, 0.7 * s]); const b1 = add(b0, [0.2 * s, sd * 1.5 * s, 0.6 * s]); R.tube([b0, b1, add(b1, [0.6 * s, sd * 0.3 * s, 1.0 * s])], [0.4 * s, 0.3 * s, 0.07 * s], 'bone', { obj: oHead }); }
    if (kind === 'boar') {   // v5: long wedge snout with a black disc nose, big curved tusks, and a bristle ridge of dark spikes along the spine
      R.cap(hc, add(hc, [2.6 * s, 0, -0.9 * s]), 1.0 * s, 0.85 * s, cm, { obj: oHead, shift: -1 });
      R.ell(add(hc, [2.75 * s, 0, -0.95 * s]), [0.45 * s, 0.9 * s, 0.8 * s], ax, 'black', { obj: oHead });
      for (const sd of [-1, 1]) {
        R.tube([add(hc, [1.7 * s, sd * 0.8 * s, -1.1 * s]), add(hc, [2.2 * s, sd * 1.15 * s, -0.5 * s]), add(hc, [2.1 * s, sd * 1.0 * s, 0.7 * s]), add(hc, [1.6 * s, sd * 0.7 * s, 1.3 * s])], [0.38 * s, 0.3 * s, 0.2 * s, 0.05 * s], 'bone', { obj: oHead, shift: 2 });
        R.cap(add(hc, [-0.2 * s, sd * 0.6 * s, 1.0 * s]), add(hc, [-0.7 * s, sd * 0.9 * s, 2.3 * s]), 0.5 * s, 0.1 * s, mm, { obj: oHead });
      }
      for (let i = 0; i < 11; i++) { const x = bl * 0.85 - i * (bl * 1.75) / 10; const zt2 = by + (3.3 - 0.9 * (i / 10)) * s + (i < 3 ? 0.3 * s : 0); R.cap([x, 0, zt2 - 0.6 * s], [x - 0.9 * s, 0, zt2 + 1.6 * s], 0.62 * s, 0.08 * s, mm, { obj: ob, shift: i % 2 ? 0 : -1 }); }
    }
  }
  R.emit(new Frame(P.at || [0, 0], fc, (P.at && P.at[2]) || 0));
}
export function centaur(k: Kit, P: { at?: number[]; facing?: number; colour?: string; pose?: string; upper?: HumanoidP } = {}): void {
  quadruped(k, { at: P.at, facing: P.facing, kind: 'horse', colour: P.colour || 'fur', pose: P.pose, rider: { ...(P.upper || {}), pose: P.pose } });
}

// ---------------- props ----------------
export function column(k: Kit, P: { at?: number[]; order?: string; height?: number; mat?: string; broken?: boolean } = {}): void {
  const at = P.at || [0, 0]; const m = mat(P.mat || 'marble'); const Hh = P.height || 26; const ion = (P.order || 'doric') === 'ionic';
  const u = at[0], v = at[1]; const b = (z: number): V => [u, v, z];
  k.ibox([u - 5.2, v - 5.2, 0], [u + 5.2, v + 5.2, 1.2], m, { shift: -1 }); k.ibox([u - 4.4, v - 4.4, 1.2], [u + 4.4, v + 4.4, 2.3], m);
  const top = P.broken ? Hh * 0.6 : Hh;
  const nfl = ion ? 16 : 12; const flutes: Tex = (p) => { const a = atan2d(p[1] - v, p[0] - u); const f = ((a + 360) * nfl / 360) % 1; return f < 0.28 ? -1 : (f > 0.85 ? 1 : 0); };
  const r0 = ion ? 2.6 : 3.1, r1 = ion ? 2.25 : 2.55; const capH = ion ? 4.0 : 3.0;
  let z0 = 2.3;
  if (ion) { k.ilathe(b(0), [[2.3, 3.5], [2.9, 3.6], [3.3, 3.0], [3.7, 3.1], [4.1, 2.8]], m); z0 = 4.1; }
  const sh = top - (P.broken ? 0 : capH);
  k.ilathe(b(0), [[z0, r0], [z0 + (sh - z0) * 0.35, r0 * 1.02], [sh, r1]], m, { tex: flutes });
  if (P.broken) { k.solid(S.inter(S.cyl(b(sh - 0.1), b(sh + 1.6), r1), S.half([u, v, sh + 0.6], [0.5, -0.3, 1])), m, { tex: flutes }); return; }
  if (ion) {
    k.ilathe(b(0), [[sh, r1 * 1.05], [sh + 0.6, r1 * 1.35], [sh + 1.2, r1 * 1.3]], m, { tex: (p) => (Math.floor(((atan2d(p[1] - v, p[0] - u) + 360) / 25)) % 2 === 0 ? -1 : 0) });
    const zc = sh + 1.4; const sp = (p: V, cu: number): TexOut => { const dv = p[1] - cu, dz = p[2] - zc; const r = Math.sqrt(dv * dv + dz * dz); const a = atan2d(dz, dv) / 360; return r < 0.45 ? -4 : ((((r / 0.62 - a + 10) % 1) < 0.4) ? -4 : 0); };
    for (const s of [-1, 1]) {
      const cv = v + s * 3.1;
      k.icyl([u - 3.2, cv, zc], [u + 3.2, cv, zc], 1.75, 1.75, m, { tex: (p) => (p[0] > u + 3.05 || p[0] < u - 3.05 ? sp(p, cv) : (Math.abs(p[0] - u) < 0.6 ? -2 : 0)) });
    }
    k.ibox([u - 2.8, v - 3.1, zc - 0.6], [u + 2.8, v + 3.1, zc + 1.75], m, { shift: 0 });
    k.ibox([u - 3.6, v - 4.2, top - 0.8], [u + 3.6, v + 4.2, top], m, { shift: 1 });
  } else {
    k.ilathe(b(0), [[sh, r1], [sh + 0.4, r1 * 1.05], [sh + 1.5, r1 * 1.45]], m);
    k.ibox([u - 3.9, v - 3.9, sh + 1.5], [u + 3.9, v + 3.9, top], m, { shift: 1 });
  }
}
// black-figure painting: silhouettes drawn in panel units (x across, y up) and mapped round the vase
type Sil = (x: number, y: number) => boolean;
const dseg = (x: number, y: number, x0: number, y0: number, x1: number, y1: number): number => {
  const dx = x1 - x0, dy = y1 - y0; const t = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1e-9), 0, 1);
  const ex = x - (x0 + dx * t), ey = y - (y0 + dy * t); return Math.sqrt(ex * ex + ey * ey) - 0.16;
};
const sdisc = (x: number, y: number, cx: number, cy: number, r: number): boolean => (x - cx) * (x - cx) + (y - cy) * (y - cy) < (r + 0.16) * (r + 0.16);
const sell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean => (x - cx) * (x - cx) / ((rx + 0.16) * (rx + 0.16)) + (y - cy) * (y - cy) / ((ry + 0.16) * (ry + 0.16)) < 1;
// warrior facing +x, base at (0,0), about 6.4 tall: crested helmet, round shield, spear, striding legs
const warriorSil = (x: number, y: number): boolean => {
  if (sdisc(x, y, 0.1, 5.6, 0.42)) return true;                                     // head
  if (dseg(x, y, 0.0, 6.0, -0.75, 5.85) < 0.12 || dseg(x, y, -0.75, 5.85, -0.9, 5.2) < 0.1) return true;     // crest
  if (dseg(x, y, 0.0, 5.2, -0.1, 3.6) < 0.5) return true;                           // torso
  if (dseg(x, y, -0.45, 3.7, 0.55, 3.7) < 0.2 && y < 3.9 && y > 3.0) return true;  // skirt / belt
  if (dseg(x, y, 0.0, 3.4, 0.7, 1.9) < 0.26 || dseg(x, y, 0.7, 1.9, 0.75, 0.0) < 0.22) return true;           // front leg
  if (dseg(x, y, -0.1, 3.4, -0.75, 1.9) < 0.26 || dseg(x, y, -0.75, 1.9, -1.1, 0.0) < 0.22) return true;     // back leg
  if (sdisc(x, y, 0.6, 4.2, 0.7)) return true;                                      // shield
  if (dseg(x, y, -1.3, 0.2, 0.3, 6.6) < 0.09 || dseg(x, y, 0.3, 6.6, 0.45, 7.1) < 0.18 && y > 6.5) return true;   // spear
  if (dseg(x, y, 0.1, 4.7, -0.5, 4.1) < 0.2) return true;                           // arm
  return false;
};
const horseSil = (x: number, y: number): boolean => {   // facing +x, base at 0, about 5.5 tall at the head
  if (sell(x, y, 0, 3.0, 1.8, 0.8)) return true;                                       // barrel
  if (sell(x, y, 1.2, 3.2, 0.8, 0.85) || sell(x, y, -1.2, 3.1, 0.8, 0.85)) return true;   // chest, rump
  if (dseg(x, y, 1.3, 3.5, 2.0, 4.9) < 0.38) return true;                                // neck
  if (dseg(x, y, 2.0, 4.95, 2.9, 4.45) < 0.3 || sdisc(x, y, 2.0, 4.95, 0.42)) return true;   // head
  if (dseg(x, y, 1.9, 5.3, 1.75, 5.7) < 0.1) return true;                               // ear
  if (dseg(x, y, 1.1, 2.7, 1.5, 0.0) < 0.17 || dseg(x, y, 0.8, 2.7, 0.55, 0.0) < 0.17) return true;   // forelegs
  if (dseg(x, y, -1.1, 2.7, -0.7, 1.3) < 0.2 || dseg(x, y, -0.7, 1.3, -1.2, 0.0) < 0.15) return true;  // hind legs
  if (dseg(x, y, -1.5, 2.7, -0.9, 1.4) < 0.17 && x < -0.6) return true;
  if (dseg(x, y, -1.8, 3.5, -2.5, 2.4) < 0.15 || dseg(x, y, -2.5, 2.4, -2.6, 1.2) < 0.1) return true; // tail
  if (dseg(x, y, 1.4, 3.7, 1.75, 5.0) < 0.15 && x < 1.55) return true;                  // mane
  return false;
};
const riderSil = (x: number, y: number): boolean => horseSil(x, y)
  || dseg(x, y, 0.2, 3.7, 0.3, 5.5) < 0.38 || sdisc(x, y, 0.35, 5.95, 0.4) || dseg(x, y, 0.3, 5.0, 1.3, 4.5) < 0.14
  || dseg(x, y, -0.3, 5.6, 2.3, 7.1) < 0.07;
const mirror = (f: Sil): Sil => (x, y) => f(-x, y);
const at2 = (f: Sil, cx: number, sc: number): Sil => (x, y) => f((x - cx) / sc, y / sc);
function figurePanel(kind: string): Sil {
  if (kind === 'horses') return (x, y) => at2(horseSil, -2.6, 0.95)(x, y) || at2(mirror(horseSil), 2.6, 0.95)(x, y) || (x > -0.4 && x < 0.4 && y < 4 && (sell(x, y, 0, 3.3, 0.3, 0.8) || dseg(x, y, 0, 0, 0, 2.5) < 0.08));
  if (kind === 'rider') return (x, y) => at2(riderSil, -1.2, 1.0)(x, y) || at2(mirror(warriorSil), 3.8, 0.85)(x, y);
  return (x, y) => at2(warriorSil, -2.8, 1.0)(x, y) || at2(mirror(warriorSil), 2.8, 1.0)(x, y);   // 'warriors' (duel)
}
function meander(u: number, v: number): boolean {   // Greek key in one cell, u,v in 0..1
  if (v < 0.16 || v > 0.84) return true;
  if (u < 0.14) return true;
  if (v > 0.62 && u < 0.7) return true;
  if (u > 0.56 && u < 0.7 && v > 0.32) return true;
  if (v > 0.32 && v < 0.46 && u > 0.28 && u < 0.7) return true;
  if (u > 0.28 && u < 0.42 && v > 0.32 && v < 0.6) return true;
  return false;
}
function palmette(u: number, v: number): boolean {   // fan of petals on a stem, u,v in 0..1
  const dx = u - 0.5, dy = v - 0.08; const r = Math.sqrt(dx * dx + dy * dy); if (Math.abs(dx) < 0.05 && v < 0.3) return true;
  const a = atan2d(dx, dy); if (r > 0.12 && r < 0.92 && Math.abs(a) < 64) { const f = ((a + 64) / 16) % 1; return f < 0.6; } return false;
}
export function amphora(k: Kit, P: { at?: number[]; height?: number; style?: string; mat?: string; figure?: string; border?: string } = {}): void {
  const at = P.at || [0, 0]; const s = (P.height || 26) / 16; const u = at[0], v = at[1]; const style = P.style || 'black-figure';
  const base = mat(P.mat || 'terracotta'); const dark = 'black'; const panel = figurePanel(P.figure || 'warriors'); const bord = P.border || 'meander';
  const prof = [[0, 1.9], [0.7, 1.9], [1.0, 1.2], [2.0, 2.2], [4.2, 4.0], [6.5, 4.7], [8.6, 4.5], [10.6, 3.5], [12.2, 2.0], [13.0, 1.6], [14.8, 1.55], [15.2, 2.1], [16, 2.1]].map((q) => [q[0] * s, q[1] * s]);
  const tex: Tex = (p) => {
    const z = p[2] / s; const a = (atan2d(p[1] - v, p[0] - u) + 360) % 360;
    if (z < 1.05 || z > 15.0) return [dark, 0];
    if (z > 13.0 && z < 14.8) { const c = (a * 11 / 360) % 1; return meander(c, (z - 13.0) / 1.8) && bord !== 'none' ? [dark, 0] : 0; }
    if (z > 12.0 && z < 12.3) return [dark, 0];
    if (z > 10.2 && z < 12.0) { const c = (a * 14 / 360) % 1; const vv = (z - 10.2) / 1.8; return (bord === 'palmette' ? palmette(c, vv) : (z < 11.0 ? meander(c, (z - 10.2) / 0.8) : false)) ? [dark, 0] : 0; }
    if (z > 9.8 && z < 10.2) return [dark, 0];
    if (z > 3.0 && z < 3.4) return [dark, 0];
    if (z > 1.1 && z < 3.0) return Math.floor(a / 15) % 2 === 0 ? [dark, 0] : 0;
    if (z >= 3.7 && z <= 9.7) {
      let da = a - 45; if (da > 180) da -= 360; if (da < -180) da += 360;
      const x = da * 0.0175 * 4.3; const y = (z - 4.2) * 1.2;
      const inside = Math.abs(da) < 75 && panel(x * 1.0, y);
      if (style === 'red-figure') return inside ? 1 : [dark, -3];
      return inside ? [dark, -3] : 1;
    }
    return style === 'red-figure' ? [dark, 0] : 0;
  };
  k.ilathe([u, v, 0], prof, base, { tex });
  const o = k.obj();
  for (const sd of [-1, 1]) {
    const dir = norm([sd, -sd, 0]); const a: V = [u + dir[0] * 1.5 * s, v + dir[1] * 1.5 * s, 14.2 * s];
    const m1: V = [u + dir[0] * 3.3 * s, v + dir[1] * 3.3 * s, 14.4 * s]; const e: V = [u + dir[0] * 3.3 * s, v + dir[1] * 3.3 * s, 10.8 * s];
    k.icapsule(a, m1, 0.45 * s, 0.45 * s, base, { obj: o, shift: -1 }); k.icapsule(m1, e, 0.45 * s, 0.5 * s, base, { obj: o, shift: -1 });
  }
}
export function brazier(k: Kit, P: { at?: number[]; height?: number; mat?: string; fire?: boolean } = {}): void {
  const at = P.at || [0, 0]; const s = (P.height || 11) / 11; const u = at[0], v = at[1]; const m = mat(P.mat || 'bronze'); const zt = 8.4 * s;
  const ol = k.obj();
  for (let i = 0; i < 3; i++) {
    const a = 45 + i * 120; const top: V = [u + cosd(a) * 2.6 * s, v + sind(a) * 2.6 * s, zt - 0.8 * s]; const mid: V = [u + cosd(a) * 3.2 * s, v + sind(a) * 3.2 * s, 3.5 * s];
    const ft: V = [u + cosd(a) * 4.1 * s, v + sind(a) * 4.1 * s, 0.6 * s];
    k.icapsule(top, mid, 0.42 * s, 0.38 * s, m, { obj: ol }); k.icapsule(mid, ft, 0.38 * s, 0.45 * s, m, { obj: ol });
    k.isphere([ft[0], ft[1], 0.6 * s], 0.7 * s, m, { obj: ol, shift: -1 });
  }
  k.iring([u, v, 3.6 * s], [0, 0, 1], 3.1 * s, 0.25 * s, m, { obj: ol, shift: -1 });
  k.ilathe([u, v, 0], [[zt - 1.6 * s, 1.2 * s], [zt - 1.0 * s, 3.2 * s], [zt - 0.2 * s, 4.3 * s], [zt + 0.4 * s, 4.6 * s]], m, { tex: (p) => (Math.floor((atan2d(p[1] - v, p[0] - u) + 360) / 30) % 2 === 0 && p[2] > zt - 0.6 * s ? -1 : 0) });
  k.iring([u, v, zt + 0.4 * s], [0, 0, 1], 4.5 * s, 0.38 * s, m, { shift: 1 });
  k.ilathe([u, v, 0], [[zt, 3.9 * s], [zt + 0.5 * s, 3.6 * s]], 'black', { shift: 1, tex: (p) => (hash(p[0], p[1]) > 0.6 ? ['fire', -3] : 0) });
  if (P.fire !== false) {
    const of = k.obj();
    k.solid(S.smooth(0.8 * s, S.capsule([u, v, zt + 0.8 * s], [u, v, zt + 6.6 * s], 2.6 * s, 0.2 * s), S.capsule([u + 1.6 * s, v - 0.6 * s, zt + 0.6 * s], [u + 1.0 * s, v - 1.3 * s, zt + 4.4 * s], 1.4 * s, 0.15 * s),
      S.capsule([u - 1.0 * s, v + 1.7 * s, zt + 0.6 * s], [u - 1.3 * s, v + 1.2 * s, zt + 4.8 * s], 1.4 * s, 0.15 * s), S.capsule([u - 1.4 * s, v - 1.2 * s, zt + 0.6 * s], [u - 1.9 * s, v - 1.6 * s, zt + 3.6 * s], 1.2 * s, 0.15 * s)), 'fire', { obj: of, glow: true });
    for (const q of [[0.6, 0.4, 9.2], [-1.4, -0.4, 10.6], [1.2, -1.6, 11.6]]) k.isphere([u + q[0] * s, v + q[1] * s, zt + (q[2] - 8.4) * s + 1.5 * s], 0.32 * s, 'fire', { obj: of, glow: true });
  }
}
export function altar(k: Kit, P: { at?: number[]; w?: number; h?: number; mat?: string; fire?: boolean } = {}): void {
  const at = P.at || [0, 0]; const w = (P.w || 9) / 2, hh = P.h || 7; const m = mat(P.mat || 'marble'); const u = at[0], v = at[1];
  k.ibox([u - w - 0.8, v - w * 0.7 - 0.8, 0], [u + w + 0.8, v + w * 0.7 + 0.8, 1.0], m, { shift: -1 });
  k.ibox([u - w, v - w * 0.7, 1.0], [u + w, v + w * 0.7, hh - 1.2], m, { tex: (p) => (Math.abs(p[2] - (hh * 0.55)) < 0.9 && (Math.floor((p[0] + p[1]) / 1.3) % 2 === 0) ? -1 : 0) });
  k.ibox([u - w - 0.6, v - w * 0.7 - 0.6, hh - 1.2], [u + w + 0.6, v + w * 0.7 + 0.6, hh], m, { shift: 1 });
  for (const sx of [-1, 1]) k.icapsule([u + sx * (w - 0.2), v - w * 0.7, hh + 0.4], [u + sx * (w - 0.2), v + w * 0.7, hh + 0.4], 0.6, 0.6, m, { shift: 1 });
  if (P.fire) k.solid(S.capsule([u, v, hh + 0.5], [u, v, hh + 5], 1.8, 0.2), 'fire', { glow: true });
}
export function statueBase(k: Kit, P: { at?: number[]; w?: number; h?: number; mat?: string } = {}): number {
  const at = P.at || [0, 0]; const w = (P.w || 8) / 2, hh = P.h || 4; const m = mat(P.mat || 'marble'); const u = at[0], v = at[1];
  k.ibox([u - w - 0.8, v - w - 0.8, 0], [u + w + 0.8, v + w + 0.8, 0.9], m, { shift: -1 });
  k.ibox([u - w, v - w, 0.9], [u + w, v + w, hh - 0.7], m, { tex: (p) => (Math.abs(p[2] - hh * 0.5) < 0.35 && Math.abs(p[1] - v) < w * 0.6 && Math.floor(p[1] * 2) % 2 === 0 ? -3 : 0) });
  k.ibox([u - w - 0.5, v - w - 0.5, hh - 0.7], [u + w + 0.5, v + w + 0.5, hh], m, { shift: 1 });
  return hh;   // top height: stand a figure at z = hh with new Frame(at, facing, hh) ... or humanoid({at, ...}) then raise via k parts
}

// ---------------- buildings: temple, house, lampstand, wall, stall ----------------
// Each builder works in a local frame (x = towards the building's front, y = across it, z up) at the origin, then
// placeScaled() scales the whole build uniformly and moves it to `at`. The local frame is either the world (front faces +u)
// or the world mirrored on the u=v diagonal (front faces +v); both keep the two faces the camera sees on +x and +y.
type LTex = (p: V) => TexOut;
type LOpts = { obj?: number; shift?: number; tex?: LTex; glow?: boolean };
class Site {
  k: Kit; sw: boolean;
  constructor(k: Kit, front?: string) { this.k = k; this.sw = front === 'v'; }
  P(x: number, y: number, z: number): V { return this.sw ? [y, x, z] : [x, y, z]; }
  L(p: V): V { return this.sw ? [p[1], p[0], p[2]] : [p[0], p[1], p[2]]; }
  o(o: LOpts): Opts { const t = o.tex; return { obj: o.obj, shift: o.shift, glow: o.glow, tex: t ? ((p: V) => t(this.L(p))) : undefined }; }
  sbox(lo: V, hi: V, r = 0): Shape { const a = this.P(lo[0], lo[1], lo[2]), b = this.P(hi[0], hi[1], hi[2]); return S.box([Math.min(a[0], b[0]), Math.min(a[1], b[1]), a[2]], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), b[2]], r); }
  scyl(a: V, b: V, r1: number, r2?: number): Shape { return S.cyl(this.P(a[0], a[1], a[2]), this.P(b[0], b[1], b[2]), r1, r2); }
  scap(a: V, b: V, r1: number, r2?: number): Shape { return S.capsule(this.P(a[0], a[1], a[2]), this.P(b[0], b[1], b[2]), r1, r2); }
  splate(pts: V[], th: number): Shape { return S.plate(pts.map((q) => this.P(q[0], q[1], q[2])), th); }
  solid(s: Shape, m: string, o: LOpts = {}): number { return this.k.solid(s, m, this.o(o)); }
  box(lo: V, hi: V, m: string, o: LOpts = {}, r = 0): number { return this.solid(this.sbox(lo, hi, r), m, o); }
  cyl(a: V, b: V, r1: number, r2: number | undefined, m: string, o: LOpts = {}): number { return this.solid(this.scyl(a, b, r1, r2), m, o); }
  cap(a: V, b: V, r1: number, r2: number | undefined, m: string, o: LOpts = {}): number { return this.solid(this.scap(a, b, r1, r2), m, o); }
  sph(c: V, r: number, m: string, o: LOpts = {}): number { return this.solid(S.sphere(this.P(c[0], c[1], c[2]), r), m, o); }
  ell(c: V, r: V, m: string, o: LOpts = {}): number { return this.solid(S.ellipsoid(this.P(c[0], c[1], c[2]), this.sw ? [r[1], r[0], r[2]] : r), m, o); }
  lathe(c: V, prof: number[][], m: string, o: LOpts = {}): number { return this.solid(S.lathe(this.P(c[0], c[1], c[2]), prof), m, o); }
  plate(pts: V[], th: number, m: string, o: LOpts = {}): number { return this.solid(this.splate(pts, th), m, o); }
  ring(c: V, n: V, R: number, r: number, m: string, o: LOpts = {}): number { return this.solid(S.ring(this.P(c[0], c[1], c[2]), this.P(n[0], n[1], n[2]), R, r), m, o); }
}
// scale every part added by fn() about the origin by s, then move it to `at` (shapes, textures and bounds together)
function placeScaled(k: Kit, s: number, at: number[] | undefined, fn: () => void): void {
  const n0 = k.parts.length; fn();
  const ou = (at && at[0]) || 0, ov = (at && at[1]) || 0, oz = (at && at[2]) || 0;
  if (s === 1 && ou === 0 && ov === 0 && oz === 0) return;
  const fw = (p: V): V => [ou + p[0] * s, ov + p[1] * s, oz + p[2] * s];
  for (let i = n0; i < k.parts.length; i++) {
    const P = k.parts[i]; const s0 = P.s; const t0 = P.tex;
    const f = (x: number, y: number, z: number): number => s0.f((x - ou) / s, (y - ov) / s, (z - oz) / s) * s;
    k.parts[i] = { ...P, s: { f, lo: fw(s0.lo), hi: fw(s0.hi), lip: s0.lip }, tex: t0 ? ((p: V) => t0([(p[0] - ou) / s, (p[1] - ov) / s, (p[2] - oz) / s])) : null, c: fw(P.c), R: P.R * s };
  }
}
const fr = (x: number): number => x - Math.floor(x);
// which face of an axis-aligned local box a surface point lies on: 0/1 = -x/+x, 2/3 = -y/+y, 4/5 = bottom/top
function faceOf(p: V, lo: V, hi: V): number {
  const d = [p[0] - lo[0], hi[0] - p[0], p[1] - lo[1], hi[1] - p[1], p[2] - lo[2], hi[2] - p[2]];
  let b = 0; for (let i = 1; i < 6; i++) if (Math.abs(d[i]) < Math.abs(d[b])) b = i; return b;
}
// ashlar masonry on a local box: courses ch high, blocks bw long, staggered; mortar joints jw thick (dark), per-block tone variation,
// optional damp/weed band at the foot (foot = [material, height]).
function ashlar(lo: V, hi: V, ch: number, bw: number, jw: number, seed = 0, foot?: [string, number]): LTex {
  return (p) => {
    const f = faceOf(p, lo, hi); const z = p[2] - lo[2];
    if (f >= 4) {   // top: paving grid
      const gx = (p[0] - lo[0]) / bw, gy = (p[1] - lo[1]) / (bw * 0.75);
      if (fr(gx) * bw < jw || fr(gy) * bw * 0.75 < jw) return -1;
      const h = hash(Math.floor(gx), Math.floor(gy), seed); return h > 0.86 ? -1 : (h < 0.1 ? 1 : 0);
    }
    const a = f < 2 ? p[1] - lo[1] : p[0] - lo[0];
    const c = Math.floor(z / ch); const off = (c % 2) * bw * 0.5 + hash(c, seed, 3) * bw * 0.3;
    const bi = Math.floor((a + off) / bw);
    if (foot && z < foot[1] && hash(Math.floor(a * 1.3), Math.floor(z * 1.6), seed + 9) > 0.35 + z / foot[1] * 0.5) return [foot[0], -1];
    if (fr(z / ch) * ch < jw * 1.1 || fr((a + off) / bw) * bw < jw) return -2;
    const h = hash(bi, c, seed + 1); return h > 0.84 ? -1 : (h < 0.12 ? 1 : 0);
  };
}
const shade = (t: LTex, d: number): LTex => (p) => { const q = t(p); if (q === null) return d; if (typeof q === 'number') return q + d; return [q[0], q[1] + d]; };

// ---------------- temple ----------------
export type TempleP = { at?: number[]; order?: string; cols?: number; depth?: number; mat?: string; roof?: string; ruined?: boolean; setting?: string; front?: string };
// Peripteral temple: three-step krepidoma, peristyle of column() builders, cella with a framed bronze door, architrave,
// frieze (doric triglyphs and metopes, or an ionic sculpted frieze with dentils), cornice, a sculpted pediment on the front,
// a tiled gable roof with cover-tile ribs, antefixes and akroteria. ruined:true drops the roof, breaks columns and scatters drums.
export function temple(k: Kit, P: TempleP = {}): void {
  const th = theme(P.setting); const m = mat(P.mat || th.stone); const ion = P.order === 'ionic';
  const nc = Math.max(2, Math.min(8, Math.round(P.cols || 4))); const nd = Math.max(2, Math.min(12, Math.round(P.depth || nc + 1)));
  const ruin = !!P.ruined; const rm = mat(P.roof === 'marble' ? m : (P.roof || 'terracotta'));
  const paint = th.cloth2, accent = th.accent;
  const s = Math.min(0.48, 3.95 / (nc + nd)) * (ruin ? 0.92 : 1);
  const K = new Site(k, P.front);
  placeScaled(k, s, P.at, () => {
    const sp = 13; const Hc = ion ? 36 : 33;
    const cx = (nd - 1) / 2 * sp, cy = (nc - 1) / 2 * sp;         // column centre lines
    // krepidoma: three steps
    const st = 1.9, tr = 2.6; let z = 0; const X0 = cx + 7.2, Y0 = cy + 7.2;
    for (let i = 0; i < 3; i++) {
      const e = (2 - i) * tr; const lo: V = [-X0 - e, -Y0 - e, z], hi: V = [X0 + e, Y0 + e, z + st];
      const at = ashlar(lo, hi, st, 6.5, 0.7, 11 + i, ruin ? ['olive', 0.6] : undefined);
      K.box(lo, hi, m, { shift: i - 2, tex: ruin ? ((p) => (p[2] > hi[2] - 0.05 && hash(Math.floor(p[0] / 1.6), Math.floor(p[1] / 1.6), 21 + i) > 0.8 ? ['olive', 1] : at(p))) : at });
      z += st;
    }
    const z0 = z;
    // cella: shaded walls inside the colonnade, framed doorway on the front
    const cxf = cx - sp * 0.85, cxb = -cx + 4.5, cyw = Math.max(cy - 6.2, 5.5); const zc = z0 + Hc;
    const clo: V = [cxb, -cyw, z0], chi: V = [cxf, cyw, ruin ? z0 + Hc * 0.55 : zc];
    const cellaT = ashlar(clo, chi, 3.2, 7, 0.75, 5, ruin ? ['olive', 2.5] : undefined);
    if (ruin) {
      const bite = S.union(K.sbox([cxb - 1, -cyw - 1, z0 + Hc * 0.32], [cxb + (cxf - cxb) * 0.45, cyw + 1, zc]), K.sbox([cxb + (cxf - cxb) * 0.45 - 1, cyw * 0.1, z0 + Hc * 0.45], [cxf + 1, cyw + 1, zc]));
      K.solid(S.sub(K.sbox(clo, chi), bite), m, { shift: -2, tex: cellaT });
    } else K.box(clo, chi, m, { shift: -2, tex: cellaT });
    const dw = Math.min(cyw * 0.42, 5), dh = Hc * 0.62;
    K.box([cxf - 0.2, -dw - 1.3, z0], [cxf + 0.7, dw + 1.3, z0 + dh + 1.3], m, { shift: 1 });                           // door frame
    K.box([cxf + 0.4, -dw, z0], [cxf + 0.9, dw, z0 + dh], 'black', { shift: 1 });                                        // dark doorway
    for (const sd of [-1, 1]) K.box([cxf + 0.6, sd < 0 ? -dw : dw * 0.15, z0], [cxf + 1.0, sd < 0 ? -dw * 0.15 : dw, z0 + dh - 0.4], 'bronze', { shift: -1, tex: (p) => (Math.abs(fr(p[2] / (dh / 4)) - 0.5) < 0.08 ? -2 : (Math.abs(p[1] - sd * dw * 0.57) < 0.35 && Math.abs(p[2] - z0 - dh * 0.5) < 0.5 ? 2 : 0)) });
    // peristyle
    const ok: boolean[] = [];
    const ci = (i: number, j: number): number => i * 100 + j;
    for (let i = 0; i < nd; i++) for (let j = 0; j < nc; j++) {
      if (i > 0 && i < nd - 1 && j > 0 && j < nc - 1) continue;
      const x = -cx + i * sp, y = -cy + j * sp;
      let h = Hc, br = false;
      if (ruin) { const q = hash(i, j, 7); if (q < 0.45 && !(i === nd - 1 && (j === 0 || j === 1))) { br = true; h = Hc * (0.35 + q * 1.6) / 0.6; } }
      ok[ci(i, j)] = !br;
      const w = K.P(x, y, z0); const n1 = k.parts.length;
      column(k, { at: [w[0], w[1]], order: ion ? 'ionic' : 'doric', height: Math.min(h, Hc), mat: m, broken: br });
      for (let q = n1; q < k.parts.length; q++) { const pr = k.parts[q]; const s0 = pr.s; const t0 = pr.tex;
        k.parts[q] = { ...pr, s: { f: (a, b, c) => s0.f(a, b, c - z0), lo: [s0.lo[0], s0.lo[1], s0.lo[2] + z0], hi: [s0.hi[0], s0.hi[1], s0.hi[2] + z0], lip: s0.lip }, tex: t0 ? ((p: V) => t0([p[0], p[1], p[2] - z0])) : null, c: [pr.c[0], pr.c[1], pr.c[2] + z0] }; }
    }
    // entablature: architrave, frieze, cornice
    const ex = cx + 4.4, ey = cy + 4.4; const ha = 3.4, hf = 3.6, hk = 1.6;
    const za = zc, zf = zc + ha, zk = zf + hf, zt = zk + hk;
    const spans: [number, number][] = [];
    if (ruin) {   // only runs of standing front columns keep their architrave
      let j0 = -1; for (let j = 0; j <= nc; j++) { const up = j < nc && ok[ci(nd - 1, j)]; if (up && j0 < 0) j0 = j; if (!up && j0 >= 0) { if (j - j0 >= 2) spans.push([j0, j - 1]); j0 = -1; } }
    }
    const archT = (lo: V, hi: V): LTex => (p) => {
      const zz = p[2] - za; const fc = faceOf(p, lo, hi); if (fc >= 4) return 0;
      if (ion) return (Math.abs(zz - ha / 3) < 0.35 || Math.abs(zz - ha * 2 / 3) < 0.35) ? -1 : (zz > ha * 0.66 ? 1 : 0);
      return zz > ha - 0.7 ? [accent, 0] : (zz < 0.5 ? -1 : 0);
    };
    const friezeT = (lo: V, hi: V): LTex => (p) => {
      const fc = faceOf(p, lo, hi); if (fc >= 4) return 0; const a = fc < 2 ? p[1] : p[0]; const zz = p[2] - zf;
      if (ion) {   // sculpted procession on a painted ground
        const q = fr((a + 40) / 3.2); const fig = Math.abs(q - 0.5) < 0.2 && zz > 0.5 && zz < hf - 0.5 && !(zz > hf - 1.4 && Math.abs(q - 0.5) > 0.11);
        return fig ? 1 : [paint, -1];
      }
      const q = fr((a + sp * 40) / (sp / 2)); const tw = 0.21;   // triglyph centred on each column and mid-span
      if (q < tw || q > 1 - tw) { const g = fr(q * 1 / (tw * 2 / 3) + 0.5); return [paint, (g < 0.3 ? -3 : -1)]; }
      return zz < 0.4 ? -1 : 1;
    };
    const ent = (lo: V, hi: V): void => {
      K.box([lo[0], lo[1], za], [hi[0], hi[1], zf], m, { tex: archT([lo[0], lo[1], za], [hi[0], hi[1], zf]) });
      K.box([lo[0], lo[1], zf], [hi[0], hi[1], zk], m, { tex: friezeT([lo[0], lo[1], zf], [hi[0], hi[1], zk]) });
      const klo: V = [lo[0] - 0.9, lo[1] - 0.9, zk], khi: V = [hi[0] + 0.9, hi[1] + 0.9, zt];
      K.box(klo, khi, m, { shift: 1, tex: (p) => { const fc = faceOf(p, klo, khi); if (fc >= 4) return 0; const a = fc < 2 ? p[1] : p[0]; return (p[2] - zk < 0.55 && (ion ? fr(a / 1.3) < 0.45 : fr(a / (sp / 2) + 0.5) < 0.2)) ? -3 : 0; } });
    };
    if (!ruin) ent([-ex, -ey, 0], [ex, ey, 0]);
    else for (const sp2 of spans) ent([cx - 4.4, -cy + sp2[0] * sp - 4.4, 0], [cx + 4.4, -cy + sp2[1] * sp + 4.4, 0]);
    if (ruin) {
      // fallen drums and blocks on the steps and ground
      const ge = 2 * tr + 3.4;   // just beyond the bottom step
      const fd = [[X0 + ge, -cy * 0.25, 0, 90], [cx * 0.25, Y0 + ge, 0, 8], [-cx * 0.45, Y0 + ge - 0.4, 0, -20], [cx - sp * 0.5, -cy + sp * 0.5, z0, 75]];
      for (const d of fd) {
        const a = d[3]; const c: V = [d[0], d[1], d[2] + 3.0]; const dir: V = [cosd(a) * 2.9, sind(a) * 2.9, 0];
        K.cyl([c[0] - dir[0], c[1] - dir[1], c[2]], [c[0] + dir[0], c[1] + dir[1], c[2]], 3.0, 3.0, m, { shift: -1,
          tex: (p) => { const q: V = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; const along = q[0] * cosd(a) + q[1] * sind(a); const ac = q[0] * -sind(a) + q[1] * cosd(a);
            if (Math.abs(along) > 2.6) return hash(Math.floor(ac * 1.5), Math.floor(q[2] * 1.5), 2) > 0.7 ? -1 : 1;   // broken ends
            return fr((atan2d(q[2], ac) + 360) / 30) < 0.3 ? -1 : (q[2] > 1.8 && hash(Math.floor(along), Math.floor(ac), 5) > 0.7 ? ['olive', 0] : 0); } });
      }
      K.box([X0 + 2, Y0 * 0.25, 2 * st], [X0 + 7.2, Y0 * 0.25 + 6, 2 * st + 3.4], m, { shift: -1, tex: (p) => (p[2] > 2 * st + 2.6 ? 1 : (hash(Math.floor(p[1]), Math.floor(p[2] * 2), 4) > 0.8 ? ['olive', 0] : 0)) });   // fallen capital
      for (const b of [[X0 + 4.5, -Y0 - 2.5, 1.5], [-X0 * 0.4, Y0 + 5.2, 1.4], [X0 + 3.5, Y0 + 3.5, 1.5]]) {   // weeds in the cracks
        const sc = b[2]; const o2 = k.obj();
        for (const q of [[0, 0, 2.2, 2.6], [1.6, 1.2, 1.4, 1.9], [-1.4, 1.0, 1.2, 1.7], [0.4, -1.6, 1.2, 1.6]]) K.sph([b[0] + q[0] * sc, b[1] + q[1] * sc, q[2] * sc], q[3] * sc, q[0] === 0 ? 'olive' : 'laurel', { obj: o2, tex: (p) => (hash(Math.floor(p[0] * 2), Math.floor(p[1] * 2), Math.floor(p[2] * 2)) > 0.7 ? -1 : 0) });
      }
      return;
    }
    // pediment on the front (+x) and roof
    const pitch = 0.52; const eY = ey + 1.6; const hp = eY * pitch; const xr0 = -ex - 1.4, xr1 = ex + 1.4;
    const fx = ex + 0.1;   // tympanum plane, set back from the raking cornice
    K.plate([[fx, -ey + 0.4, zt], [fx, ey - 0.4, zt], [fx, 0, zt + (ey - 0.4) * pitch]], 1.0, paint, { shift: -1 });
    // pediment sculpture: a standing god in the middle, figures diminishing to reclining ones in the corners
    const so = k.obj();
    const figs = [0, 0.2, 0.38, 0.56, 0.78];
    for (const fy of figs) for (const sd of (fy === 0 ? [1] : [-1, 1])) {
      const y = sd * fy * ey; const room = (ey - Math.abs(y)) * pitch * 0.82; const xq = fx + 0.9;
      if (fy < 0.7) { const hh = room; K.cap([xq, y, zt + 0.7], [xq, y, zt + hh * 0.72], 0.85 * Math.min(1, hh / 6), 0.6, m, { obj: so, shift: 1 }); K.sph([xq, y, zt + hh * 0.82], 0.75 * Math.min(1, hh / 5), m, { obj: so, shift: 1 }); }
      else K.cap([xq, y - sd * 1.6, zt + 0.8], [xq, y + sd * 1.9, zt + 0.7], 0.75, 0.6, m, { obj: so, shift: 1 });
    }
    // raking cornice
    const rk = k.obj();
    for (const sd of [-1, 1]) {
      const a: V = [xr1 - 0.2, sd * (eY + 0.3), zt], b: V = [xr1 - 0.2, 0, zt + (eY + 0.3) * pitch];
      K.cap([a[0], a[1], a[2] + 0.55], [b[0], b[1], b[2] + 0.55], 0.75, 0.75, m, { obj: rk, shift: 1 });
    }
    K.box([xr1 - 1.2, -eY, zt - 0.4], [xr1, eY, zt + 0.4], m, { obj: rk, shift: 1 });
    const zr = gableRoof(K, xr0, xr1 - 0.6, eY, zt, pitch, rm, m);
    // akroteria: palmette at the apex, urns on the corners
    const ak = P.roof === 'marble' ? 'gold' : m;
    K.plate([[xr1 - 0.2, -1.6, zr + 1.2], [xr1 - 0.2, 1.6, zr + 1.2], [xr1 - 0.2, 2.2, zr + 3.4], [xr1 - 0.2, 0, zr + 4.6], [xr1 - 0.2, -2.2, zr + 3.4]], 0.8, ak, { shift: 1 });
    for (const sd of [-1, 1]) K.lathe([xr1 - 0.4, sd * eY, zt + 0.6], [[0, 0.9], [0.8, 1.2], [1.9, 0.7], [2.4, 1.0]], ak, { shift: 0 });
  });
}
// tiled gable roof, ridge along local x from x0 to x1, eaves at y = +-eY and height zE: tile courses, cover-tile ribs,
// a ridge cap and (with antefix set) antefixes along the visible +y eave. Returns the ridge height.
function gableRoof(K: Site, x0: number, x1: number, eY: number, zE: number, pitch: number, rm: string, antefix?: string, rib = 0.95, period = 4.4): number {
  const k = K.k; const zr = zE + eY * pitch; const course = 3.6 * rib / 0.95;
  const tile = (p: V): TexOut => (fr(Math.abs(p[1]) / course) < 0.2 ? -2 : 0);
  for (const sd of [-1, 1]) K.plate([[x0, sd * eY, zE + 0.2], [x1, sd * eY, zE + 0.2], [x1, 0, zr + 0.35], [x0, 0, zr + 0.35]], 1.3, rm, { shift: sd < 0 ? -1 : 0, tex: tile });
  const ribs = k.obj(); const nr = Math.max(2, Math.round((x1 - x0 - 1.8) / period)); const lift = rib / Math.cos(Math.atan(pitch));
  for (let i = 0; i <= nr; i++) {
    const x = x0 + rib + 0.25 + i * (x1 - x0 - 2 * rib - 0.5) / nr;
    for (const sd of [-1, 1]) {
      K.cap([x, sd * (eY - 0.6), zE + 0.85 + lift * 0.6 + 0.6 * pitch], [x, sd * 0.6, zr + 1.0 + lift * 0.6 - 0.6 * pitch], rib, rib, rm, { obj: ribs, shift: 1, tex: (p) => (fr(Math.abs(p[1]) / course) < 0.16 ? -1 : 0) });
      if (sd > 0 && antefix) K.plate([[x - 1.1, eY + 0.2, zE + 0.3], [x + 1.1, eY + 0.2, zE + 0.3], [x + 0.9, eY + 0.2, zE + 2.2], [x, eY + 0.2, zE + 3.0], [x - 0.9, eY + 0.2, zE + 2.2]], 0.6, antefix, { obj: ribs, shift: 1 });
    }
  }
  K.cap([x0, 0, zr + 1.0], [x1, 0, zr + 1.0], rib * 0.95, rib * 0.95, rm, { shift: 1 });   // ridge cap
  return zr;
}

// ---------------- house ----------------
const WALLS: { [k: string]: [string, number] } = { whitewash: ['marble', 2], white: ['marble', 2], ochre: ['limestone', 1], sand: ['linen', 1], stone: ['limestone', 0], rose: ['skin_pale', 1], pink: ['skin_pale', 1], blue: ['sky', 1] };
export type HouseP = { at?: number[]; w?: number; d?: number; storeys?: number; wall?: string; roof?: string; door?: string | boolean; doorColour?: string; windows?: number; shutters?: string; extras?: string[]; setting?: string };
// Greek island house: a rounded, limewashed mass with recessed openings, a framed plank door with a marble step, shuttered
// windows with sills and lintels on the two visible faces, a flat roof with a moulded parapet (or a tiled gable), and extras.
export function house(k: Kit, P: HouseP = {}): void {
  const w = Math.max(12, Math.min(34, P.w || 24)), d = Math.max(10, Math.min(28, P.d || 18)); const ns = P.storeys === 2 ? 2 : 1;
  const wl = WALLS[P.wall || 'whitewash'] || [mat(P.wall || 'marble'), 0]; const wm = wl[0], wsh = wl[1];
  const sm = mat(P.shutters || 'aegean'); const dm = mat(P.doorColour || P.shutters || 'aegean');
  const doorFace = P.door === false || P.door === 'none' ? '' : (P.door === 'v' ? 'v' : 'u');
  const tiled = P.roof === 'tiled'; const ex = P.extras || ['pots', 'amphora', 'chimney'];
  const has = (n: string): boolean => ex.indexOf(n) >= 0;
  const SH = 13; const H = SH * ns; const X = w / 2, Y = d / 2;
  const s = Math.min(1, 50 / (w + d + (ns === 2 ? 14 : 4) + (tiled ? 6 : 0)));
  const K = new Site(k);
  placeScaled(k, s, P.at, () => {
    // openings: [face 'u'|'v', centre along the face, sill z, width, height, kind]
    type Op = { f: string; c: number; z: number; w: number; h: number; door: boolean };
    const ops: Op[] = [];
    const stairOn = has('stair') && !tiled && doorFace !== 'v';
    const stairX1 = X - 1.5, stairX0 = stairX1 - Math.min(w - 5, H * 1.05);   // bottom step at the front corner, landing at x0
    // windows (and the door) spread evenly over a span of one face; a slot that cannot fit is dropped
    const place = (face: string, a0: number, a1: number, n: number, door: boolean, z: number): void => {
      let slots = n + (door ? 1 : 0); while (slots > 0 && (a1 - a0) / slots < 8.6) slots--; if (slots <= 0) return;
      const di = door ? Math.floor(slots / 2) : -1;
      for (let i = 0; i < slots; i++) {
        const c = a0 + (a1 - a0) * (i + 0.5) / slots;
        if (i === di) ops.push({ f: face, c, z, w: 5.2, h: 9.6, door: true }); else ops.push({ f: face, c, z: z + 4.4, w: 4.2, h: 5.2, door: false });
      }
    };
    const nw = P.windows === undefined ? 2 : Math.max(0, Math.min(4, P.windows));
    for (let st = 0; st < ns; st++) {
      const z = st * SH; const vEnd = stairOn && st === 0 ? stairX0 - 1.6 : X;
      place('u', -Y, Y, doorFace === 'u' ? Math.max(0, nw - 1) : nw, st === 0 && doorFace === 'u', z);
      place('v', -X, vEnd, stairOn && st === 0 ? Math.max(1, nw - 1) : nw, st === 0 && doorFace === 'v', z);
    }
    // the wall mass: rounded block, openings recessed, flat roof parapet carved out of the same block
    const top = tiled ? H : H + 1.7;
    let mass: Shape = K.sbox([-X, -Y, 0], [X, Y, top], 0.7);
    if (!tiled) mass = S.sub(mass, K.sbox([-X + 1.1, -Y + 1.1, H], [X - 1.1, Y - 1.1, H + 6], 0.4));
    const holes: Shape[] = [];
    const opBox = (o: Op, d0: number, d1: number, grow = 0): [V, V] => o.f === 'u'
      ? [[X - d1, o.c - o.w / 2 - grow, o.z - (o.door ? 0 : grow)], [X + d0, o.c + o.w / 2 + grow, o.z + o.h + grow]]
      : [[o.c - o.w / 2 - grow, Y - d1, o.z - (o.door ? 0 : grow)], [o.c + o.w / 2 + grow, Y + d0, o.z + o.h + grow]];
    for (const o of ops) { const b = opBox(o, 2, 0.9); holes.push(K.sbox(b[0], b[1])); }
    if (holes.length) mass = S.sub(mass, S.union(...holes));
    const wallT: LTex = (p) => {
      if (!tiled && p[2] > H - 0.05 && Math.abs(p[0]) < X - 0.95 && Math.abs(p[1]) < Y - 0.95) return p[2] < H + 0.2 && (fr(p[0] / 4.5) < 0.1 || fr(p[1] / 4.5) < 0.12) ? -2 : -1;   // roof deck + inner parapet
      if (p[2] < 1.1) return -1;                                                                    // painted plinth
      if (ns === 2 && Math.abs(p[2] - SH) < 0.35) return -1;                                        // floor line
      const h = hash(Math.floor(p[0] / 2.3), Math.floor(p[1] / 2.3), Math.floor(p[2] / 1.7)); return h > 0.93 ? -1 : 0;
    };
    const wo = K.solid(mass, wm, { shift: wsh, tex: wl[0] === 'limestone' && wsh === 0 ? ashlar([-X, -Y, 0], [X, Y, top], 2.4, 5, 0.5, 3) : wallT });
    // doors and windows
    for (const o of ops) {
      const along = (lo: number, hi: number, z0: number, z1: number, d0: number, d1: number, m: string, opt: LOpts): void => {
        if (o.f === 'u') K.box([X - d1, o.c + lo, z0], [X - d0, o.c + hi, z1], m, opt); else K.box([o.c + lo, Y - d1, z0], [o.c + hi, Y - d0, z1], m, opt);
      };
      const hw = o.w / 2; const ax = o.f === 'u' ? 1 : 0;
      if (o.door) {
        along(-hw, hw, 0, o.h, 0.9, 1.3, dm, { shift: 0, tex: (p) => { const a = p[ax] - o.c; const zz = p[2] - o.z;
          if (fr((a + hw) / 1.3) < 0.22) return -1; if (Math.abs(zz - 2.4) < 0.4 || Math.abs(zz - 7.2) < 0.4) return -1;
          return (Math.abs(a - hw * 0.55) < 0.5 && Math.abs(zz - 4.8) < 0.5) ? ['bronze', 2] : 0; } });
        along(-hw - 0.7, hw + 0.7, o.h, o.h + 1.1, -0.35, 1.0, 'wood', { shift: 0, tex: (p) => (fr(p[1 - ax] * 0.9) < 0.15 ? -1 : 0) });                     // lintel
        along(-hw - 0.4, hw + 0.4, 0, 0.9, -1.6, 1.0, 'marble', { shift: 1 });                                                                     // step
        // small fanlight above the lintel
        along(-1.2, 1.2, o.h + 1.5, o.h + 2.5, 0.3, 0.6, 'black', { shift: 2 });
      } else {
        along(-hw, hw, o.z, o.z + o.h, 0.7, 1.0, 'black', { shift: 2, tex: (p) => (Math.abs(p[ax] - o.c) < 0.3 || Math.abs(p[2] - o.z - o.h * 0.55) < 0.3 ? [sm, 1] : 0) });   // glazing + cross bar
        along(-hw - 0.6, hw + 0.6, o.z - 0.8, o.z, -0.6, 0.6, 'marble', { shift: 1 });                                                       // sill
        along(-hw - 0.4, hw + 0.4, o.z + o.h, o.z + o.h + 0.8, -0.25, 0.6, 'wood', { shift: 0 });                                             // lintel
        for (const sd of [-1, 1]) {   // open louvred shutters folded back against the wall
          const a0 = sd < 0 ? -hw - 2.3 : hw + 0.15, a1 = sd < 0 ? -hw - 0.15 : hw + 2.3;
          along(a0, a1, o.z + 0.1, o.z + o.h - 0.1, -0.45, 0, sm, { shift: 0, tex: (p) => { const a = p[ax] - o.c; const zz = p[2] - o.z;
            if (Math.abs(a - (sd < 0 ? -hw - 2.3 : hw + 2.3)) < 0.35 || Math.abs(a - sd * (hw + 0.15)) < 0.35 || zz < 0.45 || zz > o.h - 0.55) return 0;
            return fr(zz / 0.95) < 0.4 ? -2 : 0; } });
        }
      }
    }
    // roof
    if (tiled) {
      const pitch = 0.45; const eY = Y + 1.4;
      K.solid(S.inter(K.sbox([-X, -Y, H - 0.1], [X, Y, H + Y * pitch + 0.2], 0.4), S.inter(S.half(K.P(0, Y, H), K.P(0, pitch, 1)), S.half(K.P(0, -Y, H), K.P(0, -pitch, 1)))), wm, { obj: wo, shift: wsh, tex: wallT });
      K.box([-X - 0.6, -Y - 0.6, H - 1.0], [X + 0.6, Y + 0.6, H], 'wood', { shift: -1 });   // eaves beam
      gableRoof(K, -X - 1.6, X + 1.6, eY, H - 0.4 - 1.4 * pitch, pitch, 'terracotta', undefined, 0.85, 3.6);
    } else {
      K.box([X - 4, -Y + 0.4, H - 1.0], [X - 3, -Y + 0.5, H - 0.4], 'terracotta', {});
      const sp0 = [-X * 0.35, Y + 0.2, H - 0.2]; K.cyl([sp0[0], Y - 0.6, sp0[2]], [sp0[0], Y + 1.8, sp0[2] - 0.4], 0.45, 0.45, 'terracotta', { shift: 1 });   // drain spout
    }
    if (has('chimney')) {
      const cxp = -X * 0.55, cyp = -Y * 0.45, zb = tiled ? H + (Y - Math.abs(cyp)) * 0.45 - 1 : H;
      K.box([cxp - 1.6, cyp - 1.6, zb], [cxp + 1.6, cyp + 1.6, zb + 5.2], wm, { shift: wsh, tex: (p) => (p[2] > zb + 3.6 && p[2] < zb + 4.4 && (fr((p[0] + p[1]) / 1.6) < 0.5) ? ['black', 1] : 0) }, 0.4);
      K.box([cxp - 2.1, cyp - 2.1, zb + 5.2], [cxp + 2.1, cyp + 2.1, zb + 6.0], wm, { shift: wsh }, 0.3);
    }
    if (stairOn) {   // whitewashed outside stair rising along the +v face from the front corner to the roof, with a low sloped parapet
      const n = Math.round(H / 1.3); const run = (stairX1 - stairX0) / n; const so = k.obj(); const sw = 3.0;
      for (let i = 0; i < n; i++) { const zt = (n - i) * H / n; K.box([stairX0 + i * run, Y - 0.2, 0], [stairX0 + (i + 1) * run, Y + sw, zt], wm, { obj: so, shift: wsh, tex: (p) => (p[2] > zt - 0.05 ? 0 : (p[0] > stairX0 + (i + 1) * run - 0.05 ? -1 : (p[2] < 1.1 ? -1 : 0))) }); }
      K.box([stairX0 - 1.2, Y - 0.2, H - 1.0], [stairX0, Y + sw, H], wm, { obj: so, shift: wsh });   // landing
      const pz = (x: number): number => (stairX1 - x) / (stairX1 - stairX0) * H;
      K.plate([[stairX1, Y + sw - 0.35, 0], [stairX1, Y + sw - 0.35, 1.6], [stairX0, Y + sw - 0.35, pz(stairX0) + 1.6], [stairX0 - 1.2, Y + sw - 0.35, H + 1.6], [stairX0 - 1.2, Y + sw - 0.35, H - 1.0], [stairX0, Y + sw - 0.35, pz(stairX0) - 0.4], [stairX1 - run, Y + sw - 0.35, 0]], 0.7, wm, { obj: so, shift: wsh - 1 });
    }
    if (has('awning') && doorFace) {   // striped cloth awning over the door on two wooden poles
      const o = ops.filter((q) => q.door)[0]; const zt = o.h + 2.8, zb = o.h + 0.6, out = 5.5, hw = 4.2;
      const P3 = (a: number, b: number, z: number): V => (o.f === 'u' ? [X + b, o.c + a, z] : [o.c + a, Y + b, z]);
      K.plate([P3(-hw, 0.2, zt), P3(hw, 0.2, zt), P3(hw, out, zb), P3(-hw, out, zb)], 0.5, 'linen', { shift: 1, tex: (p) => (fr((o.f === 'u' ? p[1] : p[0]) / 1.5) < 0.5 ? [sm, 1] : 0) });
      for (const a of [-hw + 0.4, hw - 0.4]) K.cyl(P3(a, out - 0.4, 0), P3(a, out - 0.4, zb + 0.2), 0.4, 0.4, 'wood', {});
      for (let i = 0; i < 6; i++) { const a = -hw + (i + 0.5) * (2 * hw / 6); K.plate([P3(a - 0.7, out + 0.05, zb + 0.05), P3(a + 0.7, out + 0.05, zb + 0.05), P3(a, out + 0.05, zb - 0.9)], 0.3, i % 2 ? 'linen' : sm, { shift: 1 }); }
    }
    // pots, amphora, plants at the foot of the visible walls
    const pot = (x: number, y: number, hgt: number, plant: string, z0 = 0): void => {
      K.lathe([x, y, z0], [[0, 1.0 * hgt / 3], [0.3 * hgt, 1.25 * hgt / 3], [0.85 * hgt, 1.55 * hgt / 3], [hgt, 1.75 * hgt / 3]], 'terracotta', { shift: 0, tex: (p) => (p[2] > z0 + hgt - 0.5 ? 1 : (Math.abs(p[2] - z0 - hgt * 0.75) < 0.25 ? -1 : 0)) });
      const po = k.obj(); const r = hgt * 0.55;
      for (const q of [[0, 0, 1.1, 1.0], [0.55, 0.35, 0.8, 0.75], [-0.5, 0.45, 0.75, 0.7], [0.1, -0.6, 0.85, 0.7], [-0.2, 0.1, 1.6, 0.65]])
        K.sph([x + q[0] * r, y + q[1] * r, z0 + hgt + q[2] * r], q[3] * r, plant === 'olive' ? 'olive' : 'laurel', { obj: po, tex: (p) => { const h = hash(Math.floor(p[0] * 1.6), Math.floor(p[1] * 1.6), Math.floor(p[2] * 1.6)); return plant === 'flowers' && h > 0.62 ? ['crimson', 2] : (h < 0.25 ? -1 : 0); } });
    };
    const dOp = ops.filter((q) => q.door)[0];
    // along the door's face: the amphora stands on the door's far side, a pot further along (or on the near side if crowded)
    const fL = dOp && dOp.f === 'v' ? X : Y; const aSide = dOp ? (dOp.c - dOp.w / 2 - 2.6 >= -fL + 2.4 ? dOp.c - dOp.w / 2 - 2.6 : dOp.c + dOp.w / 2 + 2.6) : -fL + 7;
    let pSide = -fL + 2.6; if (dOp && (Math.abs(pSide - aSide) < 4.5 || Math.abs(pSide - dOp.c) < dOp.w / 2 + 2.2)) pSide = Math.min(fL - 2, dOp.c + dOp.w / 2 + 2.6);
    const onFace = (a: number, out: number): number[] => (dOp && dOp.f === 'v' ? [a, Y + out] : [X + out, a]);
    if (has('pots')) {
      const fv = [[X - 3.2, 'flowers', 3.0], [-X + 4, 'laurel', 3.6]].filter((q) => (!stairOn || (q[0] as number) < stairX0 - 3) && !(dOp && dOp.f === 'v'));
      for (const q of fv) pot(q[0] as number, Y + 2.0, q[2] as number, q[1] as string);
      const pp = onFace(pSide, 2.2); pot(pp[0], pp[1], 3.2, 'flowers');
      if (!tiled) pot(-X + 2.8, Y - 3.0, 2.4, 'laurel', H);   // on the roof behind the parapet
    }
    if (has('amphora')) amphora(k, { at: onFace(aSide, 1.8), height: 5.6, style: 'plain' });   // a plain storage amphora beside the door
    if (has('bougainvillea')) {   // purple flowering creeper over the door lintel, trailing down the door's far side
      const bo = k.obj(); const o = dOp;
      const z0 = o ? o.h + 2.0 : H * 0.5;
      for (let i = 0; i < 16; i++) {
        const a = hash(i, 3, 1), b = hash(i, 5, 2); const trail = i >= 11;
        const zz = trail ? z0 - (i - 10) * 1.7 : z0 + (H + 1.2 - z0) * hash(i, 7, 3);
        const along = (o ? o.c : Y - 2) + (trail ? (o ? -o.w / 2 - 1.3 : -2) + (b - 0.5) * 1.0 : (b - 0.5) * 9 - 1.5);
        const c: V = o && o.f === 'v' ? [along, Y + 0.3 + a * 0.5, zz] : [X + 0.3 + a * 0.5, along, zz];
        K.sph(c, (trail ? 0.75 : 0.95) + a * 0.45, 'purple', { obj: bo, shift: 1, tex: (p) => (hash(Math.floor(p[0] * 2.2), Math.floor(p[1] * 2.2), Math.floor(p[2] * 2.2)) > 0.74 ? ['laurel', 0] : 0) });
      }
    }
  });
}

// ---------------- lampstand ----------------
export type LampP = { at?: number[]; height?: number; mat?: string; lit?: boolean; base?: string; head?: string };
// Tall bronze street lamp: lion-paw tripod (or a stepped column base), a fluted shaft with knops, a flared capital and either a
// lantern with horn panels (head:'lantern', default) or an open oil bowl (head:'bowl'). lit:true fills the lantern with fire light
// (or puts a big flame in the bowl), adds sparks and warms the metal under the head; lit:false shows dark panels or a cold, sooty bowl.
export function lampstand(k: Kit, P: LampP = {}): void {
  const Hh = Math.max(20, Math.min(44, P.height || 34)); const m = mat(P.mat || 'bronze'); const lit = P.lit !== false;
  const lantern = P.head !== 'bowl'; const col = P.base === 'column';
  const K = new Site(k); const n0 = k.parts.length;
  placeScaled(k, 1, P.at, () => {
    const zh = Hh - (lantern ? 9.9 : 4.5);   // top of the capital / bottom of the head
    const warm = (z0: number): LTex => (p) => (lit && p[2] > z0 ? 1 : 0);
    // base
    let zs = 0;
    if (col) {
      const sm = 'marble';
      K.box([-3.6, -3.6, 0], [3.6, 3.6, 1.2], sm, { shift: -1, tex: (p) => (p[2] > 1.0 ? 1 : 0) });
      K.box([-2.7, -2.7, 1.2], [2.7, 2.7, 5.6], sm, { tex: (p) => (Math.abs(p[2] - 3.4) < 0.3 ? -2 : 0) });
      K.box([-3.1, -3.1, 5.6], [3.1, 3.1, 6.4], sm, { shift: 1 });
      zs = 6.4;
      K.lathe([0, 0, zs], [[0, 1.7], [0.6, 1.5], [1.0, 1.0]], m, {});
      zs += 1.0;
    } else {
      const ol = k.obj();
      for (let i = 0; i < 3; i++) {   // three legs bowing out to lion paws
        const a = 45 + i * 120; const c = cosd(a), sn = sind(a);
        const top: V = [c * 0.9, sn * 0.9, 6.6], mid: V = [c * 2.7, sn * 2.7, 3.2], ft: V = [c * 3.7, sn * 3.7, 0.9];
        K.cap(top, mid, 0.42, 0.5, m, { obj: ol }); K.cap(mid, ft, 0.5, 0.55, m, { obj: ol });
        K.ell([c * 4.0, sn * 4.0, 0.65], [1.0, 1.0, 0.65], m, { obj: ol, shift: -1, tex: (p) => (p[2] < 0.35 ? -1 : 0) });   // paw
        K.sph([c * 2.75, sn * 2.75, 3.6], 0.62, m, { obj: ol, shift: 1 });   // knuckle where the brace meets the leg
      }
      K.ring([0, 0, 3.6], [0, 0, 1], 2.65, 0.26, m, { obj: ol, shift: -1 });
      K.lathe([0, 0, 0], [[5.8, 1.5], [6.4, 1.9], [7.4, 1.2], [7.8, 0.85]], m, { tex: (p) => (Math.abs(p[2] - 6.4) < 0.25 ? -2 : 0) });
      zs = 7.8;
    }
    // shaft: fluted, with two knops, a slight taper
    const nfl = 10; const flutes: LTex = (p) => { const f = fr((atan2d(p[1], p[0]) + 360) * nfl / 360); return f < 0.3 ? -1 : (f > 0.82 ? 1 : 0); };
    K.lathe([0, 0, 0], [[zs, 0.82], [zh - 1.6, 0.62]], m, { tex: (p) => { const w0 = warm(zh - 4)(p); const f = flutes(p); return (typeof f === 'number' ? f : 0) + (typeof w0 === 'number' ? w0 : 0); } });
    for (const t of [0.36, 0.7]) { const z = zs + (zh - zs) * t; K.lathe([0, 0, 0], [[z - 0.5, 0.8], [z, 1.25], [z + 0.5, 0.8]], m, { shift: 1 }); }
    // capital: a flared cup with a drip ring and four little volute hooks for hanging tools
    K.lathe([0, 0, 0], [[zh - 1.8, 0.7], [zh - 0.9, 1.1], [zh - 0.3, 2.2], [zh, 2.6]], m, { tex: warm(zh - 1.2) });
    for (let i = 0; i < 4; i++) { const a = 45 + i * 90; K.cap([cosd(a) * 1.9, sind(a) * 1.9, zh - 0.2], [cosd(a) * 3.0, sind(a) * 3.0, zh - 1.0], 0.28, 0.24, m, { shift: 1, tex: warm(zh - 2) }); }
    if (lantern) {
      // lantern: base tray, four corner posts, horn panels with a bronze lattice, a pierced cap, a ring finial
      const hw = 2.8, zb = zh + 0.6, zt = zb + 6.4;
      K.box([-hw - 0.6, -hw - 0.6, zh], [hw + 0.6, hw + 0.6, zb], m, { shift: 0, tex: warm(zh - 1) });
      const pan = lit ? 'fire' : 'black';
      const lattice: LTex = (p) => { const a = Math.abs(p[0]) > Math.abs(p[1]) ? p[1] : p[0]; const zz = p[2] - zb;
        if (Math.abs(zz - 3.1) < 0.3 || Math.abs(a) < 0.25) return [m, lit ? -2 : -2];
        if (!lit) return (zz > 3.4 && a > 0.6 && a < 1.6) ? 2 : 0;   // a cold highlight on the dark horn
        return zz < 0.9 ? -1 : (zz > 4.6 ? 0 : 1); };
      K.box([-hw, -hw, zb], [hw, hw, zt], pan, { glow: lit, shift: lit ? 0 : 1, tex: lattice });
      const po = k.obj();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) K.box([sx * hw - 0.45, sy * hw - 0.45, zb], [sx * hw + 0.45, sy * hw + 0.45, zt], m, { obj: po, shift: 1, tex: warm(zb) });
      K.box([-hw - 0.7, -hw - 0.7, zt], [hw + 0.7, hw + 0.7, zt + 0.7], m, { shift: 1 });
      K.lathe([0, 0, 0], [[zt + 0.7, 3.0], [zt + 1.4, 2.4], [zt + 2.6, 0.7], [zt + 3.0, 0.5]], m, { tex: (p) => (Math.abs(p[2] - zt - 1.3) < 0.28 && fr((atan2d(p[1], p[0]) + 360) / 30) < 0.5 ? (lit ? ['fire', 3] : ['black', 1]) : 0) });
      K.ring([0, 0, zt + 3.7], [1, -1, 0], 0.75, 0.24, m, { shift: 1 });
      if (lit) for (const q of [[0.6, -0.4, zt + 5.4, 0.3], [-0.7, 0.5, zt + 6.6, 0.24], [0.2, 0.9, zt + 7.6, 0.2]]) K.sph([q[0], q[1], q[2]], q[3], 'fire', { glow: true, shift: 2 });
    } else {
      // open oil bowl: a wide shallow phiale with a rolled rim and a tongue-pattern frieze
      const zb = zh + 0.3;
      K.lathe([0, 0, 0], [[zb, 1.2], [zb + 0.9, 3.0], [zb + 1.8, 4.0], [zb + 2.5, 4.3]], m, { tex: (p) => (p[2] > zb + 1.2 && fr((atan2d(p[1], p[0]) + 360) / 24) < 0.45 ? -1 : (lit && p[2] > zb + 1.9 ? 1 : 0)) });
      K.ring([0, 0, zb + 2.5], [0, 0, 1], 4.2, 0.35, m, { shift: 1 });
      K.lathe([0, 0, 0], [[zb + 2.3, 3.7], [zb + 2.62, 3.6]], 'black', { shift: lit ? 2 : 1, tex: (p) => (lit && hash(Math.floor(p[0] * 2), Math.floor(p[1] * 2)) > 0.55 ? ['fire', -1] : 0) });
      if (lit) {
        const of = k.obj();
        K.solid(S.smooth(0.7, K.scap([0, 0, zb + 2.6], [0.2, -0.2, zb + 9.6], 2.6, 0.2), K.scap([1.4, -0.6, zb + 2.5], [1.0, -1.4, zb + 6.4], 1.3, 0.15), K.scap([-1.1, 1.4, zb + 2.5], [-1.4, 1.0, zb + 6.9], 1.3, 0.15), K.scap([-1.3, -1.1, zb + 2.5], [-1.9, -1.6, zb + 5.6], 1.1, 0.15)), 'fire', { obj: of, glow: true });
        for (const q of [[0.6, 0.4, zb + 11.0, 0.32], [-1.2, -0.4, zb + 12.4, 0.26], [1.1, -1.4, zb + 13.2, 0.22]]) K.sph([q[0], q[1], q[2]], q[3], 'fire', { obj: of, glow: true });
      } else {
        K.cap([0, 0, zb + 2.3], [0.3, 0.1, zb + 3.2], 0.22, 0.18, 'linen', { shift: -3 });   // cold wick
      }
    }
    if (!lit) for (let i = n0; i < k.parts.length; i++) if (k.parts[i].mat === m) k.parts[i].shift -= 1;   // cold, unpolished metal
  });
}

// ---------------- wall ----------------
export type WallP = { at?: number[]; len?: number; height?: number; thick?: number; mat?: string; crenels?: boolean; gate?: boolean; sea?: boolean; axis?: string };
// Stone town wall / sea wall segment along local x (axis:'u' runs along +u, 'v' along +v): stepped footing, ashlar courses with
// staggered joints and per-block tone, a projecting coping, optional merlons, an optional arched gate with voussoirs, keystone
// and studded plank doors; sea:true adds a wet, weedy foot, scuppers and bronze mooring rings.
export function wall(k: Kit, P: WallP = {}): void {
  const L = Math.max(12, Math.min(80, P.len || 40)), Hh = Math.max(6, Math.min(30, P.height || 14)), T = Math.max(3, Math.min(10, P.thick || 6));
  const m = mat(P.mat || 'limestone'); const sea = !!P.sea; const cren = !!P.crenels; const gate = !!P.gate;
  const s = Math.min(1, 50 / (L + T + 2));
  const K = new Site(k, P.axis);   // local x runs along the wall (axis 'u' or 'v'); the long face the camera sees is local +y
  placeScaled(k, s, P.at, () => {
    const X = L / 2, Y = T / 2; const ch = 2.3, bw = 4.6, jw = 0.5;
    const g = Math.min(4.2, L * 0.14), gh = Math.min(Hh * 0.55, 8.5);   // gate half width, springing height
    const foot: [string, number] | undefined = sea ? ['olive', 3.2] : [m, 0.9];
    // footing course
    const flo: V = [-X - 0.8, -Y - 0.8, 0], fhi: V = [X + 0.8, Y + 0.8, 1.8];
    let fs: Shape = K.sbox(flo, fhi); if (gate) fs = S.sub(fs, K.sbox([-g, -Y - 2, -1], [g, Y + 2, 3]));
    K.solid(fs, m, { shift: -1, tex: shade(ashlar(flo, fhi, 1.8, 6.2, jw, 2, foot), sea ? -1 : 0) });
    // body
    const blo: V = [-X, -Y, 1.8], bhi: V = [X, Y, Hh];
    let body: Shape = K.sbox(blo, bhi);
    if (gate) body = S.sub(body, S.union(K.sbox([-g, -Y - 2, 0], [g, Y + 2, gh]), K.scyl([0, -Y - 2, gh], [0, Y + 2, gh], g)));
    const base = ashlar(blo, bhi, ch, bw, jw, 7, sea ? ['olive', 2.0] : undefined);
    const vous: LTex = (p) => {   // radiating voussoirs and a keystone round the arch on the visible face
      if (!gate || p[2] < gh - 0.2) return null; const dx = p[0], dz = p[2] - gh; const r = Math.sqrt(dx * dx + dz * dz);
      if (r < g - 0.05 || r > g + 2.0) return null; if (r > g + 1.75) return -2;
      const a = atan2d(dz, dx); if (Math.abs(a - 90) < 9) return 1;   // keystone
      return fr(a / 18) < 0.12 ? -2 : (hash(Math.floor(a / 18), 4, 1) > 0.6 ? 1 : 0);
    };
    K.solid(body, m, { tex: (p) => { const v = vous(p); if (v !== null) return v;
      const q = base(p); if (sea && p[2] < 4.5 && p[1] > Y - 0.1 && hash(Math.floor(p[0] * 1.2), Math.floor(p[2] * 2), 3) > 0.55 + p[2] * 0.08) return [m, -2];   // wet streaks
      return q; } });
    // coping
    const clo: V = [-X - 0.6, -Y - 0.6, Hh], chi: V = [X + 0.6, Y + 0.6, Hh + 1.1];
    K.box(clo, chi, m, { shift: 1, tex: (p) => { const f = faceOf(p, clo, chi); if (f >= 4) return fr(p[0] / 3.4) < 0.1 ? -1 : 0; return fr(p[0] / 6.8) < 0.07 ? -2 : (p[2] < Hh + 0.3 ? -1 : 0); } });
    if (cren) {   // merlons on the outer (+y) edge, a low parapet on the inner edge
      const mw = 3.2, gp = 2.2; const n = Math.max(2, Math.floor((L + gp) / (mw + gp))); const tot = n * mw + (n - 1) * gp; const mo = k.obj();
      for (let i = 0; i < n; i++) {
        const x0 = -tot / 2 + i * (mw + gp); const lo: V = [x0, Y - 1.8, Hh + 1.1], hi: V = [x0 + mw, Y + 0.4, Hh + 4.6];
        K.box(lo, hi, m, { obj: mo, tex: (p) => (p[2] > Hh + 4.3 ? 1 : (Math.abs(p[2] - Hh - 2.9) < 0.22 ? -2 : (hash(i, Math.floor(p[2]), 5) > 0.8 ? -1 : 0))) });
      }
      K.box([-X - 0.6, -Y - 0.6, Hh + 1.1], [X + 0.6, -Y + 0.8, Hh + 2.4], m, { shift: -1 });
    }
    if (gate) {   // studded plank doors set back in the opening, a threshold and an iron lamp hook
      const dl: LTex = (p) => { const a = p[0]; const zz = p[2]; if (fr((a + g) / 1.25) < 0.2) return -1; if (Math.abs(zz - 1.6) < 0.35 || Math.abs(zz - gh * 0.7) < 0.35) return ['iron', 1]; return (hash(Math.floor(a * 2), Math.floor(zz * 2), 6) > 0.92) ? ['iron', 2] : 0; };
      K.solid(S.union(S.inter(K.sbox([-g, -0.4, gh - 0.1], [g, 0.4, gh + g]), K.scyl([0, -1, gh], [0, 1, gh], g, g)), K.sbox([-g, -0.4, 0], [g, 0.4, gh])), 'wood', { shift: -1, tex: dl });
      K.box([-0.12, 0.35, 0], [0.12, 0.5, gh + g - 0.2], 'black', { shift: 1 });   // meeting stiles
      K.box([-g - 0.3, -Y - 0.3, 0], [g + 0.3, Y + 0.3, 0.5], m, { shift: 1 });
    }
    if (sea) {
      const ro = k.obj();
      for (const x of [-X * 0.62, X * 0.55]) { if (gate && Math.abs(x) < g + 2) continue;
        K.box([x - 0.5, Y - 0.2, 3.4], [x + 0.5, Y + 0.5, 4.2], 'bronze', { obj: ro, shift: -1 });
        K.ring([x, Y + 0.7, 2.8], [0, 1, 0.25], 1.0, 0.24, 'bronze', { obj: ro }); }
      for (const x of [-X * 0.3, X * 0.25, X * 0.8]) if (!gate || Math.abs(x) > g + 1.5) K.box([x - 0.6, Y - 0.3, 2.6], [x + 0.6, Y + 0.05, 3.4], 'black', { shift: 1 });   // scuppers
    }
  });
}

// ---------------- market stall ----------------
export type StallP = { at?: number[]; w?: number; d?: number; awning?: string; stripe?: string; goods?: string };
// Market stall: plank counter with a top board and corner posts, a sloping striped awning with a scalloped valance, a back
// shelf, a bronze balance, and goods: 'fruit' (baskets of pomegranates, lemons, olives, a melon crate), 'fish' (a tray of
// fish, fish hanging from the beam, a basket) or 'amphorae' (amphorae on the ground and the counter, a rope-wrapped jar).
export function stall(k: Kit, P: StallP = {}): void {
  const w = Math.max(10, Math.min(28, P.w || 18)), d = Math.max(7, Math.min(16, P.d || 10)); const aw = mat(P.awning || 'crimson'); const st = mat(P.stripe || 'linen');
  const goods = P.goods || 'fruit'; const s = Math.min(1, 34 / (w + d + 4));
  const K = new Site(k);
  placeScaled(k, s, P.at, () => {
    const X = d / 2, Y = w / 2; const zc = 6.4; const zf = 13.8, zb = 16.4;   // counter top, awning front and back heights
    // counter: front planks, side boards, top board
    const plank: LTex = (p) => (fr(p[2] / 1.3) < 0.18 ? -1 : (hash(Math.floor(p[2] / 1.3), Math.floor((p[0] + p[1]) / 4), 2) > 0.8 ? 1 : 0));
    K.box([X - 2.6, -Y + 0.6, 0], [X, Y - 0.6, zc - 0.6], 'wood', { tex: plank });
    K.box([X - 3.0, -Y + 0.3, zc - 0.6], [X + 0.5, Y - 0.3, zc], 'wood', { shift: 1, tex: (p) => (p[2] > zc - 0.05 && fr(p[1] / 3.1) < 0.08 ? -1 : 0) });
    // posts
    const po = k.obj();
    for (const sy of [-1, 1]) {
      K.box([X - 0.4, sy * Y - 0.45, 0], [X + 0.5, sy * Y + 0.45, zf + 0.6], 'wood', { obj: po, shift: -1 });
      K.box([-X - 0.45, sy * Y - 0.45, 0], [-X + 0.45, sy * Y + 0.45, zb + 0.6], 'wood', { obj: po, shift: -1 });
    }
    K.box([X - 0.3, -Y - 0.5, zf - 0.6], [X + 0.6, Y + 0.5, zf + 0.1], 'wood', { obj: po });   // front beam
    // back shelf with jars / crates
    K.box([-X + 0.5, -Y + 0.8, 0], [-X + 3.2, Y - 0.8, 4.2], 'wood', { shift: -2, tex: plank });
    // awning: striped cloth sloping to the front, scalloped valance on the front and the visible side
    const ao = k.obj(); const ov = 1.0;
    const stripe = (a: number): string => (fr(a / 2.6) < 0.5 ? aw : st);
    K.plate([[-X - 0.8, -Y - 0.9, zb + 0.9], [-X - 0.8, Y + 0.9, zb + 0.9], [X + ov, Y + 0.9, zf + 0.5], [X + ov, -Y - 0.9, zf + 0.5]], 0.5, aw, { obj: ao, tex: (p) => [stripe(p[1] + Y), stripe(p[1] + Y) === aw ? 0 : 1] });
    const ns = Math.max(4, Math.round((2 * Y + 1.8) / 2.6));
    for (let i = 0; i < ns; i++) { const a = -Y - 0.9 + (i + 0.5) * (2 * Y + 1.8) / ns; const c = stripe(a + Y);
      K.plate([[X + ov + 0.05, a - 1.2, zf + 0.45], [X + ov + 0.05, a + 1.2, zf + 0.45], [X + ov + 0.05, a, zf - 1.3]], 0.35, c, { obj: ao, shift: c === aw ? 0 : 1 }); }
    const nsd = Math.max(3, Math.round((2 * X + ov + 0.8) / 2.6));
    for (let i = 0; i < nsd; i++) { const a = -X - 0.8 + (i + 0.5) * (2 * X + ov + 0.8) / nsd; const zt = zb + 0.9 + (zf + 0.5 - zb - 0.9) * (a + X + 0.8) / (2 * X + ov + 0.8);
      K.plate([[a - 1.2, Y + 0.95, zt - 0.05], [a + 1.2, Y + 0.95, zt - 0.05], [a, Y + 0.95, zt - 1.7]], 0.35, i % 2 ? aw : st, { obj: ao, shift: i % 2 ? 0 : 1 }); }
    // bronze balance on the counter
    const bx = X - 1.4, by = -Y + 2.4; const bo = k.obj();
    K.cyl([bx, by, zc], [bx, by, zc + 3.6], 0.2, 0.2, 'bronze', { obj: bo }); K.cap([bx, by - 1.6, zc + 3.6], [bx, by + 1.6, zc + 3.6], 0.18, 0.18, 'bronze', { obj: bo });
    for (const sy of [-1, 1]) K.lathe([bx, by + sy * 1.6, zc + 1.4], [[0, 0.2], [0.35, 0.9], [0.5, 1.0]], 'bronze', { obj: bo, shift: 1 });
    const basket = (x: number, y: number, z: number, r: number, h: number, fill: [string, number][]): void => {
      K.lathe([x, y, z], [[0, r * 0.75], [h * 0.7, r], [h, r * 1.05]], 'wood', { shift: 1, tex: (p) => ((fr(p[2] / 0.6) < 0.4) !== (fr((atan2d(p[1] - y, p[0] - x) + 360) / 20) < 0.5) ? -1 : 0) });
      const fo = k.obj(); let i = 0;
      for (const f of fill) for (let j = 0; j < f[1]; j++, i++) {
        const a = i * 137.5, rr = (r - 0.55) * Math.sqrt((i + 0.5) / (fill.reduce((t, q) => t + q[1], 0) + 0.5));
        K.sph([x + cosd(a) * rr, y + sind(a) * rr, z + h + 0.45 + (1 - rr / r) * 0.8], 0.82, f[0], { obj: fo, shift: 1, tex: (p) => (p[2] > z + h + 0.75 ? 1 : 0) });
      }
    };
    if (goods === 'fish') {
      K.box([X - 2.8, -Y + 4.2, zc], [X + 0.2, Y - 0.8, zc + 0.8], 'wood', { shift: 0 });   // tray
      for (let i = 0; i < 5; i++) { const y = -Y + 5.2 + i * (2 * Y - 6.6) / 4; const fo = k.obj();
        K.ell([X - 1.3, y, zc + 1.15], [1.15, 0.42, 0.38], i % 2 ? 'iron' : 'sky', { obj: fo, shift: 1, tex: (p) => (p[2] > zc + 1.3 ? 1 : (p[0] > X - 0.45 ? ['black', 1] : 0)) });
        K.plate([[X - 2.3, y, zc + 1.15], [X - 3.2, y - 0.5, zc + 1.15], [X - 3.2, y + 0.5, zc + 1.15]], 0.3, 'iron', { obj: fo }); }
      for (let i = 0; i < 3; i++) { const y = -Y + 3 + i * 3.2; const fo = k.obj();   // fish hanging from the front beam
        K.cyl([X + 0.2, y, zf - 0.6], [X + 0.2, y, zf - 1.6], 0.08, 0.08, 'linen', { obj: fo, shift: -2 });
        K.ell([X + 0.2, y, zf - 3.0], [0.4, 0.45, 1.4], 'iron', { obj: fo, shift: 1, tex: (p) => (p[2] < zf - 4.0 ? -1 : 0) });
        K.plate([[X + 0.2, y, zf - 4.2], [X + 0.2, y - 0.6, zf - 5.0], [X + 0.2, y + 0.6, zf - 5.0]], 0.25, 'iron', { obj: fo }); }
      basket(X + 3.0, Y - 2.4, 0, 2.1, 2.2, [['iron', 5], ['sky', 3]]);
      K.ell([-X + 1.8, -Y + 3.0, 5.6], [1.2, 1.0, 1.2], 'crimson', { shift: -1 });   // octopus on the shelf
    } else if (goods === 'amphorae') {
      for (const q of [[X + 2.6, -Y + 2.6, 7.0, 'black-figure'], [X + 2.2, -Y + 6.6, 6.0, 'plain'], [X + 3.0, Y - 4.0, 7.4, 'red-figure'], [X + 2.0, Y - 1.2, 5.2, 'plain']])
        amphora(k, { at: K.P(q[0] as number, q[1] as number, 0), height: q[2] as number, style: q[3] as string, border: 'meander' });
      for (const q of [[X - 1.4, -Y + 6.4, 4.4], [X - 1.4, Y - 2.8, 3.8]]) {   // small jars standing on the counter
        const c = K.P(q[0], q[1], zc); K.lathe(c, [[0, 0.7], [0.4, 1.1], [q[2] * 0.6, 1.4], [q[2] * 0.85, 0.6], [q[2], 0.75]], 'terracotta', { tex: (p) => (Math.abs(p[2] - zc - q[2] * 0.55) < 0.25 ? ['black', 0] : 0) }); }
      for (let i = 0; i < 3; i++) { const c = K.P(-X + 1.9, -Y + 3 + i * 3.6, 4.2); K.lathe(c, [[0, 0.6], [1.0, 1.1], [1.8, 0.5], [2.2, 0.6]], 'terracotta', { shift: -1 }); }
    } else {
      basket(X - 1.5, -Y + 6.0, zc, 2.2, 1.3, [['crimson', 6]]);
      basket(X - 1.5, -Y + 10.8, zc, 2.2, 1.3, [['gold', 6]]);
      if (w > 15) basket(X - 1.5, Y - 2.8, zc, 2.0, 1.3, [['olive', 5]]);
      // melon crate in front of the counter
      K.box([X + 0.8, -Y + 4.4, 0], [X + 4.6, -Y + 10.2, 2.6], 'wood', { shift: 0, tex: (p) => (fr(p[2] / 0.9) < 0.25 ? -2 : 0) });
      for (const q of [[X + 2.7, -Y + 5.9], [X + 2.7, -Y + 8.6]]) K.ell([q[0], q[1], 3.2], [1.6, 1.35, 1.25], 'laurel', { tex: (p) => (fr((p[0] + p[1]) / 0.9) < 0.3 ? -2 : 1) });
      basket(X + 2.8, Y - 2.6, 0, 2.0, 2.6, [['gold', 4], ['crimson', 3]]);
      for (let i = 0; i < 3; i++) { const c = K.P(-X + 1.9, -Y + 3 + i * 3.6, 4.2); K.lathe(c, [[0, 0.6], [1.0, 1.1], [1.8, 0.5], [2.2, 0.6]], 'terracotta', { shift: -1 }); }
    }
  });
}

// ---------------- v5: lessons turned into builder behaviour ----------------
// humanoid(): the public wrapper. Applies defaults the loop4 lessons asked for, then calls humanoidCore.
//   gender:'female' -> slim, no beard, warm hair, long robe, pale skin unless set
//   torso.armour 'robe' | 'peplos' | 'gown' -> a pleated ankle-length tube (hourglass, never a cone, never coloured legs)
//   contrast: shield colour defaults to crimson / aegean when the body is bronze, with a gold emblem; crest/trim accent defaults
//   material:'marble'|'bronze'|... -> single-material mode: every part and decal in one material (statues, automatons)
export type Humanoid5 = HumanoidP & { gender?: string; material?: string; robe?: boolean };
export function humanoid(k: Kit, P: Humanoid5 = {}): { top: V } {
  const Q: any = { ...P }; const fem = Q.gender === 'female' || Q.gender === 'woman';
  Q.head = { ...(Q.head || {}) }; Q.torso = { ...(Q.torso || {}) };
  const ar0 = Q.torso.armour;
  if (ar0 === 'robe' || ar0 === 'peplos' || ar0 === 'gown' || ar0 === 'dress' || ar0 === 'long-chiton') { Q.torso.armour = 'chiton'; Q.robe = true; }
  if (fem) {
    if (Q.build === undefined) Q.build = 'slim';
    if (Q.skin === undefined && Q.material === undefined) Q.skin = 'skin_pale';
    if (Q.head.beard === undefined) Q.head.beard = 'none';
    if (Q.head.hair === undefined) Q.head.hair = 'leather';
    if (ar0 === undefined && !Q.upperOnly) { Q.torso.armour = 'chiton'; Q.robe = true; }
    if (Q.robe && Q.torso.trim === undefined) Q.torso.trim = 'gold';
  }
  if (Q.robe && !Q.torso.colour) Q.torso.colour = 'linen';
  if (Q.head.helmet && Q.head.helmet !== 'none') {   // accent: a bright crest that contrasts with the helmet
    const hmM = Q.head.helmetMat || 'bronze'; if (Q.head.crest === undefined) Q.head.crest = (Q.cape === 'crimson' || hmM === 'crimson') ? 'gold' : 'crimson';
  }
  const bodyMetal = (Q.head.helmet && Q.head.helmet !== 'none' && (Q.head.helmetMat || 'bronze') === 'bronze') || Q.torso.armour === 'muscle-cuirass';
  if (Q.shield && Q.shield !== 'none') {
    const sh: any = typeof Q.shield === 'string' ? { type: Q.shield } : { ...Q.shield };
    if (sh.type && sh.type !== 'none') {
      if (sh.colour === undefined && bodyMetal) { sh.colour = (Q.cape === 'crimson' || Q.torso.trim === 'crimson') ? 'aegean' : 'crimson'; if (sh.emblemColour === undefined) sh.emblemColour = 'gold'; }
      if (sh.emblem === undefined) sh.emblem = 'disc';
    }
    Q.shield = sh;
  }
  const prev = k.mono; if (Q.material) k.mono = mat(Q.material);
  const out = humanoidCore(k, Q);
  k.mono = prev;
  return out;
}

// ---------------- tree: olive (gnarled, silver-green), cypress (tall dark flame), laurel (round canopy) ----------------
export function tree(k: Kit, P: { at?: number[]; kind?: string; height?: number; leaf?: string } = {}): void {
  const at = P.at || [0, 0]; const u = at[0], v = at[1]; const kind = P.kind || 'olive'; const Hh = P.height || (kind === 'cypress' ? 34 : 26); const s = Hh / 26;
  const bark: Tex = (p) => { const a = atan2d(p[1] - v, p[0] - u); return Math.floor((a + 360) / 14 + p[2] * 0.35) % 3 === 0 ? -1 : (hash(p[0] * 2, p[1] * 2, p[2] * 2) > 0.86 ? 1 : 0); };
  const oT = k.obj();
  if (kind === 'cypress') {
    k.ilathe([u, v, 0], [[0, 0.9 * s], [1.0 * s, 2.0 * s], [3.0 * s, 1.5 * s], [Hh * 0.12, 1.3 * s]], 'wood', { obj: oT, tex: bark });
    const lm = P.leaf || 'laurel'; const f = k.obj();
    k.ilathe([u, v, 0], [[Hh * 0.08, 3.0 * s], [Hh * 0.25, 5.2 * s], [Hh * 0.5, 4.8 * s], [Hh * 0.75, 3.3 * s], [Hh * 0.92, 1.6 * s], [Hh, 0.15 * s]], lm,
      { obj: f, tex: (p) => { const a = atan2d(p[1] - v, p[0] - u); const q = hash(Math.floor((a + 360) / 22), Math.floor(p[2] / (1.3 * s)), 3); return q > 0.7 ? 2 : q < 0.3 ? -2 : (p[2] > Hh * 0.6 ? 1 : 0); } });
    return;
  }
  const lm = P.leaf || (kind === 'laurel' ? 'laurel' : 'olive');
  const of = k.obj();
  const cl: number[][] = [];
  if (kind === 'olive') {   // v6: gnarled olive: a twisting multi-strand trunk, root flare, black knot hollow, a fork into limbs that twist and branch
    const N = 8; const tp: V[] = [];
    for (let i = 0; i <= N; i++) { const t = i / N; const z = t * 12.5 * s; const ph = t * 5.2; const am = (0.5 + 1.7 * t) * s; tp.push([u + Math.sin(ph) * am - 0.8 * s * t, v + Math.cos(ph) * am * 0.8, z]); }
    const tr: number[] = [3.3, 2.9, 2.6, 2.7, 2.4, 2.1, 1.9, 1.7, 1.5].map((x) => x * s);
    k.ilathe([u, v, 0], [[0, 4.8 * s], [0.8 * s, 3.8 * s], [2.4 * s, 2.9 * s]], 'wood', { obj: oT, tex: bark });
    for (let i = 0; i < 4; i++) { const a0 = 25 + i * 95; k.solid(S.tube([[u + cosd(a0) * 2 * s, v + sind(a0) * 2 * s, 2.0 * s], [u + cosd(a0) * 4.0 * s, v + sind(a0) * 4.0 * s, 0.7 * s], [u + cosd(a0) * 6.2 * s, v + sind(a0) * 6.2 * s, 0.0]], [1.3 * s, 0.9 * s, 0.5 * s]), 'wood', { obj: oT, shift: -1, tex: bark }); }
    k.solid(S.tube(tp, tr), 'wood', { obj: oT, tex: bark });
    for (let j = 0; j < 2; j++) {   // twisted strands wound around the core
      const st: V[] = tp.map((q, i) => { const t = i / N; const ph = t * 7.0 + j * 3.14159; return [q[0] + Math.sin(ph) * 1.5 * s, q[1] + Math.cos(ph) * 1.4 * s, q[2]] as V; });
      k.solid(S.tube(st, tr.map((x) => x * 0.62)), 'wood', { obj: oT, shift: j ? 1 : -1, tex: bark });
    }
    const kn: V = [tp[3][0] + 2.3 * s, tp[3][1] - 1.0 * s, tp[3][2] + 0.3 * s];
    k.solid(S.ellipsoid(kn, [1.2 * s, 1.1 * s, 2.0 * s]), 'black', { obj: oT });
    const top = tp[N]; const f1: V[] = [top, [u - 2.4 * s, v + 1.0 * s, 14.8 * s], [u - 4.6 * s, v + 2.6 * s, 17.4 * s], [u - 5.8 * s, v + 1.8 * s, 20.6 * s]];
    const f2: V[] = [top, [u + 2.0 * s, v - 1.4 * s, 15.2 * s], [u + 4.2 * s, v - 3.0 * s, 17.8 * s], [u + 5.2 * s, v - 2.0 * s, 21.4 * s]];
    k.solid(S.tube(f1, [1.4 * s, 1.1 * s, 0.9 * s, 0.7 * s]), 'wood', { obj: oT, shift: 1, tex: bark }); k.solid(S.tube(f2, [1.4 * s, 1.1 * s, 0.9 * s, 0.7 * s]), 'wood', { obj: oT, shift: 1, tex: bark });
    const tw: V[][] = [[f1[2], [u - 7.6 * s, v + 4.0 * s, 20.0 * s], [u - 9.4 * s, v + 4.6 * s, 22.0 * s]], [f1[3], [u - 3.6 * s, v + 0.6 * s, 22.6 * s], [u - 2.4 * s, v + 0.2 * s, 25.0 * s]], [f2[2], [u + 7.2 * s, v - 4.6 * s, 19.8 * s], [u + 9.0 * s, v - 5.4 * s, 21.4 * s]], [f2[3], [u + 3.4 * s, v - 1.4 * s, 23.6 * s], [u + 2.4 * s, v - 0.6 * s, 26.0 * s]], [tp[5], [u + 2.0 * s, v + 4.0 * s, 15.0 * s], [u + 4.4 * s, v + 6.4 * s, 17.8 * s]]];
    for (const b of tw) k.solid(S.tube(b, [0.8 * s, 0.6 * s, 0.4 * s]), 'wood', { obj: oT, shift: 1, tex: bark });
    const ends: V[] = [f1[3], tw[0][2], tw[1][2], f2[3], tw[2][2], tw[3][2], tw[4][2]];
    for (let i = 0; i < ends.length; i++) { const e = ends[i]; cl.push([e[0] - u + (i % 2 ? 0.8 : -0.8) * s, e[1] - v, e[2] / s + 1.2, 3.9 - (i % 3) * 0.4]); }
    cl.push([-1.0, -0.5, 24.0, 4.2]);
  } else {
    const tw = (z: number): number => sind(z * 40 / s) * 1.3 * s * (z / Hh);
    const tp: V[] = [[u, v, 0], [u + tw(3 * s) + 0.6 * s, v + 0.8 * s, 4.5 * s], [u + tw(8 * s) - 0.6 * s, v - 0.5 * s, 9.5 * s], [u + 1.6 * s, v + 0.6 * s, 13.5 * s]];
    k.ilathe([u, v, 0], [[0, 3.8 * s], [1.0 * s, 3.0 * s], [2.2 * s, 2.5 * s]], 'wood', { obj: oT, tex: bark });
    k.solid(S.tube(tp, [2.0 * s, 1.6 * s, 1.3 * s, 1.1 * s]), 'wood', { obj: oT, tex: bark });
    const br: V[][] = [[tp[3], [u - 3.2 * s, v + 1.5 * s, 16.5 * s], [u - 6.0 * s, v + 2.0 * s, 19.5 * s]], [tp[2], [u + 3.8 * s, v - 2.0 * s, 13.8 * s], [u + 7.0 * s, v - 3.0 * s, 17.5 * s]]];
    for (const b of br) k.solid(S.tube(b, [1.1 * s, 0.8 * s, 0.55 * s]), 'wood', { obj: oT, shift: -1, tex: bark });
    for (const c of [[-5.8, 2.2, 21.0, 4.6], [2.0, 6.2, 22.0, 4.8], [7.0, -3.0, 19.5, 4.6], [-1.0, -0.5, 24.0, 5.2], [-6.0, -3.5, 17.5, 3.8], [3.5, 2.0, 18.6, 3.8], [9.0, 1.0, 16.5, 3.2]]) cl.push(c);
  }
  for (let i = 0; i < cl.length; i++) {
    const c = cl[i]; const cc: V = [u + c[0] * (kind === 'olive' ? 1 : s), v + c[1] * (kind === 'olive' ? 1 : s), c[2] * s]; const rr = c[3] * s;
    k.solid(S.ellipsoid(cc, [rr * 1.25, rr * 1.25, rr * 0.82]), lm, { obj: of, shift: i % 3 === 0 ? 1 : 0, tex: (p) => { const q = hash(p[0] * 1.1, p[1] * 1.1, p[2] * 1.1); const t = (p[2] - cc[2]) / rr; return q > 0.8 ? 2 : q < 0.25 ? -2 : (t > 0.3 ? 1 : t < -0.3 ? -1 : 0); } });
  }
}

// ---------------- hydra: a serpent body on stubby legs with n necks, each ending in a fanged head ----------------
export function hydra(k: Kit, P: { at?: number[]; facing?: number; heads?: number; colour?: string } = {}): void {
  const n = clamp(P.heads || 3, 2, 7); const cm = mat(P.colour || 'snake'); const bellyM = 'bone';
  const R = new Rig(k); const ob = k.obj(), oN = k.obj(), oH = k.obj(), oL = k.obj();
  const ax: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const skin: LTex = (p) => (hash(Math.floor(p[0] * 1.2), Math.floor(p[1] * 1.2), Math.floor(p[2] * 1.2)) > 0.74 ? -1 : (p[2] > 7.4 ? 1 : 0));
  R.shape((X) => S.smooth(1.6, S.ellipsoid(X.w([0, 0, 4.4]), [7.2, 4.4, 3.6]), S.ellipsoid(X.w([-4.5, 0, 4.2]), [4.2, 3.4, 3.0])), cm, { obj: ob, tex: skin });
  R.ell([1.0, 0, 3.0], [5.6, 3.6, 2.0], ax, bellyM, { obj: ob, shift: -1 });
  R.key([0, 0, 0.8], 0);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const hp: V = [sx * 3.6, sy * 3.0, 3.0]; const ft: V = [sx * 4.3, sy * 3.9, 0.6];
    R.limb(hp, ft, 1.6, 0.9, 0.3, 0.4, cm, { obj: oL }); R.ell([ft[0] + 0.5, ft[1], 0.4], [1.5, 1.2, 0.6], ax, cm, { obj: oL, shift: -1 }); R.key([ft[0] + 0.5, ft[1], 0], 0);
  }
  R.tube([[-7, 0, 4.4], [-11, 1.6, 3.4], [-15, -0.8, 2.2], [-18, 1.2, 1.2]], [2.4, 1.8, 1.1, 0.25], cm, { obj: oL, tex: skin });
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; const sy = t * 2;                   // -1..1 across the body
    const b0: V = [3.6 + 0.4 * (1 - Math.abs(sy)), sy * 2.6, 6.8];
    const lean = sy * 5.5 + (i % 2 ? 1.0 : -1.0) * 1.2; const hgt = 15 + (i % 3) * 2.6 - Math.abs(sy) * 1.2;
    const m1: V = [b0[0] + 1.5, b0[1] + lean * 0.35, b0[2] + hgt * 0.28]; const m2: V = [b0[0] - 0.6 + (i % 2) * 2.0, b0[1] + lean * 0.75, b0[2] + hgt * 0.6];
    const nt: V = [b0[0] + 2.0 + (i % 2) * 1.2, b0[1] + lean, b0[2] + hgt];
    R.tube([b0, m1, m2, nt], [2.1, 1.75, 1.5, 1.35], cm, { obj: oN, shift: 0, tex: (p) => (Math.floor(p[2] * 1.4) % 2 === 0 ? -1 : 0) });
    const hc: V = [nt[0] + 1.2, nt[1], nt[2] + 0.6];
    R.ell(hc, [2.5, 1.9, 1.7], ax, cm, { obj: oH, shift: 1, tex: (p) => (p[0] > hc[0] + 0.8 && p[2] > hc[2] - 0.1 && Math.abs(Math.abs(p[1] - hc[1]) - 1.15) < 0.5 ? ['gold', 0] : 0) });
    R.cap([hc[0] + 0.6, hc[1], hc[2] - 0.2], [hc[0] + 3.9, hc[1], hc[2] - 0.7], 1.25, 0.95, cm, { obj: oH, shift: 0 });
    R.cap([hc[0] + 1.0, hc[1], hc[2] - 0.55], [hc[0] + 3.7, hc[1], hc[2] - 1.35], 0.7, 0.55, 'bone', { obj: oH, shift: 1 });      // lower jaw
    R.plate([[hc[0] + 3.0, hc[1], hc[2] - 1.0], [hc[0] + 5.2, hc[1] + 0.5, hc[2] - 1.3], [hc[0] + 4.6, hc[1], hc[2] - 1.0], [hc[0] + 5.2, hc[1] - 0.5, hc[2] - 1.3]], 0.3, 'crimson', { obj: oH });   // forked tongue
    for (const sd of [-1, 1]) R.cap([hc[0] + 3.3, hc[1] + sd * 0.7, hc[2] - 0.9], [hc[0] + 3.4, hc[1] + sd * 0.7, hc[2] - 1.8], 0.22, 0.05, 'marble', { obj: oH });     // fangs
    R.cap([hc[0] - 0.4, hc[1], hc[2] + 1.3], [hc[0] - 1.8, hc[1], hc[2] + 2.3], 0.3, 0.08, 'bone', { obj: oH });                      // horn
    R.key([hc[0], hc[1], hc[2] + 1.8], 0);
  }
  R.emit(new Frame(P.at || [0, 0], P.facing === undefined ? 25 : P.facing, 0));
}

// ---------------- v6: themes ('settings'), hero (male/female, melee + ranged), trireme ----------------
// A theme is the material set + palette of one setting. Only 'greek' exists; add THEMES.<name> to add a setting.
export type Theme = { name: string; metal: string; trim: string; cloth: string; cloth2: string; accent: string; leather: string; wood: string; skinM: string; skinF: string; hairM: string; hairF: string; sail: string; sailStripe: string; hullTrim: string; water: string; stone: string };
export const THEMES: { [k: string]: Theme } = {
  greek: { name: 'greek', metal: 'bronze', trim: 'gold', cloth: 'linen', cloth2: 'aegean', accent: 'crimson', leather: 'leather', wood: 'wood', skinM: 'skin_olive', skinF: 'skin_olive', hairM: 'fur_dark', hairF: 'fur', sail: 'linen', sailStripe: 'crimson', hullTrim: 'crimson', water: 'aegean', stone: 'marble' },
};
export function theme(name?: string): Theme { return THEMES[name || 'greek'] || THEMES.greek; }

export type HeroP = { sex?: string; melee?: string; ranged?: string; ready?: string; pose?: string; at?: number[]; facing?: number; setting?: string; helmet?: string; cape?: boolean; height?: number; build?: string; palette?: { cloth?: string; accent?: string; hair?: string; skin?: string; metal?: string } };
// hero(): same armour materials for both sexes; different silhouette. pose: idle|idle1-4|walk1-6|melee1-5|ranged1-5|hurt|death
export function hero(k: Kit, P: HeroP = {}): { top: V } {
  const th = theme(P.setting); const pl = P.palette || {}; const fem = P.sex === 'female';
  const melee = P.melee || 'xiphos', ranged = P.ranged || 'bow';
  let pn = P.pose || 'idle'; let ready = P.ready || 'melee';
  const mm = /^(melee|ranged)([1-5])$/.exec(pn);
  if (mm) { ready = mm[1]; pn = 'attack' + mm[2]; }
  const inHand = ready === 'ranged' ? ranged : melee; const other = ready === 'ranged' ? melee : ranged;
  const metal = pl.metal || th.metal;
  const Q: Humanoid5 = {
    at: P.at, facing: P.facing === undefined ? 20 : P.facing, pose: pn, weapon: inHand, stow: [other], fem,
    height: P.height || (fem ? 20.5 : 23), build: P.build || (fem ? 'slim' : 'average'),
    skin: pl.skin || (fem ? th.skinF : th.skinM),
    head: { hair: pl.hair || (fem ? th.hairF : th.hairM), hairStyle: fem ? 'ponytail' : 'short', helmet: P.helmet || 'none', beard: 'none' },
    torso: { armour: 'muscle-cuirass', colour: metal, trim: th.trim, skirtColour: pl.cloth || th.cloth2 },
    skirt: fem ? 'chiton' : 'pteruges',
    legs: { greaves: true, sandals: true }, arms: { bracers: true },
  };
  if (P.cape) Q.cape = pl.accent || th.accent;
  return humanoid(k, Q);
}

// ship(): trireme / war galley seen side-on. Strake tubes give planking and a curved sheer; raised prow with a bronze ram, curled stern post, shield row, oars, optional sail and dock.
export function ship(k: Kit, P: { at?: number[]; facing?: number; kind?: string; sail?: boolean; oars?: number; dock?: boolean; setting?: string } = {}): void {
  const th = theme(P.setting); const R = new Rig(k); const oH = k.obj(), oD = k.obj(), oO = k.obj(), oS = k.obj(), oP = k.obj();
  const ax: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const gal = P.kind === 'galley'; const s = P.dock ? 0.7 : (P.sail ? 0.82 : 0.95); const Lh = (gal ? 10 : 11.5) * s; const LV = 6; const N = 10;
  const P3 = (f: number, l: number, z: number): V => [f * s, l * s, z * s];
  const rise = (u: number): number => (u > 0 ? 3.8 * u * u : 2.3 * u * u);
  const zbF = (u: number): number => 0.9 + 1.0 * u * u;
  const wF = (u: number): number => Math.pow(Math.max(0.0, 1 - u * u), 0.6);
  const beam = gal ? 3.9 : 4.4;
  for (const sd of [-1, 1]) for (let lv = 0; lv < LV; lv++) {
    const t = lv / (LV - 1); const pts: V[] = [];
    for (let j = 0; j <= N; j++) {
      const f = Lh / s * (-1 + 2 * j / N); const u = f * s / Lh; const top = 5.9 + rise(u); const zb = zbF(u);
      pts.push(P3(f, sd * (1.1 + (beam - 1.1) * Math.pow(t, 0.75)) * wF(u) + 0.0, zb + (top - zb) * t));
    }
    const top = lv === LV - 1;
    k.solid(S.tube(pts, pts.map(() => 0.72 * s)), top ? th.hullTrim : th.wood, { obj: oH, shift: top ? 0 : (lv % 2 ? -1 : 0), tex: (p) => (hash(Math.floor(p[0] * 1.3 / s), 7, Math.floor(p[2] * 2 / s)) > 0.82 ? -1 : 0) });
  }
  k.solid(S.tube([P3(-Lh / s, 0, zbF(-1) + 0.4), P3(-Lh / s * 0.5, 0, zbF(-0.5) - 0.2), P3(0, 0, 0.5), P3(Lh / s * 0.5, 0, zbF(0.5) - 0.2), P3(Lh / s, 0, zbF(1) + 0.4)], [0.9 * s, 1.0 * s, 1.1 * s, 1.0 * s, 0.9 * s]), th.wood, { obj: oH, shift: -2 });
  // deck
  const dk: V[] = []; for (let j = 0; j <= N; j++) { const f = Lh / s * (-1 + 2 * j / N); dk.push(P3(f, (beam - 0.9) * wF(f * s / Lh), 4.6)); } for (let j = N; j >= 0; j--) { const f = Lh / s * (-1 + 2 * j / N); dk.push(P3(f, -(beam - 0.9) * wF(f * s / Lh), 4.6)); }
  k.solid(S.plate(dk, 0.7 * s), th.wood, { obj: oD, shift: 1, tex: (p) => (Math.floor(p[0] * 1.1 / s) % 2 === 0 ? 0 : -1) });
  for (let b = 0; b < 5; b++) { const f = (-0.7 + b * 0.35) * Lh / s; const w = (beam - 0.7) * wF(f * s / Lh); k.solid(S.capsule(P3(f, -w, 5.2), P3(f, w, 5.2), 0.4 * s, 0.4 * s), th.wood, { obj: oD, shift: -1 }); }
  // prow: curved stem post, bronze ram at the waterline
  const bz = 5.9 + rise(1);
  R.tube([P3(Lh / s, 0, bz - 0.8), P3(Lh / s + 0.8, 0, bz + 1.0), P3(Lh / s + 0.6, 0, bz + 2.6), P3(Lh / s - 0.5, 0, bz + 3.6)], [0.95 * s, 0.85 * s, 0.7 * s, 0.5 * s], th.wood, { obj: oH, shift: 1 });
  R.sph(P3(Lh / s - 0.6, 0, bz + 3.8), 0.7 * s, th.trim, { obj: oH });
  R.cap(P3(Lh / s - 1.2, 0, zbF(1) + 0.9), P3(Lh / s + 4.6, 0, zbF(1) + 0.4), 1.4 * s, 0.4 * s, th.metal, { obj: oH });
  for (let i = 0; i < 3; i++) R.ring(P3(Lh / s + 0.4 + i * 1.3, 0, zbF(1) + 0.85 - i * 0.12), [1, 0, 0], (1.3 - i * 0.28) * s, 0.28 * s, th.trim, { obj: oH });
  // stern post: tall curl with a gold tip
  const sz = 5.9 + rise(-1);
  R.tube([P3(-Lh / s, 0, sz - 0.8), P3(-Lh / s - 0.9, 0, sz + 1.8), P3(-Lh / s - 0.5, 0, sz + 4.6), P3(-Lh / s + 1.0, 0, sz + 6.2), P3(-Lh / s + 2.4, 0, sz + 6.0)], [1.0 * s, 0.9 * s, 0.8 * s, 0.6 * s, 0.4 * s], th.wood, { obj: oH, shift: 1 });
  R.sph(P3(-Lh / s + 2.6, 0, sz + 5.9), 0.75 * s, th.trim, { obj: oH });
  // painted eye on both bows + gold bands near the rail
  // (eye as marble discs pressed against the hull side)
  for (const sd of [-1, 1]) {
    const u = 0.52; const f = u * Lh / s; const yy = sd * (beam * 0.78) * wF(u) + sd * 0.3; const zz = 3.9 + rise(u) * 0.9;
    R.ell(P3(f, yy, zz), [1.3 * s, 0.25 * s, 0.8 * s], ax, 'marble', { obj: oS, shift: 2 }); R.ell(P3(f + 0.2, yy + sd * 0.2, zz), [0.6 * s, 0.25 * s, 0.6 * s], ax, th.water, { obj: oS }); R.sph(P3(f + 0.2, yy + sd * 0.4, zz), 0.25 * s, 'black', { obj: oS });
  }
  // shield row along the rail
  for (const sd of [-1, 1]) for (let i = 0; i < 7; i++) {
    const u = -0.62 + i * 0.205; const f = u * Lh / s; const yy = sd * (beam + 0.4) * wF(u); const zz = 5.9 + rise(u) + 0.3;
    R.ell(P3(f, yy, zz), [0.95 * s, 0.4 * s, 0.95 * s], ax, i % 2 ? th.accent : th.metal, { obj: oS, shift: 0, tex: (p) => (Math.abs(p[1]) > 0 && Math.hypot(p[0] - f * s, p[2] - zz * s) < 0.35 * s ? [th.trim, 1] : 0) });
  }
  // oars
  const no = P.oars || (gal ? 4 : 5);
  for (const sd of [-1, 1]) for (let i = 0; i < no; i++) {
    const u = -0.5 + i * (1.0 / Math.max(1, no - 1)) * 0.95; const f = u * Lh / s; const w = beam * wF(u); const z0 = 5.9 + rise(u) - 0.6;
    const a: V = P3(f + 0.4, sd * (w - 1.4), z0 + 0.5); const b: V = P3(f - 1.6, sd * (w + 5.2), 0.9);
    R.cap(a, b, 0.32 * s, 0.4 * s, th.wood, { obj: oO, shift: 1 });
    R.ell(P3(f - 1.9, sd * (w + 5.7), 0.7), [0.5 * s, 1.5 * s, 0.22 * s], ax, th.accent, { obj: oO, shift: 0 });
    R.sph(P3(f, sd * (w + 0.3), z0), 0.45 * s, th.leather, { obj: oO });
  }
  // steering oar
  R.cap(P3(-Lh / s + 1.0, 3.4, 7.0), P3(-Lh / s - 1.8, 4.6, 1.0), 0.4 * s, 0.35 * s, th.wood, { obj: oO, shift: 1 });
  R.ell(P3(-Lh / s - 2.0, 4.7, 0.7), [0.4 * s, 0.5 * s, 1.5 * s], ax, th.wood, { obj: oO });
  if (P.sail) {
    const mf = 1.0; const mh = 21;
    R.cap(P3(mf, 0, 4.0), P3(mf, 0, mh), 0.7 * s, 0.45 * s, th.wood, { obj: oS });
    R.cap(P3(mf, -8, mh - 1.8), P3(mf, 8, mh - 1.8), 0.4 * s, 0.4 * s, th.wood, { obj: oS, shift: 1 });
    R.drape(P3(mf + 0.2, 0, mh - 2.0), [0, 1, 0], [0, 0, -1], 7.4 * s, 6.4 * s, 10.5 * s, 0.5 * s, 2, 0.5 * s, th.sail, { obj: oS, shift: 2, tex: (p) => (Math.floor((p[1] + 20 * s) * 1.1 / s) % 3 === 0 ? [th.sailStripe, 0] : 0) });
    R.cap(P3(mf, 0, mh), P3(mf, 0, mh + 1.2), 0.45 * s, 0.1 * s, th.trim, { obj: oS });
  }
  if (P.dock) {
    const dl = 5.6; const dz = 2.6;
    R.plate([P3(-12.5, beam + 1.6, dz), P3(12.5, beam + 1.6, dz), P3(12.5, beam + 9.5, dz), P3(-12.5, beam + 9.5, dz)], 0.7 * s, th.wood, { obj: oP, shift: 1, tex: (p) => (Math.floor(p[0] * 0.8 / s) % 2 === 0 ? 0 : -1) });
    for (const fx of [-11.5, -4, 4, 11.5]) for (const ly of [beam + 2.0, beam + 9.0]) R.cap(P3(fx, ly, 0.0), P3(fx, ly, dz + 1.6), 0.55 * s, 0.55 * s, th.wood, { obj: oP, shift: -1 });
    R.cap(P3(-6, beam + 2.0, dz + 0.4), P3(6, beam + 2.0, dz + 0.4), 0.2 * s, 0.2 * s, 'linen', { obj: oP, shift: 2 }); void dl;
    R.cap(P3(-3, beam + 1.6, dz + 0.5), P3(-1.5, beam - 0.6, 5.2), 0.22 * s, 0.22 * s, 'linen', { obj: oP, shift: 2 });
    R.cyl(P3(10, beam + 3.0, dz + 0.3), P3(10, beam + 3.0, dz + 2.2), 0.5 * s, 0.5 * s, th.trim, { obj: oP });
  }
  R.key(P3(0, 0, 0.5), 0);
  const fc = P.facing === undefined ? 5 : P.facing;
  R.emit(new Frame(P.at || [0, 0], fc, 0));
}
