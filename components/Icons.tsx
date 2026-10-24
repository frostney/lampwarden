// 16x16 pixel icons for the upgrades, drawn as crisp SVG rects. One character per pixel; '.' is transparent.
import type { UpgradeId } from "@/lib/legacy";

const PALETTE: Record<string, string> = {
  K: "#1b1410", // outline
  W: "#fff6d8", // highlight
  Y: "#ffd34a", // flame
  O: "#f08a24", // flame edge
  R: "#d8433a", // red
  d: "#8e2424", // dark red
  B: "#c8913a", // bronze
  b: "#7d5422", // dark bronze
  G: "#f2c14e", // gold
  S: "#e4e8ee", // steel
  s: "#8e98a8", // steel shade
  L: "#9a5f34", // leather
  l: "#5e3720", // dark leather
};

const ART: Record<UpgradeId | "oil", string[]> = {
  // a Greek oil lamp (lychnos) with its flame on the spout
  wick: [
    "................",
    "...K............",
    "..KYK...........",
    "..KYK...........",
    ".KYWYK..........",
    ".KYWYK..........",
    "KOYYYOK.........",
    "KOOYOOK.........",
    ".KOOOK...KKKK...",
    "..KbbKKKKBGGBKK.",
    "..KBBBBBBBBBBBBK",
    "..KBGBBBBBBBBBbK",
    "...KbBBBBBBBbbK.",
    "....KKbbbbbbKK..",
    "......KKKKKK....",
    "................",
  ],
  // a xiphos, point up and to the right
  blade: [
    "..............KK",
    ".............KSK",
    "............KSsK",
    "...........KSsK.",
    "..........KSsK..",
    ".........KSsK...",
    "........KSsK....",
    ".......KSsK.....",
    "..KK..KSsK......",
    "..KGKKSsK.......",
    "...KGGsK........",
    "....KGGK........",
    "...KLKKGK.......",
    "..KLK..KGK......",
    ".KLK....KK......",
    ".KK.............",
  ],
  // a leather quiver with three fletched arrows
  quiver: [
    "....R...W...R...",
    "...RRR.WWW.RRR..",
    "....R...W...R...",
    "....K...K...K...",
    "....K...K...K...",
    "...KKKKKKKKKKK..",
    "...KLLLLLLLLLK..",
    "...KGGGGGGGGGK..",
    "...KLLLLLLLLlK..",
    "...KLLLLLLLLlK..",
    "...KLLLLLLLLlK..",
    "...KGGGGGGGGGK..",
    "...KLLLLLLLLlK..",
    "...KLLLLLLLLlK..",
    "....KLLLLLLlK...",
    ".....KKKKKKK....",
  ],
  heart: [
    "................",
    "................",
    "...KKK...KKK....",
    "..KRRRK.KRRRK...",
    ".KRWWRRKRRRRRK..",
    ".KRWRRRRRRRRRK..",
    ".KRRRRRRRRRRdK..",
    ".KRRRRRRRRRRdK..",
    "..KRRRRRRRRdK...",
    "...KRRRRRRdK....",
    "....KRRRRdK.....",
    ".....KRRdK......",
    "......KdK.......",
    ".......K........",
    "................",
    "................",
  ],
  // a drop of lamp oil, the currency
  oil: [
    "................",
    ".......K........",
    "......KGK.......",
    "......KGK.......",
    ".....KGGGK......",
    ".....KGGGK......",
    "....KGWGGGK.....",
    "....KGWGGGK.....",
    "...KGWGGGGBK....",
    "...KGGGGGGBK....",
    "...KGGGGGBBK....",
    "...KBGGGGBBK....",
    "....KBBBBBK.....",
    ".....KKKKK......",
    "................",
    "................",
  ],
};

interface Pixel {
  column: number;
  row: number;
  colour: string;
}

function pixelsOf(rows: readonly string[]): Pixel[] {
  const pixels: Pixel[] = [];
  for (const [row, line] of rows.entries())
    for (const [column, symbol] of [...line].entries()) {
      const colour = PALETTE[symbol];
      if (colour) pixels.push({ column, row, colour });
    }
  return pixels;
}

export function Icon({ name, size = 32 }: { name: keyof typeof ART; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      {pixelsOf(ART[name]).map(({ column, row, colour }) => (
        <rect key={`${column},${row}`} x={column} y={row} width={1} height={1} fill={colour} />
      ))}
    </svg>
  );
}
