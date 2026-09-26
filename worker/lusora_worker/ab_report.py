"""The directed-edit A/B report (docs/05-roadmap/directed-edit-test.md, Part 2).

    uv run python -m lusora_worker.ab_report <vid> [<vid>]           the table
    uv run python -m lusora_worker.ab_report <vid> [<vid>] --json    one JSON row
    uv run python -m lusora_worker.ab_report <vid> [<vid>] --blind   X/Y links + score sheet
    uv run python -m lusora_worker.ab_report <vid> [<vid>] --unblind the table + the scores
    uv run python -m lusora_worker.ab_report --summary               the verdict over all pairs

One id is enough when it is a fork: its `ab_fork.json` names the other. Which
arm is which is read off the snapshots — the directed arm is the one whose
pipeline runs the `edit_hints` stage — so the order on the command line does
not matter. Two arms on the same pipeline are a NOISE pair (script 1 run
twice): the table still prints, the directed-only rows do not.

Everything comes from the two folders (the data plane of record) plus
cost_events and video_events. Without a database the model and failure rows
say so and the rest still prints.

Nothing here changes a video. --blind writes only under evals/directed/.
"""

from __future__ import annotations

import json
import math
import os
import random
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

import lusora_contracts

from .config import REPO_ROOT, videos_root
from .edithints import _beat_ranges, pin_spans
from .stage_times import parse as parse_stage_log
from .validators import emphasis_policy, max_overlays_for

SHARED_FILES = ("script.txt", "audio.mp3", "subtitles.srt", "tts_timings.json")
SNAPSHOT_VARIABLE = ("pipeline", "pipeline_doc")
EVALS = REPO_ROOT / "evals" / "directed"
RUBRIC = ("overlay_relevance", "overlay_timing", "mood_music", "hook", "broll_key_moments")
# Upstream of the fork: made once, shared by both arms, billed to one of them.
UPSTREAM_OPS = ("llm.generate_script", "llm.research", "tts.narrate", "transcribe")


class ReportError(Exception):
    pass


# ---------------- the arms ----------------


@dataclass
class Arm:
    video_id: str
    folder: Path
    cfg: dict[str, Any]

    @property
    def pipeline(self) -> str:
        return str(self.cfg.get("pipeline") or "?")

    @property
    def directed(self) -> bool:
        stages = (self.cfg.get("pipeline_doc") or {}).get("stages") or []
        return any(s.get("name") == "edit_hints" for s in stages)

    def has(self, name: str) -> bool:
        return (self.folder / name).exists()

    def json(self, name: str) -> Any:
        path = self.folder / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def text(self, name: str) -> str:
        path = self.folder / name
        return path.read_text(encoding="utf-8") if path.exists() else ""


def load_arm(video_id: str, root: Path | None = None) -> Arm:
    folder = (root or videos_root()) / video_id
    if not (folder / "cfg.json").exists():
        raise ReportError(f"{video_id}: no cfg.json in {folder} — was it enqueued?")
    return Arm(video_id, folder, json.loads((folder / "cfg.json").read_text(encoding="utf-8")))


def pair(ids: list[str], root: Path | None = None) -> tuple[Arm, Arm]:
    """(control, treatment) from one fork id or two ids, in either order."""
    if len(ids) == 1:
        record = load_arm(ids[0], root).json("ab_fork.json")
        if not record:
            raise ReportError(f"{ids[0]} is not a fork (no ab_fork.json) — name both videos")
        ids = [record["from"], ids[0]]
    if len(ids) != 2 or ids[0] == ids[1]:
        raise ReportError("name one forked video, or two different videos")
    a, b = (load_arm(i, root) for i in ids)
    if a.directed and b.directed:
        raise ReportError("both videos run the directed pipeline — one arm must be the control")
    return (b, a) if a.directed else (a, b)


def pair_name(control: Arm, other: Arm) -> str:
    """Sorted, not control-first: the name is printed beside the blind links."""
    return "__".join(sorted((control.video_id, other.video_id)))


# ---------------- is the pair clean? ----------------


def _sha(path: Path) -> str | None:
    return sha256(path.read_bytes()).hexdigest() if path.exists() else None


