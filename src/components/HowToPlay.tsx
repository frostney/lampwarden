"use client";

// The title scroll's "How to play": the controls of the input the player is likely using, with the keys, the mouse, the
// pad's buttons and the touch controls drawn as pixel art from code (one symbol per pixel, like Icon.tsx). Touch when
// the main pointer is coarse (the phone's on-screen stick and buttons), the gamepad while one is connected, otherwise
// the keyboard and mouse. Presentation only: the bindings themselves are in game/controls.ts and game/gamepad.ts.
import { useSyncExternalStore } from "react";

import { Icon, PALETTE } from "@/components/Icon";
import { ARMS, type ShootIcon, type StrikeIcon } from "@/game/weapons";
import type { Sex } from "@/scene/assets";

type ControlsKind = "keyboard" | "gamepad" | "touch";

type Grid = string[][]; // rows of palette symbols, '.' is transparent

const blank = (width: number, height: number): Grid =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => "."));

// the letters on the keys and buttons, five pixels square
const LETTERS: Record<string, readonly string[]> = {
  A: [".XXX.", "X...X", "XXXXX", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "XXXX.", "X...X", "XXXX."],
  D: ["XXXX.", "X...X", "X...X", "X...X", "XXXX."],
  J: ["..XXX", "...X.", "...X.", "X..X.", ".XX.."],
  K: ["X..X.", "X.X..", "XX...", "X.X..", "X..X."],
  L: ["X....", "X....", "X....", "X....", "XXXXX"],
  R: ["XXXX.", "X...X", "XXXX.", "X..X.", "X...X"],
  S: [".XXXX", "X....", ".XXX.", "....X", "XXXX."],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X.."],
  W: ["X...X", "X...X", "X.X.X", "X.X.X", ".X.X."],
};
const LETTER_SIZE = 5;
const textWidth = (text: string) => text.length * LETTER_SIZE + (text.length - 1);

// text in ink, its top left at (left, top)
function writeText(grid: Grid, text: string, left: number, top: number) {
  for (const [index, letter] of [...text].entries()) {
    const rows = LETTERS[letter] ?? [];
    for (const [rowIndex, row] of rows.entries()) {
      for (const [columnIndex, symbol] of [...row].entries()) {
        if (symbol === "X") {
          const target = grid[top + rowIndex];
          if (target) {
            target[left + index * (LETTER_SIZE + 1) + columnIndex] = "K";
          }
        }
      }
    }
  }
}

// a rectangular key: outline with cut corners, a lit face, a darker lower edge, the text on it
function keycap(text: string, face: string, shade: string): Grid {
  const width = textWidth(text) + 4;
  const height = LETTER_SIZE + 4;
  const grid = blank(width, height);
  for (const [row, line] of grid.entries()) {
    for (const column of line.keys()) {
      const onEdgeRow = row === 0 || row === height - 1;
      const onEdgeColumn = column === 0 || column === width - 1;
      if (onEdgeRow && onEdgeColumn) {
        continue; // rounded corner
      }
      line[column] = onEdgeRow || onEdgeColumn ? "K" : row === height - 2 ? shade : face;
    }
  }
  writeText(grid, text, 2, 2);
  return grid;
}

// a round button or stick: outline, lit face, darker lower right, a letter in the middle
function disc(diameter: number, face: string, shade: string, text?: string): Grid {
  const grid = blank(diameter, diameter);
  const middle = (diameter - 1) / 2;
  for (const [row, line] of grid.entries()) {
    for (const column of line.keys()) {
      const distance = Math.hypot(column - middle, row - middle);
      if (distance > diameter / 2) {
        continue;
      }
      if (distance > diameter / 2 - 1) {
        line[column] = "K";
      } else {
        line[column] = column - middle + (row - middle) > diameter / 3 ? shade : face;
      }
    }
  }
  if (text) {
    writeText(grid, text, Math.round(middle - 2), Math.round(middle - 2));
  }
  return grid;
}

