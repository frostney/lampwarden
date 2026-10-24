
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
        const x = (t + d) / 2, y = (t - d) / 2, z = (this.oy + t - cy) / ZK; const e = 0.04;
        const n = norm([s.f(x + e, y, z) - s.f(x - e, y, z), s.f(x, y + e, z) - s.f(x, y - e, z), s.f(x, y, z + e) - s.f(x, y, z - e)]);
        depth[idx] = t; part[idx] = pi; nrm[idx * 3] = n[0]; nrm[idx * 3 + 1] = n[1]; nrm[idx * 3 + 2] = n[2];
        pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
      }
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
      for (let py = Y0; py <= Y1; py++) for (let px = X0; px <= X1; px++) {
        const i = py * W + px; if (part[i] >= 0) continue;
        const d = (px + 0.5 - this.ox) / 2; const sg = py + 0.5 - this.oy; const g: V = [(sg + d) / 2, (sg - d) / 2, 0];
        let t = 0.15; let inShadow = false;
        for (let it = 0; it < 90 && t < 60; it++) {
          const q = add(g, mul(LIGHT, t)); let md = BIG;
          for (const P of this.parts) {
            const dc = len(sub(q, P.c)) - P.R; if (dc > md) continue;
            md = Math.min(md, Math.max(dc, P.s.f(q[0], q[1], q[2])));
          }
          if (md < 0.03) { inShadow = true; break; }
          t += Math.max(md * 0.8, 0.05);
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
  for (let i = 0; i < N; i++) {
    if (out[i * 4 + 3] !== 255) continue; let bd = BIG, bc = PALFLAT[0];
    for (const c of PALFLAT) { const dd = (c[0] - out[i * 4]) * (c[0] - out[i * 4]) + (c[1] - out[i * 4 + 1]) * (c[1] - out[i * 4 + 1]) + (c[2] - out[i * 4 + 2]) * (c[2] - out[i * 4 + 2]); if (dd < bd) { bd = dd; bc = c; } }
    if (bd > 0) { clamped++; out[i * 4] = bc[0]; out[i * 4 + 1] = bc[1]; out[i * 4 + 2] = bc[2]; }
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
