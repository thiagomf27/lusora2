"""The visual review (D121, documentary plan slice 12b) — Dark Palace's
`revisor`: the FINISHED video looked at, and the shots with a problem repaired.

Two frames of every visual item (25% and 75% into it) on contact sheets of 12,
shown to the pick judge, which names the items with a problem:

  logo          a small channel logo in one corner of the footage
  foreign_text  text that is not ours: a news banner, burned-in subtitles,
                a big title, a screenshot (DP's `alheio`)
  cut_off       our own text cut off at the edge or out of its box (`cortado`)
  blank         a black, blank or broken frame (`preto`)

Code does the repair: a source with foreign text is banned from the video and
every shot that used it is resolved again; a logo is cropped out of every clip
of its source; a cut-off graphic is dropped with its sound; a blank shot gets
another picture. This module holds the pieces that decide; the stage body
(`steps.run_visual_review`) resolves, validates and patch-renders.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm, sources
from . import pick_shots

ROLE = "visual_review"
STAGE = "visual_review"
PROBLEMS = ("logo", "foreign_text", "cut_off", "blank")
CORNERS = ("top-left", "top-right", "bottom-left", "bottom-right")
PER_SHEET = 12  # items per sheet (DP's `por`)
PER_ROW = 3  # items per row, two frames each
SAMPLES = (0.25, 0.75)

DEFAULTS = {"enabled": False, "never_empty": True}


def settings(cfg: dict[str, Any]) -> dict[str, Any]:
    review = (((cfg.get("source_policy") or {}).get("visual") or {}).get("review")) or {}
    return {**DEFAULTS, **{k: v for k, v in review.items() if v is not None}}


# ---------------- looking ----------------


def sample_times(plan: dict[str, Any], window: tuple[float, float] | None) -> dict[int, list[float]]:
    """Item index -> the FILE seconds of its two frames. A windowed render's
    t=0 is the window's start; an item whose frames fall outside it is not in
    the file and is skipped."""
    out: dict[int, list[float]] = {}
    start, end = window if window else (0.0, float("inf"))
    for i, item in enumerate(plan["tracks"]["visual"]):
        s, e = float(item["start_s"]), float(item["end_s"])
        times = [s + (e - s) * f for f in SAMPLES]
        if all(start <= t < end for t in times):
            out[i] = [round(t - start, 3) for t in times]
    return out


def extract_frames(video: Path, times: dict[int, list[float]], workdir: Path) -> dict[int, list[Path]]:
    workdir.mkdir(parents=True, exist_ok=True)
    frames: dict[int, list[Path]] = {}
    for i, ts in times.items():
        got = []
        for k, t in enumerate(ts):
            dest = workdir / f"_frame_{i:04d}_{k}.jpg"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video),
                            "-frames:v", "1", "-q:v", "3", str(dest)], capture_output=True)
            if dest.exists():
                got.append(dest)
        if got:
            frames[i] = got
    return frames


def build_sheets(workdir: Path, frames: dict[int, list[Path]]) -> list[tuple[Path, list[int]]]:
    """Sheets of PER_SHEET items, PER_ROW to a row, each item's two frames side
    by side and its number in yellow over the first — DP's `folhas`, drawn by
    pick_shots' sheet builder."""
    order = sorted(frames)
    out = []
    for s in range(0, len(order), PER_SHEET):
        group = order[s:s + PER_SHEET]
        rows, labels = [], []
        for r in range(0, len(group), PER_ROW):
            row, label = [], []
            for i in group[r:r + PER_ROW]:
                pair = (frames[i] + frames[i])[:2]  # one frame only: shown twice
                row += [{"thumb": str(p)} for p in pair]
                label += [f"#{i}", ""]
            rows.append(row)
            labels.append(label)
        sheet, _numbered = pick_shots.build_sheet(workdir, rows, 0, 2 * PER_ROW, f"review_{s // PER_SHEET + 1:02d}",
                                                  cell_labels=labels)
        out.append((sheet, group))
    return out


def _words(props: dict[str, Any]) -> str:
    """What a graphic says, for the judge to recognize it: its string props."""
    said = [str(v) for k, v in (props or {}).items() if isinstance(v, str) and k not in ("emphasis", "variant", "side",
            "position", "framing", "zoom", "src", "plate") and v.strip()]
    return " / ".join(said)[:90]


