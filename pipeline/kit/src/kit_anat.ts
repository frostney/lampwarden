
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
