"""Pick shots — a vision judge between the search and the download.

D103 (documentary plan, slice 3). resolve_assets downloads the FIRST hit a
search returns, and a keyword search cannot tell a Pennsylvania coal town from
a sunny suburb that shares the words: run 01 of the Centralia benchmark had a
tropical garbage fire under "the town dump" and a palm-lined street under
"1960s small town". Slice 2 made the searches ask about the story; this makes
someone LOOK at the answers.

Dark Palace's `escolher_tomadas`: candidates on a numbered contact sheet, a
vision model rates each 1-5 and names a corner logo. Here one sheet holds
several shots, one row each, so a 36-shot video is six calls. The ratings go to
`shot_picks.json`; resolve_assets fetches the best-rated candidate that is not
already on screen, crops what the judge reported, and asks the plain search for
any shot the judge could not rate — a vision outage costs quality, never the
video.
"""

from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import httpx
from lusora_contracts import prompts as prompt_packs

from ..config import parallelism
from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm, sources
from ..validators import validate_ratings

STAGE = "pick_shots"
ROLE = "pick_shots"
MAX_ATTEMPTS = 2

DEFAULTS = {"enabled": False, "llm": "claude_cli", "model": None,
            "candidates_per_shot": 6, "shots_per_sheet": 6, "min_rating": 3}

CELL_W, CELL_H, LABEL_H = 320, 180, 26


def settings(cfg: dict[str, Any]) -> dict[str, Any]:
    pick = (((cfg.get("source_policy") or {}).get("visual") or {}).get("pick")) or {}
    return {**DEFAULTS, **{k: v for k, v in pick.items() if v is not None}}


# ---------------- candidates ----------------


def gather(
    ctx: StageContext,
    shots: list[tuple[dict, list[str]]],
    chain: list[dict],
    limit: int,
) -> dict[str, list[dict]]:
    """Candidates per item id, from the first source in the chain that offers
    any. A source without a `candidates` method (the generator, today's
    library adapter) is skipped here and still answers in resolve_assets."""
    offering = [(c, sources.ADAPTERS[str(c.get("source"))]) for c in chain
                if hasattr(sources.ADAPTERS.get(str(c.get("source"))), "candidates")]

    def one(shot: tuple[dict, list[str]]) -> tuple[str, list[dict]]:
        item, queries = shot
        for source_cfg, adapter in offering:
            found = adapter.candidates(ctx, item, queries, source_cfg, limit)
            if found:
                return str(item["id"]), found
        return str(item["id"]), []

    workers = max(1, min(len(shots), parallelism("ASSET_PARALLELISM", 4)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(one, shots))


# ---------------- contact sheets ----------------


def _thumb(url: str, dest: Path) -> bool:
    small = url if "?" in url else f"{url}?auto=compress&cs=tinysrgb&w=480"
    try:
        with httpx.stream("GET", small, timeout=30, follow_redirects=True) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        return True
    except httpx.HTTPError:
        dest.unlink(missing_ok=True)
        return False


def _cell(src: Path | None, label: str, dest: Path) -> None:
    box = f"scale={CELL_W}:{CELL_H}:force_original_aspect_ratio=decrease," \
          f"pad={CELL_W}:{CELL_H + LABEL_H}:(ow-iw)/2:{LABEL_H}+({CELL_H}-ih)/2:color=0x111111"
    text = (f"drawtext=font='DejaVu Sans':fontsize=20:fontcolor=0xffd400:x=6:y=3:text='{label}'"
            if label else "null")
    inputs = ["-i", str(src)] if src else ["-f", "lavfi", "-i", f"color=c=0x111111:s={CELL_W}x{CELL_H}"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-vf", f"{box},{text}",
                    "-frames:v", "1", "-q:v", "3", str(dest)], check=True, capture_output=True)