def describe_graphics(plan: dict[str, Any], items: list[int]) -> str:
    """One line per shot that has any of OUR graphics on screen at its two
    frames: which component, and what it says. Without it, a graphic that
    repeats the narration — a highlighted passage, a marked phrase — reads to
    the judge exactly like burned-in subtitles (the first Centralia review
    banned two good clips over the hook's own marked phrase)."""
    visual = plan["tracks"]["visual"]
    overlays = plan["tracks"].get("overlays") or []
    lines = []
    for i in items:
        s, e = float(visual[i]["start_s"]), float(visual[i]["end_s"])
        over = _covering(overlays, [s + (e - s) * f for f in SAMPLES])
        if over:
            said = "; ".join(f"{o.get('component') or o.get('kind')}" + (f' "{_words(o.get("props") or {})}"'
                             if _words(o.get("props") or {}) else "") for o in over)
            lines.append(f"#{i}: {said}")
    return "\n".join(lines)


def validate(answer: Any, on_sheet: list[int]) -> tuple[list[dict[str, Any]], list[str]]:
    """(the findings kept, a note per thing dropped)."""
    problems = answer.get("problems") if isinstance(answer, dict) else None
    if not isinstance(problems, list):
        return [], ["the answer has no `problems` list — nothing taken from it"]
    kept, notes = [], []
    for entry in problems:
        if not isinstance(entry, dict):
            notes.append(f"not an object: {entry!r}"[:120])
            continue
        item, problem = entry.get("item"), str(entry.get("problem") or "")
        if isinstance(item, bool) or not isinstance(item, int) or item not in on_sheet:
            notes.append(f"item {item!r} is not on this sheet")
            continue
        if problem not in PROBLEMS:
            notes.append(f"item {item}: unknown problem {problem!r}")
            continue
        corner = str(entry.get("corner") or "").strip().lower()
        if problem == "logo" and corner not in CORNERS:
            notes.append(f"item {item}: a logo with no corner ({corner!r}) — nothing to crop")
            continue
        kept.append({"item": item, "problem": problem, **({"corner": corner} if problem == "logo" else {}),
                     "note": str(entry.get("note") or "")[:160]})
    return kept, notes


def judge(
    ctx: StageContext, sheet: Path, items: list[int], see_fn: llm.SeeFn, graphics: str = "",
) -> tuple[list[dict], list[str]]:
    """One sheet's findings. A judge that cannot answer (quota, login, network)
    costs the review, never the video: nothing is found on that sheet."""
    conf = pick_shots.settings(ctx.cfg)
    provider = conf["llm"]
    model = None if isinstance(provider, list) else conf.get("model")
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    system, user = prompt_packs.compose(ROLE, prompt, {
        "items": ", ".join(f"#{i}" for i in items),
        "graphics": graphics,
        "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
    })
    try:
        with budget_gate(ctx, stage=STAGE, provider=provider, operation="llm.visual_review",
                         estimated_units=3000, model=model, details={"sheet": sheet.name}) as cost:
            try:
                result = see_fn(provider, model, system, user, [sheet], 4000, prompt_packs.temperature(ROLE, prompt))
            except StageError as exc:
                raise _JudgeDown(str(exc)) from exc
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "sheet": sheet.name, "answered_by": result.provider})
    except _JudgeDown as exc:
        return [], [f"{sheet.name}: the judge did not answer ({str(exc)[:160]}) — not reviewed"]
    try:
        answer = llm.extract_json(result.text)
    except (ValueError, json.JSONDecodeError) as exc:
        return [], [f"{sheet.name}: the answer was not JSON ({exc})"[:200]]
    kept, notes = validate(answer, items)
    return kept, [f"{sheet.name}: {n}" for n in notes]


class _JudgeDown(Exception):
    """The vision provider could not answer."""


# ---------------- repairing ----------------


def _ban_key(asset: dict[str, Any]) -> str:
    """The whole upload when the asset names one, else the asset itself."""
    parent = sources.Ledger.parent(str(asset.get("source") or ""), asset.get("id"))
    return parent if parent is not None else sources.Ledger.key(asset)


def _same_source(asset: dict[str, Any], key: str) -> bool:
    return bool(asset.get("path")) and (_ban_key(asset) == key or sources.Ledger.key(asset) == key)


def _covering(overlays: list[dict[str, Any]], times: list[float]) -> list[dict[str, Any]]:
    return [o for o in overlays if any(float(o["start_s"]) <= t < float(o["end_s"]) for t in times)]