def integrity(control: Arm, other: Arm) -> list[str]:
    """Why this pair would NOT isolate the pipeline. Empty = clean."""
    problems: list[str] = []
    for name in SHARED_FILES:
        a, b = _sha(control.folder / name), _sha(other.folder / name)
        if a != b:
            problems.append(f"{name} differs between the arms" if a and b else f"{name} is in one arm only")
    keys = set(control.cfg) | set(other.cfg)
    drift = sorted(
        k for k in keys
        if k not in SNAPSHOT_VARIABLE and json.dumps(control.cfg.get(k), sort_keys=True) != json.dumps(other.cfg.get(k), sort_keys=True)
    )
    if drift:
        problems.append("the snapshots differ beyond the pipeline: " + ", ".join(drift))
    if control.has("edit_hints.json"):
        problems.append(f"the control {control.video_id} has an edit_hints.json")
    if other.directed and other.has("overlays.json"):
        problems.append(f"the directed arm {other.video_id} has an overlays.json")
    return problems


# ---------------- per arm ----------------


def _duration(arm: Arm) -> float:
    plan = arm.json("edit_plan.json") or {}
    return float(((plan.get("tracks") or {}).get("audio") or {}).get("voiceover", {}).get("duration_s") or 0.0)


def overlay_stats(arm: Arm) -> dict[str, Any]:
    plan = arm.json("edit_plan.json")
    if not plan:
        return {"compiled": None}
    duration = _duration(arm)
    style = arm.cfg.get("style_pack_doc") or {}
    anchor = emphasis = 0
    components: dict[str, int] = {}
    for item in plan["tracks"]["overlays"]:
        name = item.get("component")
        if not name:
            continue
        entry = lusora_contracts.catalog_component(name)
        if entry is not None and not entry.get("anchor_types"):
            emphasis += 1
        else:
            anchor += 1
        components[name] = components.get(name, 0) + 1
    # What was DECIDED before compile: the selection on v3, the sheet otherwise.
    selection = arm.json("overlays.json")
    if selection is not None:
        decided = len(selection.get("selections") or [])
    else:
        decided = sum(1 for b in (arm.json("beats.json") or {}).get("beats", []) if b.get("overlay"))
    compiled = anchor + emphasis
    enabled, per_minute = emphasis_policy(style)
    return {
        "compiled": compiled,
        "decided": decided,
        "dropped": max(0, decided - compiled),
        "anchor": anchor,
        "emphasis": emphasis,
        "per_minute": round(compiled * 60 / duration, 2) if duration else None,
        "anchor_budget": max_overlays_for(style, duration) if duration else None,
        "emphasis_budget": (math.ceil(per_minute * duration / 60) + 1) if duration and enabled else 0,
        "components": dict(sorted(components.items())),
    }


def sound_stats(arm: Arm) -> dict[str, Any]:
    beats = (arm.json("beats.json") or {}).get("beats") or []
    moods = [b.get("mood") for b in beats if b.get("kind", "narration") == "narration" and b.get("mood")]
    changes = sum(1 for x, y in zip(moods, moods[1:]) if x != y)
    duration = _duration(arm)
    plan = arm.json("edit_plan.json") or {}
    music = ((plan.get("tracks") or {}).get("audio") or {}).get("music") or []
    return {
        "moods": sorted(set(moods)),
        "mood_changes": changes,
        "mood_changes_per_min": round(changes * 60 / duration, 2) if duration else None,
        "music_spans": len(music),
    }


def visual_stats(arm: Arm, events: list[dict[str, Any]]) -> dict[str, Any]:
    beats = (arm.json("beats.json") or {}).get("beats") or []
    plan = arm.json("edit_plan.json") or {}
    visual = (plan.get("tracks") or {}).get("visual") or []
    assets = {
        (i["asset"].get("provider") or i["asset"].get("source"), i["asset"].get("id") or i["asset"].get("path"))
        for i in visual if i.get("asset")
    }
    fallback = 0
    for e in events:
        msg = e.get("message") or ""
        if "got a fallback visual_intent" in msg:
            fallback += int(msg.split(" ", 1)[0])
    return {
        "beats": len(beats),
        "distinct_intents": len({str(b.get("visual_intent") or "").strip().lower() for b in beats} - {""}),
        "visual_items": len(visual),
        "distinct_assets": len(assets),
        "fallback_intents": fallback,
        # D95: the share of junctions the render actually animates — what a
        # pack's animated_share delivered, after short shots fell back to cuts
        "animated_junctions": sum(
            1 for i in visual[:-1] if ((i.get("transition_out") or {}).get("type") or "cut") != "cut"
        ),
    }


