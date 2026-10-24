// Hand-authored pixel grids for the emblem. Characters map to colours through gridColours in palette.ts; '.' is
// transparent.

/** The emblem: a Greek oil lamp (lychnos) with its flame at the nozzle, before the outline is added. 29 x 22. */
export const oilLamp: readonly string[] = [
  "........................y....",
  "........................Y....",
  ".......................yY....",
  ".......................yWy...",
  "......................FyWYy..",
  "......................FYWWYF.",
  ".....................FyWWWYF.",
  ".....................FYWWWYF.",
  ".....................OFYWYFO.",
  "......................OFYFO..",
  "........GHHHHHG........OFO...",
  ".GGG.GHHWWWWWWHHG.....GHkHB..",
  "GKKKGHWHHGGGGHHHHBGGGHHkkBb..",
  "HKKKBHHGGkkkkGGHHHHHHHHHBBb..",
  "BKKKBGGHGGddGGHHGGGGGGBBbb...",
  ".BbbBBGGHHHHHHGGBBBBbbbbm....",
  "...mBBBBGGGGGGBBBbbbmmm......",
  "....mbBBBBBBBBBBbbmm.........",
  ".....mmbbbbbbbbbmmd..........",
  ".......ddmmmmmmdd............",
  ".........kbbbbk..............",
  ".........kmmmmk..............",
];

/** The lamp redrawn for the 16 x 16 favicon, outline included. */
export const oilLampFavicon: readonly string[] = [
  "................",
  "...........K....",
  "..........KyK...",
  "..........KYK...",
  ".........KyWyK..",
  ".........KYWYFK.",
  "........KFYWYFK.",
  "........KOFWFOK.",
  "...KKKKK.KOFOK..",
  ".KKWHHHHKKKbKK..",
  "KbKHGkkGHHHHHBK.",
  "KbKGHHHHHHHBBbK.",
  ".KBBBBBBBBBbbK..",
  "..KmbbbbbbmmK...",
  "....KKmmmmKK....",
  "......KKKK......",
];
