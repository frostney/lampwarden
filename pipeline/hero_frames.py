#!/usr/bin/env python3
"""Regenerate the plain 128 px hero animation frames (public/sprites/hero/<sex>_<anim><n>.png). No Mubit call: the builder is deterministic code.
usage: python3 pipeline/hero_frames.py [--render local|shotcup] [--out public/sprites/hero]
Local mode runs each frame through the bun renderer; shotcup mode batches one animation per Shotcup run (needs SHOTCUP_API_KEY; see shotcup_render.py status note)."""

import argparse
import os
import sys

PIPELINE_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPELINE_DIRECTORY)
from local_render import render_file
from shotcup_main import FRAME_COUNTS, HERO_WEAPONS, hero_frame_items

parser = argparse.ArgumentParser()
parser.add_argument("--render", choices=["local", "shotcup"], default="local")
parser.add_argument("--out", default=os.path.join(PIPELINE_DIRECTORY, "..", "public", "sprites", "hero"))
arguments = parser.parse_args()
output_directory = os.path.abspath(arguments.out)
os.makedirs(output_directory, exist_ok=True)
for sex in HERO_WEAPONS:
    for animation in FRAME_COUNTS:
        items = hero_frame_items(sex, animation)
        if arguments.render == "shotcup":
            import shotcup_render

            shotcup_render.run_batch(items, output_directory)
        else:
            for name, code in items:
                source_path = os.path.join(output_directory, "_" + name + ".ts")
                with open(source_path, "w") as source_file:
                    source_file.write(code)
                stats, error = render_file(source_path, name, output_directory, keep_magnified_view=False)
                os.remove(source_path)
                if error:
                    sys.exit(error)
                print(name, stats["flags"], flush=True)