def stage_seconds(arm: Arm) -> dict[str, float]:
    """The last successful time of each stage, over every run of the video."""
    log = arm.folder / "production.log"
    if not log.exists():
        return {}
    seconds: dict[str, float] = {}
    for run in parse_stage_log(log.read_text(encoding="utf-8").splitlines()):
        for name, s, failed in run.stages:
            if not failed:
                seconds[name] = s
    return seconds


# ---------------- the database half ----------------


def _db_rows(sql: str, video_id: str) -> list[dict[str, Any]] | None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(url, row_factory=dict_row, connect_timeout=3) as conn:
            return list(conn.execute(sql, (video_id,)).fetchall())
    except Exception:  # noqa: BLE001 — a report without the DB still reports
        return None


def model_stats(video_id: str) -> dict[str, Any] | None:
    rows = _db_rows(
        "SELECT provider, operation, units, usd, details FROM cost_events "
        "WHERE video_id = %s AND status = 'completed' ORDER BY ts",
        video_id,
    )
    if rows is None:
        return None
    ops: dict[str, dict[str, Any]] = {}
    for r in rows:
        op = str(r["operation"])
        if not op.startswith("llm.") or op.startswith(UPSTREAM_OPS):
            continue
        d = r["details"] or {}
        o = ops.setdefault(op, {"provider": r["provider"], "calls": 0, "repairs": 0, "in": 0, "out": 0, "usd": 0.0})
        o["calls"] += 1
        o["repairs"] += 1 if int(d.get("attempt") or 1) > 1 else 0
        o["in"] += int(d.get("input_tokens") or 0)
        o["out"] += int(d.get("output_tokens") or 0)
        o["usd"] += float(r["usd"] or 0)
    for o in ops.values():
        o["usd"] = round(o["usd"], 5)
    return ops


def events(video_id: str) -> list[dict[str, Any]] | None:
    return _db_rows(
        "SELECT stage, status::text AS status, message FROM video_events WHERE video_id = %s ORDER BY ts, id",
        video_id,
    )


def _rejections(evs: list[dict[str, Any]]) -> list[str]:
    return [f"{e['stage']}: {e['message']}" for e in evs if "rejected" in (e.get("message") or "")]


def _failures(evs: list[dict[str, Any]]) -> list[str]:
    return [f"{e['stage']}: {(e.get('message') or '')[:160]}" for e in evs if e.get("status") == "failed"]


# ---------------- directed only ----------------


def _first_visual(plan: dict[str, Any], beat_id: str) -> dict[str, Any] | None:
    for item in (plan.get("tracks") or {}).get("visual") or []:
        if item.get("beat_id") == beat_id:
            return item
    return None


def _asset_label(item: dict[str, Any] | None) -> str:
    if not item or not item.get("asset"):
        return "—"
    a = item["asset"]
    return f"{a.get('provider') or a.get('source')}:{a.get('query') or a.get('id') or ''}".strip(":")


def key_moments(control: Arm, directed: Arm) -> list[dict[str, Any]]:
    """Every shot pin, where it lands, and what each arm put on screen there.

    Timed from the directed arm's beat start: the audio is shared, so the same
    second in the control is the same words."""
    hints = directed.json("edit_hints.json")
    script = directed.text("script.txt").strip()
    if not hints or not script:
        return []
    moments = []
    arms = []
    for arm in (control, directed):
        beats = [b for b in (arm.json("beats.json") or {}).get("beats", []) if b.get("kind", "narration") == "narration"]
        try:
            ranges = _beat_ranges(beats, script)
        except ValueError:
            ranges = []
        arms.append((beats, ranges, arm.json("edit_plan.json") or {}))
    for span in pin_spans(hints, script):
        if not span["shot"]:
            continue
        row: dict[str, Any] = {"at": span["pin"]["at"], "intent": span["pin"].get("visual_intent")}
        for label, (beats, ranges, plan) in zip(("control", "directed"), arms):
            hit = next((i for i, (s, e) in enumerate(ranges) if s <= span["start"] <= e), None)
            if hit is None:
                row[label] = "—"
                continue
            item = _first_visual(plan, beats[hit]["id"])
            row[label] = _asset_label(item)
            if label == "directed" and item:
                row["t"] = round(float(item["start_s"]), 1)
        moments.append(row)
    return moments


