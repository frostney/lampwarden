// Preloaded into every runner process (`bun --preload ./shim_plugin.ts`): resolves the kit's first-home import
// `shotcup:canvas` to the canvas shim beside this file.
import { plugin } from "bun";

plugin({
  name: "shotcup",
  setup(build) {
    build.onResolve({ filter: /^shotcup:canvas$/ }, () => ({ path: `${import.meta.dir}/shim_canvas.ts` }));
  },
});
