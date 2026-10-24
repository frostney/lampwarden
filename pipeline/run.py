#!/usr/bin/env python3
"""Lampwarden asset pipeline: brief -> generator (Opus via Mubit) -> render -> verifier (Opus via Mubit, image) -> one fix -> best-of -> public/sprites.

usage: MUBIT_API_KEY=... python3 pipeline/run.py [--render local|shotcup|vercel] [--out public/sprites] [--pose idle] "brief one" "brief two" ...
       python3 pipeline/run.py --file briefs.json      # {"id": ["category", "brief"], ...}
The key is read from the environment only; it is never printed, logged or written to disk.
Every Mubit call (request id, status, tokens, verdict) is appended to pipeline/runs/run.jsonl (no key, no headers).
"""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

PIPELINE_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PIPELINE_DIRECTORY)
from local_render import render_file

REPOSITORY_ROOT = os.path.dirname(PIPELINE_DIRECTORY)
MUBIT_MESSAGES_URL = "https://api.mubit.ai/anthropic/v1/messages"
MODEL = "claude-opus-5-5"
# generator system prompt = the builder API doc
with open(os.path.join(PIPELINE_DIRECTORY, "prompts", "generator.md")) as prompt_file:
    GENERATOR_SYSTEM_PROMPT = prompt_file.read()
# verifier system prompt = art-director rubric + the same API doc
with open(os.path.join(PIPELINE_DIRECTORY, "prompts", "verifier.md")) as prompt_file:
    VERIFIER_SYSTEM_PROMPT = prompt_file.read()
RETRYABLE_STATUSES = (429, 500, 502, 503, 504, 529)
_file_lock = threading.Lock()
BANNED_IDENTIFIERS = re.compile(r"\b(import|require|process|Bun|fetch|eval|Function|globalThis|XMLHttpRequest|Deno)\b")
LOG_PATH = os.path.join(PIPELINE_DIRECTORY, "runs", "run.jsonl")
PASSING_SCORE = 7


def short_sha(text):
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def append_log_row(row):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with _file_lock, open(LOG_PATH, "a") as log_file:
        log_file.write(json.dumps(row) + "\n")


def send_request(system, messages, session, max_tokens):
    """One POST to Mubit. Returns (status, request_id, elapsed_milliseconds, reply_json, error_text)."""
    api_key = os.environ.get("MUBIT_API_KEY")
    if not api_key:
        sys.exit("MUBIT_API_KEY is not set (export it in your shell; do not put it in files)")
    body = {  # no temperature
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "metadata": {"user_id": session},
    }
    request = urllib.request.Request(
        MUBIT_MESSAGES_URL,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    started = time.time()
    try:
        response = urllib.request.urlopen(request, timeout=240)
        headers = {name.lower(): value for name, value in response.headers.items()}
        elapsed_milliseconds = round((time.time() - started) * 1000)
        return (
            response.status,
            headers.get("x-middleware-request-id"),
            elapsed_milliseconds,
            json.loads(response.read()),
            None,
        )
    except urllib.error.HTTPError as error:
        headers = {name.lower(): value for name, value in error.headers.items()}
        elapsed_milliseconds = round((time.time() - started) * 1000)
        error_text = error.read()[:400].decode("utf-8", "replace")
        return error.code, headers.get("x-middleware-request-id"), elapsed_milliseconds, None, error_text
    # any other failure (URLError, timeout, reset) is logged and retried once by call_model
    except Exception as error:  # noqa: BLE001
        return None, None, round((time.time() - started) * 1000), None, repr(error)[:200]


def call_model(task, system, messages, session, log_fields, max_tokens):
    """send_request with one retry on 429/5xx/timeout. Returns (log_row, reply_text); reply_text is None on failure."""
    status, request_id, elapsed_milliseconds, reply, error_text = send_request(system, messages, session, max_tokens)
    first_try = None
    if status in RETRYABLE_STATUSES or status is None:  # one retry
        first_try = {"status": status, "rid": request_id, "ms": elapsed_milliseconds, "error": error_text}
        time.sleep(5)
        status, request_id, elapsed_milliseconds, reply, error_text = send_request(
            system, messages, session, max_tokens
        )
    log_row = {
        "ts": time.strftime("%H:%M:%S"),
        "task": task,
        "status": status,
        "rid": request_id,
        "ms": elapsed_milliseconds,
        "session": session,
        "model": MODEL,
        "system_sha": short_sha(system),
        **log_fields,
    }
    if first_try:
        log_row["first_try"] = first_try
    reply_text = None
    if reply is None:
        log_row["error"] = error_text
    else:
        usage = reply.get("usage", {})
        log_row.update(
            in_tokens=usage.get("input_tokens"), out_tokens=usage.get("output_tokens"), stop=reply.get("stop_reason")
        )
        reply_text = "".join(content_block.get("text", "") for content_block in reply.get("content", []))
    return log_row, reply_text


def verifier_png_base64(path):
    """128px sprite -> 4x nearest on the (46,46,56) backdrop the verifier is calibrated on, as base64 PNG."""
    sprite = Image.open(path).convert("RGBA")
    backdrop = Image.new("RGBA", sprite.size, (46, 46, 56, 255))
    backdrop.alpha_composite(sprite)
    magnified = backdrop.convert("RGB").resize((sprite.width * 4, sprite.height * 4), Image.NEAREST)
    png_buffer = io.BytesIO()
    magnified.save(png_buffer, "PNG")
    return base64.b64encode(png_buffer.getvalue()).decode()


def parse_json(text):
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    try:
        return json.loads(match.group(0)) if match else None
    except (ValueError, RecursionError):
        return None


def is_score(value):
    return isinstance(value, (int, float))


def verify_once(png_path, brief, code, stats, session, log_fields):
    coverage_percent = 100 * (stats.get("coverage") or 0)
    stats_summary = (
        f"bbox {stats.get('bbox')}, coverage {coverage_percent:.0f}%, "
        f"parts {stats.get('parts')}, flags {stats.get('flags')}"
    )
    prompt_text = (
        "BRIEF: "
        + brief
        + "\n\nENGINE STATS: "
        + stats_summary
        + "\n\nGENERATOR CODE:\n```ts\n"
        + code
        + "\n```\n\nRENDERED SPRITE (image):"
    )
    content = [
        {"type": "text", "text": prompt_text},
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": verifier_png_base64(png_path)},
        },
    ]
    log_row, reply_text = call_model(
        "verify", VERIFIER_SYSTEM_PROMPT, [{"role": "user", "content": content}], session, dict(log_fields), 1800
    )
    verdict = parse_json(reply_text)
    if verdict is None:
        unparsed = (reply_text or log_row.get("error") or "")[:200]
        verdict = {
            "pass": False,
            "score": None,
            "issues": ["verifier reply not JSON: " + unparsed],
            "fix": "",
            "lesson": "",
        }
    verdict["pass"] = bool(verdict.get("pass")) and is_score(verdict.get("score")) and verdict["score"] >= PASSING_SCORE
    log_row["verdict"] = verdict
    append_log_row(log_row)
    return log_row