def cut_difference(control: Arm, directed: Arm) -> dict[str, int] | None:
    a = (control.json("beat_cuts.json") or {}).get("cuts")
    b = (directed.json("beat_cuts.json") or {}).get("cuts")
    if not a or not b:
        return None
    control_texts = [c["script_text"] for c in a]
    differ = sum(1 for c in b if c["script_text"] not in control_texts)
    return {"directed_cuts": len(b), "control_cuts": len(a), "differ": differ}


def directed_stats(control: Arm, directed: Arm) -> dict[str, Any]:
    hints = directed.json("edit_hints.json") or {}
    pins = hints.get("pins") or []
    return {
        "sections": len(hints.get("sections") or []),
        "pins": len(pins),
        "graphics": sum(1 for p in pins if p.get("overlay")),
        "shots": sum(1 for p in pins if p.get("visual_intent")),
        "cuts": cut_difference(control, directed),
        "key_moments": key_moments(control, directed),
    }


# ---------------- the human half (decision 4) ----------------


def edit_pass_log() -> Path:
    return videos_root().parent / "edit-pass" / "log.jsonl"


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def human_stats(directed: Arm, log: Path | None = None) -> dict[str, Any] | None:
    record = directed.json("edit_pass.json")
    if not record:
        return None
    session = record.get("paste_session")
    path = log or edit_pass_log()
    lines = []
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            try:
                line = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if line.get("paste_session") == session:
                lines.append(line)
    checks = [l for l in lines if l.get("event") == "check"]
    submit = next((l for l in lines if l.get("event") == "submit" and l.get("video_id") == directed.video_id), None)
    minutes = None
    if checks and submit:
        minutes = round((_ts(submit["ts"]) - _ts(checks[0]["ts"])).total_seconds() / 60, 1)
    round_trips = len({c.get("block_sha256") for c in checks}) or int(record.get("attempts") or 1)
    return {
        "paste_session": session,
        "round_trips": round_trips,
        "repairs": max(0, round_trips - 1),
        "errors_per_paste": [len(c.get("errors") or []) for c in checks],
        "minutes": minutes,
    }


# ---------------- the row ----------------


def arm_row(arm: Arm) -> dict[str, Any]:
    evs = events(arm.video_id)
    return {
        "video_id": arm.video_id,
        "pipeline": arm.pipeline,
        "duration_s": round(_duration(arm), 1),
        "model": model_stats(arm.video_id),
        "rejections": None if evs is None else _rejections(evs),
        "failures": None if evs is None else _failures(evs),
        "overlays": overlay_stats(arm),
        "sound": sound_stats(arm),
        "visuals": visual_stats(arm, evs or []),
        "stage_seconds": stage_seconds(arm),
    }


def build(control: Arm, other: Arm) -> dict[str, Any]:
    row: dict[str, Any] = {
        "pair": pair_name(control, other),
        "kind": "directed" if other.directed else "noise",
        "integrity": integrity(control, other),
        "control": arm_row(control),
        "other": arm_row(other),
    }
    if other.directed:
        row["directed"] = directed_stats(control, other)
        row["human"] = human_stats(other)
    return row


# ---------------- the table ----------------


def _model_cells(model: dict[str, Any] | None) -> dict[str, str]:
    if model is None:
        return {}
    cells = {}
    for op, o in model.items():
        cells[f"{op} calls (repairs)"] = f"{o['calls']} ({o['repairs']})"
        cells[f"{op} tokens in/out"] = f"{o['in']:,} / {o['out']:,}"
        cells[f"{op} $"] = f"{o['usd']:.4f}"
    total = sum(o["usd"] for o in model.values())
    cells["downstream LLM $"] = f"{total:.4f}"
    return cells


