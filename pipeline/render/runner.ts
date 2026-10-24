// The runner a render sandbox executes for one sprite (batch.ts starts one per item):
//   bun --preload ./shim_plugin.ts runner.ts <build.ts> <name> [pose]   (KIT_OUT = output dir, default ./out)
// It runs model-written code, so model code reaches it only inside the Vercel Sandbox VM, never on a host.
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
console.log(JSON.stringify({ name, ms, fit: k.fit, snapped: k.snapped, dropped: k.dropped, ...r.stats }));
