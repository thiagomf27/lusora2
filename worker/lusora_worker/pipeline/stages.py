"""The step registry: what each stage NAME actually does.

D60 split this file in two halves that used to be one list. The manifest
(`contracts/pipelines/<name>.yaml`) owns POLICY — which stages run, in what
order, what each produces. This file owns MECHANISM — the callable behind a
name and how that step decides it is already done (artifact presence vs. a
freshness check that also compares mtimes). Neither half can be derived from
the other, which is why the manifest never encodes a done-check and this
registry never encodes an order.

`build_stages` binds the two: a manifest stage with no entry here is a
load-time error, not a mid-video surprise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..context import StageContext
from ..errors import StageError
from . import steps


@dataclass(frozen=True)
class Step:
    """One executable stage body plus its done-check (mechanism only)."""

    run: Callable[[StageContext], None]
    is_done: Callable[[StageContext], bool] | None = None


@dataclass(frozen=True)
class Stage:
    name: str
    run: Callable[[StageContext], None]
    # default done-check: this artifact exists in the folder (None = always runs)
    artifact: str | None = None
    is_done: Callable[[StageContext], bool] | None = field(default=None)

    def done(self, ctx: StageContext) -> bool:
        if self.is_done is not None:
            return self.is_done(ctx)
        if self.artifact is None:
            return False
        return ctx.has(self.artifact)


# name -> (body, done-check). A stage whose done-check is None falls back to
# "the artifact the manifest says it produces is present"; a stage that
# produces nothing (validate, qa) therefore always runs.
STEP_REGISTRY: dict[str, Step] = {
    # D64: phase 0 of the script agent — what the video is ABOUT, before
    # anything writes a sentence the audience will hear.
    "research": Step(steps.run_research),
    "script": Step(steps.run_script),
    "narration": Step(steps.run_narration),
    "transcript": Step(steps.run_transcript),
    "plan_beats": Step(steps.run_plan_beats),
    "compile_plan": Step(steps.run_compile_plan, steps.plan_compiled_and_fresh),
    "resolve_assets": Step(steps.run_resolve_assets, steps.assets_resolved),
    # D48: binds the compiler's cue and bed NAMES to bytes from the sound pack.
    # After resolve_assets so a plan with no audio costs nothing, before
    # validate so the file-existence checks see real files.
    "resolve_audio": Step(steps.run_resolve_audio, steps.audio_resolved),
    "validate": Step(steps.run_validate),  # judges the plan — always runs
    "render": Step(steps.run_render, steps.render_fresh),
    # D57: between render and finalize, so a black or silent file never reaches
    # RENDERED — the orchestrator sets that status only after every stage
    # passes, and a StageError here stops the video with one reason. Always
    # runs: it judges the FILE, and the file is what changed.
    "qa": Step(steps.run_qa),
    "finalize": Step(steps.run_finalize, steps.finalize_fresh),
}


# Substages are the named PHASES inside a stage body (the beats process: split
# the script, align it to the transcript, join pieces into beats). They are
# declarative only — the stage body calls them in its own order, and the
# orchestrator never walks them, because a phase is not resumable on its own:
# they share one in-memory pass and produce no artifact between them.
#
# They are registered for exactly one reason: a manifest that declares a phase
# this build cannot run must fail at LOAD, the same rule stage names follow.
# A substage list that could name anything would be a comment.
SUBSTAGE_REGISTRY: dict[str, set[str]] = {
    "plan_beats": {"spine_pass", "script_split", "srt_alignment", "beat_parts", "chunking", "beat_writing"},
}


class UnknownStageError(ValueError):
    """A manifest names a stage this worker cannot run."""


def build_stages(manifest: dict[str, Any]) -> list[Stage]:
    """Bind a manifest's stage list to this worker's step registry.

    Raised early and once per video, before any work is done: a pipeline that
    names a stage this build has no body for must fail at load, when the reason
    is still 'the manifest and the worker disagree', rather than nine stages in.
    """
    stages: list[Stage] = []
    for entry in manifest["stages"]:
        name = entry["name"]
        step = STEP_REGISTRY.get(name)
        if step is None:
            known = ", ".join(sorted(STEP_REGISTRY))
            raise UnknownStageError(
                f"pipeline {manifest['name']!r} names stage {name!r}, which this worker "
                f"has no step for (known: {known})"
            )
        for sub in entry.get("substages") or []:
            known_subs = SUBSTAGE_REGISTRY.get(name, set())
            if sub["name"] not in known_subs:
                raise UnknownStageError(
                    f"pipeline {manifest['name']!r} declares substage {sub['name']!r} of "
                    f"stage {name!r}, which this worker has no phase for "
                    f"(known: {', '.join(sorted(known_subs)) or 'none'})"
                )
        produces = entry.get("produces") or []
        stages.append(
            Stage(
                name=name,
                run=step.run,
                # the first produced artifact is what the orchestrator asserts
                # after the body returns; the rest are the stage's own business
                artifact=produces[0] if produces else None,
                is_done=step.is_done,
            )
        )
    return stages


def ensure_claim_materialized(ctx: StageContext) -> None:
    """Bootstrap: the folder and cfg.json must exist (written at enqueue).

    Not a stage — it is the precondition for the loop, not a step it can skip,
    which is why no manifest lists it.
    """
    ctx.folder.mkdir(parents=True, exist_ok=True)
    if not ctx.has("cfg.json"):
        if ctx.cfg:
            ctx.write_json("cfg.json", ctx.cfg)
        else:
            raise StageError(
                "claim",
                f"cfg.json missing from {ctx.folder} and no cfg snapshot in DB — re-enqueue the video",
            )
