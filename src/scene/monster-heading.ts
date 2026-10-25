// Which way a monster faces on the ground, as one of the warden's eight octants (src/scene/assets.ts), worked out from
// where it is: the sim keeps no heading for a monster, so the scene reads it from the monster's own steps. Drawing only:
// nothing here is read by the sim, and a replay (which steps the same sim) shows the same headings.
//
// A monster that travels faces the way it has moved, taken over a few pixels of ground so the sideways wobble of its walk
// does not turn it, and it turns only when its heading is well past the edge of the octant it faces (so it does not flicker
// between two). While it is thrown by a blow or held by one it keeps its heading, as a body does when knocked; when it
// stands at the warden's side to claw him it faces him; when it claws a lamp it faces the way it came, which is the lamp.
// A monster that has not moved yet faces the plaza's centre, which is the way the one sprite a monster used to have looked
// (south-east, flipped on the right of the plaza).
import { CENTRE_X, ground, type Monster } from "../game/sim";
import { octantOf, offsetFromOctant } from "./assets";
import { CLAW_REACH } from "./creature-animation";

/** The octant a monster that has not moved faces: the way its sprite looked before it turned, towards the plaza's centre. */
const SOUTH_EAST = 1;
const SOUTH_WEST = 3;
/** Ground distance a monster must have moved since its last heading before the heading is read again. */
const MIN_STEP = 3;
/** A monster that has moved more than this far since it was last looked at was put there, not walked: it faces anew. */
const PLACED_FAR = 60;
/** How far (in radians) a heading must be from the middle of the octant faced before the monster turns to the next one. */
const TURN_PAST = 0.62;

interface Heading {
  /** Where the heading was last read from. */
  fromX: number;
  fromY: number;
  octant: number;
}

type Walker = Pick<Monster, "x" | "y" | "stun" | "snuff" | "knockX" | "knockY">;

const headings = new WeakMap<object, Heading>();

/** Turns to face (`towardX`, `towardY`) (the ground's, with y at twice the screen's) once it is well past the octant faced. */
function turnToward(heading: Heading, towardX: number, towardY: number) {
  if (Math.hypot(towardX, towardY) < 1e-6) {
    return;
  }
  if (offsetFromOctant(towardX, towardY, heading.octant) > TURN_PAST) {
    heading.octant = octantOf(towardX, towardY);
  }
}

/**
 * The octant `monster` faces now. Call it once or more each frame: it reads the monster's position, so a frame that did
 * not move it changes nothing. `hero` is where the warden stands.
 */
export function monsterOctant(monster: Walker, hero: { x: number; y: number }): number {
  let heading = headings.get(monster);
  if (!heading) {
    heading = { fromX: monster.x, fromY: monster.y, octant: monster.x > CENTRE_X ? SOUTH_WEST : SOUTH_EAST };
    headings.set(monster, heading);
  }
  const steppedX = monster.x - heading.fromX;
  const steppedY = (monster.y - heading.fromY) * 2;
  if (Math.hypot(steppedX, steppedY) > PLACED_FAR) {
    // not a step but a placement (the monster of a night that has just begun, a test): it faces the centre again
    heading.fromX = monster.x;
    heading.fromY = monster.y;
    heading.octant = monster.x > CENTRE_X ? SOUTH_WEST : SOUTH_EAST;
    return heading.octant;
  }
  const thrown = monster.stun > 0 || monster.knockX !== 0 || monster.knockY !== 0;
  if (thrown) {
    // a blow moves it without turning it: the heading is read afresh from where it lands
    heading.fromX = monster.x;
    heading.fromY = monster.y;
    return heading.octant;
  }
  if (Math.hypot(steppedX, steppedY) >= MIN_STEP) {
    turnToward(heading, steppedX, steppedY);
    heading.fromX = monster.x;
    heading.fromY = monster.y;
  } else if (monster.snuff <= 0 && ground(monster.x, monster.y, hero.x, hero.y) < CLAW_REACH) {
    // standing at the warden's side to claw him
    turnToward(heading, hero.x - monster.x, (hero.y - monster.y) * 2);
  }
  return heading.octant;
}
