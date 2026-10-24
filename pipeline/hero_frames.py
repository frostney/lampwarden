#!/usr/bin/env python3
"""Regenerate the plain 128 px hero animation frames (public/sprites/hero/<sex>_<anim><n>.png). No Mubit call: the builder is deterministic code.
usage: python3 pipeline/hero_frames.py [--render local|shotcup] [--out public/sprites/hero]
Local mode runs each frame through the bun renderer; shotcup mode batches one animation per Shotcup run (needs SHOTCUP_API_KEY; see shotcup_render.py status note)."""
import argparse, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from shotcup_main import FRAMES, HERO, hero_frame_items
from local_render import render_file

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
                st, err = render_file(src, name, out, keep_x4=False); os.remove(src)
                if err: sys.exit(err)
                print(name, st["flags"], flush=True)
