
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
