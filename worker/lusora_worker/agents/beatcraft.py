"""Per-cut visual craft — the beat planner with the transcription removed.

D88. `cut_beats` has already decided where the narration is cut and when each
piece is spoken, in code, from the real transcript. This call receives those
spans NUMBERED and answers by index: what the shot shows, what to search for,
the mood, the anchors. It never returns `script_text`.

Two things follow, and both are the point.

**Verbatim coverage becomes unfailable.** The sheet is rejected when the beats'
text concatenated does not equal the script, and the model used to produce that
text by retyping the narration — so a dropped clause or a normalised quote mark
failed a whole sheet, and three repair attempts could only ask it to retype more
carefully. Here the text is copied from the cuts by code, so the property is
true by construction rather than checked after the fact.

**It is most of the bill.** Output ran at roughly three times input, and the
largest single item was the script coming back one beat at a time — money paid
to receive something we already had.

The merged sheet is submitted to `validate_beat_sheet` UNCHANGED. That is safe
for the reason D52 already established: chunked planning assembles a sheet from
several calls and judges it as a whole, which is the arrangement in production
today.
"""

from __future__ import annotations

import json
import math
from typing import Any

from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import llm
from ..validators import emphasis_policy, max_overlays_for, validate_beat_sheet

STAGE = "plan_beats"
ROLE = "beatcraft"
MAX_ATTEMPTS = 3

# Above this many cuts the answer is split across several calls. The same knob
# the planner reads (`channel.planner.chunk_target_beats`, schema default 30) —
# it was doing nothing on the production pipeline, because v3 bypasses the
# planner entirely whenever beat_cuts.json exists.
DEFAULT_CHUNK_TARGET_BEATS = 30

# How many of the previous chunk's answers to carry forward, and how many
# earlier visual subjects to show. Both are the planner's numbers, for the same
# reasons: two is enough for a mood to hold across a boundary, and twelve is
# enough to stop the fourth aerial shot without the ledger becoming the largest
# thing in the prompt.
CARRY_FORWARD_BEATS = 2
LEDGER_ENTRIES = 12

# Craft keys the model may set. `script_text`, `timing` and `id` are ours and
# are filled from the cuts; anything else it invents is dropped rather than
# carried into a sheet the schema would reject.
#
# `transition_out` (D89, beat sheet v1.2) is in this list even though the
# shipped prompt does not ask for it. It was missing, which made a
# PROMPT-PACK edit unable to take effect: someone adding the field to
# contracts/prompts/beatcraft/*.json would have had every answer silently
# dropped by merge(), and D43's whole point is that the editable half is data a
# person can change without a deploy. The default pack still says nothing about
# transitions — D89 keeps the field human-set until an eval says the model
# chooses well, and D85 measured what happens when a model is shown a field
# with no taste attached to it: it fills it, every time, on every beat.
CRAFT_KEYS = ("visual_intent", "queries", "mood", "media_preference", "anchors", "overlay",
              "notes", "transition_out")


def render_cuts(cuts: list[dict[str, Any]]) -> str:
    """The numbered spans, with how long each is held.

    The duration is shown because it is the one thing that should change what a
    shot is: a 1.8s span wants one readable subject, an 8s span can hold a
    developing image.
    """
    lines = []
    for cut in cuts:
        held = float(cut["end_s"]) - float(cut["start_s"])
        lines.append(f'[{cut["index"]}] ({held:.1f}s) {cut["script_text"]}')
    return "\n".join(lines)


