#!/usr/bin/env python3
"""Lampwarden asset pipeline: brief -> generator (Opus via Mubit) -> render -> verifier (Opus via Mubit, image) -> one fix -> best-of -> public/sprites.

usage: MUBIT_API_KEY=... python3 pipeline/run.py [--render local|shotcup] [--out public/sprites] [--pose idle] "brief one" "brief two" ...
       python3 pipeline/run.py --file briefs.json      # {"id": ["category", "brief"], ...}
The key is read from the environment only; it is never printed, logged or written to disk.
Every Mubit call (request id, status, tokens, verdict) is appended to pipeline/runs/run.jsonl (no key, no headers).
"""
import json, os, re, sys, time, subprocess, hashlib, base64, io, argparse, urllib.request, urllib.error, threading
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from local_render import render_file
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
URL = "https://api.mubit.ai/anthropic/v1/messages"; MODEL = "claude-opus-5-5"
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()[:12]
GSYS = open(os.path.join(HERE, "prompts", "generator.md")).read()   # generator system prompt = the builder API doc
VSYS = open(os.path.join(HERE, "prompts", "verifier.md")).read()    # verifier system prompt = art-director rubric + the same API doc
RETRY = (429, 500, 502, 503, 504, 529); _lk = threading.Lock()
BANNED = re.compile(r"\b(import|require|process|Bun|fetch|eval|Function|globalThis|XMLHttpRequest|Deno)\b")
LOG = os.path.join(HERE, "runs", "run.jsonl")

def logrow(row):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with _lk, open(LOG, "a") as f: f.write(json.dumps(row) + "\n")

def raw_call(system, messages, sess, max_tokens):
    key = os.environ.get("MUBIT_API_KEY")
    if not key: sys.exit("MUBIT_API_KEY is not set (export it in your shell; do not put it in files)")
    body = {"model": MODEL, "max_tokens": max_tokens, "system": system, "messages": messages, "metadata": {"user_id": sess}}   # no temperature
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
          headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    t = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=240); h = {k.lower(): v for k, v in r.headers.items()}
        return r.status, h.get("x-middleware-request-id"), round((time.time() - t) * 1000), json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        h = {k.lower(): v for k, v in e.headers.items()}
        return e.code, h.get("x-middleware-request-id"), round((time.time() - t) * 1000), None, e.read()[:400].decode("utf-8", "replace")
    except Exception as e:
        return None, None, round((time.time() - t) * 1000), None, repr(e)[:200]

def call(task, system, messages, sess, meta, max_tokens):
    st, rid, ms, js, err = raw_call(system, messages, sess, max_tokens); first = None
    if st in RETRY or st is None:   # one retry
        first = {"status": st, "rid": rid, "ms": ms, "error": err}; time.sleep(5); st, rid, ms, js, err = raw_call(system, messages, sess, max_tokens)
    rec = {"ts": time.strftime("%H:%M:%S"), "task": task, "status": st, "rid": rid, "ms": ms, "session": sess, "model": MODEL, "system_sha": sha(system), **meta}
    if first: rec["first_try"] = first
    txt = None
    if js is None: rec["error"] = err
    else:
        u = js.get("usage", {}); rec.update(in_tokens=u.get("input_tokens"), out_tokens=u.get("output_tokens"), stop=js.get("stop_reason"))
        txt = "".join(c.get("text", "") for c in js.get("content", []))
    return rec, txt

def png_b64(path):   # 128px sprite -> 4x nearest on the (46,46,56) backdrop the verifier is calibrated on
    im = Image.open(path).convert("RGBA"); bg = Image.new("RGBA", im.size, (46, 46, 56, 255)); bg.alpha_composite(im)
    bg = bg.convert("RGB").resize((im.width * 4, im.height * 4), Image.NEAREST); b = io.BytesIO(); bg.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()

def parse_json(txt):
    m = re.search(r"\{.*\}", txt or "", re.S)
    try: return json.loads(m.group(0)) if m else None
    except Exception: return None

