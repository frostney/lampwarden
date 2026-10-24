"""Shotcup renderer for run.py (--render shotcup): same contract as render_locally, returns (stats, None) or (None, error) and leaves out/<name>.png.

How it works: the assembled kit (kit/kit.ts) lives on a Shotcup drive named `lampwarden` (written once, by content, only when it changed) and every run mounts it
read-only at /kit; the run itself only carries the short generated /main.ts (see shotcup_main.py). Needs SHOTCUP_API_KEY in the environment (never printed or logged).

STATUS (2026-10-24): run against the live API on a Scale-plan account. Endpoints, Bearer auth, the drive create/write (409 when the drive exists,
`created: false` for an unchanged write) and the run response (`run.status`, `run.stdout`, `run.artifacts[].inlineBase64`, `run.metrics.engineMs`)
work as written here. 47 renders of 6 sprites were pixel-identical to the local renderer. Fixed after the first runs: timeoutMs above the plan's
300 s was clamped with a warning, and a "runtime is busy" refusal (all workers taken) was reported as a render error; it is now retried.
Timings and sandbox checks: pipeline/README.md and docs/LIVE_GENERATION.md.

CLI (batch many sprites in one run): python3 pipeline/shotcup_render.py out_dir build1.ts build2.ts ...   (names from file stems)
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PIPELINE_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPELINE_DIRECTORY)
from shotcup_main import main_source

SHOTCUP_BASE_URL = os.environ.get("SHOTCUP_BASE", "https://shotcup.dev")
DRIVE_NAME = os.environ.get("SHOTCUP_DRIVE", "lampwarden")
KIT_PATH = os.path.join(PIPELINE_DIRECTORY, "kit", "kit.ts")
BUSY_RETRIES = 2
_drive_seeded = False


def _request(method, path, body=None, timeout=600):
    api_key = os.environ.get("SHOTCUP_API_KEY")
    if not api_key:
        raise RuntimeError("SHOTCUP_API_KEY is not set")
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        SHOTCUP_BASE_URL + path,
        data=payload,
        method=method,
        headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        if error.headers.get("content-type", "").startswith("application/json"):
            return error.code, json.loads(error.read() or b"null")
        return error.code, {"error": f"HTTP {error.code:d}"}


def seed_drive():
    """Create the drive if needed and write /kit.ts (a write of identical content makes no new version)."""
    global _drive_seeded
    if _drive_seeded:
        return
    status, _ = _request("POST", "/api/v1/drives", {"name": DRIVE_NAME})  # 409 when it already exists is fine
    if status not in (200, 201, 409):
        raise RuntimeError(f"create drive failed: HTTP {status:d}")
    with open(KIT_PATH) as kit_file:
        kit_source = kit_file.read()
    status, reply = _request(
        "PUT",
        f"/api/v1/drives/{urllib.parse.quote(DRIVE_NAME)}/files",
        {"files": [{"path": "/kit.ts", "content": kit_source}]},
    )
    if status not in (200, 201):
        raise RuntimeError(f"write drive failed: HTTP {status:d} {str(reply)[:200]}")
    _drive_seeded = True


def run_batch(items, output_directory, pose="", timeout_milliseconds=300000):
    """items [(name, code)] in one Shotcup run -> {name: stats} or raises. Saves PNGs into output_directory.

    300 s is the Scale plan's ceiling; a larger timeout_milliseconds is clamped with a `timeout-clamped` warning.
    """
    seed_drive()
    body = {
        "code": main_source(items, pose),
        "engine": {"canvas": True},
        "mounts": [{"drive": DRIVE_NAME, "path": "/kit", "mode": "ro"}],
        "timeoutMs": timeout_milliseconds,
        "deterministic": True,
    }
    for attempt in range(BUSY_RETRIES + 1):
        status, reply = _request("POST", "/api/v1/runs", body)
        if status != 200 or not reply or "run" not in reply:
            raise RuntimeError(f"run request failed: HTTP {status:d} {str(reply)[:200]}")
        run = reply["run"]
        # all workers taken: the run queues ~30 s, then fails as daemon-error "the runtime is busy; retry shortly".
        # Not the build code's fault, so retry.
        if run.get("failureKind") != "daemon-error" or "busy" not in str(run.get("error")):
            break
        time.sleep(2 + 3 * attempt)
    if run.get("status") != "succeeded":
        failure_output = (run.get("stderr") or str(run.get("error")) or "")[-300:]
        raise RuntimeError(f"shotcup run {run.get('status')} ({run.get('failureKind')}): {failure_output}")
    for artifact in run.get("artifacts", []):
        if not artifact["path"].endswith(".png"):
            continue
        if artifact.get("inlineBase64"):
            png_bytes = base64.b64decode(artifact["inlineBase64"])
        else:
            with urllib.request.urlopen(artifact["url"], timeout=60) as response:
                png_bytes = response.read()
        with open(os.path.join(output_directory, os.path.basename(artifact["path"])), "wb") as png_file:
            png_file.write(png_bytes)
    stats_by_name = {
        sprite_stats["name"]: sprite_stats for sprite_stats in json.loads(run["stdout"].strip().splitlines()[-1])
    }
    engine_milliseconds = (run.get("metrics") or {}).get("engineMs")
    for sprite_stats in stats_by_name.values():
        sprite_stats["shotcup_engine_ms_batch"] = engine_milliseconds
    return stats_by_name


def render(code, name, output_directory, pose=""):
    try:
        return run_batch([(name, code)], output_directory, pose)[name], None
    except Exception as error:  # noqa: BLE001 -- any Shotcup failure becomes a render error for the caller to score
        return None, f"shotcup: {str(error)[:300]}"


if __name__ == "__main__":
    output_directory, build_paths = sys.argv[1], sys.argv[2:]
    os.makedirs(output_directory, exist_ok=True)
    build_items = []
    for build_path in build_paths:
        with open(build_path) as build_file:
            build_items.append((os.path.splitext(os.path.basename(build_path))[0], build_file.read()))
    print(json.dumps(run_batch(build_items, output_directory)))