def verify(png_path, brief, code, stats, session, log_fields):
    first_row = verify_once(png_path, brief, code, stats, session, {**log_fields, "sample": 1})
    verdict = dict(first_row["verdict"])
    request_ids = [first_row["rid"]]
    first_score = verdict.get("score")
    if is_score(first_score) and 6 <= first_score <= 7:  # borderline: verify twice, average
        second_row = verify_once(png_path, brief, code, stats, session, {**log_fields, "sample": 2})
        request_ids.append(second_row["rid"])
        second_score = second_row["verdict"].get("score")
        if is_score(second_score):
            verdict["scores"] = [first_score, second_score]
            verdict["score"] = (first_score + second_score) / 2
            verdict["pass"] = verdict["score"] >= PASSING_SCORE and (verdict["pass"] or second_row["verdict"]["pass"])
    return verdict, request_ids


def extract_code(text):
    match = re.search(r"```(?:ts|typescript|js|javascript)?\n(.*?)```", text, re.DOTALL)
    return (match.group(1) if match else text).strip()


def is_truncated(log_row, text):
    code = extract_code(text or "")
    return (
        log_row.get("stop") == "max_tokens"
        or code.count("{") != code.count("}")
        or ("function build" in code and not code.rstrip().endswith("}"))
    )


def generate(task, messages, session, log_fields, max_tokens):
    log_row, reply_text = call_model(task, GENERATOR_SYSTEM_PROMPT, messages, session, log_fields, max_tokens)
    if reply_text is not None and is_truncated(log_row, reply_text):  # one retry with a bigger budget
        log_row["truncated_first"] = {"rid": log_row["rid"], "out_tokens": log_row.get("out_tokens")}
        retry_row, retry_text = call_model(task, GENERATOR_SYSTEM_PROMPT, messages, session, log_fields, 4000)
        retry_row["note"] = "truncation retry of " + str(log_row["rid"])
        append_log_row(log_row)
        log_row, reply_text = retry_row, retry_text
    append_log_row(log_row)
    return log_row, reply_text


# ---- renderers: each returns (stats dict, None) or (None, error). The PNG lands in <output_directory>/<name>.png ----
def render_locally(code, name, output_directory, pose=""):
    source_path = os.path.join(output_directory, name + ".ts")
    with open(source_path, "w") as source_file:
        source_file.write(code + "\n")
    # allowlisted env: generated code never sees MUBIT_API_KEY or any other secret
    return render_file(source_path, name, output_directory, pose)


