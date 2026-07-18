"""Script agent (bounded agent #1): generator strategy + persona from the
style pack. One call; cost recorded through the budget gate."""

from __future__ import annotations

from ..context import StageContext
from ..costs import budget_gate
from ..providers import llm

STAGE = "script"


def generate_script(ctx: StageContext, chat_fn: llm.ChatFn = llm.chat) -> str:
    cfg_script = ctx.cfg.get("script") or {}
    provider = str(cfg_script.get("llm") or "deepseek")
    style = ctx.cfg.get("style_pack_doc") or {}
    persona = str(style.get("script_persona") or "A clear, engaging narrator.")
    language = str(ctx.cfg.get("language") or "en-US")
    title = str(ctx.video.get("title") or "").strip()
    content_rules = str(ctx.cfg.get("content_rules") or "")

    system = (
        "You write voiceover narration scripts for YouTube videos.\n"
        f"Persona and style:\n{persona}\n"
        f"Language: write the ENTIRE script in {language}.\n"
        "Output ONLY the narration text — no headings, no scene directions, "
        "no markdown, no speaker labels. Plain sentences that will be read aloud."
    )
    user = (
        f"Write the narration script for a video titled: {title!r}.\n"
        f"Target length: 60–120 seconds of speech (roughly 150–300 words).\n"
        + (f"Channel content rules: {content_rules}\n" if content_rules else "")
        + "Structure it with a hook, a development, and a resolution."
    )

    est_tokens = 1200
    with budget_gate(
        ctx, stage=STAGE, provider=provider, operation="llm.generate_script",
        estimated_units=est_tokens, details={"title": title[:80]},
    ) as cost:
        result = chat_fn(provider, cfg_script.get("model"), system, user, 2000)
        cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                          "output_tokens": result.output_tokens})
    ctx.db.provider_health(f"llm.{provider}", True)
    return result.text.strip()
