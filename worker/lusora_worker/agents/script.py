"""Script agent (bounded agent #1): generator strategy + persona from the
style pack. One call; cost recorded through the budget gate.

The prompt itself is data (D42): the editable half comes from the cfg
snapshot (`cfg.prompts.script`, resolved at enqueue per D44), the welded
output contract from contracts/prompts/welded/. Videos enqueued before
M10 have no snapshot and fall back to the built-in default.
"""

from __future__ import annotations

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..providers import llm

STAGE = "script"
# the prompt-pack role; the same word as the stage here, but they are separate
# namespaces (the planner's stage is "plan_beats", its role is "planner")
ROLE = "script"

# Speaking rate used to turn a target duration into a word count for the
# prompt. Deliberately a hint, not a constraint: the compiler works from the
# real audio duration, never from this estimate.
WORDS_PER_SECOND = 2.5

DEFAULT_TARGET_SECONDS = 90.0


def target_seconds(cfg: dict) -> float:
    """D45: narration length is style pack data, overridable per channel and
    per video (both ride on `script.target_seconds` in the merged snapshot)."""
    script_cfg = cfg.get("script") or {}
    if script_cfg.get("target_seconds"):
        return float(script_cfg["target_seconds"])
    pack_script = ((cfg.get("style_pack_doc") or {}).get("script")) or {}
    if pack_script.get("target_seconds"):
        return float(pack_script["target_seconds"])
    return DEFAULT_TARGET_SECONDS


def generate_script(ctx: StageContext, chat_fn: llm.ChatFn = llm.chat) -> str:
    cfg_script = ctx.cfg.get("script") or {}
    provider = str(cfg_script.get("llm") or "deepseek")
    style = ctx.cfg.get("style_pack_doc") or {}
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    seconds = target_seconds(ctx.cfg)

    system, user = prompt_packs.compose(
        ROLE,
        prompt,
        {
            "persona": str(style.get("script_persona") or ""),
            "language": str(ctx.cfg.get("language") or "en-US"),
            "title": str(ctx.video.get("title") or "").strip(),
            "target_seconds": round(seconds),
            "target_words": round(seconds * WORDS_PER_SECOND),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
        },
    )

    max_tokens = int((prompt or {}).get("max_tokens") or 8000)
    model = cfg_script.get("model") or (prompt or {}).get("model_hint")
    est_tokens = 1200
    with budget_gate(
        ctx, stage=STAGE, provider=provider, operation="llm.generate_script",
        estimated_units=est_tokens,
        details={"title": str(ctx.video.get("title") or "")[:80],
                 "prompt": (prompt or {}).get("name", "default")},
    ) as cost:
        result = chat_fn(provider, model, system, user, max_tokens)
        cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                          "output_tokens": result.output_tokens})
    ctx.db.provider_health(f"llm.{provider}", True)
    return result.text.strip()
