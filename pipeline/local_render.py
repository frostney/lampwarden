"""Local bun renderer shared by run.py and hero_frames.py: runs one build script and returns its stats.

The build code may come from a model. The BANNED regex in run.py is a tripwire, not a sandbox (`this['pro'+'cess'].env` gets past it),
so the subprocess gets an allowlisted environment: no API keys, tokens or other secrets from the caller's shell reach the generated code.
"""
import json, os, subprocess
RENDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render")
PASS = ("PATH", "HOME", "TMPDIR", "LANG")   # what bun needs to start; nothing else is passed through


def render_env(out):
    env = {k: os.environ[k] for k in PASS if k in os.environ}
    env["KIT_OUT"] = out
    return env


def render_file(src, name, out, pose="", keep_x4=True, timeout=30):
    """Render src (a build script) to out/<name>.png. Returns (stats, None) or (None, error)."""
    try:
        p = subprocess.run(["bun", "--preload", "./shim_plugin.ts", "run_local.ts", src, name, pose], cwd=RENDER, env=render_env(out),
                           capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "render timed out"
    if not keep_x4:
        x4 = os.path.join(out, name + "_x4.png")
        if os.path.exists(x4): os.remove(x4)
    if p.returncode != 0: return None, (p.stderr.strip().splitlines() or ["error"])[-1][:300]
    return json.loads(p.stdout.strip().splitlines()[-1]), None
