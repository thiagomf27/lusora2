"""Overlay selection — the graphic question, asked where it is the only question.

D87. On `faceless_v3` the planner writes beats and nothing else; this stage then
walks the beats that could legally carry a graphic and decides which ones do.

Two things follow from separating it, and both are the point:

**The menu is shortlisted per candidate.** A beat whose anchor is a `date` is
shown the components that attach to a date, not all twenty-nine. The planner
used to carry the whole catalog through every chunk call — about 2,900 tokens,
six times — and read it once, for a whole video. Here it is roughly 400 tokens
and it is read at the moment of choosing.

**That is also the fix for what the menu was hiding.** The baseline measured the
planner using 11 of 29 components, with three of every four overlays a counter
or a tag and the entire exhibit family never once chosen — on channels whose
references are built from exhibits. A `DocumentCard` is invisible in a
twenty-nine entry list skimmed once; it is unavoidable in a six-entry list
beside the beat it belongs to.
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
from ..providers import llm
from ..validators import (
    emphasis_policy,
    max_overlays_for,
    validate_overlay_selection,
)

STAGE = "select_overlays"
ROLE = "overlay"
MAX_ATTEMPTS = 3

# How many words of the beat's own narration to show. The selector is choosing a
# graphic for a span, not rewriting it, so the whole script would be paid for
# once per candidate and read once in total.
SPAN_WORDS = 40


def _candidate_menu(
    anchor_types: list[str],
    allowed: list[str] | None,
    emphasis_enabled: bool,
) -> list[dict[str, Any]]:
    """The components this ONE beat may legally carry.

    Everything whose `anchor_types` intersect the beat's own anchors, plus —
    when the pack enables the emphasis class — everything that carries no
    anchor at all, which is the pure-text cards and the whole exhibit family.
    A beat with no anchors and no emphasis class has no menu and is not a
    candidate at all.
    """
    out = []
    for entry in sorted(lusora_contracts.load_catalog()["components"], key=lambda e: e["name"]):
        if allowed and entry["name"] not in allowed:
            continue
        takes = entry["anchor_types"]
        if takes:
            if not set(takes) & set(anchor_types):
                continue
        elif not emphasis_enabled:
            continue
        out.append(entry)
    return out


def _render_candidate(beat: dict[str, Any], menu: list[dict[str, Any]]) -> str:
    """One candidate block: what the beat says, what it can show, what it may use."""
    span = " ".join(str(beat.get("script_text") or beat.get("visual_intent") or "").split()[:SPAN_WORDS])
    lines = [f'BEAT {beat.get("id")}: "{span}"']

    anchors = beat.get("anchors") or []
    if anchors:
        lines.append("  anchors it can show:")
        for i, anchor in enumerate(anchors):
            label = f" ({anchor['label']})" if anchor.get("label") else ""
            value = anchor.get("value")
            shown = json.dumps(value, ensure_ascii=False) if value is not None else "—"
            lines.append(
                f"    [{i}] {anchor.get('type')}: {shown}{label}  from \"{anchor.get('source_words', '')}\""
            )
    else:
        lines.append("  anchors it can show: none — only an emphasis graphic is possible here")

    lines.append("  components you may use on this beat:")
    for entry in menu:
        takes = "/".join(entry["anchor_types"]) or "carries no fact — emphasis only"
        hold = (entry.get("duration_hint_s") or {}).get("default")
        held = f", holds ~{hold:g}s" if hold else ""
        lines.append(f"    - {entry['name']} ({takes}{held}): {entry['when_to_use']}")
    return "\n".join(lines)


def build_candidates(beats: list[dict[str, Any]], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Every beat that could legally carry a graphic, with its own menu.

    A beat with neither an anchor nor a reachable emphasis component is not
    offered at all — there is nothing it could be given, so asking about it
    would spend tokens to be told no.
    """
    style = cfg.get("style_pack_doc") or {}
    allowed = (style.get("overlays") or {}).get("allowed_components")
    emphasis_enabled, _ = emphasis_policy(style)

    candidates = []
    for beat in beats:
        anchor_types = [str(a.get("type")) for a in (beat.get("anchors") or [])]
        menu = _candidate_menu(anchor_types, allowed, emphasis_enabled)
        if menu:
            candidates.append({"beat": beat, "menu": menu})
    return candidates


