#!/usr/bin/env python3
"""Pixel-identity gate for kit changes: renders every committed sprite (public/sprites/*.ts) and the 40 hero frames with the local
bun renderer and the current pipeline/kit/kit.ts, and compares the decoded RGBA with the committed PNGs.
usage: python3 pipeline/check_pixels.py [--out DIR]   (prints one line per sprite; exits 1 if any pixel differs or a render fails)"""
import argparse
import os
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from local_render import render_file  # noqa: E402
from shotcup_main import FRAMES, HERO, hero_frame_items  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--out", default=None, help="where the renders go (default: a temporary directory)")
arguments = parser.parse_args()
out_dir = os.path.abspath(arguments.out) if arguments.out else tempfile.mkdtemp(prefix="kit-pixels-")
os.makedirs(out_dir, exist_ok=True)
sprites_dir = os.path.join(HERE, "..", "public", "sprites")

jobs = [(name[:-3], os.path.join(sprites_dir, name), os.path.join(sprites_dir, name[:-3] + ".png"))
        for name in sorted(os.listdir(sprites_dir)) if name.endswith(".ts")]
for sex in HERO:
    for animation in FRAMES:
        for name, code in hero_frame_items(sex, animation):
            source_path = os.path.join(out_dir, "_" + name + ".ts")
            open(source_path, "w").write(code)
            jobs.append((name, source_path, os.path.join(sprites_dir, "hero", name + ".png")))

failures = total_differing = 0
for name, source_path, committed_png in jobs:
    stats, error = render_file(source_path, name, out_dir, keep_x4=False, timeout=120)
    if error:
        print("%-22s ERROR %s" % (name, error)); failures += 1; continue
    rendered = Image.open(os.path.join(out_dir, name + ".png")).convert("RGBA").tobytes()
    committed = Image.open(committed_png).convert("RGBA").tobytes()
    differing = sum(1 for offset in range(0, len(rendered), 4) if rendered[offset:offset + 4] != committed[offset:offset + 4])
    total_differing += differing; failures += 1 if differing else 0
    print("%-22s %s differing_pixels=%d" % (name, "DIFF" if differing else "ok  ", differing))
print("sprites %d, with differences %d, differing pixels %d" % (len(jobs), failures, total_differing))
sys.exit(1 if failures else 0)
