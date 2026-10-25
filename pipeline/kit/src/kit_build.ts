
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
  const hF0 = norm(LD([cosd(-hz), 0, sind(-hz)])); const fA = (P.facing === undefined ? 0 : P.facing) + TURN.degrees;
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
  const camA = 45 - ((P.facing === undefined ? -35 : P.facing) + TURN.degrees); const wcam: V = norm(add(mul(aF, -sind(camA)), mul(aL, cosd(camA))));
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
  if (!P.rig) R.emit(new Frame(P.at || [0, 0], (P.facing || 0) + TURN.degrees, (P.at && P.at[2]) || 0), g(po.fall));
  return { top: add(Hc, mul(hZ, hr)) };
}
export function winged(k: Kit, P: HumanoidP & { span?: number } = {}): { top: V } {
  return humanoid(k, { ...P, wings: { type: (P.wings && P.wings.type) || 'feather', colour: P.wings && P.wings.colour, span: P.span || (P.wings && P.wings.span) || 12 } });
}
