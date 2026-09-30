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
import re
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
            "screen": True, "keep_in_library": True, "check_min_share": 0.5,
            **PRESETS.get(amount, PRESETS["normal"])}
    conf.update({k: v for k, v in raw.items() if v is not None})
    return conf


_NOT_A_NAME = {"the", "a", "an", "and", "of", "in", "on", "to", "for", "with", "from", "how", "why", "what",
               "when", "who", "its", "it", "this", "that", "town", "city", "fire", "today"}


def anchor_name(subjects_doc: dict[str, Any], video_title: str = "") -> str:
    """The proper noun this video keeps returning to ("Centralia"), or "".

    Counted over the subject names, the working title and the video's own
    title: a capitalised word that is not a sentence word. It stands in for the
    `youtube` search a subjects.json written before D104 does not have."""
    texts = [str(s.get("name") or "") for s in subjects_doc.get("subjects") or []]
    texts += [str(subjects_doc.get("title") or ""), video_title]
    counts: dict[str, int] = {}
    for text in texts:
        for word in re.findall(r"\b[A-Z][a-zA-Z]{2,}\b", text):
            key = word.lower()
            if key not in _NOT_A_NAME:
                counts[word] = counts.get(word, 0) + 1
    best = sorted(counts.items(), key=lambda kv: -kv[1])
    return best[0][0] if best and best[0][1] >= 2 else ""


def youtube_query(subject: dict[str, Any], anchor: str) -> str:
    """What to ask YouTube for one subject (D104).

    YouTube's worth is real footage of THE place, so the search must name it.
    The first Centralia run searched the stock queries instead — 'steam cracks
    in ground' — and got Old Faithful, a Hampshire church and a Los Angeles
    trench rescue: one video in eleven was of Centralia."""
    if str(subject.get("youtube") or "").strip():
        return str(subject["youtube"]).strip()
    name = re.sub(r"^(the|a|an)\s+", "", str(subject.get("name") or ""), flags=re.I).strip()
    if anchor and anchor.lower() not in name.lower():
        return f"{anchor} {name}".strip()
    return name or str((subject.get("queries") or [""])[0])


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


# ---------------- the early topic check (D105) ----------------


