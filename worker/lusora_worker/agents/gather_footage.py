"""Gather footage — the open internet, per subject, into the video's folder.

D104 (documentary plan, slice 4). Slices 2 and 3 made the searches ask about
the story and a judge look at the answers, but the answers could only come
from Pexels, which has no 1962 Pennsylvania: the Centralia dump fire was a
tropical garbage fire because that is all a stock library holds. Dark Palace
reaches further — YouTube footage of the real place, Commons and archive.org
photos of the real people and events — and this stage is that reach in
LUSORA's shape.

Per subject of subjects.json, most-seen first (a hook beat counts double):
YouTube results are searched through the proxy, a text model picks from their
titles which ones are worth downloading, those are downloaded whole and cut
into shots at scene changes; free-licence photos are listed by URL. Everything
lands in footage.json. Nothing here places a shot: the chain sources `youtube`
and `archive` offer the pool to pick_shots, whose judge looks at every shot
against its beat, and to resolve_assets.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..providers import adult_filter, footage, llm

STAGE = "gather_footage"
ROLE = "pick_videos"
MAX_ATTEMPTS = 2

PRESETS = {
    "much": {"max_videos": 30, "videos_per_subject": 2, "max_video_seconds": 1500, "shots_per_video": 30,
             "photos_per_subject": 4},
    "normal": {"max_videos": 18, "videos_per_subject": 1, "max_video_seconds": 1500, "shots_per_video": 24,
               "photos_per_subject": 3},
    "little": {"max_videos": 10, "videos_per_subject": 1, "max_video_seconds": 600, "shots_per_video": 16,
               "photos_per_subject": 2},
}
RESULTS_PER_SEARCH = 8


def settings(cfg: dict[str, Any]) -> dict[str, Any]:
    raw = (((cfg.get("source_policy") or {}).get("visual") or {}).get("footage")) or {}
    amount = str(raw.get("amount") or "normal")
    conf = {"enabled": False, "amount": amount, "youtube": True, "photos": True, "safety": True,
            "keep_in_library": True, **PRESETS.get(amount, PRESETS["normal"])}
    conf.update({k: v for k, v in raw.items() if v is not None})
    return conf


def subject_usage(subjects_doc: dict[str, Any], beats: list[dict[str, Any]]) -> list[str]:
    """Subject ids, most on screen first. A beat inside the hook counts double:
    the opening needs the strongest footage (Dark Palace's `_uso`)."""
    hook_end = int(subjects_doc.get("hook_end_cut", -1))
    use: dict[str, float] = {}
    for i, beat in enumerate(beats):
        sid = str(beat.get("subject") or "")
        if sid:
            use[sid] = use.get(sid, 0.0) + (2.0 if i <= hook_end else 1.0)
    known = [str(s["id"]) for s in subjects_doc.get("subjects") or []]
    return sorted(known, key=lambda s: (-use.get(s, 0.0), known.index(s)))


# ---------------- choosing videos from their titles ----------------


def render_results(subjects: dict[str, dict], results: dict[str, list[dict]], quota: dict[str, int]) -> str:
    blocks = []
    for sid, found in results.items():
        s = subjects[sid]
        lines = [f"SUBJECT {sid} (may take {quota[sid]}): {s.get('name', '')}"
                 + (f" — {s['look']}" if s.get("look") else "")]
        lines += [f"  [{k}] {r['title']} | {r['channel']} | {int(r['duration'])}s | {r['views']} views"
                  for k, r in enumerate(found)]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def validate_picks(answer: Any, results: dict[str, list[dict]], quota: dict[str, int]) -> list[str]:
    if not isinstance(answer, dict) or not isinstance(answer.get("picks"), dict):
        return ['the answer must be an object {"picks": {"<subject id>": [<result number>, ...]}}']
    problems = []
    for sid, picked in answer["picks"].items():
        if sid not in results:
            problems.append(f"{sid} is not a subject listed above")
            continue
        if not isinstance(picked, list) or not all(isinstance(k, int) and not isinstance(k, bool) for k in picked):
            problems.append(f"{sid}: picks must be a list of result numbers")
            continue
        bad = [k for k in picked if not 0 <= k < len(results[sid])]
        if bad:
            problems.append(f"{sid}: {bad} not in its list (0-{len(results[sid]) - 1})")
        if len(picked) > quota[sid]:
            problems.append(f"{sid}: {len(picked)} picked, it may take {quota[sid]}")
    return problems


def pick_videos(
    ctx: StageContext,
    subjects: dict[str, dict],
    results: dict[str, list[dict]],
    quota: dict[str, int],
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, list[int]]:
    """Result numbers to download per subject. The planner's model reads the
    titles; `mock` takes each subject's first result. A model that cannot
    answer costs the YouTube footage, not the video."""
    planner = ctx.cfg.get("planner") or {}
    provider = str(planner.get("llm") or "mock")
    if provider == "mock" or not results:
        return {sid: list(range(min(quota[sid], len(found)))) for sid, found in results.items()}
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = planner.get("model") or (prompt or {}).get("model_hint")
    subjects_doc = ctx.read_json("subjects.json") if ctx.has("subjects.json") else {}
    system, base_user = prompt_packs.compose(ROLE, prompt, {
        "results": render_results(subjects, results, quota),
        "main_idea": str(subjects_doc.get("main_idea") or ""),
        "content_rules": str(ctx.cfg.get("content_rules") or ""),
        "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
    })
    user = base_user
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(ctx, stage=STAGE, provider=provider, operation="llm.pick_videos",
                         estimated_units=3000, model=model,
                         details={"subjects": len(results), "attempt": attempt}) as cost:
            result = chat_fn(provider, model, system, user, int((prompt or {}).get("max_tokens") or 16000),
                             prompt_packs.temperature(ROLE, prompt))
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens, "attempt": attempt})
        try:
            answer = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as exc:
            problems = [f"output was not a parseable JSON object: {exc}"]
        else:
            problems = validate_picks(answer, results, quota)
            if not problems:
                return {sid: list(answer["picks"].get(sid) or []) for sid in results}
        ctx.db.event(ctx.video_id, STAGE, "progress", f"video pick attempt {attempt} rejected: {'; '.join(problems[:4])}")
        user = (base_user + "\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix ALL of these and output the corrected JSON:\n- "
                + "\n- ".join(problems))
    ctx.db.event(ctx.video_id, STAGE, "progress", "the model could not pick videos — no YouTube footage this time")
    return {}