def verify_once(png, brief, code, stats, sess, meta):
    stat = "bbox %s, coverage %.0f%%, parts %s, flags %s" % (stats.get("bbox"), 100 * (stats.get("coverage") or 0), stats.get("parts"), stats.get("flags"))
    content = [{"type": "text", "text": "BRIEF: " + brief + "\n\nENGINE STATS: " + stat + "\n\nGENERATOR CODE:\n```ts\n" + code + "\n```\n\nRENDERED SPRITE (image):"},
               {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png_b64(png)}}]
    rec, txt = call("verify", VSYS, [{"role": "user", "content": content}], sess, dict(meta), 1800)
    v = parse_json(txt)
    if v is None: v = {"pass": False, "score": None, "issues": ["verifier reply not JSON: " + (txt or rec.get("error") or "")[:200]], "fix": "", "lesson": ""}
    v["pass"] = bool(v.get("pass")) and isinstance(v.get("score"), (int, float)) and v["score"] >= 7
    rec["verdict"] = v; logrow(rec); return rec

def verify(png, brief, code, stats, sess, meta):
    r1 = verify_once(png, brief, code, stats, sess, {**meta, "sample": 1}); v = dict(r1["verdict"]); rids = [r1["rid"]]; s = v.get("score")
    if isinstance(s, (int, float)) and 6 <= s <= 7:   # borderline: verify twice, average
        r2 = verify_once(png, brief, code, stats, sess, {**meta, "sample": 2}); rids.append(r2["rid"]); s2 = r2["verdict"].get("score")
        if isinstance(s2, (int, float)):
            v["scores"] = [s, s2]; v["score"] = (s + s2) / 2; v["pass"] = v["score"] >= 7 and (v["pass"] or r2["verdict"]["pass"])
    return v, rids

def extract(txt):
    m = re.search(r"```(?:ts|typescript|js|javascript)?\n(.*?)```", txt, re.S); return (m.group(1) if m else txt).strip()
def truncated(rec, txt):
    code = extract(txt or ""); return rec.get("stop") == "max_tokens" or code.count("{") != code.count("}") or ("function build" in code and not code.rstrip().endswith("}"))

def gen(task, msgs, sess, meta, mt):
    rec, txt = call(task, GSYS, msgs, sess, meta, mt)
    if txt is not None and truncated(rec, txt):   # one retry with a bigger budget
        rec["truncated_first"] = {"rid": rec["rid"], "out_tokens": rec.get("out_tokens")}
        rec2, txt2 = call(task, GSYS, msgs, sess, meta, 4000); rec2["note"] = "truncation retry of " + str(rec["rid"]); logrow(rec); rec, txt = rec2, txt2
    logrow(rec); return rec, txt

# ---- renderers: both return (stats dict, None) or (None, error). The PNG lands in out/<name>.png ----
def render_local(code, name, out, pose=""):
    src = os.path.join(out, name + ".ts"); open(src, "w").write(code + "\n")
    return render_file(src, name, out, pose)   # allowlisted env: generated code never sees MUBIT_API_KEY or any other secret

def render(code, name, out, mode, pose=""):
    if BANNED.search(code): return None, "rejected: banned identifier " + BANNED.search(code).group(0)
    if "function build" not in code: return None, "no function build(k) found"
    if mode == "shotcup":
        import shotcup_render; return shotcup_render.render(code, name, out, pose)
    return render_local(code, name, out, pose)

def det(st):
    f, i = st["flags"], []
    if "clipped_at_edge" in f: i.append("sprite touches the canvas edge (bbox %s): keep everything within |u|,|v|<=14 and z<=40" % st["bbox"])
    if "too_small" in f: i.append("sprite covers only %.1f%% of the canvas: make it bigger" % (100 * st["coverage"]))
    if "too_big" in f: i.append("sprite covers %.0f%% of the canvas: make it smaller" % (100 * st["coverage"]))
    if "too_short" in f: i.append("sprite is under 24 px tall: make it taller")
    return i

def check(code, name, out, brief, sess, meta, mode, pose):
    st, err = render(code, name, out, mode, pose)
    if err: return st, {"pass": False, "score": 0, "issues": ["code did not run: " + err], "fix": "Return a complete function build(k) using only the documented builders.", "lesson": ""}, [], "render"
    d = det(st)
    if d: return st, {"pass": False, "score": 0, "issues": d, "fix": "; ".join(d), "lesson": ""}, [], "post"   # engine flags short-circuit: no verifier call
    v, rids = verify(os.path.join(out, name + ".png"), brief, code, st, sess, meta); return st, v, rids, "llm"

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]

