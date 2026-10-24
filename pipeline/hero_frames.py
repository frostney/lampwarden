#!/usr/bin/env python3
"""Regenerate the plain 128 px hero animation frames (public/sprites/hero/<sex>_<anim><n>.png). No Mubit call: the builder is deterministic code.
usage: python3 pipeline/hero_frames.py [--render local|shotcup] [--out public/sprites/hero]
Local mode runs each frame through the bun renderer; shotcup mode batches one animation per Shotcup run (needs SHOTCUP_API_KEY; see shotcup_render.py status note)."""
import argparse, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from shotcup_main import FRAMES, HERO, hero_frame_items

ap = argparse.ArgumentParser(); ap.add_argument("--render", choices=["local", "shotcup"], default="local")
ap.add_argument("--out", default=os.path.join(HERE, "..", "public", "sprites", "hero")); a = ap.parse_args()
out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
for sex in HERO:
    for anim in FRAMES:
        items = hero_frame_items(sex, anim)
        if a.render == "shotcup":
            import shotcup_render; shotcup_render.run_batch(items, out)
        else:
            for name, code in items:
                src = os.path.join(out, "_" + name + ".ts"); open(src, "w").write(code)
                env = {k: v for k, v in os.environ.items() if k != "MUBIT_API_KEY"}; env["RIG_OUT"] = out
                p = subprocess.run(["bun", "--preload", "./shim_plugin.ts", "run_local.ts", src, name], cwd=os.path.join(HERE, "render"), env=env, capture_output=True, text=True)
                os.remove(src)
                if os.path.exists(os.path.join(out, name + "_x4.png")): os.remove(os.path.join(out, name + "_x4.png"))
                if p.returncode: sys.exit(p.stderr[-300:])
                print(name, json.loads(p.stdout.strip().splitlines()[-1])["flags"], flush=True)
