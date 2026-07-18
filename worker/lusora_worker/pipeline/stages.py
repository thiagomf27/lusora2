"""The stage registry. Each stage: name, done-check, run.

M2 ships STUB creative stages (they touch valid placeholder artifacts);
M3+ replaces the bodies. The orchestrator only ever asks two questions:
"is this stage's output present?" and "run it".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..context import StageContext
from ..errors import StageError
from . import steps


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


STAGES: list[Stage] = [
    Stage("script", steps.run_script, artifact="script.txt"),
    Stage("narration", steps.run_narration, artifact="audio.mp3"),
    Stage("transcript", steps.run_transcript, artifact="subtitles.srt"),
    Stage("plan_beats", steps.run_plan_beats, artifact="beats.json"),
    Stage("compile_plan", steps.run_compile_plan, artifact="edit_plan.json"),
    Stage("resolve_assets", steps.run_resolve_assets, is_done=steps.assets_resolved),
    Stage("validate", steps.run_validate),  # always runs
    Stage("render", steps.run_render, artifact="final.mp4"),
    Stage("finalize", steps.run_finalize, artifact="metadata.txt"),
]


def ensure_claim_materialized(ctx: StageContext) -> None:
    """Stage 1: the folder and cfg.json must exist (written at enqueue)."""
    ctx.folder.mkdir(parents=True, exist_ok=True)
    if not ctx.has("cfg.json"):
        if ctx.cfg:
            ctx.write_json("cfg.json", ctx.cfg)
        else:
            raise StageError(
                "claim",
                f"cfg.json missing from {ctx.folder} and no cfg snapshot in DB — re-enqueue the video",
            )