def _build_prompt(
    ctx: StageContext,
    candidates: list[dict[str, Any]],
    audio_duration_s: float,
) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    overlays = style.get("overlays") or {}
    density = overlays.get("density", "normal")
    emphasis_enabled, emphasis_per_minute = emphasis_policy(style)
    max_emphasis: int | str = ""
    if emphasis_enabled:
        max_emphasis = math.ceil(emphasis_per_minute * audio_duration_s / 60) + 1

    return prompt_packs.compose(
        ROLE,
        (ctx.cfg.get("prompts") or {}).get(ROLE),
        {
            "video_id": ctx.video_id,
            "candidates": "\n\n".join(
                _render_candidate(c["beat"], c["menu"]) for c in candidates
            ),
            "audio_duration_s": f"{audio_duration_s:.0f}",
            "density": density if isinstance(density, str) else json.dumps(density),
            "max_overlays": max_overlays_for(style, audio_duration_s),
            "emphasis_per_minute": emphasis_per_minute if emphasis_enabled else "",
            "max_emphasis": max_emphasis,
            "visual_language": str(style.get("visual_language") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
        },
    )


def select_overlays(
    ctx: StageContext,
    beats_doc: dict[str, Any],
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    """Choose the graphics. Validate, repair up to three times, same as the planner."""
    beats = list(beats_doc.get("beats") or [])
    candidates = build_candidates(beats, ctx.cfg)
    empty: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "selections": []}
    if not candidates:
        ctx.log("no beat can legally carry a graphic — overlays.json is empty by construction")
        return empty

    cfg_block = ctx.cfg.get("overlay") or ctx.cfg.get("planner") or {}
    provider = str(cfg_block.get("llm") or "deepseek")
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = cfg_block.get("model") or (prompt or {}).get("model_hint")
    max_tokens = int((prompt or {}).get("max_tokens") or 32000)
    temperature = prompt_packs.temperature(ROLE, prompt)

    if provider == "mock":
        return empty

    system, base_user = _build_prompt(ctx, candidates, audio_duration_s)
    user = base_user
    attempts: list[str] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.select_overlays",
            estimated_units=6000,
            details={"attempt": attempt, "candidates": len(candidates),
                     "prompt": (prompt or {}).get("name", "default")},
        ) as cost:
            result = chat_fn(provider, model, system, user, max_tokens, temperature)
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "attempt": attempt})
        try:
            doc = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as exc:
            violations = [f"output was not a parseable JSON object: {exc}"]
        else:
            doc["video_id"] = ctx.video_id
            doc.setdefault("version", "1.0")
            doc.setdefault("selections", [])
            violations = validate_overlay_selection(doc, beats, ctx.cfg, audio_duration_s)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(
                    ctx.video_id, STAGE, "progress",
                    f"overlays accepted on attempt {attempt} "
                    f"({len(doc['selections'])} of {len(candidates)} candidates)",
                )
                return doc

        attempts.append(f"attempt {attempt}: {len(violations)} violation(s)")
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"attempt {attempt} rejected: {'; '.join(violations[:5])}")
        # Rebuilt from the base prompt, not appended to the last one: attempt
        # 1's already-fixed complaints would otherwise ride along into attempt 3
        # and grow the bill every round (same reasoning as the planner).
        user = (
            base_user
            + "\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix ALL of these and output the corrected JSON:\n- "
            + "\n- ".join(violations)
        )

    raise StageError(
        STAGE,
        f"overlay selection failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)}) — "
        "upload overlays.json manually, or run a pipeline without this stage",
    )