def process(bid, cat, brief, args):
    out = os.path.join(HERE, "runs", "work"); os.makedirs(out, exist_ok=True)
    sess = f"lampwarden-{bid}-" + re.sub(r"\W+", "-", brief)[:34]
    meta = {"bid": bid, "cat": cat, "brief": brief, "render": args.render}; msgs = [{"role": "user", "content": "Brief: " + brief}]
    g1, txt = gen("gen", msgs, sess, dict(meta), 1500)
    row = {"id": bid, "brief": brief, "session": sess, "gen": g1["rid"]}
    if txt is None: print(bid, "GEN FAILED", g1.get("error"), flush=True); return None
    code = extract(txt); n = slug(bid)
    st, v, rids, stage = check(code, n, out, brief, sess, {**meta, "stage": "first"}, args.render, args.pose)
    row.update(verify=rids, first_score=v.get("score")); best = (code, st, v, n, "first")
    print(f"{bid} | gen {g1['rid']} | {stage} pass={v['pass']} score={v['score']} {v['issues'][:2]}", flush=True)
    if not v["pass"]:   # ONE fix call: the verifier's issues + fix go back to the generator as a follow-up turn
        corr = ("Your sprite was rendered and rejected.\nBrief: " + brief + "\nScore: " + str(v.get("score")) + "/10\nIssues:\n- " + "\n- ".join(map(str, v.get("issues") or [])) +
                "\nRequested fix: " + str(v.get("fix", "")) + "\n\nReply with the complete corrected build(k) only, keeping what already works.")
        g2, txt2 = gen("fix", msgs + [{"role": "assistant", "content": txt}, {"role": "user", "content": corr}], sess, {**meta, "fixes_verify": rids[:1]}, 3000)
        row["fix"] = g2["rid"]
        if txt2 is not None:
            code2 = extract(txt2); st2, v2, rids2, stage2 = check(code2, n + "-fixed", out, brief, sess, {**meta, "stage": "after_fix"}, args.render, args.pose)
            row.update(fixed_verify=rids2, fixed_score=v2.get("score"))
            print(f"   fix {g2['rid']} | {stage2} pass={v2['pass']} score={v2['score']} {v2['issues'][:2]}", flush=True)
            if (v2.get("score") or 0) > (v.get("score") or 0): best = (code2, st2, v2, n + "-fixed", "fixed")   # best-of: ties go to the first attempt
    code_b, st_b, v_b, name_b, which = best
    if st_b is None: print(bid, "no renderable result"); return None
    os.makedirs(args.out, exist_ok=True)
    Image.open(os.path.join(out, name_b + ".png")).save(os.path.join(args.out, n + ".png"))
    open(os.path.join(args.out, n + ".ts"), "w").write(code_b + "\n")
    row.update(final=which, score=v_b.get("score"), passed=v_b["pass"], issues=v_b.get("issues"), rendered_with=args.render)
    mp = os.path.join(args.out, "manifest.json"); 
    with _lk:
        man = json.load(open(mp)) if os.path.exists(mp) else {"sprites": {}}
        man["sprites"][n] = {"brief": brief, "file": n + ".png", "code": n + ".ts", **{k: row[k] for k in row if k not in ("id", "brief")}}
        json.dump(man, open(mp, "w"), indent=1)
    return row

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("briefs", nargs="*"); ap.add_argument("--file"); ap.add_argument("--render", choices=["local", "shotcup"], default="local")
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "sprites")); ap.add_argument("--pose", default=""); a = ap.parse_args()
    items = list(json.load(open(a.file)).items()) if a.file else [(slug(b), ["brief", b]) for b in a.briefs]
    if not items: sys.exit("give at least one brief")
    print({"generator_prompt_sha": sha(GSYS), "verifier_prompt_sha": sha(VSYS), "render": a.render}, flush=True)
    with ThreadPoolExecutor(1 if a.render == "shotcup" else 4) as ex: list(ex.map(lambda t: process(t[0], t[1][0], t[1][1], a), items))
    print("ALL DONE", flush=True)
