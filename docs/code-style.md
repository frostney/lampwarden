# Code style

The TypeScript and React rules come from the `typescript-stack` and `react-stack` skills in `.agents/skills/`. What
they mean here:
- **Names say what they hold.** No one- or two-letter variables, parameters or properties (`state`, not `s`;
  `velocityX`, not `vx`; `health`, not `hp`). `x` and `y` for coordinates and `id` are fine. The lint plugin catches
  bindings; property names are on review.
- **No `any`, no `!`, no `as`.** Accept `unknown` at untrusted boundaries and validate it once with Zod (the plays API);
  narrow with `instanceof` or a guard elsewhere.
- **Types do the type checking.** Don't write runtime checks or tests that only re-assert what the compiler already
  guarantees; validate only data from outside the program (requests, storage, the gamepad API).
- **Tests check behaviour that can regress**: replay determinism, sim outcomes, the visual verifier for anything on
  screen.
- **No tautological tests.** Every assertion must be able to fail when the code it covers breaks. Don't assert:
  - what the compiler already guarantees: that a field exists, a tuple's length, a value's type;
  - a constant or a static table against its own literal (`expect(SEA_COLOUR).toBe(0x1e5f8a)`), or a template function
    against the template it fills in;
  - an expected value worked out by the code under test, or by a copy of its formula;
  - a value the test has just set, read straight back;
  - a fake or an in-memory store on its own, when no production code runs in between;
  - something that holds by construction (a string that is always non-empty, a file that differs from its copy right
    after the test rewrote it), or what another assertion in the same test already pins.

  Pin a tuning number through the behaviour it drives (a creature can come in time on every night), not by restating
  it. A rule the program must keep is tested where the code builds it (the Mubit client's own tests pin the request it
  sends).
- **Pixel art is code.** Sprites come from kit builder scripts, icons and projectiles from pixel grids or drawing code,
  the logo from `tools/logo`. Commit the code with the image.