def check(ctx: StageContext, progress: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Before the beats are planned: does the internet have footage of this
    story at all? Per subject, the YouTube search gather_footage will ask
    (metadata only) and one Commons search. A subject is COVERED when it has
    at least two usable YouTube results or one free-licence photo. The raw
    results are kept, so gather_footage does not search twice."""
    conf = settings(ctx.cfg)
    say = progress or (lambda _m: None)
    subjects_doc = ctx.read_json("subjects.json")
    subjects = {str(s["id"]): s for s in subjects_doc.get("subjects") or []}
    anchor = anchor_name(subjects_doc, str(ctx.video.get("title") or ""))
    safety = bool(conf["safety"])
    out: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "subjects": {}, "thin": [], "note": ""}

    def one(sid: str) -> tuple[str, dict[str, Any]]:
        q = youtube_query(subjects[sid], anchor)
        entry: dict[str, Any] = {"name": subjects[sid].get("name", ""), "query": q, "youtube": 0, "photos": 0,
                                 "results": []}
        if conf["youtube"]:
            try:
                raw = footage.youtube_search(q, RESULTS_PER_SEARCH)
            except footage.ProxyMissing as exc:
                raw, out["note"] = [], str(exc)
            usable = [r for r in raw if footage.usable_result(r, float(conf["max_video_seconds"]))
                      and (not safety or adult_filter.safe(r["title"]))]
            entry["youtube"], entry["results"] = len(usable), usable
        if conf["photos"]:
            try:
                photos, _why = footage.commons_photos(q, 2, safety=safety)
                entry["photos"] = len(photos)
            except Exception:  # noqa: BLE001 - a site refusing is not an answer about the topic
                entry["photos"] = 0
        return sid, entry

    with ThreadPoolExecutor(max_workers=4) as pool:
        out["subjects"] = dict(pool.map(one, list(subjects)))
    out["thin"] = [sid for sid, e in out["subjects"].items() if e["youtube"] < 2 and e["photos"] < 1]
    covered = len(subjects) - len(out["thin"])
    say(f"footage check: {covered} of {len(subjects)} subjects have footage online"
        + (f"; thin: {', '.join(out['thin'])}" if out["thin"] else ""))
    return out


def check_is_thin(doc: dict[str, Any], min_share: float) -> str:
    """The reason to stop, or "" when the topic has enough footage."""
    total = len(doc.get("subjects") or {})
    if not total:
        return ""
    covered = total - len(doc.get("thin") or [])
    if covered / total >= min_share:
        return ""
    names = ", ".join(f"{sid} ({doc['subjects'][sid]['name']})" for sid in doc["thin"][:6])
    return (f"only {covered} of {total} subjects have footage online (the channel asks for "
            f"{min_share:.0%}); thin: {names}")


def footage_report(ctx: StageContext) -> str:
    """footage_report.md: what the topic check and the judge found, written
    for the person deciding whether to approve a paused video."""
    lines = [f"# Footage report — {ctx.video.get('title') or ctx.video_id}", ""]
    if ctx.has("footage_check.json"):
        doc = ctx.read_json("footage_check.json")
        lines += ["## Topic check (before planning)", "",
                  "| subject | search | usable YouTube results | photos |", "|---|---|---|---|"]
        for sid, e in (doc.get("subjects") or {}).items():
            mark = " ⚠" if sid in (doc.get("thin") or []) else ""
            lines.append(f"| {sid}{mark} {e.get('name', '')} | {e.get('query', '')} | {e.get('youtube', 0)} | {e.get('photos', 0)} |")
        if doc.get("note"):
            lines += ["", f"Note: {doc['note']}"]
        lines.append("")
    if ctx.has("shot_picks.json") and ctx.has("beats.json"):
        from .pick_shots import settings as pick_settings

        picks = ctx.read_json("shot_picks.json")
        min_rating = int(pick_settings(ctx.cfg)["min_rating"])
        beats = {b["id"]: b for b in ctx.read_json("beats.json")["beats"]}
        weak = []
        for item_id, entry in (picks.get("items") or {}).items():
            best = (entry.get("candidates") or [{}])[0]
            if int(best.get("rating") or 0) < min_rating:
                beat = beats.get(str(entry.get("beat_id")), {})
                weak.append(f"| {entry.get('beat_id')} | {str(beat.get('script_text') or '')[:90]} | "
                            f"{best.get('rating', '—')} {best.get('desc', '')[:50]} |")
        judged = len(picks.get("items") or {})
        lines += ["## Shot judge (before the render)", "",
                  f"{judged - len(weak)} of {judged} judged shots have a candidate rated {min_rating}+. "
                  f"Contact sheets are in `sheets/`.", ""]
        if weak:
            lines += ["Weak shots (they will use their best candidate, or the plain search):", "",
                      "| beat | narration | best candidate |", "|---|---|---|", *weak, ""]
        if picks.get("unjudged"):
            lines += [f"Not judged (the judge did not answer): {', '.join(picks['unjudged'])}", ""]
    lines += ["Approve to continue with what was found, or cancel the video."]
    return "\n".join(lines) + "\n"


def gather(
    ctx: StageContext,
    chat_fn: llm.ChatFn = llm.chat,
    progress: Callable[[str], None] | None = None,
    see_fn: llm.SeeFn = llm.see,
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

    anchor = anchor_name(subjects_doc, str(ctx.video.get("title") or ""))

    # ---- YouTube ----
    if conf["youtube"] and int(conf["max_videos"]) > 0:
        asked = {sid: youtube_query(subjects[sid], anchor) for sid in order}
        say("youtube searches: " + "; ".join(f"{sid} '{q}'" for sid, q in asked.items()))
        # the topic check (D105) already asked the same questions
        checked = (ctx.read_json("footage_check.json").get("subjects") or {}) if ctx.has("footage_check.json") else {}

        def search(sid: str) -> tuple[str, list[dict]]:
            prior = checked.get(sid) or {}
            if prior.get("query") == asked[sid] and prior.get("results"):
                return sid, list(prior["results"])
            return sid, footage.youtube_search(asked[sid], RESULTS_PER_SEARCH)

        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                raw = dict(pool.map(search, order))
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
            video = {"id": r["id"], "subject": sid, "title": r["title"], "channel": r["channel"], "url": r["url"],
                     "duration": footage.probe_seconds(ctx.folder / rel), "file": rel, "license": "youtube",
                     "shots": shots}
            if conf["screen"]:
                video = screen(ctx, video, subjects[sid], see_fn)
                if not video["shots"]:
                    doc["skipped"].append(f"youtube {r['id']}: every shot failed screening")
                    return None
            return video

        # two at a time through one proxy: parallel yt-dlp traffic is the
        # classic bot signature (the library runs one)
        with ThreadPoolExecutor(max_workers=2) as pool:
            doc["videos"] = [v for v in pool.map(fetch, chosen) if v]
        if chosen:
            ctx.db.provider_health("youtube", bool(doc["videos"]))
        dropped = sum(int(v.get("dropped") or 0) for v in doc["videos"])
        say(f"youtube: {len(doc['videos'])} of {len(chosen)} chosen videos downloaded, "
            f"{sum(len(v['shots']) for v in doc['videos'])} shots"
            + (f" ({dropped} dropped by screening: captions, effects, graphics, off-subject)" if dropped else ""))

    # ---- Commons and archive.org photos ----
    per = int(conf["photos_per_subject"])
    if conf["photos"] and per > 0:
        def photos(sid: str) -> tuple[str, list[dict], list[str]]:
            # archives hold real, NAMED things: ask for the place first, and
            # only fall back to the generic stock words when that finds nothing
            got, skipped = [], []
            for q in dict.fromkeys([youtube_query(subjects[sid], anchor), first_query(sid)]):
                for fetcher, n in ((footage.commons_photos, per), (footage.archive_photos, max(1, per // 2))):
                    try:
                        found, why = fetcher(q, n, safety=safety)
                    except Exception as exc:  # noqa: BLE001 - one site refusing costs its photos, not the video
                        skipped.append(f"{fetcher.__name__} '{q}': {type(exc).__name__}")
                        continue
                    got += [p for p in found if p["id"] not in {g["id"] for g in got}]
                    skipped += why
                if got:
                    break
            return sid, got[:per], skipped

        with ThreadPoolExecutor(max_workers=4) as pool:
            for sid, got, skipped in pool.map(photos, order):
                doc["photos"] += [{**p, "subject": sid} for p in got]
                doc["skipped"] += skipped
        say(f"photos: {len(doc['photos'])} free-licence photos for "
            f"{len({p['subject'] for p in doc['photos']})} subjects")
    return doc


def screen(
    ctx: StageContext,
    video: dict[str, Any],
    subject: dict[str, Any],
    see_fn: llm.SeeFn = llm.see,
) -> dict[str, Any]:
    """Show one downloaded video's shots to the pick judge, once, and keep only
    what could be b-roll for OUR narration (Dark Palace's `escolher_tomadas`).

    Footage cut from someone else's documentary carries that documentary's
    edit: burned-in captions, their graphics and title cards, zooms and glitch
    effects, a presenter talking to the camera. The user saw those in the first
    render with YouTube footage; a shot the judge rates 1 here never enters the
    pool, so no beat is ever offered it. A judge that cannot answer keeps the
    shots unscreened — pick_shots still rates each one against its beat."""
    from . import pick_shots

    conf = pick_shots.settings(ctx.cfg)
    if not conf["enabled"] or conf["llm"] == "mock" or not video["shots"]:
        return video
    cols = 6
    shots = video["shots"]
    offers = [{"id": f"{video['id']}#{s['n']}", "thumb": str(ctx.folder / s["thumb"])} for s in shots]
    rows = [offers[i:i + cols] for i in range(0, len(offers), cols)]
    sheet, numbered = pick_shots.build_sheet(ctx.folder / "sheets", rows, 0, cols, f"screen_{video['id']}",
                                             numbers_only=True)
    if not numbered:
        return video
    look = f" — {subject['look']}" if subject.get("look") else ""
    rows_text = (f"EVERY row is the same shot on this sheet (#0-#{len(numbered) - 1}): moments cut from the YouTube "
                 f"video \"{video['title']}\" ({video.get('channel') or 'unknown channel'}), found for the subject "
                 f"\"{subject.get('name', '')}\"{look}. Rate each moment as raw b-roll for that subject.")
    ratings = pick_shots.judge(ctx, sheet, rows_text, len(numbered), conf, see_fn, f"screen {video['id']}")
    if ratings is None:
        return video
    by_id = {str(cand["id"]): int(n) for n, (_row, cand) in enumerate(numbered)}
    by_n = {int(r["n"]): r for r in ratings}
    kept = []
    for shot, offer in zip(shots, offers):
        verdict = by_n.get(by_id.get(offer["id"], -1))
        if verdict is not None and int(verdict["rating"]) <= 1:
            continue
        if verdict is not None:
            shot = {**shot, "rating": int(verdict["rating"]), "desc": str(verdict.get("desc") or "")[:120]}
        kept.append(shot)
    return {**video, "shots": kept, "dropped": len(shots) - len(kept)}


def fetch_one_video(
    ctx: StageContext,
    query: str,
    subject_id: str,
    see_fn: llm.SeeFn = llm.see,
) -> dict[str, Any] | None:
    """One more YouTube video for a search a person typed at the footage gate
    (D108): the first usable, safe result not already in the pool, downloaded,
    cut, screened, and added to footage.json under `subject_id`. None when
    nothing usable came back — the search still reaches stock."""
    conf = settings(ctx.cfg)
    if not conf["enabled"] or not conf["youtube"]:
        return None
    pool = ctx.read_json("footage.json") if ctx.has("footage.json") else \
        {"version": "1.0", "video_id": ctx.video_id, "videos": [], "photos": [], "skipped": []}
    have = {v["id"] for v in pool.get("videos") or []}
    try:
        results = footage.youtube_search(query, RESULTS_PER_SEARCH)
    except footage.ProxyMissing:
        return None
    subjects = {str(s["id"]): s for s in (ctx.read_json("subjects.json").get("subjects") or [])} \
        if ctx.has("subjects.json") else {}
    for r in results:
        if r["id"] in have or not footage.usable_result(r, float(conf["max_video_seconds"])):
            continue
        if conf["safety"] and not adult_filter.safe(r["title"]):
            continue
        rel = f"footage/yt_{r['id']}.mp4"
        if footage.youtube_download(r["id"], ctx.folder / rel) is None:
            continue
        shots = footage.scene_shots(ctx.folder / rel, ctx.folder / "footage" / "thumbs", ctx.folder,
                                    int(conf["shots_per_video"]))
        video = {"id": r["id"], "subject": subject_id if subject_id in subjects else (next(iter(subjects), "s1")),
                 "title": r["title"], "channel": r["channel"], "url": r["url"],
                 "duration": footage.probe_seconds(ctx.folder / rel), "file": rel, "license": "youtube",
                 "shots": shots}
        if conf["screen"] and shots:
            video = screen(ctx, video, subjects.get(video["subject"], {"name": query}), see_fn)
        if not video["shots"]:
            continue
        pool.setdefault("videos", []).append(video)
        ctx.write_json("footage.json", pool)
        return video
    return None


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
    # a windowed test render shows one stretch of the timeline: credit only that
    window = ((ctx.cfg.get("output") or {}).get("window")) or {}
    lo, hi = float(window.get("start_s", 0.0)), float(window.get("end_s", float("inf")))
    lines: list[str] = []
    seen: set[str] = set()
    for item in plan["tracks"]["visual"]:
        if float(item.get("end_s", 0.0)) <= lo or float(item.get("start_s", 0.0)) >= hi:
            continue
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
            provider = str(asset.get("provider"))
            kind = "video" if item.get("media_type") == "video" else "photo"
            page = f" — https://www.pexels.com/{kind}/{aid}/" if provider == "pexels" else ""
            lines.append(f"- {provider.capitalize()} {kind} #{aid} — {asset.get('license') or 'royalty-free'}{page}")
    maps = [o for o in plan["tracks"].get("overlays") or []
            if o.get("component") == "SatelliteLocate" and ((o.get("props") or {}).get("plate") or (o.get("props") or {}).get("plates"))
            and float(o.get("end_s", 0.0)) > lo and float(o.get("start_s", 0.0)) < hi]
    if maps:
        from ..providers.imagery import CREDIT

        lines.append(f"- {CREDIT} — https://gibs.earthdata.nasa.gov")
    if not lines:
        return ""
    return "Footage and photos used in this video:\n" + "\n".join(lines) + "\n"


def validate_footage(doc: dict[str, Any]) -> list[str]:
    from ..validators import _schema_errors

    return _schema_errors("footage", doc)