// a stick: a dark well with a knob on it; a letter says which stick, pips on the well say it goes every way
interface StickLook {
  diameter: number;
  knobRadius: number;
  knob: string;
  knobShade: string;
  text?: string;
  pips?: true;
}
function stickGlyph({ diameter, knobRadius, knob, knobShade, text, pips }: StickLook): Grid {
  const grid = disc(diameter, "l", "l");
  const middle = (diameter - 1) / 2;
  for (const [row, line] of grid.entries()) {
    for (const column of line.keys()) {
      const distance = Math.hypot(column - middle, row - middle);
      if (distance <= knobRadius) {
        line[column] = column - middle + (row - middle) > knobRadius - 1 ? knobShade : knob;
      } else if (distance <= knobRadius + 1 && line[column] === "l") {
        line[column] = "K";
      }
    }
  }
  if (pips) {
    // a small arrowhead towards each side
    let offsets: [number, number][] = [
      [0, 2 - middle],
      [-1, 3 - middle],
      [0, 3 - middle],
      [1, 3 - middle],
    ];
    for (let turn = 0; turn < 4; turn++) {
      for (const [across, down] of offsets) {
        const target = grid[middle + down];
        if (target) {
          target[middle + across] = "e";
        }
      }
      offsets = offsets.map(([across, down]) => [-down, across]);
    }
  }
  if (text) {
    writeText(grid, text, Math.round(middle - 2), Math.round(middle - 2));
  }
  return grid;
}

const MOUSE: Grid = [
  ".KKKKKKK.",
  "KYYYKSSSK",
  "KYYYKSSSK",
  "KYYYKSSSK",
  "KKKKKKKKK",
  "KSSSSSSSK",
  "KSSSSSSsK",
  "KSSSSSSsK",
  "KSSSSSSsK",
  ".KSSSSsK.",
  "..KKKKK..",
].map((row) => [...row]);

// the touch buttons' backdrop: a round button the weapon's icon sits on
const touchDisc = (face: string, shade: string) => disc(22, face, shade);

const GLYPHS = {
  W: keycap("W", "W", "e"),
  A: keycap("A", "W", "e"),
  S: keycap("S", "W", "e"),
  D: keycap("D", "W", "e"),
  J: keycap("J", "W", "e"),
  K: keycap("K", "W", "e"),
  mouse: MOUSE,
  "pad-A": disc(11, "S", "s", "A"),
  "pad-B": disc(11, "S", "s", "B"),
  "pad-RT": keycap("RT", "S", "s"),
  "pad-left-stick": stickGlyph({ diameter: 15, knobRadius: 5, knob: "S", knobShade: "s", text: "L" }),
  "touch-stick": stickGlyph({ diameter: 21, knobRadius: 4.5, knob: "G", knobShade: "B", pips: true }),
  "touch-strike": touchDisc("G", "B"),
  "touch-shoot": touchDisc("W", "e"),
} satisfies Record<string, Grid>;
type GlyphName = keyof typeof GLYPHS;

const PIXEL = 2; // screen pixels per glyph pixel, like the 2x pixel font

// the grid as SVG rects, one per run of one colour along a row
function glyphRects(grid: Grid) {
  const rects: { column: number; row: number; length: number; colour: string }[] = [];
  for (const [row, line] of grid.entries()) {
    let column = 0;
    while (column < line.length) {
      const symbol = line[column];
      const colour = symbol ? PALETTE[symbol] : undefined;
      if (!symbol || !colour) {
        column++;
        continue;
      }
      let end = column + 1;
      while (line[end] === symbol) {
        end++;
      }
      rects.push({ column, row, length: end - column, colour });
      column = end;
    }
  }
  return rects;
}

