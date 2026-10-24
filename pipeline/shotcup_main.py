"""Build the short /main.ts for a Shotcup run: the kit lives on the `lampwarden` Shotcup drive (mounted at /kit), so a run only carries the build() calls.
usage: python3 pipeline/shotcup_main.py build1.ts [build2.ts ...] [--pose walk3] > main.ts   (names come from the file stems)
Each build is wrapped as its own function, rendered through Kit/post, and written to /out/<name>.png (128px) and /out/<name>_x4.png (verifier view)."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
EXPORTS = json.load(open(os.path.join(HERE, "kit", "exports.json")))   # every kit export, destructured so build code can call hero(), ship(), ...
BANNED = re.compile(r"\b(import|require|process|Bun|fetch|eval|Function|globalThis|XMLHttpRequest|Deno)\b")

def main_ts(items, pose="", x4=False):
    """items: [(name, code)] -> source of /main.ts"""
    out = ["import { createCanvas } from 'shotcup:canvas';", "import * as K from '/kit/kit.ts';", "const { " + ", ".join(EXPORTS) + " } = K;", "const POSE = " + json.dumps(pose) + ";", "const res: any[] = [];"]
    for i, (name, code) in enumerate(items):
        assert not BANNED.search(code), name
        body = re.sub(r"^\s*export\s+", "", code, flags=re.M)
        out.append(re.sub(r"function build\s*\(", "function build%d(" % i, body, count=1))
        out.append("{ const k = new Kit(); build%d(k); const r = post(k.render()); " % i +
                   "createCanvas(128, 128, { pixels: r.rgba }).save('/out/%s.png'); " % name +
                   ("createCanvas(512, 512, { pixels: onBg(r, [46, 46, 56], 4).rgba }).save('/out/%s_x4.png'); " % name if x4 else "") +
                   "res.push({ name: %s, fit: k.fit, snapped: k.snapped, dropped: k.dropped, ...r.stats }); }" % json.dumps(name))
    out.append("console.log(JSON.stringify(res));")
    return "\n".join(out) + "\n"

HERO = {"male": dict(melee="xiphos", ranged="bow"), "female": dict(melee="spear", ranged="sling")}
FRAMES = {"idle": 4, "walk": 6, "melee": 5, "ranged": 5}

def hero_frame_items(sex, anim):
    """The plain 128 px hero animation frames (noScale, facing 20) as [(name, build code)]."""
    h = HERO[sex]
    return [("%s_%s%d" % (sex, anim, i), "function build(k) {\n k.noScale = true;\n hero(k, {sex:%s, melee:%s, ranged:%s, pose:%s, at:[0,0], facing:20});\n}\n"
             % tuple(json.dumps(x) for x in (sex, h["melee"], h["ranged"], "%s%d" % (anim, i)))) for i in range(1, FRAMES[anim] + 1)]

if __name__ == "__main__":
    args = sys.argv[1:]; pose = ""
    if args and args[0] == "--hero":   # --hero male walk -> main.ts for that animation (all frames in one run)
        sys.stdout.write(main_ts(hero_frame_items(args[1], args[2]))); sys.exit(0)
    if "--pose" in args: i = args.index("--pose"); pose = args[i + 1]; del args[i:i + 2]
    sys.stdout.write(main_ts([(os.path.splitext(os.path.basename(a))[0], open(a).read()) for a in args], pose))