# What the Vercel Sandbox SDK needs from the shell, and nothing else (no MUBIT_API_KEY). Without a token in the shell the
# SDK refreshes an OIDC token itself from the Vercel CLI login and the linked project (.vercel/project.json).
VERCEL_SANDBOX_ENVIRONMENT = (
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "VERCEL_OIDC_TOKEN",
    "VERCEL_TOKEN",
    "VERCEL_TEAM_ID",
    "VERCEL_PROJECT_ID",
    "VERCEL_SANDBOX_SNAPSHOT_ID",
)


def render_in_vercel_sandbox(code, name, output_directory, pose=""):
    """Runs the build in a fresh Vercel Sandbox microVM with no network (see vercel_sandbox_render.ts)."""
    source_path = os.path.join(output_directory, name + ".ts")
    with open(source_path, "w") as source_file:
        source_file.write(code + "\n")
    environment = {variable: os.environ[variable] for variable in VERCEL_SANDBOX_ENVIRONMENT if variable in os.environ}
    renderer_script = os.path.join(PIPELINE_DIRECTORY, "vercel_sandbox_render.ts")
    try:
        completed = subprocess.run(
            ["bun", "--no-env-file", renderer_script, source_path, name, output_directory, pose],
            check=False,
            cwd=REPOSITORY_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return None, "vercel sandbox: timed out"
    if completed.returncode != 0:
        return None, (completed.stderr.strip().splitlines() or ["vercel sandbox: error"])[-1][:300]
    return json.loads(completed.stdout.strip().splitlines()[-1]), None


def render(code, name, output_directory, renderer, pose=""):
    banned_match = BANNED_IDENTIFIERS.search(code)
    if banned_match:
        return None, "rejected: banned identifier " + banned_match.group(0)
    if "function build" not in code:
        return None, "no function build(k) found"
    if renderer == "shotcup":
        import shotcup_render

        return shotcup_render.render(code, name, output_directory, pose)
    if renderer == "vercel":
        return render_in_vercel_sandbox(code, name, output_directory, pose)
    return render_locally(code, name, output_directory, pose)


def engine_flag_issues(stats):
    flags, issues = stats["flags"], []
    if "clipped_at_edge" in flags:
        issues.append(
            f"sprite touches the canvas edge (bbox {stats['bbox']}): keep everything within |u|,|v|<=14 and z<=40"
        )
    if "too_small" in flags:
        issues.append(f"sprite covers only {100 * stats['coverage']:.1f}% of the canvas: make it bigger")
    if "too_big" in flags:
        issues.append(f"sprite covers {100 * stats['coverage']:.0f}% of the canvas: make it smaller")
    if "too_short" in flags:
        issues.append("sprite is under 24 px tall: make it taller")
    return issues


def render_and_verify(code, name, output_directory, brief, session, log_fields, renderer, pose):
    """Returns (stats, verdict, verifier request ids, stage) where stage is "render", "post" or "llm"."""
    stats, error = render(code, name, output_directory, renderer, pose)
    if error:
        verdict = {
            "pass": False,
            "score": 0,
            "issues": ["code did not run: " + error],
            "fix": "Return a complete function build(k) using only the documented builders.",
            "lesson": "",
        }
        return stats, verdict, [], "render"
    flag_issues = engine_flag_issues(stats)
    if flag_issues:  # engine flags short-circuit: no verifier call
        verdict = {"pass": False, "score": 0, "issues": flag_issues, "fix": "; ".join(flag_issues), "lesson": ""}
        return stats, verdict, [], "post"
    png_path = os.path.join(output_directory, name + ".png")
    verdict, request_ids = verify(png_path, brief, code, stats, session, log_fields)
    return stats, verdict, request_ids, "llm"


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def correction_message(brief, verdict):
    issue_lines = "\n- ".join(map(str, verdict.get("issues") or []))
    return (
        "Your sprite was rendered and rejected.\nBrief: "
        + brief
        + "\nScore: "
        + str(verdict.get("score"))
        + "/10\nIssues:\n- "
        + issue_lines
        + "\nRequested fix: "
        + str(verdict.get("fix", ""))
        + "\n\nReply with the complete corrected build(k) only, keeping what already works."
    )


def process(brief_id, category, brief, arguments):
    work_directory = os.path.join(PIPELINE_DIRECTORY, "runs", "work")
    os.makedirs(work_directory, exist_ok=True)
    session = f"lampwarden-{brief_id}-" + re.sub(r"\W+", "-", brief)[:34]
    log_fields = {"bid": brief_id, "cat": category, "brief": brief, "render": arguments.render}
    messages = [{"role": "user", "content": "Brief: " + brief}]
    generation_row, generated_text = generate("gen", messages, session, dict(log_fields), 1500)
    row = {"id": brief_id, "brief": brief, "session": session, "gen": generation_row["rid"]}
    if generated_text is None:
        print(brief_id, "GEN FAILED", generation_row.get("error"), flush=True)
        return None
    code = extract_code(generated_text)
    sprite_name = slugify(brief_id)
    stats, verdict, request_ids, stage = render_and_verify(
        code,
        sprite_name,
        work_directory,
        brief,
        session,
        {**log_fields, "stage": "first"},
        arguments.render,
        arguments.pose,
    )
    row.update(verify=request_ids, first_score=verdict.get("score"))
    best = (code, stats, verdict, sprite_name, "first")
    print(
        f"{brief_id} | gen {generation_row['rid']} | {stage} pass={verdict['pass']} score={verdict['score']}"
        f" {verdict['issues'][:2]}",
        flush=True,
    )
    if not verdict["pass"]:  # ONE fix call: the verifier's issues + fix go back to the generator as a follow-up turn
        fix_messages = messages + [
            {"role": "assistant", "content": generated_text},
            {"role": "user", "content": correction_message(brief, verdict)},
        ]
        fix_row, fixed_text = generate(
            "fix", fix_messages, session, {**log_fields, "fixes_verify": request_ids[:1]}, 3000
        )
        row["fix"] = fix_row["rid"]
        if fixed_text is not None:
            fixed_code = extract_code(fixed_text)
            fixed_name = sprite_name + "-fixed"
            fixed_stats, fixed_verdict, fixed_request_ids, fixed_stage = render_and_verify(
                fixed_code,
                fixed_name,
                work_directory,
                brief,
                session,
                {**log_fields, "stage": "after_fix"},
                arguments.render,
                arguments.pose,
            )
            row.update(fixed_verify=fixed_request_ids, fixed_score=fixed_verdict.get("score"))
            print(
                f"   fix {fix_row['rid']} | {fixed_stage} pass={fixed_verdict['pass']} score={fixed_verdict['score']}"
                f" {fixed_verdict['issues'][:2]}",
                flush=True,
            )
            if (fixed_verdict.get("score") or 0) > (verdict.get("score") or 0):  # best-of: ties go to the first attempt
                best = (fixed_code, fixed_stats, fixed_verdict, fixed_name, "fixed")
    best_code, best_stats, best_verdict, best_name, best_attempt = best
    if best_stats is None:
        print(brief_id, "no renderable result")
        return None
    os.makedirs(arguments.out, exist_ok=True)
    Image.open(os.path.join(work_directory, best_name + ".png")).save(os.path.join(arguments.out, sprite_name + ".png"))
    with open(os.path.join(arguments.out, sprite_name + ".ts"), "w") as code_file:
        code_file.write(best_code + "\n")
    row.update(
        final=best_attempt,
        score=best_verdict.get("score"),
        passed=best_verdict["pass"],
        issues=best_verdict.get("issues"),
        rendered_with=arguments.render,
    )
    manifest_path = os.path.join(arguments.out, "manifest.json")
    with _file_lock:
        if os.path.exists(manifest_path):
            with open(manifest_path) as manifest_file:
                manifest = json.load(manifest_file)
        else:
            manifest = {"sprites": {}}
        manifest["sprites"][sprite_name] = {
            "brief": brief,
            "file": sprite_name + ".png",
            "code": sprite_name + ".ts",
            **{key: row[key] for key in row if key not in ("id", "brief")},
        }
        with open(manifest_path, "w") as manifest_file:
            json.dump(manifest, manifest_file, indent=1)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("briefs", nargs="*")
    parser.add_argument("--file")
    parser.add_argument("--render", choices=["local", "shotcup", "vercel"], default="local")
    parser.add_argument("--out", default=os.path.join(REPOSITORY_ROOT, "public", "sprites"))
    parser.add_argument("--pose", default="")
    arguments = parser.parse_args()
    if arguments.file:
        with open(arguments.file) as briefs_file:
            items = list(json.load(briefs_file).items())
    else:
        items = [(slugify(brief), ["brief", brief]) for brief in arguments.briefs]
    if not items:
        sys.exit("give at least one brief")
    prompt_shas = {
        "generator_prompt_sha": short_sha(GENERATOR_SYSTEM_PROMPT),
        "verifier_prompt_sha": short_sha(VERIFIER_SYSTEM_PROMPT),
        "render": arguments.render,
    }
    print(prompt_shas, flush=True)

    def process_item(item):
        brief_id, brief_entry = item  # brief_entry is ["category", "brief"]
        return process(brief_id, brief_entry[0], brief_entry[1], arguments)

    with ThreadPoolExecutor(1 if arguments.render == "shotcup" else 4) as executor:
        list(executor.map(process_item, items))
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
