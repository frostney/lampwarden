
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
    if (has('pots')) {
      const fv = [[X - 3.2, 'flowers', 3.0], [-X + 4, 'laurel', 3.6]].filter((q) => !stairOn || (q[0] as number) < stairX0 - 3);
      for (const q of fv) pot(q[0] as number, Y + 2.0, q[2] as number, q[1] as string);
      pot(X + 2.2, dOp && dOp.f === 'u' ? Math.min(Y - 2, dOp.c + dOp.w / 2 + 2.6) : -Y + 3.0, 3.2, 'flowers');
      if (!tiled) pot(-X + 2.8, Y - 3.0, 2.4, 'laurel', H);   // on the roof behind the parapet
    }
    if (has('amphora')) {   // a plain storage amphora beside the door (or the front corner)
      const at = dOp ? (dOp.f === 'u' ? [X + 1.8, dOp.c - dOp.w / 2 - 2.6] : [dOp.c - dOp.w / 2 - 2.6, Y + 1.8]) : [X + 1.8, -Y + 7];
      amphora(k, { at, height: 5.6, style: 'plain' });
    }
    if (has('bougainvillea')) {   // purple flowering creeper spilling over the door (or the front corner)
      const bo = k.obj(); const o = dOp;
      const z0 = o ? o.h + 1.2 : H * 0.5;
      for (let i = 0; i < 16; i++) {   // a canopy along the parapet over the door, trailing down the door's left side
        const a = hash(i, 3, 1), b = hash(i, 5, 2); const trail = i >= 11;
        const zz = trail ? z0 - (i - 10) * 1.6 : z0 + (H + 1.4 - z0) * hash(i, 7, 3);
        const along = (o ? o.c : Y - 2) + (trail ? (o ? -o.w / 2 - 1.4 : -2) + (b - 0.5) * 1.2 : (b - 0.5) * 10 - 1.2);
        const c: V = o && o.f === 'v' ? [along, Y + 0.5 + a * 0.8, zz] : [X + 0.5 + a * 0.8, along, zz];
        K.sph(c, (trail ? 0.8 : 1.0) + a * 0.5, 'purple', { obj: bo, shift: 1, tex: (p) => (hash(Math.floor(p[0] * 2.2), Math.floor(p[1] * 2.2), Math.floor(p[2] * 2.2)) > 0.74 ? ['laurel', 0] : 0) });
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
