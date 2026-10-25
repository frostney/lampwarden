# Ideas for after the hackathon

Things we found or wanted during Night Shift (24–25 October 2026) and left for later. Each names where it came from, so
the context can be picked up again. Nothing here is committed to; it is a list to choose from.

## Mubit and the model calls

- **Tune the calls for Claude Opus 5.5, measured before switching.** None of the Mubit calls sets `output_config.effort`,
  so on Claude Opus 5.5 they all run at its default, `medium` (Claude Opus 5 defaulted to `high`).
  - **Effort first.** Sweep effort per route: generator, verifier, fix, creature brief writer, director. Effort leaves
    the system prompt as it is, so it should stay in the same Mubit task.
  - **Then the prompts.** Audit `pipeline/prompts/` against Anthropic's Claude Opus 5.5 guidance, and try structured
    outputs (`output_config.format`) for the verifier score, the brief and the director's decision. Check first that
    Mubit passes `output_config` through.
  - **Then the image prep.** Re-test whether the verifier still needs `pipeline/verifier-image.ts`'s preparation, since
    the model reads images more precisely now.
  - **Mind the side effects.** Any system-prompt change starts a new Mubit task, whose adapter starts from zero, and a new
    verifier prompt needs `bun run calibrate:verifier` again (#30).
- **Show a model update in the game.** Rate the generator and verifier requests Good/Bad in the Mubit console. Once an
  adapter trains, compare acceptance rates before and after it.

## Generation pipeline and the kit

- **A cypress that reads as a cypress.** The kit's `tree(kind: 'cypress')` draws a fat egg shape, so the Mubit cypress was
  rejected (#69). This is a kit change, then a new sandbox snapshot.
- **A gold thunderbolt on a marble Zeus.** `material: 'marble'` overrides `weaponMat: 'gold'`, so the verifier's
  suggested fix does nothing, and the statue stays below the acceptance bar (5.5, #70).
- **Poses for every body.** Humanoids, centaurs and quadrupeds animate. Lamia bodies barely move, and the hydra takes no
  pose (#50). The brief writer steers away from them for now (#57).
- **A stricter animation check.** A generated creature that ignores `POSE` is only refused when all its walk frames are
  identical (#57).
- **Smaller creature atlases.** One animated creature's atlas was about 10 times its still sprite, measured on a single
  creature (#57).
- **Back off failing jobs.** A creature job that fails every time is retried at each night start and dawn, up to twice a
  night, within the limits (#59).
- **One unexplained slow sandbox run.** A batch once took 340 s where the work inside the VM took 2.6 s, and it did not
  repeat (#57).

## Operations

- **Catch a stale sandbox snapshot before it ships.** Any change to `pipeline/kit/kit.ts` or `pipeline/render/` makes the
  snapshot in `VERCEL_SANDBOX_SNAPSHOT_ID` stale, and live generation then fails until someone builds a new one and sets
  the variable. It happened twice in one night (#53, #67). Options:
  - a CI check that compares the runner bundle digest with the deployed snapshot's manifest;
  - building the snapshot as part of the deploy.

## Gameplay and balance

- **Re-calibrate the human-paced bot on real plays.** It was calibrated on nine plays recorded on older builds (#55).
  Play-testing on the current build is the real check.
- **Trust in the director's input.** The director judges the recording the client sends, so a client that fabricates
  its inputs is judged on them (#52).

## Scene and presentation

- **A bigger or more varied plaza.** Procedural layouts are limited by the plaza's size: the temple and house swap
  sides, the olives sit in corners, and the votive altar appears on about 5% of nights (#72).
- **Planks on the dock's bridge.** The bridge boards read as dark flat blocks at night (#72).
- **The harpy at night.** Its new dark brown wings are lower in contrast against the dark wall (#70).
- **Props lit by the lamps.** At the default light radius no prop's base sits in a lamp's pool, so props only catch the
  lamps' light with the wick upgrade (#74).
- **A monster exactly at a lamp's ground y** draws over the lamp (#73 review).
- **The daughter's spear thrust** is clipped at the hero card's edge on its last two frames (#56).
- **A regression check for "no swing after a night"** on the title cards (#56).