def _build_prompt(
    ctx: StageContext,
    cuts: list[dict[str, Any]],
    audio_duration_s: float,
    menu: str,
    chunk_position: str = "",
    carry_forward: str = "",
    visual_ledger: str = "",
    chunk_share: float = 1.0,
) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    pacing = style.get("pacing") or {}
    emphasis_enabled, emphasis_per_minute = emphasis_policy(style)
    # A chunk gets a slack-free share of the whole video's budget: floor, and no
    # +1, so the shares summed over the chunks stay under the ceiling the merged
    # sheet is finally judged against. Same arithmetic as the planner's.
    max_overlays: int | str = ""
    if menu:
        whole = max_overlays_for(style, audio_duration_s)
        max_overlays = whole if chunk_share >= 1.0 else max(1, math.floor(whole * chunk_share))
    return prompt_packs.compose(
        ROLE,
        (ctx.cfg.get("prompts") or {}).get(ROLE),
        {
            "video_id": ctx.video_id,
            "cuts": render_cuts(cuts),
            "audio_duration_s": f"{audio_duration_s:.0f}",
            "arc": pacing.get("arc") or "",
            "visual_language": str(style.get("visual_language") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
            "instructions": str((ctx.cfg.get("overrides") or {}).get("instructions") or ""),
            "component_menu": menu,
            # A budget for a decision this call is not making would be the
            # prompt talking to itself, so both go with the menu.
            "max_overlays": max_overlays,
            "emphasis_per_minute": (emphasis_per_minute if (menu and emphasis_enabled) else ""),
            "chunk_position": chunk_position,
            "carry_forward": carry_forward,
            "visual_ledger": visual_ledger,
        },
    )


def merge(cuts: list[dict[str, Any]], craft: dict[str, Any], video_id: str) -> dict[str, Any]:
    """Beats = the cuts (text and timing) + the model's per-index craft.

    Assembled here rather than by the model, which is the whole mechanism: a
    cut with no answer still becomes a beat, with a visual_intent derived from
    its own words, so a missing index degrades one shot instead of failing a
    video.
    """
    answers = craft.get("beats") or {}
    beats = []
    for cut in cuts:
        index = int(cut["index"])
        answer = answers.get(str(index)) or answers.get(index) or {}
        beat: dict[str, Any] = {
            "id": f"b{index + 1}",
            "kind": "narration",
            "script_text": cut["script_text"],
        }
        for key in CRAFT_KEYS:
            if isinstance(answer, dict) and answer.get(key) not in (None, "", [], {}):
                beat[key] = answer[key]
        beat.setdefault("visual_intent", _fallback_intent(cut["script_text"]))
        beats.append(beat)
    return {"version": "1.1", "video_id": video_id, "beats": beats}


def _fallback_intent(text: str) -> str:
    """A usable shot description for a cut the model did not answer."""
    words = [w.strip(".,!?…:;\"'") for w in text.split()]
    subject = " ".join(w for w in words if len(w) > 3)[:120]
    return (subject or "establishing shot") + ", wide establishing shot"


def _chunk_cuts(cuts: list[dict[str, Any]], target: int) -> list[list[dict[str, Any]]]:
    """Contiguous index ranges of roughly `target` cuts each.

    A chunk is a RANGE and nothing cleverer, which is the whole reason this is
    cheaper than the planner's chunking: `cut_beats` already decided where the
    narration divides and when each piece is spoken, so there is no partition
    left for a spine pass to choose. D52's spine exists to find the story's
    joints before the script is cut; here the script is cut before anything is
    asked, and borrowing the mechanism would be paying for an answer we have.
    """
    if len(cuts) <= target:
        return [list(cuts)]
    count = math.ceil(len(cuts) / target)
    size = math.ceil(len(cuts) / count)
    return [list(cuts[i:i + size]) for i in range(0, len(cuts), size)]


def _format_carry_forward(cuts: list[dict[str, Any]], answers: dict[str, Any]) -> str:
    """The last few answers of the previous chunk, as the model wrote them."""
    lines = []
    for cut in cuts[-CARRY_FORWARD_BEATS:]:
        answer = answers.get(str(cut["index"])) or {}
        intent = str(answer.get("visual_intent") or "").strip()
        if intent:
            lines.append(f'  [{cut["index"]}] ({answer.get("mood", "neutral")}) {intent}')
    return "\n".join(lines)


def _format_ledger(answers: dict[str, Any]) -> str:
    """Visual subjects already spent, most recent last."""
    intents = [
        str(a.get("visual_intent") or "").strip()
        for _k, a in sorted(answers.items(), key=lambda kv: int(kv[0]))
        if isinstance(a, dict) and str(a.get("visual_intent") or "").strip()
    ]
    return "\n".join(f"  - {i}" for i in intents[-LEDGER_ENTRIES:])


def craft_beats(
    ctx: StageContext,
    cuts: list[dict[str, Any]],
    script: str,
    audio_duration_s: float,
    menu: str = "",
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    """Ask for the craft, merge it onto the cuts, judge the result unchanged.

    Above `chunk_target_beats` the asking is split across several calls. That
    threshold is not new caution: `planner.py` has always put the safe size of
    one call at 20-30 beats, and said in a comment that above it you split
    "rather than risk truncation or degraded quality on one huge call". This
    stage never honoured it. An 11-minute script cuts into 217 spans, whose
    answer is roughly 19.5k output tokens before the reasoning trace, in one
    JSON object that is all-or-nothing: a single malformed brace loses the whole
    video with no partial progress to resume from.
    """
    target = max(1, int((ctx.cfg.get("planner") or {}).get("chunk_target_beats")
                        or DEFAULT_CHUNK_TARGET_BEATS))
    chunks = _chunk_cuts(cuts, target)
    chunked = len(chunks) > 1
    if chunked:
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"{len(cuts)} cuts over {len(chunks)} calls of ~{target}")

    answers: dict[str, Any] = {}
    for i, chunk in enumerate(chunks):
        answers.update(_craft_chunk(
            ctx, chunk, audio_duration_s, menu, chat_fn,
            chunk_position=f"part {i + 1} of {len(chunks)}" if chunked else "",
            carry_forward=_format_carry_forward(chunks[i - 1], answers) if i else "",
            visual_ledger=_format_ledger(answers) if chunked else "",
            # The density budget belongs to the whole video, so a chunk gets a
            # slack-free share of it: floor, and no +1, exactly as the planner
            # does, so honouring the hint keeps the merged sheet under the
            # ceiling it is finally judged against.
            chunk_share=len(chunk) / len(cuts) if chunked else 1.0,
        ))

    doc = merge(cuts, {"beats": answers}, ctx.video_id)
    # The whole sheet, judged as a whole — the arrangement D52 already
    # established for chunked planning. Each chunk checked its own slice; this
    # catches anything that only exists across the merge.
    violations = validate_beat_sheet(doc, script, ctx.cfg, audio_duration_s)
    _raise_if_structural(violations)
    if violations:
        raise StageError(
            STAGE,
            "merged beat sheet failed final validation: " + "; ".join(violations[:8]),
        )
    ctx.db.event(ctx.video_id, STAGE, "progress",
                 f"beat craft accepted ({len(doc['beats'])} beats over {len(chunks)} call(s))")
    return doc


def _raise_if_structural(violations: list[str]) -> None:
    """A violation about the beat COUNT is about the cuts, and the cuts are ours.

    Retrying it asks the model to change a number it does not control — the
    exact futility this stage removed for verbatim coverage, and it cost three
    attempts and 57k tokens per case before this existed. Fail loudly at the
    stage that owns the decision instead.
    """
    structural = [v for v in violations if "outside the pacing range" in v]
    if structural:
        raise StageError(
            STAGE,
            f"{structural[0]} — the spans come from cut_beats, so no answer from "
            "the model can fix this. The style pack's hold window and the script "
            "disagree; widen pacing.avg_hold_seconds or pacing.max_hold.",
        )


def _craft_chunk(
    ctx: StageContext,
    cuts: list[dict[str, Any]],
    audio_duration_s: float,
    menu: str,
    chat_fn: llm.ChatFn,
    chunk_position: str = "",
    carry_forward: str = "",
    visual_ledger: str = "",
    chunk_share: float = 1.0,
) -> dict[str, Any]:
    """One call's worth of cuts, repaired up to three times, judged on its own
    slice. Where there is only one chunk the slice IS the sheet, so this is
    exactly what the single call always did."""
    planner_cfg = ctx.cfg.get("planner") or {}
    provider = str(planner_cfg.get("llm") or "deepseek")
    prompt = (ctx.cfg.get("prompts") or {}).get(ROLE)
    model = planner_cfg.get("model") or (prompt or {}).get("model_hint")
    max_tokens = int((prompt or {}).get("max_tokens") or 64000)
    temperature = prompt_packs.temperature(ROLE, prompt)

    script = " ".join(str(c["script_text"]) for c in cuts)
    duration = float(cuts[-1]["end_s"]) - float(cuts[0]["start_s"])

    system, base_user = _build_prompt(
        ctx, cuts, audio_duration_s, menu,
        chunk_position=chunk_position, carry_forward=carry_forward,
        visual_ledger=visual_ledger, chunk_share=chunk_share,
    )
    user = base_user
    attempts: list[str] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.craft_beats",
            estimated_units=8000,
            details={"attempt": attempt, "cuts": len(cuts), "part": chunk_position or "whole",
                     "prompt": (prompt or {}).get("name", "default")},
            model=model,
        ) as cost:
            result = chat_fn(provider, model, system, user, max_tokens, temperature)
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "attempt": attempt})
        try:
            craft = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as exc:
            violations = [f"output was not a parseable JSON object: {exc}"]
        else:
            doc = merge(cuts, craft, ctx.video_id)
            # The UNCHANGED validator. Coverage cannot be among these
            # violations — the spans came from the cuts — so every one it
            # reports is genuinely about craft, which is what makes the repair
            # message worth sending back.
            violations = validate_beat_sheet(doc, script, ctx.cfg, duration)
            violations += _index_violations(cuts, craft)
            _raise_if_structural(violations)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(ctx.video_id, STAGE, "progress",
                             f"{chunk_position or 'beat craft'} accepted on attempt {attempt} "
                             f"({len(doc['beats'])} beats)")
                return {str(c["index"]): (craft.get("beats") or {}).get(str(c["index"]))
                        or (craft.get("beats") or {}).get(c["index"]) or {}
                        for c in cuts}

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
        f"beat craft failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)})"
        + (f" on {chunk_position}" if chunk_position else "")
        + " — upload beats.json manually or switch planner.llm to 'mock'",
    )


def _index_violations(cuts: list[dict[str, Any]], craft: dict[str, Any]) -> list[str]:
    """Answers that name a cut that does not exist, or miss one that does.

    A missing index is repaired rather than accepted even though `merge`
    survives it: the fallback intent keeps the video alive, and asking once is
    cheaper than shipping a shot nobody chose.
    """
    answers = craft.get("beats")
    if not isinstance(answers, dict):
        return ["`beats` must be an object keyed by cut index, e.g. {\"0\": {…}, \"1\": {…}}"]
    known = {str(c["index"]) for c in cuts}
    given = {str(k) for k in answers}
    violations = []
    for unknown in sorted(given - known, key=lambda x: (len(x), x)):
        violations.append(f"answer names index {unknown}, which is not one of the {len(cuts)} cuts")
    missing = sorted(known - given, key=int)
    if missing:
        shown = ", ".join(missing[:12]) + ("…" if len(missing) > 12 else "")
        violations.append(f"no answer for index {shown} — every cut needs one")
    for key, answer in answers.items():
        if isinstance(answer, dict) and "script_text" in answer:
            violations.append(
                f"index {key} returned script_text — the narration is already decided, "
                "answer only with what appears on screen"
            )
    return violations
