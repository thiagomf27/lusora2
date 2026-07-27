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
"""

from __future__ import annotations

import json
from typing import Any

import lusora_contracts
from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm
from ..validators import validate_beat_sheet

STAGE = "plan_beats"
# the prompt-pack role, which is NOT the stage name (contracts/prompts/planner/)
ROLE = "planner"
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
        },
    )


def plan_beats(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    planner_cfg = ctx.cfg.get("planner") or {}
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    provider = str(planner_cfg.get("llm") or "deepseek")
    model = planner_cfg.get("model") or (prompt or {}).get("model_hint")
    max_tokens = int((prompt or {}).get("max_tokens") or 16000)
    system, base_user = _build_prompt(ctx, script, audio_duration_s)
    user = base_user

    attempts: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.plan_beats",
            estimated_units=12000,
            details={"attempt": attempt, "prompt": (prompt or {}).get("name", "default")},
        ) as cost:
            # reasoning models spend 4-9k tokens thinking before the JSON starts
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
            violations = validate_beat_sheet(doc, script, ctx.cfg, audio_duration_s)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(ctx.video_id, STAGE, "progress",
                             f"beat sheet accepted on attempt {attempt} ({len(doc['beats'])} beats)")
                return doc

        attempts.append(f"attempt {attempt}: {len(violations)} violation(s)")
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"attempt {attempt} rejected: {'; '.join(violations[:5])}")
        # Feed ALL violations of THIS attempt back (Principle 5), rebuilt from
        # the base prompt: appending to the previous user message would carry
        # attempt 1's already-fixed complaints into attempt 3 and grow the
        # token bill on every round.
        user = (
            base_user
            + "\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Fix ALL of these violations and output the corrected JSON:\n- "
            + "\n- ".join(violations)
        )

    raise StageError(
        STAGE,
        f"beat planner failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)}) — "
        "upload beats.json manually or switch planner.llm to 'mock'",
    )