function Glyph({ name }: { name: GlyphName }) {
  const grid = GLYPHS[name];
  const width = grid[0]?.length ?? 0;
  return (
    <svg
      aria-hidden="true"
      className="glyph"
      data-glyph={name}
      height={grid.length * PIXEL}
      shapeRendering="crispEdges"
      viewBox={`0 0 ${width} ${grid.length}`}
      width={width * PIXEL}
    >
      {glyphRects(grid).map(({ column, row, length, colour }) => (
        <rect fill={colour} height={1} key={`${column},${row}`} width={length} x={column} y={row} />
      ))}
    </svg>
  );
}

// a touch button: its backdrop with the warden's weapon on it
function TouchButton({ backdrop, weapon }: { backdrop: GlyphName; weapon: StrikeIcon | ShootIcon }) {
  return (
    <span className="touch-glyph">
      <Glyph name={backdrop} />
      <Icon name={weapon} size={32} />
    </span>
  );
}

// what a control is shown with: glyphs, and "or" between alternatives
interface Control {
  id: string;
  label: string;
  pieces: (GlyphName | "or")[];
}

const subscribeToPointer = (notify: () => void) => {
  const query = matchMedia("(pointer: coarse)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const hasCoarsePointer = () => matchMedia("(pointer: coarse)").matches;

// the input the player is likely using: a connected gamepad, else the touch screen, else the keyboard and mouse
function useControlsKind(gamepadConnected: boolean): ControlsKind {
  const coarse = useSyncExternalStore(subscribeToPointer, hasCoarsePointer, () => false);
  if (gamepadConnected) {
    return "gamepad";
  }
  return coarse ? "touch" : "keyboard";
}

const KEYBOARD: { controls: Control[]; hint: string } = {
  controls: [
    { id: "move", label: "move (or arrows)", pieces: ["W", "A", "S", "D"] },
    { id: "strike", label: "strike", pieces: ["J"] },
    { id: "shoot", label: "shoot", pieces: ["K", "or", "mouse"] },
  ],
  hint: "Hold a direction to turn. Stand by a dark lamp to relight it.",
};
const GAMEPAD: { controls: Control[]; hint: string } = {
  controls: [
    { id: "move", label: "move", pieces: ["pad-left-stick"] },
    { id: "strike", label: "strike", pieces: ["pad-A"] },
    { id: "shoot", label: "shoot", pieces: ["pad-B", "or", "pad-RT"] },
  ],
  hint: "The left stick turns you, the right aims. Stand by a dark lamp to relight it.",
};
const TOUCH: { controls: Control[]; hint: string } = {
  controls: [
    { id: "move", label: "move", pieces: ["touch-stick"] },
    { id: "strike", label: "strike", pieces: ["touch-strike"] },
    { id: "shoot", label: "shoot", pieces: ["touch-shoot"] },
  ],
  hint: "Stand by a dark lamp to relight it.",
};
const GUIDES = { keyboard: KEYBOARD, gamepad: GAMEPAD, touch: TOUCH };

export function HowToPlay({ gamepadConnected, sex }: { gamepadConnected: boolean; sex: Sex }) {
  const kind = useControlsKind(gamepadConnected);
  const guide = GUIDES[kind];
  const arms = ARMS[sex];
  return (
    <section aria-label="How to play" className="controls" data-controls={kind} data-line={true}>
      <h2 className="controls-heading">How to play</h2>
      <div className="controls-row">
        {guide.controls.map((control) => (
          <div className="control" key={control.id}>
            <span className="glyphs">
              {control.pieces.map((piece) => {
                if (piece === "or") {
                  return <span key={piece}>or</span>;
                }
                if (piece === "touch-strike") {
                  return <TouchButton backdrop={piece} key={piece} weapon={arms.strikeIcon} />;
                }
                if (piece === "touch-shoot") {
                  return <TouchButton backdrop={piece} key={piece} weapon={arms.shootIcon} />;
                }
                return <Glyph key={piece} name={piece} />;
              })}
            </span>
            <span>{control.label}</span>
          </div>
        ))}
      </div>
      <p>{guide.hint}</p>
    </section>
  );
}