def _arm_cells(r: dict[str, Any]) -> dict[str, str]:
    o, s, v, t = r["overlays"], r["sound"], r["visuals"], r["stage_seconds"]
    cells = {"pipeline": r["pipeline"], "duration": f"{r['duration_s']}s"}
    cells.update(_model_cells(r["model"]))
    if r["model"] is None:
        cells["model"] = "(no database)"
    cells["rejected attempts"] = "?" if r["rejections"] is None else str(len(r["rejections"]))
    cells["stage failures"] = "?" if r["failures"] is None else str(len(r["failures"]))
    if o.get("compiled") is not None:
        cells["overlays anchor / emphasis"] = f"{o['anchor']} / {o['emphasis']}"
        cells["budget anchor / emphasis"] = f"{o['anchor_budget']} / {o['emphasis_budget']}"
        cells["overlays per minute"] = str(o["per_minute"])
        cells["overlays dropped at compile"] = f"{o['dropped']} of {o['decided']}"
        cells["components"] = ", ".join(f"{k}×{n}" for k, n in o["components"].items()) or "—"
    else:
        cells["overlays"] = "(not compiled)"
    cells["mood changes (/min)"] = f"{s['mood_changes']} ({s['mood_changes_per_min']})"
    cells["music spans"] = str(s["music_spans"])
    cells["beats / distinct intents"] = f"{v['beats']} / {v['distinct_intents']}"
    cells["visual items / distinct assets"] = f"{v['visual_items']} / {v['distinct_assets']}"
    junctions = max(v["visual_items"] - 1, 0)
    cells["animated transitions"] = (
        f"{v['animated_junctions']} / {junctions} ({v['animated_junctions'] / junctions:.0%})"
        if junctions else "—"
    )
    cells["fallback intents"] = str(v["fallback_intents"])
    downstream = {k: x for k, x in t.items() if k not in ("script", "narration", "transcript")}
    for name, secs in downstream.items():
        cells[f"time {name}"] = f"{secs:.1f}s"
    if downstream:
        cells["time after transcript"] = f"{sum(downstream.values()):.1f}s"
    return cells


def format_table(row: dict[str, Any]) -> str:
    a, b = _arm_cells(row["control"]), _arm_cells(row["other"])
    keys = list(dict.fromkeys([*a, *b]))
    head_b = "directed" if row["kind"] == "directed" else "control (rerun)"
    width = max(len(k) for k in keys)
    ca = max(len(a.get(k, "")) for k in keys) if keys else 10
    ca = max(ca, len(row["control"]["video_id"]))
    lines = [
        f"A/B {row['pair']} ({row['kind']} pair)",
        f"{'':<{width}}  {'control':<{ca}}  {head_b}",
        f"{'':<{width}}  {row['control']['video_id']:<{ca}}  {row['other']['video_id']}",
    ]
    lines += [f"{k:<{width}}  {a.get(k, '—'):<{ca}}  {b.get(k, '—')}" for k in keys]
    if row["integrity"]:
        lines.append("\nNOT A CLEAN PAIR:")
        lines += [f"  - {p}" for p in row["integrity"]]
    else:
        lines.append("\npair is clean: same narration files, same snapshot but the pipeline")
    d = row.get("directed")
    if d:
        cuts = d["cuts"]
        lines.append(
            f"\ndirected: {d['sections']} sections, {d['pins']} pins "
            f"({d['graphics']} graphics, {d['shots']} key shots)"
            + (f"; {cuts['differ']} of {cuts['directed_cuts']} cuts differ from the control" if cuts else "")
        )
        for m in d["key_moments"]:
            lines.append(f"  key shot @ {m.get('t', '?')}s \"{m['at']}\": control {m['control']} | directed {m['directed']}")
    h = row.get("human")
    if d is not None:
        if h:
            lines.append(
                f"edit pass: {h['round_trips']} round-trip(s), errors per paste {h['errors_per_paste'] or '—'}, "
                f"{'?' if h['minutes'] is None else h['minutes']} min from first check to submit"
            )
        else:
            lines.append("edit pass: no edit_pass.json — the round-trips were not logged")
    for label in ("control", "other"):
        rej = row[label]["rejections"] or []
        if rej:
            lines.append(f"\n{row[label]['video_id']} rejected attempts:")
            lines += [f"  - {x[:200]}" for x in rej]
    if "scores" in row:
        lines.append("\n" + format_scores(row["scores"]))
    return "\n".join(lines)


# ---------------- blind review ----------------


def platform_url() -> str:
    return os.environ.get("PLATFORM_URL") or f"http://localhost:{os.environ.get('PLATFORM_PORT') or 3000}"


