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
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import lusora_contracts
from lusora_contracts import prompts as prompt_packs

from ..config import parallelism
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

# Above this many candidates the question is split across several calls. Each
# candidate block is its own shortlisted menu — roughly 400 tokens — so a long
# video puts a hundred of them in one prompt, and the budgets it is asked to
# respect stop being legible long before the context runs out. Same knob as the
# beat craft, for the same reason: it is the size of one call.
DEFAULT_CHUNK_TARGET = 30

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
    """One candidate block: what the beat says, what it SHOWS, what it may use.

    The shot is here because the prompt's first reason to decline is "the shot
    already carries the fact — do not caption a thing the viewer is looking at",
    and this stage runs two stages before `resolve_assets`. There is no footage
    yet and there cannot be; what exists is the shot the beat was PLANNED to
    show, which is the same judgement one remove away. Until this line, the only
    way to satisfy that rule was to invent a shot — `script_text` is always
    present on a narration beat, so the `or beat.get("visual_intent")` fallback
    this replaced never once fired on the path that needed it.
    """
    span = " ".join(str(beat.get("script_text") or "").split()[:SPAN_WORDS])
    lines = [f'BEAT {beat.get("id")}: "{span}"']
    intent = " ".join(str(beat.get("visual_intent") or "").split()[:SPAN_WORDS])
    if intent:
        lines.append(f"  the shot planned for it: {intent}")

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
        props = _hintable_props(entry)
        if props:
            lines.append(f"      props: {json.dumps(props, ensure_ascii=False, separators=(',', ':'))}")
    return "\n".join(lines)


def _hintable_props(entry: dict[str, Any]) -> dict[str, Any]:
    """The props this component will accept, with their shapes.

    The planner deliberately does NOT get these (D85's slice): thirty entries
    of prop schemas is 2k tokens read once for a whole video, and a model handed
    a schema fills the schema. Here the menu is six entries, so the same
    information costs almost nothing — and it is REQUIRED, because the re-aim
    worked: the selector started reaching for StepFlow, Timeline and
    DocumentCard, then failed three attempts guessing that `steps` takes
    strings rather than objects. Telling it to choose an exhibit while hiding
    how to fill one is asking for a decision it cannot express.
    """
    out: dict[str, Any] = {}
    for name, spec in (entry.get("props") or {}).items():
        if spec.get("from_anchor") or spec.get("computed") or name in _HIDDEN_PROPS:
            continue
        shape = {k: spec[k] for k in ("type", "enum", "required", "items", "min", "max", "maxWords")
                 if k in spec}
        if shape:
            out[name] = shape
    return out


# The catalog's `emphasis` prop is a visual weight the theme owns; the beat
# sheet's is an overlay CLASS (D86). One word for two meanings in one prompt.
_HIDDEN_PROPS = frozenset({"emphasis"})


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
        # A TIMED beat sits outside the class system (D86): no script_text, so
        # no anchor, so every overlay on one is pure text by construction and
        # the emphasis gate does not apply. It is always a candidate, or a cold
        # open could never get its title card on a pipeline where the planner
        # no longer writes overlays at all.
        structural = beat.get("kind") == "timed"
        menu = _candidate_menu(anchor_types, allowed, emphasis_enabled or structural)
        if menu:
            candidates.append({"beat": beat, "menu": menu})
    return candidates