def build_sheet(
    workdir: Path, rows: list[list[dict]], first_row: int, cols: int, name: str,
) -> tuple[Path, list[tuple[int, dict]]]:
    """One numbered contact sheet: a row per shot, its candidates left to
    right, each labelled `#n  shot r`. A thumbnail that will not download
    leaves a blank cell and takes no number, so the judge is never asked about
    a picture it cannot see. Returns the sheet and, per number, (row, candidate)."""
    workdir.mkdir(parents=True, exist_ok=True)
    numbered: list[tuple[int, dict]] = []
    cells: list[Path] = []
    for r, row in enumerate(rows):
        for c in range(cols):
            cell = workdir / f"_{name}_{len(cells):03d}.jpg"
            candidate = row[c] if c < len(row) else None
            raw = workdir / f"_{name}_raw.jpg"
            if candidate is not None and _thumb(str(candidate["thumb"]), raw):
                n = len(numbered)
                _cell(raw, f"#{n}  shot {first_row + r + 1}", cell)
                numbered.append((r, candidate))
            else:
                _cell(None, "", cell)
            raw.unlink(missing_ok=True)
            cells.append(cell)
    sheet = workdir / f"{name}.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "1", "-i", str(workdir / f"_{name}_%03d.jpg"),
                    "-vf", f"tile={cols}x{len(rows)}", "-frames:v", "1", "-q:v", "4", str(sheet)],
                   check=True, capture_output=True)
    for cell in cells:
        cell.unlink(missing_ok=True)
    return sheet, numbered


def render_rows(
    rows: list[tuple[dict, dict]], numbered: list[tuple[int, dict]], first_row: int,
    subject_names: dict[str, str],
) -> str:
    """The text half of the sheet: which numbers are which shot, and what that
    shot is for."""
    lines = []
    for r, (item, beat) in enumerate(rows):
        numbers = [f"#{n}" for n, (row, _c) in enumerate(numbered) if row == r]
        if not numbers:
            continue
        span = f"{numbers[0]}-{numbers[-1]}" if len(numbers) > 1 else numbers[0]
        subject = subject_names.get(str(beat.get("subject") or ""))
        lines.append(
            f"shot {first_row + r + 1} ({span}): narration \"{str(beat.get('script_text') or '').strip()[:220]}\""
            f" — wanted: {str(beat.get('visual_intent') or '').strip()[:200]}"
            + (f" — subject: {subject}" if subject else "")
        )
    return "\n".join(lines)


# ---------------- the judge ----------------


def _build_prompt(ctx: StageContext, rows_text: str, count: int) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    subjects_doc = ctx.read_json("subjects.json") if ctx.has("subjects.json") else {}
    return prompt_packs.compose(
        ROLE,
        (ctx.cfg.get("prompts") or {}).get(ROLE),
        {
            "rows": rows_text,
            "candidate_count": count,
            "main_idea": str(subjects_doc.get("main_idea") or ""),
            "visual_thread": ", ".join(subjects_doc.get("visual_thread") or []),
            "visual_language": str(style.get("visual_language") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
        },
    )


class _JudgeDown(Exception):
    """The vision provider could not answer (quota, login, network)."""


def judge(
    ctx: StageContext,
    sheet: Path,
    rows_text: str,
    count: int,
    conf: dict[str, Any],
    see_fn: llm.SeeFn,
    label: str,
) -> list[dict] | None:
    """One sheet's ratings, repaired once; None when the judge could not
    answer, so its shots fall back to the plain search."""
    provider, model = str(conf["llm"]), conf.get("model")
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    temperature = prompt_packs.temperature(ROLE, prompt)
    system, base_user = _build_prompt(ctx, rows_text, count)
    user = base_user
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with budget_gate(
                ctx, stage=STAGE, provider=provider, operation="vision.pick_shots",
                estimated_units=3000, model=model,
                details={"sheet": label, "candidates": count, "attempt": attempt},
            ) as cost:
                try:
                    result = see_fn(provider, model, system, user, [sheet], 4000, temperature)
                except StageError as exc:
                    # the gate records a failed call and lets this through; a
                    # budget stop or a missing price is raised by the gate
                    # itself and still stops the video
                    raise _JudgeDown(str(exc)) from exc
                cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                                  "output_tokens": result.output_tokens,
                                                  "sheet": label, "attempt": attempt})
        except _JudgeDown as exc:
            ctx.db.provider_health(f"vision.{provider}", False, str(exc)[:200])
            ctx.db.event(ctx.video_id, STAGE, "progress",
                         f"{label}: the judge did not answer ({str(exc)[:160]}) — plain search for its shots")
            return None
        try:
            answer = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as exc:
            violations = [f"output was not a parseable JSON object: {exc}"]
        else:
            violations = validate_ratings(answer, count)
            if not violations:
                ctx.db.provider_health(f"vision.{provider}", True)
                return answer["ratings"]
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"{label}: attempt {attempt} rejected: {'; '.join(violations[:4])}")
        user = (base_user + "\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix ALL of these and output the corrected JSON:\n- "
                + "\n- ".join(violations))
    return None


