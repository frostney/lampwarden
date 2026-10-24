
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
    const rk = k.obj(); const ang = Math.atan(pitch);
    for (const sd of [-1, 1]) {
      const a: V = [xr1 - 0.2, sd * (eY + 0.3), zt], b: V = [xr1 - 0.2, 0, zt + (eY + 0.3) * pitch];
      K.cap([a[0], a[1], a[2] + 0.55], [b[0], b[1], b[2] + 0.55], 0.75, 0.75, m, { obj: rk, shift: 1 });
    }
    K.box([xr1 - 1.2, -eY, zt - 0.4], [xr1, eY, zt + 0.4], m, { obj: rk, shift: 1 });
    // roof slopes with tile courses, cover-tile ribs, antefixes
    const zr = zt + hp; const tile = (p: V): TexOut => { const d = Math.abs(p[1]); return fr(d / 3.6) < 0.2 ? -2 : 0; };
    for (const sd of [-1, 1]) K.plate([[xr0, sd * eY, zt + 0.2], [xr1 - 0.6, sd * eY, zt + 0.2], [xr1 - 0.6, 0, zr + 0.35], [xr0, 0, zr + 0.35]], 1.3, rm, { shift: sd < 0 ? -1 : 0, tex: tile });
    const ribs = k.obj(); const nr = Math.max(2, Math.round((xr1 - xr0 - 2.4) / 4.4)); const lift = 0.95 / Math.cos(Math.atan(pitch));
    for (let i = 0; i <= nr; i++) {
      const x = xr0 + 1.2 + i * (xr1 - xr0 - 3.0) / nr;
      for (const sd of [-1, 1]) {
        K.cap([x, sd * (eY - 0.6), zt + 0.2 + 0.65 + lift * 0.6 + 0.6 * pitch], [x, sd * 0.6, zr + 0.35 + 0.65 + lift * 0.6 - 0.6 * pitch], 0.95, 0.95, rm, { obj: ribs, shift: 1, tex: (p) => (fr(Math.abs(p[1]) / 3.6) < 0.16 ? -1 : 0) });
        if (sd > 0) K.plate([[x - 1.1, eY + 0.2, zt + 0.3], [x + 1.1, eY + 0.2, zt + 0.3], [x + 0.9, eY + 0.2, zt + 2.2], [x, eY + 0.2, zt + 3.0], [x - 0.9, eY + 0.2, zt + 2.2]], 0.6, m, { obj: ribs, shift: 1 });
      }
    }
    K.cap([xr0, 0, zr + 1.0], [xr1 - 0.6, 0, zr + 1.0], 0.9, 0.9, rm, { shift: 1 });   // ridge
    // akroteria: palmette at the apex, urns on the corners
    const ak = P.roof === 'marble' ? 'gold' : m;
    K.plate([[xr1 - 0.2, -1.6, zr + 1.2], [xr1 - 0.2, 1.6, zr + 1.2], [xr1 - 0.2, 2.2, zr + 3.4], [xr1 - 0.2, 0, zr + 4.6], [xr1 - 0.2, -2.2, zr + 3.4]], 0.8, ak, { shift: 1 });
    for (const sd of [-1, 1]) K.lathe([xr1 - 0.4, sd * eY, zt + 0.6], [[0, 0.9], [0.8, 1.2], [1.9, 0.7], [2.4, 1.0]], ak, { shift: 0 });
    void ang;
  });
}