def blind(row: dict[str, Any], control: Arm, other: Arm, root: Path = EVALS, coin: random.Random | None = None) -> Path:
    """Write the score sheet for one pair and print only X and Y.

    The key is written once: a second --blind on the same pair re-prints the
    same links instead of flipping again, so a reviewer who lost the links does
    not get a different mapping."""
    folder = root / row["pair"]
    folder.mkdir(parents=True, exist_ok=True)
    key_path = folder / "key.json"
    if key_path.exists():
        key = json.loads(key_path.read_text(encoding="utf-8"))
    else:
        ids = [control.video_id, other.video_id]
        (coin or random.SystemRandom()).shuffle(ids)
        key = {"X": ids[0], "Y": ids[1], "control": control.video_id, "other": other.video_id, "kind": row["kind"]}
        key_path.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    scores_path = folder / "scores.json"
    if not scores_path.exists():
        template = {
            "X": {k: None for k in RUBRIC},
            "Y": {k: None for k in RUBRIC},
            "publish": None,
            "notes": "",
            "_help": "each rubric item 1-5; publish is \"X\" or \"Y\". See evals/directed/README.md",
        }
        scores_path.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
    moments = [m.get("t") for m in (row.get("directed") or {}).get("key_moments", []) if m.get("t") is not None]
    print(f"blind review {row['pair']}  (do not open {key_path.name})")
    print(f"  X: {platform_url()}/editor/{key['X']}")
    print(f"  Y: {platform_url()}/editor/{key['Y']}")
    if moments:
        print("  key moments to score in BOTH: " + ", ".join(f"{int(t // 60)}:{int(t % 60):02d}" for t in moments))
    print(f"  scores: {scores_path}")
    return folder


class ScoresIncomplete(ReportError):
    pass


def read_scores(folder: Path) -> dict[str, Any]:
    """The filled score sheet, unblinded: by arm instead of by letter."""
    key_path, scores_path = folder / "key.json", folder / "scores.json"
    if not key_path.exists() or not scores_path.exists():
        raise ScoresIncomplete(f"{folder.name}: run --blind first")
    key = json.loads(key_path.read_text(encoding="utf-8"))
    sheet = json.loads(scores_path.read_text(encoding="utf-8"))
    missing = [f"{x}.{k}" for x in ("X", "Y") for k in RUBRIC if not isinstance((sheet.get(x) or {}).get(k), int | float)]
    bad = [f"{x}.{k}" for x in ("X", "Y") for k in RUBRIC
           if isinstance((sheet.get(x) or {}).get(k), int | float) and not 1 <= sheet[x][k] <= 5]
    if missing or bad or sheet.get("publish") not in ("X", "Y"):
        raise ScoresIncomplete(
            f"{folder.name}: scores.json is not complete"
            + (f" (missing {', '.join(missing)})" if missing else "")
            + (f" (out of 1-5: {', '.join(bad)})" if bad else "")
            + ("" if sheet.get("publish") in ("X", "Y") else " (publish must be \"X\" or \"Y\")")
        )
    arm = {key["X"]: "X", key["Y"]: "Y"}
    control, other = arm[key["control"]], arm[key["other"]]
    return {
        "kind": key.get("kind", "directed"),
        "control": sheet[control],
        "other": sheet[other],
        "delta": {k: sheet[other][k] - sheet[control][k] for k in RUBRIC},
        "publish": "other" if sheet["publish"] == other else "control",
        "notes": sheet.get("notes") or "",
    }


def format_scores(s: dict[str, Any]) -> str:
    other = "directed" if s["kind"] == "directed" else "rerun"
    lines = [f"{'blind scores':<20} control  {other}  delta"]
    for k in RUBRIC:
        lines.append(f"{k:<20} {s['control'][k]:>7}  {s['other'][k]:>{len(other)}}  {s['delta'][k]:+g}")
    lines.append(f"would publish: {'the ' + other + ' arm' if s['publish'] == 'other' else 'the control'}")
    if s["notes"]:
        lines.append(f"notes: {s['notes']}")
    return "\n".join(lines)


# ---------------- the verdict over every pair ----------------


