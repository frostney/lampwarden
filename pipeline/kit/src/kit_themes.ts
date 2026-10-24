
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
