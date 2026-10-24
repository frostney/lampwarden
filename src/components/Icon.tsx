// 16x16 pixel icons for the upgrades, the HUD and the touch controls, drawn as crisp SVG rects. One character per pixel;
// '.' is transparent.
import type { UpgradeId } from "@/game/legacy";

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
  e: "#e8dcc0", // bone
  E: "#a89a80", // bone shade
  T: "#a8a29a", // stone
  t: "#6e6a64", // stone shade
};

// Adds the 1 px dark outline the sprites have around every drawn pixel (left, right, up and down), for icons whose
// grids are drawn without one.
function outlined(rows: readonly string[]): string[] {
  const drawn = (row: number, column: number) => {
    const symbol = rows[row]?.[column];
    return symbol !== undefined && symbol !== ".";
  };
  return rows.map((line, row) =>
    [...line]
      .map((symbol, column) => {
        if (symbol !== ".") return symbol;
        const touchesDrawn =
          drawn(row - 1, column) || drawn(row + 1, column) || drawn(row, column - 1) || drawn(row, column + 1);
        return touchesDrawn ? "K" : ".";
      })
      .join(""),
  );
}

export type IconName = UpgradeId | "oil" | "slain" | "shoot" | "spear" | "sling" | "pouch";

const ART: Record<IconName, string[]> = {
  // a skull: monsters slain
  slain: outlined([
    "................",
    "................",
    ".....eeeee......",
    "....eeeeeee.....",
    "...eeeeeeeeE....",
    "...eKKeeeKKE....",
    "...eKKeeeKKE....",
    "...eeeeKeeeE....",
    "....eeKKKeE.....",
    ".....eeeeE......",
    ".....eKeKe......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ]),
  // an arrow in flight, point up and to the right: shoot
  shoot: outlined([
    "................",
    "............SSS.",
    ".............SS.",
    "............L.S.",
    "...........L....",
    "..........L.....",
    ".........L......",
    "........L.......",
    ".......L........",
    "......L.........",
    "...R.L..........",
    "..R.L...........",
    "...L.R..........",
    "..L.R...........",
    "................",
    "................",
  ]),
  // a spear, point up and to the right: the daughter's strike
  spear: outlined([
    "................",
    "................",
    ".............S..",
    "...........SWs..",
    ".........SSWss..",
    "........SSWss...",
    "........SWs.....",
    ".......Bb.......",
    "......Ll........",
    ".....Ll.........",
    "....Ll..........",
    "...Ll...........",
    "..Ll............",
    ".Bb.............",
    "................",
    "................",
  ]),
  // a sling with its stone in the pouch, the cords to the hand: the daughter's shot
  sling: outlined([
    "................",
    "................",
    "........LLLLL...",
    ".......LLWTTLL..",
    ".......LWTTTtL..",
    ".......LTTTttL..",
    ".......LLTttLL..",
    ".......LLLllLl..",
    "......L......L..",
    ".....L......L...",
    "....L......L....",
    "...L......L.....",
    "..BBLLLLLL......",
    ".BbbB...........",
    "..BB............",
    "................",
  ]),
  // a leather pouch of sling stones, tied at the neck
  pouch: outlined([
    ".......WT.......",
    "......WTTt......",
    "...WT.TTtt.WT...",
    "..WTTt.tt.WTTt..",
    "..TTtt....TTtt..",
    "...ttLLLLLLtt...",
    "....LLLLLLLL....",
    "....GGGGGGGG....",
    "..LLLLLLLLLLll..",
    ".LBBLLLLLLLLLll.",
    ".LBLLLLLLLLLLll.",
    ".LLLLLLLLLLLLll.",
    ".LLLLLLLLLLLLll.",
    "..LLLLLLLLLLll..",
    "...llllllllll...",
    "................",
  ]),
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
  // a round leather shield with a bronze boss: health for this warden
  hide: [
    "................",
    "....KKKKKKKK....",
    "..KKLLLLLLLLKK..",
    ".KLLLLLLLLLLLlK.",
    ".KLBLLLLLLLLBlK.",
    "KLLLLLLBBLLLLLlK",
    "KLLLLLBGGBLLLllK",
    "KLLLLLBGGBLLLllK",
    "KLLLLLLBBLLLLllK",
    "KLLLLLLLLLLLLllK",
    ".KLBLLLLLLLLBlK.",
    ".KLLLLLLLLLLllK.",
    "..KKLLLLLLllKK..",
    "....KKKKKKKK....",
    "................",
    "................",
  ],
  // a steel mallet with the blow's sparks: knockback
  knockback: [
    "................",
    "..KKKKKKKKKKK...",
    ".KSSSSSSSSSSsK..",
    ".KSWWSSSSSSssK..",
    ".KSSSSSSSSSssK..",
    ".KsssssssssssK..",
    "..KKKKKLLKKKK...",
    "......KLLlK.....",
    "...Y..KLLlK..Y..",
    "..Y...KLLlK...Y.",
    "......KLLlK.....",
    ".Y....KLLlK..Y..",
    "......KLLlK.....",
    ".......KllK.....",
    ".......KKKK.....",
    "................",
  ],
  // a drop of oil with sparks of luck: oil found
  seeker: [
    "............W...",
    ".......K...WYW..",
    "......KGK...W...",
    "......KGK.......",
    ".....KGGGK......",
    ".....KGGGK..W...",
    "....KGWGGGK.....",
    "....KGWGGGK.....",
    "...KGWGGGGBK....",
    "..W.KGGGGGBK....",
    ".WYW.KGGGGBBK...",
    "..W.KBGGGGBBK...",
    "....KBBBBBBK....",
    ".....KKKKKK.....",
    "................",
    "................",
  ],
  // a torch with a sparking flame: lamps relight faster
  tinder: [
    "...W............",
    ".......K.....W..",
    "......KYK.......",
    ".....KYYYK......",
    ".....KYWYK......",
    "....KOYWYOK.....",
    "....KOYYYOK.....",
    ".....KOOOK......",
    "...KKKbBBbKK....",
    "....KbBGGBbK....",
    ".....KbBBbK.....",
    "......KLlK......",
    "......KLlK......",
    "......KLlK......",
    "......KllK......",
    ".......KK.......",
  ],
  // a winged sandal: speed
  stride: [
    "................",
    "................",
    "..KKK...........",
    ".KWWWKK.........",
    "KWWeWWWK........",
    ".KWWeeWWK.KK....",
    "..KKeeeWKKLLK...",
    "....KKeKKGLLLK..",
    ".....KKKKLLLLK..",
    "......KLLLLLLK..",
    "....KLLLLLLLLKK.",
    "...KLLLLLLLLLLLK",
    "..KBbBbBbBbBbBK.",
    "..KKKKKKKKKKKK..",
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

export function Icon({ name, size = 32 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      data-icon={name}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {pixelsOf(ART[name]).map(({ column, row, colour }) => (
        <rect key={`${column},${row}`} x={column} y={row} width={1} height={1} fill={colour} />
      ))}
    </svg>
  );
}