# ---------------- the stage ----------------


def gather(
    ctx: StageContext,
    chat_fn: llm.ChatFn = llm.chat,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    conf = settings(ctx.cfg)
    say = progress or (lambda _m: None)
    subjects_doc = ctx.read_json("subjects.json")
    beats = ctx.read_json("beats.json")["beats"] if ctx.has("beats.json") else []
    subjects = {str(s["id"]): s for s in subjects_doc.get("subjects") or []}
    order = subject_usage(subjects_doc, beats)
    doc: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "videos": [], "photos": [], "skipped": []}
    safety = bool(conf["safety"])

    def first_query(sid: str) -> str:
        queries = subjects[sid].get("queries") or []
        return str(queries[0] if queries else subjects[sid].get("name") or sid)

    # ---- YouTube ----
    if conf["youtube"] and int(conf["max_videos"]) > 0:
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                raw = dict(pool.map(lambda sid: (sid, footage.youtube_search(first_query(sid), RESULTS_PER_SEARCH)),
                                    order))
        except footage.ProxyMissing as exc:
            raw = {}
            doc["skipped"].append(f"youtube: {exc}")
            ctx.db.provider_health("youtube", False, str(exc))
        results: dict[str, list[dict]] = {}
        for sid in order:
            kept = []
            for r in raw.get(sid) or []:
                if not footage.usable_result(r, float(conf["max_video_seconds"])):
                    continue
                if safety and not adult_filter.safe(r["title"]):
                    doc["skipped"].append(f"youtube {r['id']}: 18+ filter ({adult_filter.reason(r['title'])})")
                    continue
                kept.append(r)
            if kept:
                results[sid] = kept
        quota = {sid: int(conf["videos_per_subject"]) for sid in results}
        say(f"youtube: {sum(len(v) for v in results.values())} usable results for {len(results)} of {len(order)} subjects")
        picks = pick_videos(ctx, subjects, results, quota, chat_fn)

        chosen: list[tuple[str, dict]] = []
        seen: set[str] = set()
        for sid in order:  # most-seen subject first, so the cap cuts the least-seen
            for k in picks.get(sid) or []:
                r = results[sid][k]
                if r["id"] in seen or len(chosen) >= int(conf["max_videos"]):
                    continue
                seen.add(r["id"])
                chosen.append((sid, r))

        def fetch(entry: tuple[str, dict]) -> dict | None:
            sid, r = entry
            rel = f"footage/yt_{r['id']}.mp4"
            info = footage.youtube_download(r["id"], ctx.folder / rel)
            if info is None:
                doc["skipped"].append(f"youtube {r['id']}: download failed")
                return None
            shots = footage.scene_shots(ctx.folder / rel, ctx.folder / "footage" / "thumbs", ctx.folder,
                                        int(conf["shots_per_video"]))
            if not shots:
                doc["skipped"].append(f"youtube {r['id']}: no shot of 2.3 s or more")
                return None
            return {"id": r["id"], "subject": sid, "title": r["title"], "channel": r["channel"], "url": r["url"],
                    "duration": footage.probe_seconds(ctx.folder / rel), "file": rel, "license": "youtube",
                    "shots": shots}

        # two at a time through one proxy: parallel yt-dlp traffic is the
        # classic bot signature (the library runs one)
        with ThreadPoolExecutor(max_workers=2) as pool:
            doc["videos"] = [v for v in pool.map(fetch, chosen) if v]
        if chosen:
            ctx.db.provider_health("youtube", bool(doc["videos"]))
        say(f"youtube: {len(doc['videos'])} of {len(chosen)} chosen videos downloaded, "
            f"{sum(len(v['shots']) for v in doc['videos'])} shots")

    # ---- Commons and archive.org photos ----
    per = int(conf["photos_per_subject"])
    if conf["photos"] and per > 0:
        def photos(sid: str) -> tuple[str, list[dict], list[str]]:
            q = first_query(sid)
            got, skipped = [], []
            for fetcher, n in ((footage.commons_photos, per), (footage.archive_photos, max(1, per // 2))):
                try:
                    found, why = fetcher(q, n, safety=safety)
                except Exception as exc:  # noqa: BLE001 - one site refusing costs its photos, not the video
                    skipped.append(f"{fetcher.__name__} '{q}': {type(exc).__name__}")
                    continue
                got += found
                skipped += why
            return sid, got[:per], skipped

        with ThreadPoolExecutor(max_workers=4) as pool:
            for sid, got, skipped in pool.map(photos, order):
                doc["photos"] += [{**p, "subject": sid} for p in got]
                doc["skipped"] += skipped
        say(f"photos: {len(doc['photos'])} free-licence photos for "
            f"{len({p['subject'] for p in doc['photos']})} subjects")
    return doc


def keep_in_library(ctx: StageContext, doc: dict[str, Any], used_ids: set[str]) -> str:
    """Hand every YouTube video this video used to the b-roll library, so it
    is tagged there and the next video can search it (D104). Best effort."""
    import httpx

    base = (ctx.config.library_api_url if ctx.config else "") or ""
    base = base.rstrip("/")
    videos = [v for v in doc.get("videos") or [] if v["id"] in used_ids]
    if not base or not videos:
        return "no library to hand footage to" if not base else "no YouTube footage was used"
    sent = 0
    for v in videos:
        path = ctx.folder / v["file"]
        if not path.exists():
            continue
        try:
            with open(path, "rb") as f:
                resp = httpx.post(f"{base}/uploads", files={"files": (path.name, f, "video/mp4")},
                                  data={"kind": "video_file", "source_url": v["url"],
                                        "source_name": v.get("channel") or "youtube", "license": "unknown",
                                        "channel": str(ctx.channel_id)}, timeout=120)
            resp.raise_for_status()
            sent += 1
        except (httpx.HTTPError, OSError) as exc:
            ctx.db.provider_health("library", False, f"footage handoff failed: {exc}")
            return f"library unreachable ({type(exc).__name__}); {sent} of {len(videos)} handed over"
    return f"{sent} of {len(videos)} YouTube videos handed to the library"


def credits(ctx: StageContext, doc: dict[str, Any] | None, plan: dict[str, Any]) -> str:
    """credits.txt: every placed shot from YouTube or the archives, with its
    licence and page — CC BY and CC BY-SA require it, and a YouTube channel is
    owed it."""
    videos = {v["id"]: v for v in (doc or {}).get("videos") or []}
    photos = {p["id"]: p for p in (doc or {}).get("photos") or []}
    lines: list[str] = []
    seen: set[str] = set()
    for item in plan["tracks"]["visual"]:
        asset = item.get("asset") or {}
        src, aid = asset.get("source"), str(asset.get("id") or "")
        if src == "youtube":
            v = videos.get(aid.split("#")[0])
            if v and v["id"] not in seen:
                seen.add(v["id"])
                lines.append(f"- {v['title']} — {v.get('channel') or 'unknown channel'} — YouTube — {v['url']}")
        elif src == "archive":
            p = photos.get(aid)
            if p and p["id"] not in seen:
                seen.add(p["id"])
                lines.append(f"- {p['title']} — {p.get('author') or 'unknown author'} — {p['license']} — {p.get('page') or p['url']}")
        elif src == "stock" and asset.get("provider") and aid and f"stock:{aid}" not in seen:
            seen.add(f"stock:{aid}")
            lines.append(f"- {asset.get('provider')} #{aid} — {asset.get('license') or 'royalty-free'}")
    if not lines:
        return ""
    return "Footage and photos used in this video:\n" + "\n".join(lines) + "\n"


def validate_footage(doc: dict[str, Any]) -> list[str]:
    from ..validators import _schema_errors

    return _schema_errors("footage", doc)
