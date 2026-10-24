"""Shotcup renderer for run.py (--render shotcup): same contract as render_local, returns (stats, None) or (None, error) and leaves out/<name>.png.

How it works: the assembled kit (kit/kit.ts) lives on a Shotcup drive named `lampwarden` (written once, by content, only when it changed) and every run mounts it
read-only at /kit; the run itself only carries the short generated /main.ts (see shotcup_main.py). Needs SHOTCUP_API_KEY in the environment (never printed or logged).

STATUS: this REST client has NOT been executed by its author (no API key was available on the box when it was written). The same run body
(code + engine {canvas:true} + mounts [{drive:'lampwarden', path:'/kit', mode:'ro'}]) was executed through the Shotcup MCP server and its output was
pixel-identical to the local renderer, but this Python code path is untested. Endpoints follow https://shotcup.dev/docs/quickstart and /docs/drives.

CLI (batch many sprites in one run): python3 pipeline/shotcup_render.py out_dir build1.ts build2.ts ...   (names from file stems)
"""
import base64, hashlib, json, os, sys, urllib.request, urllib.error, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotcup_main import main_ts

BASE = os.environ.get("SHOTCUP_BASE", "https://shotcup.dev")
DRIVE = os.environ.get("SHOTCUP_DRIVE", "lampwarden")
KIT = os.path.join(HERE, "kit", "kit.ts")
_seeded = False

def _req(method, path, body=None, timeout=600):
    key = os.environ.get("SHOTCUP_API_KEY")
    if not key: raise RuntimeError("SHOTCUP_API_KEY is not set")
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp: return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, (json.loads(e.read() or b"null") if e.headers.get("content-type", "").startswith("application/json") else {"error": "HTTP %d" % e.code})

def seed_drive():
    """Create the drive if needed and write /kit.ts (a write of identical content makes no new version)."""
    global _seeded
    if _seeded: return
    st, _ = _req("POST", "/api/v1/drives", {"name": DRIVE})   # 409 when it already exists is fine
    if st not in (200, 201, 409): raise RuntimeError("create drive failed: HTTP %d" % st)
    st, js = _req("PUT", "/api/v1/drives/%s/files" % urllib.parse.quote(DRIVE), {"files": [{"path": "/kit.ts", "content": open(KIT).read()}]})
    if st not in (200, 201): raise RuntimeError("write drive failed: HTTP %d %s" % (st, str(js)[:200]))
    _seeded = True

def run_batch(items, out, pose="", timeout_ms=600000):
    """items [(name, code)] in one Shotcup run -> {name: stats} or raises. Saves PNGs into out/."""
    seed_drive()
    body = {"code": main_ts(items, pose), "engine": {"canvas": True}, "mounts": [{"drive": DRIVE, "path": "/kit", "mode": "ro"}], "timeoutMs": timeout_ms, "deterministic": True}
    st, js = _req("POST", "/api/v1/runs", body)
    if st != 200 or not js or "run" not in js: raise RuntimeError("run request failed: HTTP %d %s" % (st, str(js)[:200]))
    run = js["run"]
    if run.get("status") != "succeeded": raise RuntimeError("shotcup run %s: %s" % (run.get("status"), (run.get("stderr") or str(run.get("error")) or "")[-300:]))
    for a in run.get("artifacts", []):
        if not a["path"].endswith(".png"): continue
        if a.get("inlineBase64"): png = base64.b64decode(a["inlineBase64"])
        else:
            with urllib.request.urlopen(a["url"], timeout=60) as resp: png = resp.read()
        open(os.path.join(out, os.path.basename(a["path"])), "wb").write(png)
    stats = {s["name"]: s for s in json.loads(run["stdout"].strip().splitlines()[-1])}
    ms = (run.get("metrics") or {}).get("engineMs")
    for s in stats.values(): s["shotcup_engine_ms_batch"] = ms
    return stats

def render(code, name, out, pose=""):
    try: return run_batch([(name, code)], out, pose)[name], None
    except Exception as e: return None, "shotcup: %s" % str(e)[:300]

if __name__ == "__main__":
    out, files = sys.argv[1], sys.argv[2:]
    os.makedirs(out, exist_ok=True)
    res = run_batch([(os.path.splitext(os.path.basename(f))[0], open(f).read()) for f in files], out)
    print(json.dumps(res))
