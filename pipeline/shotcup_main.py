"""Build the short /main.ts for a Shotcup run: the kit lives on the `lampwarden` Shotcup drive (mounted at /kit), so a run only carries the build() calls.
usage: python3 pipeline/shotcup_main.py build1.ts [build2.ts ...] [--pose walk3] > main.ts   (names come from the file stems)
Each build is wrapped as its own function, rendered through Kit/post, and written to /out/<name>.png (128px) and /out/<name>_x4.png (verifier view)."""

import json
import os
import re
import sys

PIPELINE_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
# every kit export, destructured so build code can call hero(), ship(), ...
with open(os.path.join(PIPELINE_DIRECTORY, "kit", "exports.json")) as exports_file:
    KIT_EXPORTS = json.load(exports_file)
BANNED_IDENTIFIERS = re.compile(r"\b(import|require|process|Bun|fetch|eval|Function|globalThis|XMLHttpRequest|Deno)\b")


def main_source(items, pose="", include_magnified_view=False):
    """items: [(name, code)] -> source of /main.ts"""
    lines = [
        "import { createCanvas } from 'shotcup:canvas';",
        "import * as K from '/kit/kit.ts';",
        "const { " + ", ".join(KIT_EXPORTS) + " } = K;",
        "const POSE = " + json.dumps(pose) + ";",
        "const res: any[] = [];",
    ]
    for index, (name, code) in enumerate(items):
        assert not BANNED_IDENTIFIERS.search(code), name
        build_body = re.sub(r"^\s*export\s+", "", code, flags=re.MULTILINE)
        lines.append(re.sub(r"function build\s*\(", f"function build{index}(", build_body, count=1))
        magnified_save = (
            "createCanvas(512, 512, { pixels: onBg(r, [46, 46, 56], 4).rgba }).save('/out/" + name + "_x4.png'); "
            if include_magnified_view
            else ""
        )
        lines.append(
            "{ const k = new Kit(); build"
            + str(index)
            + "(k); const r = post(k.render()); "
            + "createCanvas(128, 128, { pixels: r.rgba }).save('/out/"
            + name
            + ".png'); "
            + magnified_save
            + "res.push({ name: "
            + json.dumps(name)
            + ", fit: k.fit, snapped: k.snapped, dropped: k.dropped, ...r.stats }); }"
        )
    lines.append("console.log(JSON.stringify(res));")
    return "\n".join(lines) + "\n"


HERO_WEAPONS = {"male": {"melee": "xiphos", "ranged": "bow"}, "female": {"melee": "spear", "ranged": "sling"}}
FRAME_COUNTS = {"idle": 4, "walk": 6, "melee": 5, "ranged": 5}


def hero_frame_code(sex, pose_name):
    """build(k) source for one plain hero frame."""
    weapons = HERO_WEAPONS[sex]
    hero_options = (
        f"sex:{json.dumps(sex)}, melee:{json.dumps(weapons['melee'])}, ranged:{json.dumps(weapons['ranged'])}, "
        f"pose:{json.dumps(pose_name)}, at:[0,0], facing:20"
    )
    return "function build(k) {\n k.noScale = true;\n hero(k, {" + hero_options + "});\n}\n"


def hero_frame_items(sex, animation):
    """The plain 128 px hero animation frames (noScale, facing 20) as [(name, build code)]."""
    return [
        (f"{sex}_{animation}{frame_number}", hero_frame_code(sex, f"{animation}{frame_number}"))
        for frame_number in range(1, FRAME_COUNTS[animation] + 1)
    ]


if __name__ == "__main__":
    arguments = sys.argv[1:]
    pose = ""
    if arguments and arguments[0] == "--hero":  # --hero male walk -> main.ts for that animation (all frames in one run)
        sys.stdout.write(main_source(hero_frame_items(arguments[1], arguments[2])))
        sys.exit(0)
    if "--pose" in arguments:
        pose_index = arguments.index("--pose")
        pose = arguments[pose_index + 1]
        del arguments[pose_index : pose_index + 2]
    build_items = []
    for build_path in arguments:
        with open(build_path) as build_file:
            build_items.append((os.path.splitext(os.path.basename(build_path))[0], build_file.read()))
    sys.stdout.write(main_source(build_items, pose))