def mock_ratings(count: int) -> list[dict]:
    """The offline judge: every candidate a 3, so resolve tries them in the
    search's own order — exactly what it did before pick_shots existed."""
    return [{"n": n, "rating": 3, "logo": "", "desc": ""} for n in range(count)]


# ---------------- the stage ----------------


def pick(
    ctx: StageContext,
    shots: list[tuple[dict, dict, list[str]]],
    chain: list[dict],
    see_fn: llm.SeeFn = llm.see,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """shots = (plan item, its beat, its searches) for every item to judge.
    Returns the shot_picks.json document."""
    conf = settings(ctx.cfg)
    doc: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "enabled": True,
                           "provider": str(conf["llm"]), "model": conf.get("model"),
                           "sheets": 0, "unjudged": [], "items": {}}
    limit = int(conf["candidates_per_shot"])
    found = gather(ctx, [(item, queries) for item, _beat, queries in shots], chain, limit)
    judged_shots = [(item, beat) for item, beat, _q in shots if found.get(str(item["id"]))]
    if progress:
        total = sum(len(v) for v in found.values())
        progress(f"{total} candidates for {len(judged_shots)} of {len(shots)} shots")

    subjects_doc = ctx.read_json("subjects.json") if ctx.has("subjects.json") else {}
    subject_names = {str(s["id"]): str(s.get("name") or "") for s in subjects_doc.get("subjects") or []}
    per_sheet = int(conf["shots_per_sheet"])
    groups = [judged_shots[i:i + per_sheet] for i in range(0, len(judged_shots), per_sheet)]
    workdir = ctx.folder / "sheets"

    def one(g: int) -> tuple[int, list[tuple[int, dict]], list[dict] | None]:
        group = groups[g]
        first_row = g * per_sheet
        rows = [found[str(item["id"])] for item, _beat in group]
        label = f"sheet {g + 1}/{len(groups)}"
        if conf["llm"] == "mock":
            numbered = [(r, c) for r, row in enumerate(rows) for c in row]
            return g, numbered, mock_ratings(len(numbered))
        sheet, numbered = build_sheet(workdir, rows, first_row, limit, f"sheet_{g + 1:02d}")
        if not numbered:
            return g, numbered, None
        rows_text = render_rows(group, numbered, first_row, subject_names)
        return g, numbered, judge(ctx, sheet, rows_text, len(numbered), conf, see_fn, label)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(one, range(len(groups))))

    for g, numbered, ratings in results:
        group = groups[g]
        if ratings is None:
            doc["unjudged"] += [str(item["id"]) for item, _beat in group]
            continue
        doc["sheets"] += 1
        by_n = {int(r["n"]): r for r in ratings}
        for r, (item, _beat) in enumerate(group):
            rated = []
            for n, (row, candidate) in enumerate(numbered):
                if row != r or n not in by_n:
                    continue
                verdict = by_n[n]
                rated.append({
                    "source": candidate["source"], "provider": candidate.get("provider"),
                    "id": str(candidate["id"]), "query": str(candidate["query"]),
                    "page_size": int(candidate.get("page_size") or limit),
                    "rating": int(verdict["rating"]),
                    "logo": str(verdict.get("logo") or "").strip().lower(),
                    "desc": str(verdict.get("desc") or "")[:120],
                })
            # best first; the search's own order breaks a tie (sorted is stable)
            rated.sort(key=lambda c: -c["rating"])
            doc["items"][str(item["id"])] = {"beat_id": item.get("beat_id"), "candidates": rated}
    return doc


def best_candidates(doc: dict[str, Any] | None, item_id: str, min_rating: int) -> list[dict]:
    """The candidates resolve_assets may place for one item, best first."""
    entry = ((doc or {}).get("items") or {}).get(str(item_id)) or {}
    return [c for c in entry.get("candidates") or [] if int(c.get("rating", 0)) >= min_rating]
