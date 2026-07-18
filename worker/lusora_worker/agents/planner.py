"""Beat planner agent (bounded agent #2) — the creative core.

Inputs: script + style pack (pacing numbers, arc, density) + component
catalog (when_to_use rules) + channel content rules. Output: a beat
sheet. Wrapped in the validate→repair loop: max 3 attempts, ALL
violations fed back (Core Principle 5).
"""

from __future__ import annotations

import json
from typing import Any

import lusora_contracts

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm
from ..validators import validate_beat_sheet

STAGE = "plan_beats"
MAX_ATTEMPTS = 3


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


def _build_prompt(ctx: StageContext, script: str, audio_duration_s: float) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    pacing = style.get("pacing") or {}
    overlays = style.get("overlays") or {}
    allowed = overlays.get("allowed_components")
    density = overlays.get("density", "normal")
    avg_hold = float(pacing.get("avg_hold_seconds", 4.0))
    target_beats = max(1, round(audio_duration_s / avg_hold))
    content_rules = str(ctx.cfg.get("content_rules") or "")
    visual_language = str(style.get("visual_language") or "")
    instructions = str((ctx.cfg.get("overrides") or {}).get("instructions") or "")

    system = (
        "You are a documentary beat planner. You segment a narration script into visual beats "
        "and choose what appears on screen for each. You output ONLY a JSON object, no prose.\n\n"
        "HARD RULES:\n"
        "1. Each beat's script_text must be a VERBATIM contiguous span of the script. Together, "
        "in order, the beats must cover the ENTIRE script with no overlap and no gaps.\n"
        "2. visual_intent is a location-scout style description: concrete, visual, specific "
        "(subjects, era, framing, lighting). It is used as a search query for footage. "
        "Example: 'aerial view of a 1940s industrial district, smokestacks, workers assembling "
        "aircraft wings, archival grain'. Never abstract ('the concept of change').\n"
        "3. anchors: structured facts found VERBATIM in the beat's span (percentage, number, "
        "comparison, place, date, name, quote). source_words must appear in the span exactly.\n"
        "4. An overlay may ONLY reference one of its beat's anchors (anchor_ref = index) or, for "
        "TitleCard, carry pure text. Never invent numbers — they come from the anchor.\n"
        "   props_hint carries concrete VALUES only (e.g. {\"text\": \"1943\"}), never the prop "
        "schema — anything shaped like {\"type\": …} is invalid.\n"
        "5. Use overlays sparingly and only where the rules below say they help.\n\n"
        f"COMPONENT MENU (the only components that exist):\n{_catalog_menu(allowed)}\n"
    )
    user = (
        f"SCRIPT ({audio_duration_s:.0f}s of narration):\n{script}\n\n"
        f"PACING: aim for about {target_beats} beats "
        f"(avg hold {avg_hold}s, min {pacing.get('min_hold', 2.5)}s, max {pacing.get('max_hold', 8)}s). "
        f"Overlay density: {density}.\n"
        + (f"VISUAL LANGUAGE: {visual_language}\n" if visual_language else "")
        + (f"CONTENT RULES: {content_rules}\n" if content_rules else "")
        + (f"PER-VIDEO INSTRUCTIONS: {instructions}\n" if instructions else "")
        + "\nOutput JSON shape:\n"
        '{"version":"1.0","video_id":"' + ctx.video_id + '","beats":[{"id":"b1","kind":"narration",'
        '"script_text":"…","visual_intent":"…","mood":"…","media_preference":"video|image|any",'
        '"anchors":[{"type":"percentage","value":70,"label":"…","source_words":"…"}],'
        '"overlay":{"component":"…","anchor_ref":0,"props_hint":{}}}]}\n'
        "Omit anchors/overlay where not needed. Respond with the JSON object only."
    )
    return system, user


def plan_beats(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    provider = str(((ctx.cfg.get("planner") or {}).get("llm")) or "deepseek")
    model = (ctx.cfg.get("planner") or {}).get("model")
    system, user = _build_prompt(ctx, script, audio_duration_s)

    attempts: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.plan_beats",
            estimated_units=4000, details={"attempt": attempt},
        ) as cost:
            result = chat_fn(provider, model, system, user, 6000)
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
            violations = validate_beat_sheet(doc, script, ctx.cfg, audio_duration_s)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(ctx.video_id, STAGE, "progress",
                             f"beat sheet accepted on attempt {attempt} ({len(doc['beats'])} beats)")
                return doc

        attempts.append(f"attempt {attempt}: {len(violations)} violation(s)")
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"attempt {attempt} rejected: {'; '.join(violations[:5])}")
        # feed ALL violations back for repair
        user = (
            user
            + f"\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Fix ALL of these violations and output the corrected JSON:\n- "
            + "\n- ".join(violations)
        )

    raise StageError(
        STAGE,
        f"beat planner failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)}) — "
        "upload beats.json manually or switch planner.llm to 'mock'",
    )
