
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
