
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
  R.emit(new Frame(P.at || [0, 0], fc + TURN.degrees, (P.at && P.at[2]) || 0));
}
export function centaur(k: Kit, P: { at?: number[]; facing?: number; colour?: string; pose?: string; upper?: HumanoidP } = {}): void {
  quadruped(k, { at: P.at, facing: P.facing, kind: 'horse', colour: P.colour || 'fur', pose: P.pose, rider: { ...(P.upper || {}), pose: P.pose } });
}