def _build_prompt(
    ctx: StageContext,
    candidates: list[dict[str, Any]],
    audio_duration_s: float,
    chunk_position: str = "",
    share: float = 1.0,
) -> tuple[str, str]:
    style = ctx.cfg.get("style_pack_doc") or {}
    overlays = style.get("overlays") or {}
    density = overlays.get("density", "normal")
    emphasis_enabled, emphasis_per_minute = emphasis_policy(style)
    max_emphasis: int | str = ""
    if emphasis_enabled:
        max_emphasis = math.ceil(emphasis_per_minute * audio_duration_s / 60) + 1
        if share < 1.0:
            max_emphasis = max(1, math.floor(max_emphasis * share))

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
            "max_overlays": (
                max_overlays_for(style, audio_duration_s) if share >= 1.0
                else max(1, math.floor(max_overlays_for(style, audio_duration_s) * share))
            ),
            "chunk_position": chunk_position,
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
    # 64k, matching the planner, and for the same reason: reasoning is billed
    # out of max_tokens and its length is not bounded by the prompt. One run
    # died here having spent all 32,000 completion tokens thinking, with none
    # left for the answer. Unused budget is free — billing is on actual tokens
    # — so buy headroom rather than track the spread.
    max_tokens = int((prompt or {}).get("max_tokens") or 64000)
    temperature = prompt_packs.temperature(ROLE, prompt)

    if provider == "mock":
        return empty

    target = max(1, int((ctx.cfg.get("planner") or {}).get("chunk_target_beats")
                        or DEFAULT_CHUNK_TARGET))
    chunks = [candidates[i:i + target] for i in range(0, len(candidates), target)] \
        if len(candidates) > target else [candidates]
    if len(chunks) > 1:
        ctx.log(f"{len(candidates)} candidates over {len(chunks)} calls of ~{target}")

    def select(i: int, chunk: list[dict[str, Any]]) -> dict[str, Any]:
        return _select_chunk(
            ctx, chunk, beats, audio_duration_s, chat_fn,
            provider, model, prompt, max_tokens, temperature,
            chunk_position=f"part {i + 1} of {len(chunks)}" if len(chunks) > 1 else "",
            share=len(chunk) / len(candidates) if len(chunks) > 1 else 1.0,
        )

    # The chunks are independent — each is held to its own share of the budget
    # and the merge is judged whole below — so they need not wait on each other.
    # Merged in chunk order whatever order they finish in, so the document is
    # the one a serial run writes; the first failing part IN ORDER is the one
    # reported, and parts not yet started are cancelled rather than paid for.
    workers = min(len(chunks), parallelism("OVERLAY_PARALLELISM", 4))
    if workers == 1:
        parts = [select(i, chunk) for i, chunk in enumerate(chunks)]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(select, i, chunk) for i, chunk in enumerate(chunks)]
            try:
                parts = [f.result() for f in futures]
            except BaseException:
                for f in futures:
                    f.cancel()
                raise

    selections: list[dict[str, Any]] = []
    declined: list[dict[str, Any]] = []
    for part in parts:
        selections += part.get("selections") or []
        declined += part.get("declined") or []

    doc = {"version": "1.0", "video_id": ctx.video_id,
           "selections": selections, "declined": declined}
    # The whole selection, judged against the whole video's budget — the same
    # arrangement the chunked beat craft uses. Each chunk was held to its own
    # share; this is what catches a merge that adds up to more than the video
    # is allowed.
    violations = validate_overlay_selection(doc, beats, ctx.cfg, audio_duration_s)
    if violations:
        raise StageError(
            STAGE,
            "merged overlay selection failed final validation: " + "; ".join(violations[:8]),
        )
    ctx.db.event(
        ctx.video_id, STAGE, "progress",
        f"{len(selections)} overlays selected over {len(chunks)} call(s), "
        f"{len(declined)} beats declined",
    )
    return doc


def _select_chunk(
    ctx: StageContext,
    candidates: list[dict[str, Any]],
    beats: list[dict[str, Any]],
    audio_duration_s: float,
    chat_fn: llm.ChatFn,
    provider: str,
    model: Any,
    prompt: Any,
    max_tokens: int,
    temperature: Any,
    chunk_position: str = "",
    share: float = 1.0,
) -> dict[str, Any]:
    """One call's worth of candidates, repaired up to three times.

    Judged against this chunk's share of the budget rather than the video's, so
    a chunk cannot be rejected for spending less than the whole allowance — the
    failure the planner's chunking hit and documented.
    """
    system, base_user = _build_prompt(
        ctx, candidates, audio_duration_s, chunk_position=chunk_position, share=share
    )
    user = base_user
    attempts: list[str] = []
    # The slice of the video these candidates actually cover: what the budget
    # check should scale to.
    chunk_duration = audio_duration_s * share

    for attempt in range(1, MAX_ATTEMPTS + 1):
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.select_overlays",
            estimated_units=6000,
            details={"attempt": attempt, "candidates": len(candidates),
                     "prompt": (prompt or {}).get("name", "default")},
            model=model,
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
            violations = validate_overlay_selection(doc, beats, ctx.cfg, chunk_duration)
            if chunk_position:
                violations += _outside_this_chunk(doc, candidates)
            if not violations:
                ctx.db.provider_health(f"llm.{provider}", True)
                ctx.db.event(
                    ctx.video_id, STAGE, "progress",
                    f"{chunk_position or 'overlays'} accepted on attempt {attempt} "
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
        f"overlay selection failed after {MAX_ATTEMPTS} attempts ({'; '.join(attempts)})"
        + (f" on {chunk_position}" if chunk_position else "")
        + " — upload overlays.json manually, or run a pipeline without this stage",
    )


def _outside_this_chunk(
    doc: dict[str, Any], candidates: list[dict[str, Any]]
) -> list[str]:
    """A chunk may only SELECT for the beats it was shown.

    Without this a call could place a graphic on a beat another call is also
    deciding for, and the merge would carry two answers to one question. Applied
    to selections only, and only when there is more than one chunk: a `declined`
    naming a beat outside this part costs nothing (the merge's own validator
    catches a beat that ends up in both lists), and an unchunked call was always
    free to decline a beat that was never a candidate.
    """
    mine = {str(c["beat"].get("id")) for c in candidates}
    return [
        f"beat {sel.get('beat_id')} is not one of the candidates in this part — "
        "choose only from the beats listed below"
        for sel in (doc.get("selections") or [])
        if str(sel.get("beat_id")) not in mine
    ]
