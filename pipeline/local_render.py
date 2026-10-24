"""Local bun renderer shared by run.py and hero_frames.py: runs one build script and returns its stats.

The build code may come from a model. The BANNED_IDENTIFIERS regex in run.py is a tripwire, not a sandbox (`this['pro'+'cess'].env` gets past it),
so the subprocess gets an allowlisted environment: no API keys, tokens or other secrets from the caller's shell reach the generated code.
"""

import json
import os
import subprocess

RENDER_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render")
# what bun needs to start; nothing else is passed through
ALLOWED_ENVIRONMENT_VARIABLES = ("PATH", "HOME", "TMPDIR", "LANG")


def render_environment(output_directory):
    environment = {name: os.environ[name] for name in ALLOWED_ENVIRONMENT_VARIABLES if name in os.environ}
    environment["KIT_OUT"] = output_directory
    return environment


def render_file(source_path, name, output_directory, pose="", keep_magnified_view=True, timeout=30):
    """Render source_path (a build script) to output_directory/<name>.png. Returns (stats, None) or (None, error)."""
    try:
        completed = subprocess.run(
            ["bun", "--preload", "./shim_plugin.ts", "run_local.ts", source_path, name, pose],
            check=False,
            cwd=RENDER_DIRECTORY,
            env=render_environment(output_directory),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return None, "render timed out"
    if not keep_magnified_view:
        magnified_path = os.path.join(output_directory, name + "_x4.png")
        if os.path.exists(magnified_path):
            os.remove(magnified_path)
    if completed.returncode != 0:
        return None, (completed.stderr.strip().splitlines() or ["error"])[-1][:300]
    return json.loads(completed.stdout.strip().splitlines()[-1]), None
