"""Where the story turns and where it looks back (D112, documentary plan slice 7).

Dark Palace's `efeitos_da_narrativa`: one cheap call over the narration marks
the beats told as a memory or a step back in time (`flashback`) and the beats
where the story turns (`turns`). The script's paragraph starts after the hook
are always turns, so a call that gives no answer still leaves the video its
chapter breaks — and then nothing is aged, because a flashback cannot be
guessed from the layout of the text.

It decides no content: compile_plan places the film texture from it, and only
when style_pack.texture.placement is `narrative`. Any other placement writes
`source: off` without a call.
"""

from __future__ import annotations

import json
import re
from typing import Any

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm

STAGE = "narrative_marks"
ROLE = "narrative_marks"
BEAT_CHARS = 220  # DP sends each block's first 220 characters: enough to tell a memory from a turn


class _NoAnswer(Exception):
    """The provider could not answer."""


def placement(cfg: dict[str, Any]) -> str:
    texture = (cfg.get("style_pack_doc") or {}).get("texture") or {}
    return str(texture.get("placement") or "off")


def render_beats(beats: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{b['id']}] {' '.join(str(b.get('script_text') or '').split())[:BEAT_CHARS]}" for b in beats)


def _words(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def paragraph_starts(script: str, cuts: list[dict[str, Any]]) -> set[int]:
    """The indexes of the cuts that open a paragraph of the script.

    The cuts concatenate to the script (D88), so walking both word by word
    lines each cut up with its place in the text; a cut opens a paragraph when
    a blank line sits between it and the words before it.
    """
    starts: set[int] = set()
    # every word of the script with whether a paragraph break comes right before it
    words: list[tuple[str, bool]] = []
    for p, paragraph in enumerate(re.split(r"\n\s*\n", script.strip())):
        for w, word in enumerate(_words(paragraph)):
            words.append((word, p > 0 and w == 0))
    at = 0
    for cut in cuts:
        own = _words(str(cut.get("script_text") or ""))
        if not own:
            continue
        # find the cut's first word from where the last cut ended
        k = next((n for n in range(at, min(len(words), at + 40)) if words[n][0] == own[0]), None)
        if k is None:
            continue
        if words[k][1]:
            starts.add(int(cut.get("index", 0)))
        at = k + len(own)
    return starts


def validate(answer: Any, ids: set[str]) -> list[str]:
    if not isinstance(answer, dict):
        return ['the answer must be an object {"flashback": [...], "turns": [...]}']
    problems = []
    for key in ("flashback", "turns"):
        value = answer.get(key)
        if not isinstance(value, list):
            problems.append(f"`{key}` must be a list of beat ids")
            continue
        unknown = [str(v) for v in value if str(v) not in ids]
        if unknown:
            problems.append(f"`{key}` names beats that do not exist: {', '.join(unknown[:5])}")
    return problems


def mark(
    ctx: StageContext,
    beats: list[dict[str, Any]],
    cuts: list[dict[str, Any]],
    script: str,
    hook_end_s: float | None,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    """marks.json: the model's marks plus the paragraph turns, or the paragraph turns alone."""
    doc: dict[str, Any] = {"version": "1.0", "video_id": ctx.video_id, "flashback": [], "turns": [], "source": "off"}
    if placement(ctx.cfg) != "narrative":
        return doc
    # beat craft makes one beat per cut, in order (D88)
    by_index = {int(c.get("index", n)): (beats[n]["id"], float(c.get("start_s", 0))) for n, c in enumerate(cuts)
                if n < len(beats)}
    after_hook = [by_index[i] for i in sorted(paragraph_starts(script, cuts)) if i in by_index]
    first = str(beats[0]["id"]) if beats else None
    turns = [bid for bid, start in after_hook
             if (hook_end_s is None and bid != first) or (hook_end_s is not None and start >= hook_end_s - 0.01)]
    doc.update(turns=turns, source="fallback")

    planner = ctx.cfg.get("planner") or {}
    provider = planner.get("llm") or "mock"
    chain = llm.chain_of(provider)
    if chain == ["mock"] or not beats:
        doc["note"] = "no model for the call (mock planner)"
        return doc
    gate_provider = llm.gate_provider(chain)
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = None if isinstance(provider, list) else (planner.get("model") or (prompt or {}).get("model_hint"))
    subjects_doc = ctx.read_json("subjects.json") if ctx.has("subjects.json") else {}
    system, user = prompt_packs.compose(ROLE, prompt, {
        "beats": render_beats(beats),
        "main_idea": str(subjects_doc.get("main_idea") or ""),
        "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
    })
    try:
        with budget_gate(ctx, stage=STAGE, provider=gate_provider, operation="llm.narrative_marks",
                         estimated_units=4000, model=model, details={"beats": len(beats)}) as cost:
            try:
                result = chat_fn(provider, model, system, user, int((prompt or {}).get("max_tokens") or 8000),
                                 prompt_packs.temperature(ROLE, prompt))
            except StageError as exc:
                raise _NoAnswer(str(exc)) from exc  # the gate records it as failed
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "answered_by": result.provider})
    except _NoAnswer as exc:
        # the marks only place texture: a provider that cannot answer costs the
        # flashbacks, never the video (a budget refusal still stops it)
        for name, reason in getattr(exc.__cause__, "marks", None) or [(gate_provider, str(exc)[:200])]:
            ctx.db.provider_health(f"llm.{name}", False, reason[:200])
        doc["note"] = f"the call failed ({exc})"[:300]
        return doc
    try:
        answer = llm.extract_json(result.text)
    except (ValueError, json.JSONDecodeError) as exc:
        doc["note"] = f"the answer was not JSON ({exc})"[:300]
        return doc
    ids = {str(b["id"]) for b in beats}
    problems = validate(answer, ids)
    if problems:
        doc["note"] = "; ".join(problems)[:300]
        return doc
    order = {str(b["id"]): n for n, b in enumerate(beats)}
    model_turns = {str(v) for v in answer["turns"]}
    doc["turns"] = sorted(set(turns) | model_turns, key=order.__getitem__)
    doc["flashback"] = sorted({str(v) for v in answer["flashback"]}, key=order.__getitem__)
    doc["source"] = "model"
    return doc
