"""Run one eval case through the real stages and score it.

    python -m lusora_worker.evals.run_case <case_dir> <out.json> [--arm v3|base]
                                           [--reuse-beats] [--provider deepseek]

`--reuse-beats` is the difference between a $1.13 arm and a $0.15 one: the
overlay prompt cannot change the beats, so tuning it should not pay to
regenerate them. It also holds the planner constant across the comparison,
which makes the measurement cleaner as well as cheaper.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from lusora_contracts.pipelines import load_pipeline

from ..agents import beatcraft
from ..agents import overlay as overlay_agent
from ..agents import planner as planner_agent
from ..context import StageContext
from ..pipeline import steps
from ..providers import llm
from ..validators import selections_by_beat
from .harness import BeatsCache, EvalDb, call_cost


def _load_env(repo: Path) -> None:
    env = repo / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def _narration_seconds(srt: Path) -> float:
    ends = [ln.split("-->")[1].strip() for ln in srt.read_text(encoding="utf-8").splitlines()
            if "-->" in ln]
    hours, minutes, seconds = ends[-1].split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds.replace(",", "."))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m lusora_worker.evals.run_case")
    parser.add_argument("case_dir", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--arm", choices=("base", "v3"), default="v3")
    parser.add_argument("--run", type=int, default=1)
    parser.add_argument("--provider", default="deepseek")
    parser.add_argument("--reuse-beats", action="store_true",
                        help="skip the planner when cached beats exist for this case+arm+run")
    parser.add_argument("--cache", type=Path, default=None)
    parser.add_argument("--temperature", type=float, default=None,
                        help="override every prompt pack's temperature, to measure what it does")
    args = parser.parse_args(argv)

    repo = Path(__file__).resolve().parents[3]
    _load_env(repo)

    case = args.case_dir
    cfg = json.loads((case / "cfg.json").read_text(encoding="utf-8"))
    script = (case / "script.txt").read_text(encoding="utf-8").strip()
    duration = _narration_seconds(case / "subtitles.srt")

    run_cfg: dict[str, Any] = {
        "language": cfg.get("language"),
        "content_rules": cfg.get("content_rules") or "",
        "style_pack_doc": cfg["style_pack_doc"],
        "budget": {"max_usd_per_video": 2.0},
        "planner": {"llm": args.provider},
    }
    if args.arm == "v3":
        run_cfg["pipeline_doc"] = load_pipeline("faceless_v3")

    db = EvalDb(case.name, args.arm)
    calls: list[tuple[str, int, int]] = []

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        if args.temperature is not None:
            temperature = args.temperature
        result = llm.chat(provider, model, system, user, max_tokens, temperature)
        calls.append((model or "", result.input_tokens, result.output_tokens))
        print(f"  call {len(calls)}: in {result.input_tokens:>6} out {result.output_tokens:>6}",
              flush=True)
        return result

    args.out.parent.mkdir(parents=True, exist_ok=True)
    folder = args.out.parent / f"{case.name}.work"
    folder.mkdir(exist_ok=True)
    (folder / "script.txt").write_text(script, encoding="utf-8")
    (folder / "subtitles.srt").write_text(
        (case / "subtitles.srt").read_text(encoding="utf-8"), encoding="utf-8")

    ctx = StageContext(
        video={"id": case.name, "channel_id": "EVAL", "title": case.name},
        folder=folder, cfg=run_cfg, db=db, config=None,
    )
    print(f"{case.name}: {duration:.0f}s, arm={args.arm}, run={args.run}", flush=True)

    cache = BeatsCache(args.cache or args.out.parent, args.arm)
    beats = cache.get(case.name, args.run) if args.reuse_beats else None
    if beats is not None:
        print(f"  beats reused from cache ({len(beats['beats'])} beats, no planner call)",
              flush=True)
    elif args.arm == "v3":
        parts = steps.cut_script(ctx, script, duration)
        cuts = [{"index": i, "script_text": p.text, "start_s": round(p.start_s, 3),
                 "end_s": round(p.end_s, 3)} for i, p in enumerate(parts)]
        print(f"  cut into {len(cuts)} spans (no model call)", flush=True)
        beats = beatcraft.craft_beats(ctx, cuts, script, duration,
                                      menu=steps._planner_menu_for(ctx), chat_fn=chat_fn)
        cache.put(case.name, args.run, beats)
    else:
        beats = planner_agent.plan_beats(ctx, script, duration, chat_fn=chat_fn)
        cache.put(case.name, args.run, beats)

    planner_calls = len(calls)

    if args.arm == "v3":
        selection = overlay_agent.select_overlays(ctx, beats, duration, chat_fn=chat_fn)
        chosen = selections_by_beat(selection)
        beats = {**beats, "beats": [
            {**b, "overlay": chosen[str(b["id"])]} if str(b["id"]) in chosen
            else {k: v for k, v in b.items() if k != "overlay"}
            for b in beats["beats"]
        ]}
        (args.out.parent / f"{case.name}.{args.run}.overlays.json").write_text(
            json.dumps(selection, indent=2, ensure_ascii=False), encoding="utf-8")

    args.out.write_text(json.dumps(beats, indent=2, ensure_ascii=False), encoding="utf-8")

    spent = sum(call_cost(args.provider, "llm.plan_beats", model, i, o) for model, i, o in calls)
    overlays = sum(1 for b in beats["beats"] if b.get("overlay"))
    print(
        f"  -> {len(beats['beats'])} beats, {overlays} overlays | "
        f"{planner_calls} planner + {len(calls) - planner_calls} overlay call(s) | "
        f"{sum(i for _, i, _ in calls):,} in / {sum(o for _, _, o in calls):,} out | "
        f"${spent:.3f}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the CLI
    raise SystemExit(main())