def verdict(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The adopt/stop rules of Part 2, over the scored directed pairs.

    `rows` carry: scores (read_scores), human (human_stats), and the failure
    counts of both arms (None when unknown)."""
    n = len(rows)
    wins = sum(1 for r in rows if r["scores"]["publish"] == "other")
    means = {k: round(statistics.mean(r["scores"]["delta"][k] for r in rows), 2) for k in RUBRIC} if rows else {}
    humans = [r["human"] for r in rows if r.get("human")]
    repairs = [h["repairs"] for h in humans]
    checks = {
        "preferred on >= 4 of 5": wins >= 4 if n >= 5 else None,
        "+0.5 on overlay relevance or b-roll": (means.get("overlay_relevance", 0) >= 0.5 or means.get("broll_key_moments", 0) >= 0.5) if rows else None,
        "no category <= -0.5": all(v > -0.5 for v in means.values()) if rows else None,
        "failures no higher than control": (
            None if any(r["failures"] is None for r in rows)
            else sum(r["failures"]["other"] for r in rows) <= sum(r["failures"]["control"] for r in rows)
        ) if rows else None,
        "median <= 1 repair": (statistics.median(repairs) <= 1) if repairs else None,
        "no video at >= 3 round-trips": all(h["round_trips"] < 3 for h in humans) if humans else None,
        "<= ~10 min per video": all((h["minutes"] or 0) <= 10 for h in humans) if humans else None,
    }
    if n >= 5 and wins <= 2:
        outcome = "STOP"
    elif n >= 5 and all(v is True for v in checks.values()):
        outcome = "ADOPT (then the 20-minute confirmation pair)"
    elif n < 5:
        outcome = f"NOT YET ({n} of 5 scored pairs)"
    else:
        outcome = "NO ADOPT (a rule failed; see the checks)"
    return {"pairs": n, "directed_preferred": wins, "mean_delta": means, "checks": checks, "outcome": outcome}


def summary(root: Path = EVALS, videos: Path | None = None) -> str:
    rows, skipped, noise = [], [], []
    for folder in sorted(p for p in root.glob("*") if (p / "key.json").exists()):
        try:
            scores = read_scores(folder)
        except ScoresIncomplete as e:
            skipped.append(str(e))
            continue
        key = json.loads((folder / "key.json").read_text(encoding="utf-8"))
        if scores["kind"] != "directed":
            noise.append((folder.name, scores))
            continue
        failures = {}
        for label in ("control", "other"):
            evs = events(key[label])
            failures[label] = None if evs is None else len(_failures(evs))
        try:
            other = load_arm(key["other"], videos)
            human = human_stats(other)
        except ReportError:
            human = None
        rows.append({
            "pair": folder.name,
            "scores": scores,
            "human": human,
            "failures": None if None in failures.values() else failures,
        })
    v = verdict(rows)
    lines = [f"directed-edit A/B: {v['pairs']} scored pair(s), directed preferred on {v['directed_preferred']}"]
    for k, m in v["mean_delta"].items():
        lines.append(f"  mean delta {k:<20} {m:+g}")
    for rule, ok in v["checks"].items():
        lines.append(f"  [{'ok' if ok else '--' if ok is None else 'NO'}] {rule}")
    for name, s in noise:
        spread = ", ".join(f"{k} {s['delta'][k]:+g}" for k in RUBRIC)
        lines.append(f"  noise pair {name}: {spread}")
    lines.append(f"verdict: {v['outcome']}")
    lines += [f"  (skipped: {s})" for s in skipped]
    return "\n".join(lines)


# ---------------- command line ----------------


def main(argv: list[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    ids = [a for a in argv if not a.startswith("--")]
    unknown = flags - {"--json", "--blind", "--unblind", "--summary"}
    if unknown:
        print(f"unknown option {sorted(unknown)[0]}", file=sys.stderr)
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    try:
        if "--summary" in flags:
            print(summary())
            return 0
        if not ids:
            print(__doc__.strip().split("\n\n")[1], file=sys.stderr)
            return 2
        control, other = pair(ids)
        row = build(control, other)
        if "--blind" in flags:
            blind(row, control, other)
            return 0
        if "--unblind" in flags:
            row["scores"] = read_scores(EVALS / row["pair"])
        if "--json" in flags:
            print(json.dumps(row, ensure_ascii=False, sort_keys=True))
        else:
            print(format_table(row))
        return 0
    except ReportError as e:
        print(f"ab_report: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
