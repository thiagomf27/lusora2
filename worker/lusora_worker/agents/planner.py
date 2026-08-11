"""Beat planner agent (bounded agent #2) — the creative core.

Inputs: script + style pack (pacing numbers, arc, density) + component
catalog (when_to_use rules) + channel content rules. Output: a beat
sheet. Wrapped in the validate→repair loop: max 3 attempts, ALL
violations fed back (Core Principle 5).

The creative half of the prompt is data (D42/D44): it arrives in the cfg
snapshot as `cfg.prompts.planner`. The HARD RULES, the JSON shape and the
component menu are welded (D43) — they encode what
`validate_beat_sheet` is about to enforce, so they are composed from the
CURRENT contracts at call time rather than from the snapshot.

Long scripts are planned in CHUNKS (one call per ~CHUNK_TARGET_BEATS
beats): each call sees the full script for context but is told to emit
beats for one contiguous, sentence-aligned slice only, carrying the last
beats of the previous chunk forward for visual/mood continuity. Short
videos stay a single call — the prompt for that path is unchanged.
"""

from __future__ import annotations

import json
import math
from typing import Any

import lusora_contracts
from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from .. import validators
from ..providers import llm
from ..textsplit import split_sentences
from ..validators import validate_beat_sheet

STAGE = "plan_beats"
# the prompt-pack role, which is NOT the stage name (contracts/prompts/planner/)
ROLE = "planner"
MAX_ATTEMPTS = 3

# A single call comfortably handles ~20-30 beats (existing calls cost
# 4-9k tokens in that range per the max_tokens comment below); above this,
# split into sentence-aligned chunks rather than risk truncation or
# degraded quality on one huge call.
CHUNK_TARGET_BEATS = 30

CARRY_FORWARD_BEATS = 2


def _catalog_menu(allowed: list[str] | None) -> str:
    lines = []
    for entry in lusora_contracts.load_catalog()["components"]:
        if allowed and entry["name"] not in allowed:
            continue
        props = {
            name: {k: v for k, v in spec.items() if k in ("type", "enum", "maxWords", "min", "max", "required")}
            for name, spec in entry["props"].items()
            if not spec.get("from_anchor") and not spec.get("computed")
        }
        lines.append(
            f"- {entry['name']} (anchor types: {entry['anchor_types'] or 'none — pure text allowed'})\n"
            f"  when to use: {entry['when_to_use']}\n"
            f"  when NOT to use: {entry['when_not_to_use']}\n"
            f"  props you may hint: {json.dumps(props)}"
        )
    return "\n".join(lines)


def _chunk_script(script: str, chunk_count: int) -> list[str]:
    """Split into `chunk_count` contiguous, sentence-aligned, word-balanced
    slices, so each slice is trivially a verbatim span of the script (what
    `validate_beat_sheet`'s coverage check requires). Returns [script]
    unchanged when chunking isn't needed."""
    sentences = split_sentences(script)
    if chunk_count <= 1 or len(sentences) <= chunk_count:
        return [script]
    total_words = sum(len(s.split()) for s in sentences)
    target_words = total_words / chunk_count
    chunks: list[str] = []
    current: list[str] = []
    current_words = 0
    for sentence in sentences:
        current.append(sentence)
        current_words += len(sentence.split())
        if current_words >= target_words and len(chunks) < chunk_count - 1:
            chunks.append(" ".join(current))
            current, current_words = [], 0
    if current:
        chunks.append(" ".join(current))
    return chunks


def _format_carry_forward(beats: list[dict[str, Any]]) -> str:
    if not beats:
        return ""
    lines = [
        f"- {b.get('id')} (mood: {b.get('mood', 'neutral')}): {b.get('visual_intent', '')}"
        for b in beats[-CARRY_FORWARD_BEATS:]
    ]
    return "\n".join(lines)


