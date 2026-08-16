"""Review mode (D62): where the worker stops and waits for a human.

The manifest already declared this shape — `default_checkpoint_policy` and the
per-stage `human_approval_on_review_mode` flags shipped with D60 and did
nothing. This module is what executes them, and it answers OQ-28: the
ORCHESTRATOR enforces the gate, because it is the only thing that knows both
the manifest and the folder.

Two ideas, and both of them are deliberately files rather than rows:

*   **The policy** is `auto` (run straight through, what every video did before
    this existed) or `guided` (stop at every gated stage). It is read from the
    cfg snapshot first, so a single video can be sent through review without
    changing the channel, and falls back to the manifest's default. A policy on
    a pipeline, never a separate pipeline — the same manifest runs both ways.

*   **An approval** is `approvals/<stage>.json` in the video folder. The folder
    is the data plane of record (D3), and the orchestrator's whole resume model
    is "skip what exists"; making an approval a file means gates resume by the
    same rule as artifacts, with no worker state and no second source of truth.
    It also keeps manual-first honest: a video driven by hand can be un-gated
    with `mkdir -p approvals && echo '{}' > approvals/script.json`.

The worker never WRITES an approval. It only asks whether one is there.
Granting is a human act and belongs to the platform.
"""

from __future__ import annotations

from typing import Any

APPROVALS_DIR = "approvals"

AUTO = "auto"
GUIDED = "guided"


def policy(cfg: dict[str, Any], manifest: dict[str, Any]) -> str:
    """Which mode this video runs in.

    cfg.checkpoint_policy -> manifest.default_checkpoint_policy -> auto. The
    per-video layer wins because review is a decision about ONE video far more
    often than about a channel: the first video on a new channel is reviewed,
    the next fifty are not.

    An unrecognised value degrades to `auto` rather than failing the video: the
    schema already rejects it at enqueue, and a snapshot that somehow carries a
    typo should still produce a video rather than stop the queue.
    """
    chosen = cfg.get("checkpoint_policy") or manifest.get("default_checkpoint_policy") or AUTO
    return GUIDED if str(chosen) == GUIDED else AUTO


def gated_stages(manifest: dict[str, Any]) -> list[str]:
    """The stage names that would pause under `guided`, in manifest order."""
    return [
        str(stage["name"])
        for stage in manifest.get("stages") or []
        if stage.get("human_approval_on_review_mode")
    ]


def approval_name(stage: str) -> str:
    """The artifact whose presence means 'a human said yes to this stage'."""
    return f"{APPROVALS_DIR}/{stage}.json"


def approved(ctx: Any, stage: str) -> bool:
    """Has a human said yes to this stage? Presence of the file IS the answer.

    Deliberately not "is the file well-formed": an approval that failed to
    parse would otherwise re-gate a video whose human already answered, and
    the worst case of a truncated file is a note that reads oddly in the log.
    """
    return ctx.has(approval_name(stage))


def approval_note(ctx: Any, stage: str) -> str:
    """One line naming who approved and when, for the event log.

    Never raises: this is decoration on a gate that has already been passed,
    so a hand-written `{}` or a corrupt file degrades to a plain statement
    rather than failing a video at the moment it was cleared to continue.
    """
    try:
        doc = ctx.read_json(approval_name(stage))
    except Exception:
        return "approval file present"
    if not isinstance(doc, dict):
        return "approval file present"
    who = str(doc.get("approved_by") or "").strip()
    when = str(doc.get("approved_at") or "").strip()
    if who and when:
        return f"approved by {who} at {when}"
    if who:
        return f"approved by {who}"
    return "approval file present"
