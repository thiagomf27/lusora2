"""Subjects — the whole narration read once, before any shot is planned.

D102 (documentary plan, slice 2). Beat craft plans a video in chunks of thirty
spans and reads each span on its own, so a span that names nothing ("for almost
20 years, the town lived with it") is searched as whatever it says, and Pexels
answers with a sunny suburb. Run 01 of the Centralia benchmark showed exactly
that: "1970s street children", "man on porch portrait", "snowy town aerial" —
each a fair reading of its sentence, none of them the story.

Dark Palace avoids it with one call over the WHOLE narration that names the
video's subjects and their searches before any block is planned. This is that
call: `subjects.json` carries the main idea, a visual thread that fits almost
any shot, and the subjects the story returns to, each with several searches
that are different angles of it. Beat craft then ties every beat to a subject,
and resolve_assets falls back to — and rotates through — the subject's searches.
"""

from __future__ import annotations

import json
from typing import Any

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm
from ..validators import validate_subjects
from .beatcraft import render_cuts

STAGE = "subjects"
ROLE = "subjects"
MAX_ATTEMPTS = 3


def _build_prompt(ctx: StageContext, cuts: list[dict[str, Any]], audio_duration_s: float) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    return prompt_packs.compose(
        ROLE,
        (ctx.cfg.get("prompts") or {}).get(ROLE),
        {
            "video_id": ctx.video_id,
            "cuts": render_cuts(cuts),
            "cut_count": len(cuts),
            "audio_duration_s": f"{audio_duration_s:.0f}",
            "visual_language": str(style.get("visual_language") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
        },
    )


def find_subjects(
    ctx: StageContext,
    cuts: list[dict[str, Any]],
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    """One call, repaired up to three times, judged by `validate_subjects`."""
    planner_cfg = ctx.cfg.get("planner") or {}
    provider = planner_cfg.get("llm") or "deepseek"
    gate_provider = llm.gate_provider(llm.chain_of(provider))
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = None if isinstance(provider, list) else (planner_cfg.get("model") or (prompt or {}).get("model_hint"))
    max_tokens = int((prompt or {}).get("max_tokens") or 32000)
    temperature = prompt_packs.temperature(ROLE, prompt)

    system, base_user = _build_prompt(ctx, cuts, audio_duration_s)
    user = base_user
    attempts: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=gate_provider, operation="llm.subjects",
            estimated_units=4000,
            details={"attempt": attempt, "cuts": len(cuts),
                     "prompt": (prompt or {}).get("name", "default")},
            model=model,
        ) as cost:
            result = chat_fn(provider, model, system, user, max_tokens, temperature)
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "attempt": attempt,
                                              "answered_by": result.provider})
        try:
            doc = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as exc:
            violations = [f"output was not a parseable JSON object: {exc}"]
        else:
            doc["version"] = "1.0"
            doc["video_id"] = ctx.video_id  # ours, not the model's to get wrong
            violations = validate_subjects(doc, len(cuts))
            if not violations:
                ctx.db.provider_health(f"llm.{result.provider}", True)
                ctx.db.event(ctx.video_id, STAGE, "progress",
                             f"{len(doc['subjects'])} subjects accepted on attempt {attempt}")
                return doc

        attempts.append(f"attempt {attempt}: {len(violations)} violation(s)")
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"attempt {attempt} rejected: {'; '.join(violations[:5])}")
        user = (
            base_user
            + "\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix ALL of these and output the corrected JSON:\n- "
            + "\n- ".join(violations)
        )

    raise StageError(
        STAGE,
        f"subjects failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)}) "
        "— upload subjects.json manually or switch planner.llm to 'mock'",
    )


def fallback_subjects(ctx: StageContext, cuts: list[dict[str, Any]]) -> dict[str, Any]:
    """The mock path: a valid, deliberately plain subjects.json from the title.

    A `mock` channel runs offline and in tests; it still needs the artifact so
    the stages after it behave the same way they do on a real run. One subject,
    and a thread built from the title's own words — honest about knowing nothing.
    """
    from ..providers.sources import keywords_from_intent

    title = str(ctx.video.get("title") or "documentary")
    base = keywords_from_intent(title) or "documentary footage"
    return {
        "version": "1.0",
        "video_id": ctx.video_id,
        "main_idea": title,
        "visual_thread": [base, "archival footage"],
        "subjects": [{"id": "s1", "name": title, "queries": [base, "establishing shot"], "first_cut": 0}],
        "hook_end_cut": min(3, len(cuts) - 1),
        "title": title,
    }


def render_subjects(doc: dict[str, Any]) -> str:
    """The subjects block beat craft reads: the story's look, then the list."""
    lines = [f"MAIN IDEA: {doc.get('main_idea', '')}",
             f"VISUAL THREAD (fits almost any shot): {', '.join(doc.get('visual_thread') or [])}",
             "SUBJECTS:"]
    for s in doc.get("subjects") or []:
        look = f" — {s['look']}" if s.get("look") else ""
        lines.append(f"  {s['id']}: {s['name']}{look} (from cut {s['first_cut']}; "
                     f"searches: {', '.join(s.get('queries') or [])})")
    return "\n".join(lines)
