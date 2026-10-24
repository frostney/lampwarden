// bun --preload ./shim_plugin.ts run_local.ts <build.ts> <name> [pose]   (KIT_OUT = output dir, default ./out)
// Also writes <name>_x4.png, the sprite magnified 4x on the verifier's backdrop, unless KIT_X4=0. Nothing in the pipeline
// reads it (pipeline/verifier-image.ts builds the verifier's image from the 128 px PNG on the host); see docs/LIVE_GENERATION.md, "Pixel scaling".
import { createCanvas } from './shim_canvas.ts';
import * as K from '../kit/kit.ts';
import { readFileSync } from 'node:fs';
const [file, name, poseName] = process.argv.slice(2);
const src = readFileSync(file, 'utf8');
const names = Object.keys(K).filter((n) => /^[A-Za-z_]\w*$/.test(n));
const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(src.replace(/^\s*export\s+/m, '')).replace(/^\s*export\s*\{[^}]*\};?\s*$/m, '');
const t0 = performance.now();
const fn = new Function(...names, 'POSE', body + '\nreturn build;')(...names.map((n) => (K as any)[n]), poseName || '');
const k = new K.Kit(); fn(k);
const r = K.post(k.render());
const ms = Math.round(performance.now() - t0);
createCanvas(128, 128, { pixels: r.rgba }).save('/out/' + name + '.png');
if (process.env.KIT_X4 !== '0') createCanvas(512, 512, { pixels: K.onBg(r, [46, 46, 56], 4).rgba }).save('/out/' + name + '_x4.png');
console.log(JSON.stringify({ name, ms, fit: k.fit, snapped: k.snapped, dropped: k.dropped, ...r.stats }));