def repair(ctx: StageContext, plan: dict[str, Any], found: list[dict[str, Any]]) -> dict[str, Any]:
    """Apply the findings to `plan` in place. Returns what was done:
    {"done": [notes], "banned": [keys], "cleared": [item ids]}.

    Order matters: a source is banned (and its shots cleared) before any crop,
    so a clip about to be replaced is never cropped; a cut-off with no graphic
    over it is text IN the footage, which is DP's rule too — ban its source."""
    visual = plan["tracks"]["visual"]
    overlays = plan["tracks"].get("overlays") or []
    audio = plan["tracks"].get("audio") or {}
    done: list[str] = []
    banned: list[str] = []
    cleared: set[str] = set()

    def clear(match: Any, why: str) -> None:
        for item in visual:
            asset = item.get("asset") or {}
            if not match(item) or str(item["id"]) in cleared or not asset.get("path"):
                continue
            path = str(asset["path"])
            # unlink only when no shot we keep still shows the file (a
            # never-empty repeat shares its neighbour's), and never write
            # over it: on a hard-linked bench fork it is the original's too
            if not any(str((v.get("asset") or {}).get("path")) == path and str(v["id"]) not in cleared
                       and v is not item for v in visual):
                (ctx.folder / path).unlink(missing_ok=True)
            item["asset"] = {"source": asset.get("source") or "manual", "path": ""}
            cleared.add(str(item["id"]))
            done.append(f"{item['id']}: cleared to be resolved again ({why})")

    by_item = {f["item"]: f for f in found}
    times = {i: [float(visual[i]["start_s"]) + (float(visual[i]["end_s"]) - float(visual[i]["start_s"])) * f
                 for f in SAMPLES] for i in by_item if 0 <= i < len(visual)}
    # which of our graphics were over a shot is a question about the video as
    # rendered: two shots flagged for one graphic that spans them must both
    # find it, not the second find it already gone and blame the footage
    rendered = list(overlays)

    for i, f in sorted(by_item.items()):
        if i not in times:
            continue
        item = visual[i]
        asset = item.get("asset") or {}
        problem = f["problem"]
        if problem == "cut_off":
            over = _covering(rendered, times[i])
            if over:
                ids = {str(o["id"]) for o in over}
                if not any(str(o["id"]) in ids for o in overlays):
                    continue  # already dropped for a shot before this one
                plan["tracks"]["overlays"] = overlays = [o for o in overlays if str(o["id"]) not in ids]
                if audio.get("sfx"):
                    audio["sfx"] = [s for s in audio["sfx"] if str(s.get("origin_id")) not in ids]
                done.append(f"{item['id']}: dropped {', '.join(sorted(ids))} (its text was cut off)")
                continue
            problem = "foreign_text"  # no graphic of ours there: the text is in the footage
        if problem not in ("foreign_text", "blank") or not asset.get("path"):
            continue
        why = "foreign text" if problem == "foreign_text" else "blank frame"
        if not asset.get("id"):
            # a generated picture or a manual file names no source to ban
            # (every generated image shares `ai:<provider>:`): only this shot
            clear(lambda v, item=item: v is item, why)
            continue
        key = _ban_key(asset) if problem == "foreign_text" else sources.Ledger.key(asset)
        if key not in banned:
            banned.append(key)
        if problem == "foreign_text":
            clear(lambda v, key=key: _same_source(v.get("asset") or {}, key), f"{why} in {key}")
        else:
            clear(lambda v, key=key: sources.Ledger.key(v.get("asset") or {}) == key, why)

    for i, f in sorted(by_item.items()):
        if f["problem"] != "logo" or i not in times:
            continue
        asset = visual[i].get("asset") or {}
        if not asset.get("path") or str(visual[i]["id"]) in cleared:
            continue
        key = _ban_key(asset)
        # every clip of the upload carries its logo; an id-less asset is only itself
        group = [v for v in visual if _same_source(v.get("asset") or {}, key)] if asset.get("id") else [visual[i]]
        for item in group:
            a = item.get("asset") or {}
            if str(item["id"]) in cleared or a.get("logo_crop"):
                continue
            if item.get("media_type") not in ("image", "video") or not (ctx.folder / str(a["path"])).exists():
                continue
            if sources.reframe(ctx.folder / str(a["path"]), f["corner"]):
                a["logo_crop"] = f["corner"]
                done.append(f"{item['id']}: cropped the {f['corner']} logo out of {a['path']}")

    return {"done": done, "banned": banned, "cleared": sorted(cleared)}
