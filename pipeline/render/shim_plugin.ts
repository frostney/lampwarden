import { plugin } from 'bun';
plugin({ name: 'shotcup', setup(b) { b.onResolve({ filter: /^shotcup:canvas$/ }, () => ({ path: import.meta.dir + '/shim_canvas.ts' })); } });