def _build_prompt(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    *,
    full_script: str = "",
    carry_forward: str = "",
    chunk_position: str = "",
    coverage_scope: str = "the ENTIRE script",
    max_overlays: int | str = "",
) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    pacing = style.get("pacing") or {}
    overlays = style.get("overlays") or {}
    allowed = overlays.get("allowed_components")
    avg_hold = float(pacing.get("avg_hold_seconds", 4.0))
    density = overlays.get("density", "normal")

    return prompt_packs.compose(
        ROLE,
        (ctx.cfg.get("prompts") or {}).get(ROLE),
        {
            "script": script,
            "audio_duration_s": f"{audio_duration_s:.0f}",
            "target_beats": max(1, round(audio_duration_s / avg_hold)),
            "avg_hold": avg_hold,
            "min_hold": pacing.get("min_hold", 2.5),
            "max_hold": pacing.get("max_hold", 8),
            "arc": pacing.get("arc") or "",
            "density": density if isinstance(density, str) else json.dumps(density),
            "visual_language": str(style.get("visual_language") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
            "component_menu": _catalog_menu(allowed),
            "video_id": ctx.video_id,
            "full_script": full_script,
            "carry_forward": carry_forward,
            "chunk_position": chunk_position,
            "coverage_scope": coverage_scope,
            "max_overlays": max_overlays,
        },
    )


def _plan_chunk(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    chat_fn: llm.ChatFn,
    *,
    full_script: str,
    carry_forward: str,
    chunk_position: str,
    coverage_scope: str,
    section_label: str,
    max_overlays: int | str = "",
    validate_duration_s: float | None = None,
) -> dict[str, Any]:
    """One call, with the same validate→repair loop as before (max 3
    attempts, ALL violations fed back). `section_label` is "" for the
    single-call (unchunked) path, which keeps every message below
    byte-identical to the pre-chunking version; non-empty only when this is
    one of several chunks.

    `validate_duration_s` is None for a chunk: beat-count-range and overlay
    density are properties of the WHOLE video, and `validate_beat_sheet`
    grants each of them a slack term. Judging a chunk against its own share
    hands out that slack once per chunk, so the chunks can each pass while
    their sum overshoots the real budget (observed: 14 overlays against a
    13-overlay video budget). Those two checks are therefore deferred to the
    single merged-sheet pass in `plan_beats`; everything else — schema,
    verbatim coverage of this slice, anchors, overlay validity — still runs
    here, where the repair loop can fix it cheaply."""
    planner_cfg = ctx.cfg.get("planner") or {}
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    provider = str(planner_cfg.get("llm") or "deepseek")
    model = planner_cfg.get("model") or (prompt or {}).get("model_hint")
    # 32k, not 16k: reasoning is billed out of max_tokens and its length is not
    # bounded by the prompt — a run that had been costing 4-9k spent 15.8k
    # thinking and truncated mid-JSON with 16k. The unused budget is free
    # (billing is on actual tokens), so buy headroom rather than track the
    # spread. Verified: the API accepts max_tokens=64000 for deepseek-v4-*.
    max_tokens = int((prompt or {}).get("max_tokens") or 64000)
    system, base_user = _build_prompt(
        ctx, script, audio_duration_s,
        full_script=full_script, carry_forward=carry_forward,
        chunk_position=chunk_position, coverage_scope=coverage_scope,
        max_overlays=max_overlays,
    )
    user = base_user
    label_prefix = f"{section_label}: " if section_label else ""

    attempts: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.plan_beats",
            estimated_units=12000,
            details={
                "attempt": attempt,
                "prompt": (prompt or {}).get("name", "default"),
                **({"section": section_label} if section_label else {}),
            },
        ) as cost:
            # reasoning models spend 4-16k tokens thinking before the JSON starts
            result = chat_fn(provider, model, system, user, max_tokens)
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "attempt": attempt})
        try:
            doc = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as e:
            violations = [f"output was not a parseable JSON object: {e}"]
        else:
            doc["video_id"] = ctx.video_id
            doc.setdefault("version", "1.0")
            violations = validate_beat_sheet(doc, script, ctx.cfg, validate_duration_s)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(ctx.video_id, STAGE, "progress",
                             f"{label_prefix}beat sheet accepted on attempt {attempt} ({len(doc['beats'])} beats)")
                return doc

        attempts.append(f"attempt {attempt}: {len(violations)} violation(s)")
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"{label_prefix}attempt {attempt} rejected: {'; '.join(violations[:5])}")
        # Feed ALL violations of THIS attempt back (Principle 5), rebuilt from
        # the base prompt: appending to the previous user message would carry
        # attempt 1's already-fixed complaints into attempt 3 and grow the
        # token bill on every round.
        user = (
            base_user
            + "\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Fix ALL of these violations and output the corrected JSON:\n- "
            + "\n- ".join(violations)
        )

    section_suffix = f" on {section_label}" if section_label else ""
    raise StageError(
        STAGE,
        f"beat planner failed{section_suffix} after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)}) — "
        "upload beats.json manually or switch planner.llm to 'mock'",
    )


def plan_beats(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    style = ctx.cfg.get("style_pack_doc") or {}
    avg_hold = float((style.get("pacing") or {}).get("avg_hold_seconds", 4.0))
    total_target_beats = max(1, round(audio_duration_s / avg_hold))
    chunk_count = max(1, math.ceil(total_target_beats / CHUNK_TARGET_BEATS))
    chunks = _chunk_script(script, chunk_count)
    chunked = len(chunks) > 1

    total_words = len(script.split()) or 1
    merged_beats: list[dict[str, Any]] = []
    next_id = 1
    for i, chunk in enumerate(chunks):
        if chunked:
            chunk_duration = audio_duration_s * (len(chunk.split()) / total_words)
        else:
            chunk_duration = audio_duration_s
        # A slack-free share of the whole-video density budget: floor, and no
        # +1 (see _plan_chunk). Summed over chunks this stays under the
        # ceiling the merged sheet is judged against, so honouring the hint
        # means the final check passes.
        chunk_overlays: int | str = ""
        if chunked:
            per_minute = validators.overlays_per_minute(ctx.cfg.get("style_pack_doc") or {})
            chunk_overlays = max(1, math.floor(per_minute * chunk_duration / 60))
        doc = _plan_chunk(
            ctx, chunk, chunk_duration, chat_fn,
            full_script=script if chunked else "",
            carry_forward=_format_carry_forward(merged_beats) if chunked else "",
            chunk_position=f"part {i + 1} of {len(chunks)}" if chunked else "",
            coverage_scope=(
                "YOUR SECTION only (marked SCRIPT below) — not the full script, shown only for context"
                if chunked else "the ENTIRE script"
            ),
            section_label=f"section {i + 1}/{len(chunks)}" if chunked else "",
            max_overlays=chunk_overlays,
            # unchunked: the one call IS the whole video, so judge it fully here
            validate_duration_s=None if chunked else audio_duration_s,
        )
        for beat in doc["beats"]:
            beat["id"] = f"b{next_id}"
            next_id += 1
            merged_beats.append(beat)

    merged = {"version": "1.0", "video_id": ctx.video_id, "beats": merged_beats}
    if chunked:
        # Belt-and-suspenders: each chunk already validated its own slice;
        # this catches boundary bugs across the merge (it should always pass
        # mechanically, since chunks partition the script by sentence).
        violations = validate_beat_sheet(merged, script, ctx.cfg, audio_duration_s)
        if violations:
            raise StageError(
                STAGE,
                "merged beat sheet failed final validation: " + "; ".join(violations[:8]),
            )
    return merged
