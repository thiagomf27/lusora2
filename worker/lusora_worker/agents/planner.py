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

Long scripts are planned in CHUNKS (one call per
`planner.chunk_target_beats` beats): each call sees the full script for
context but is told to emit beats for one contiguous, sentence-aligned
slice only, carrying the last beats of the previous chunk forward for
visual/mood continuity. Short videos stay a single call — the prompt for
that path is unchanged.

Where the chunks are CUT is decided by a cheap spine pass first (D52):
one call over the whole script returning section boundaries as sentence
INDICES plus a one-line summary each, so sections land on the story's
joints rather than on even word counts. Code checks the indices (first is
0, strictly increasing, in range) and splits any section still too long;
anything wrong with the spine degrades to the deterministic word-balanced
split rather than failing the video.
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
# phase 1 of the same agent on a long script (D52), with its own prompt role
SPINE_ROLE = "spine"
MAX_ATTEMPTS = 3

# A single call comfortably handles ~20-30 beats (existing calls cost
# 4-9k tokens in that range per the max_tokens comment below); above this,
# split into sentence-aligned chunks rather than risk truncation or
# degraded quality on one huge call. Config, not a constant (Principle 4):
# channel_config.planner.chunk_target_beats, schema default 30.
DEFAULT_CHUNK_TARGET_BEATS = 30

CARRY_FORWARD_BEATS = 2

# How many earlier visual intents the next section is shown. Enough to stop it
# opening on the same aerial shot for the fourth time; short enough that the
# ledger does not become the largest thing in the prompt.
LEDGER_ENTRIES = 12

# The spine returns one short line per section, so its whole answer is a few
# hundred tokens however long the script is.
SPINE_MAX_TOKENS = 4000


# The prop keys worth showing a model, in the order they are rendered.
# `description` is last because it is the long one, and it is included at all
# because it is the authoring craft the entry already carries: "omit the label
# when the narration names the figure in the same breath" is exactly the
# judgement the menu exists to transfer, and deleting it at the door left the
# model a type signature to guess against.
_PROP_KEYS = ("type", "enum", "required", "min", "max", "maxWords", "description")

# Never shown, in any mode. The catalog's `emphasis` prop is a VISUAL weight
# (accent / neutral) and the beat sheet's `emphasis` is an overlay CLASS (D59);
# putting both words in one prompt asks the model to hold two meanings for one
# key. It is a theme's decision either way, so the planner never needed it.
_HIDDEN_PROPS = frozenset({"emphasis"})


def _catalog_menu(allowed: list[str] | None, *, props: bool = False) -> str:
    """The component menu, in one of two sizes.

    SELECTION (`props=False`, the planner's) answers only "which component,
    and when not". It carries no prop schemas at all: choosing the component is
    the judgement, and the compiler fills props from the anchor and the theme's
    defaults, so a schema the model reads is a schema the model then feels
    obliged to fill. On the full catalog this is the difference between roughly
    7k tokens and 2k, on every call.

    AUTHORING (`props=True`) is for the surfaces that really do write props —
    the editor chat, the prompt preview — and it pays for the schemas with the
    prop DESCRIPTIONS beside them, which is the half worth having.

    Both are rendered from one function so the two cannot drift; the platform
    mirrors it, and `contracts/fixtures/component_menu.txt` is the golden file
    that makes drift a CI failure rather than a discovery in a prompt.
    """
    lines = []
    # Sorted by name, explicitly, in BOTH languages. The two catalog loaders
    # order the merge differently — Python appends the data packs after core,
    # the platform interleaves them — and an order that depends on which loader
    # composed the prompt is an order that cannot be pinned. Caught by the
    # golden file the first time it existed, which is the whole argument for it.
    for entry in sorted(lusora_contracts.load_catalog()["components"], key=lambda e: e["name"]):
        if allowed and entry["name"] not in allowed:
            continue
        anchors = "/".join(entry["anchor_types"]) or "none — pure text allowed"
        # what a choice costs in screen time. The model is being asked to spend
        # a budget it could not previously see the prices for.
        hold = (entry.get("duration_hint_s") or {}).get("default")
        head = f"- {entry['name']} (anchor types: {anchors}"
        head += f"; holds ~{hold:g}s)" if hold else ")"
        block = [
            head,
            f"  when to use: {entry['when_to_use']}",
            f"  when NOT to use: {entry['when_not_to_use']}",
        ]
        if props:
            hints = {
                name: {k: spec[k] for k in _PROP_KEYS if k in spec}
                for name, spec in entry["props"].items()
                if not spec.get("from_anchor")
                and not spec.get("computed")
                and name not in _HIDDEN_PROPS
            }
            # compact separators and ensure_ascii=False so this is byte-identical to
            # the platform's JSON.stringify — the golden file compares the two
            block.append(
                "  props you may hint: "
                + json.dumps(hints, ensure_ascii=False, separators=(",", ":"))
            )
        lines.append("\n".join(block))
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


def _sections_from_starts(sentences: list[str], starts: list[int]) -> list[list[str]]:
    """Cut the sentence list at the given start indices."""
    bounds = list(starts) + [len(sentences)]
    return [sentences[bounds[i] : bounds[i + 1]] for i in range(len(starts))]


def _split_oversized(
    sections: list[list[str]], summaries: list[str], max_words: int
) -> tuple[list[str], list[str]]:
    """Bring every section under `max_words` by splitting it at its own
    sentence boundaries, keeping the summary on each piece.

    The spine chooses where the story turns; it does not get to hand one call a
    section twice the size a call can plan. Deterministic post-processing of an
    LLM artifact, which is the same arrangement everywhere else: the model
    proposes, code decides (D2)."""
    out_text: list[str] = []
    out_summary: list[str] = []
    for section, summary in zip(sections, summaries):
        words = sum(len(s.split()) for s in section)
        pieces = max(1, math.ceil(words / max_words)) if max_words > 0 else 1
        if pieces == 1 or len(section) < 2:
            out_text.append(" ".join(section))
            out_summary.append(summary)
            continue
        for piece in _chunk_script(" ".join(section), min(pieces, len(section))):
            out_text.append(piece)
            out_summary.append(summary)
    return out_text, out_summary


def _spine_sections(
    ctx: StageContext,
    script: str,
    section_count: int,
    chat_fn: llm.ChatFn,
) -> tuple[list[str], list[str], str] | None:
    """One cheap call: where does this story TURN?

    Returns (section texts, one-line summaries, arc) or None to fall back to the
    deterministic word-balanced split. None is the answer for every failure —
    the model refused, the JSON was unparseable, the indices did not describe a
    partition, the budget gate said no — because a spine is an improvement on a
    split that already works, and no video should die for it.

    The model never echoes script text: it returns INDICES into a sentence list
    this code numbered. That is what makes the output checkable by arithmetic
    instead of by string matching, and it keeps the call cheap on a 12-minute
    script."""
    sentences = split_sentences(script)
    if len(sentences) <= section_count:
        return None

    planner_cfg = ctx.cfg.get("planner") or {}
    provider = str(planner_cfg.get("llm") or "deepseek")
    prompt = (ctx.cfg.get("prompts") or {}).get(SPINE_ROLE)
    model = planner_cfg.get("model") or (prompt or {}).get("model_hint")
    system, user = prompt_packs.compose(
        SPINE_ROLE,
        prompt,
        {
            "script": "\n".join(f"{i}. {s}" for i, s in enumerate(sentences)),
            "sentence_count": len(sentences),
            "section_count": section_count,
            "arc": str(((ctx.cfg.get("style_pack_doc") or {}).get("pacing") or {}).get("arc") or ""),
            "content_rules": str(ctx.cfg.get("content_rules") or ""),
        },
    )

    try:
        with budget_gate(
            ctx, stage=STAGE, provider=provider, operation="llm.plan_spine",
            estimated_units=2000, details={"sections": section_count},
            model=model,
        ) as cost:
            result = chat_fn(
                provider, model, system, user,
                int((prompt or {}).get("max_tokens") or SPINE_MAX_TOKENS),
                prompt_packs.temperature(SPINE_ROLE, prompt),
            )
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens})
        doc = llm.extract_json(result.text)
        raw = doc.get("sections") or []
        starts = [int(s["start_sentence"]) for s in raw]
        summaries = [str(s.get("summary") or "").strip() for s in raw]
        arc = str(doc.get("arc") or "").strip()
    except (StageError, ValueError, TypeError, KeyError, json.JSONDecodeError) as e:
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"spine unavailable ({e.__class__.__name__}), cutting sections by word count instead")
        return None

    valid = (
        starts
        and starts[0] == 0
        and all(0 <= a < len(sentences) for a in starts)
        and all(b > a for a, b in zip(starts, starts[1:]))
    )
    if not valid:
        ctx.db.event(ctx.video_id, STAGE, "progress",
                     f"spine returned {starts[:8]}, which is not a partition of "
                     f"{len(sentences)} sentences — cutting sections by word count instead")
        return None

    max_words = max(1, math.ceil(len(script.split()) / section_count * 1.5))
    texts, summaries = _split_oversized(
        _sections_from_starts(sentences, starts), summaries, max_words
    )
    ctx.db.event(ctx.video_id, STAGE, "progress",
                 f"spine cut {len(texts)} sections at the story's joints (asked for {section_count})")
    return texts, summaries, arc


def _format_spine(summaries: list[str], arc: str, current: int) -> str:
    """The whole spine, with THIS section marked — the planner needs to know
    what it is writing towards, not only what it is writing."""
    lines = [f"ARC: {arc}"] if arc else []
    for i, summary in enumerate(summaries):
        mark = "  <- YOUR SECTION" if i == current else ""
        lines.append(f"{i + 1}. {summary}{mark}")
    return "\n".join(lines)


def _format_ledger(beats: list[dict[str, Any]]) -> str:
    """Visual subjects already spent, oldest first, deduplicated.

    Carry-forward answers "what did the last shot look like"; this answers "what
    has this video already shown", which is the question that stops section 5
    from opening on the same aerial as sections 1, 2 and 3."""
    seen: list[str] = []
    for beat in beats:
        intent = " ".join(str(beat.get("visual_intent") or "").split()[:8])
        if intent and intent not in seen:
            seen.append(intent)
    return "\n".join(f"- {intent}" for intent in seen[-LEDGER_ENTRIES:])


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
    spine: str = "",
    visual_ledger: str = "",
) -> tuple[str, str]:
    """The emphasis budget (D59) is read here rather than passed in: it is a
    property of the style pack, the same for every chunk, and empty unless the
    pack enables the class — which is what keeps the composed prompt
    byte-identical for a pack that does not use it."""
    style = ctx.cfg.get("style_pack_doc") or {}
    pacing = style.get("pacing") or {}
    overlays = style.get("overlays") or {}
    allowed = overlays.get("allowed_components")
    # D87: on a pipeline that runs select_overlays, the overlay question is
    # asked in its own call and the planner does not pay for the menu at all —
    # the biggest single item in its prompt, on every chunk. Read from the
    # pipeline SNAPSHOT rather than the file on disk (Principle 7), so a video
    # enqueued before the stage existed composes exactly as it did.
    overlays_are_a_separate_stage = "select_overlays" in [
        stage.get("name")
        for stage in ((ctx.cfg.get("pipeline_doc") or {}).get("stages") or [])
    ]
    avg_hold = float(pacing.get("avg_hold_seconds", 4.0))
    density = overlays.get("density", "normal")
    emphasis_enabled, emphasis_per_minute = validators.emphasis_policy(style)

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
            "component_menu": "" if overlays_are_a_separate_stage else _catalog_menu(allowed),
            "video_id": ctx.video_id,
            "full_script": full_script,
            "carry_forward": carry_forward,
            "chunk_position": chunk_position,
            "coverage_scope": coverage_scope,
            "max_overlays": max_overlays,
            "spine": spine,
            "visual_ledger": visual_ledger,
            "emphasis_per_minute": (
                "" if overlays_are_a_separate_stage
                else (emphasis_per_minute if emphasis_enabled else "")
            ),
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
    spine: str = "",
    visual_ledger: str = "",
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
    # 64k, not 16k: reasoning is billed out of max_tokens and its length is not
    # bounded by the prompt — a run that had been costing 4-9k spent 15.8k
    # thinking and truncated mid-JSON with 16k. The unused budget is free
    # (billing is on actual tokens), so buy headroom rather than track the
    # spread. Verified: the API accepts max_tokens=64000 for deepseek-v4-*.
    max_tokens = int((prompt or {}).get("max_tokens") or 64000)
    # 0.2, from the pack (D85). This call emits strict JSON against a schema a
    # validator is about to reject, so variance is pure loss and a repair loop
    # pays for it twice.
    temperature = prompt_packs.temperature(ROLE, prompt)
    system, base_user = _build_prompt(
        ctx, script, audio_duration_s,
        full_script=full_script, carry_forward=carry_forward,
        chunk_position=chunk_position, coverage_scope=coverage_scope,
        max_overlays=max_overlays, spine=spine, visual_ledger=visual_ledger,
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
            model=model,
        ) as cost:
            # reasoning models spend 4-16k tokens thinking before the JSON starts
            result = chat_fn(provider, model, system, user, max_tokens, temperature)
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "attempt": attempt})
        try:
            doc = llm.extract_json(result.text)
        except (ValueError, json.JSONDecodeError) as e:
            violations = [f"output was not a parseable JSON object: {e}"]
        else:
            doc["video_id"] = ctx.video_id
            doc.setdefault("version", "1.1")
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


def _one_of_each_timed_beat(beats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """At most one cold open and one outro across a chunked video.

    The prompt says "use at most one of each" and each chunk obeys it — but a
    chunk only sees its own section, so a six-section script can return six
    outros, all of them at the example's 900s, and the merged sheet fails on
    overlapping timed spans. The rule is about the VIDEO, so it can only be
    enforced where the video exists.

    A cold open is a timed beat starting at 0; everything else timed is an
    outro. The first cold open wins and the LAST outro wins, which is the
    reading that keeps the strongest closing image rather than the earliest.
    """
    cold = [b for b in beats if b.get("kind") == "timed"
            and float((b.get("timing") or {}).get("start_s", 0)) <= 0.001]
    outro = [b for b in beats if b.get("kind") == "timed" and b not in cold]
    keep = {id(b) for b in (cold[:1] + outro[-1:])}
    return [b for b in beats if b.get("kind") != "timed" or id(b) in keep]


def plan_beats(
    ctx: StageContext,
    script: str,
    audio_duration_s: float,
    chat_fn: llm.ChatFn = llm.chat,
) -> dict[str, Any]:
    style = ctx.cfg.get("style_pack_doc") or {}
    planner_cfg = ctx.cfg.get("planner") or {}
    avg_hold = float((style.get("pacing") or {}).get("avg_hold_seconds", 4.0))
    total_target_beats = max(1, round(audio_duration_s / avg_hold))
    target_per_chunk = max(1, int(planner_cfg.get("chunk_target_beats") or DEFAULT_CHUNK_TARGET_BEATS))
    chunk_count = max(1, math.ceil(total_target_beats / target_per_chunk))

    summaries: list[str] = []
    arc = ""
    spine = None
    if chunk_count > 1 and (planner_cfg.get("spine") or {}).get("enabled", True):
        spine = _spine_sections(ctx, script, chunk_count, chat_fn)
    if spine is not None:
        chunks, summaries, arc = spine
    else:
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
        # The spine and the full script answer the SAME question — "what is the
        # rest of this video doing" — and the spine answers it in a paragraph
        # where the script answers it in the whole script, once per chunk. Where
        # a spine exists it wins and the script is dropped; where the spine call
        # failed or was skipped, the script is still the only context there is.
        spine_text = _format_spine(summaries, arc, i) if chunked and summaries else ""
        doc = _plan_chunk(
            ctx, chunk, chunk_duration, chat_fn,
            full_script=script if chunked and not spine_text else "",
            carry_forward=_format_carry_forward(merged_beats) if chunked else "",
            chunk_position=f"part {i + 1} of {len(chunks)}" if chunked else "",
            coverage_scope=(
                "YOUR SECTION only, which is the SCRIPT section below"
                if chunked else "the ENTIRE script"
            ),
            section_label=f"section {i + 1}/{len(chunks)}" if chunked else "",
            max_overlays=chunk_overlays,
            spine=spine_text,
            visual_ledger=_format_ledger(merged_beats) if chunked else "",
            # unchunked: the one call IS the whole video, so judge it fully here
            validate_duration_s=None if chunked else audio_duration_s,
        )
        for beat in doc["beats"]:
            beat["id"] = f"b{next_id}"
            next_id += 1
            merged_beats.append(beat)

    if chunked:
        merged_beats = _one_of_each_timed_beat(merged_beats)
    merged = {"version": "1.1", "video_id": ctx.video_id, "beats": merged_beats}
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


# ---------------- the golden file ----------------

MENU_FIXTURE = lusora_contracts.CONTRACTS_ROOT / "fixtures" / "component_menu.txt"

MENU_FIXTURE_HEADER = """# Golden file: the component menu, rendered for the shipped catalog.
#
# Two implementations render this text — _catalog_menu() in
# worker/lusora_worker/agents/planner.py and componentMenu() in
# platform/src/lib/catalog.ts — and both assert against this file. It is the
# only robust way to keep two languages in one voice: a menu that drifts is
# discovered here, in CI, rather than in a prompt six weeks later.
#
# Regenerate with:
#   cd worker && uv run python -m lusora_worker.agents.planner --write-menu-fixture
#
# A diff here means the menu every planner call carries has changed. That is
# allowed; it is not allowed to happen by accident.
"""


def render_menu_fixture() -> str:
    """The golden file's exact contents, from the catalog as it stands."""
    return (
        MENU_FIXTURE_HEADER
        + "=== selection ===\n"
        + _catalog_menu(None)
        + "\n=== authoring ===\n"
        + _catalog_menu(None, props=True)
        + "\n"
    )


def split_menu_fixture(text: str) -> tuple[str, str]:
    """(selection, authoring) from the golden file, header discarded."""
    selection, authoring = text.split("=== authoring ===\n")
    return selection.split("=== selection ===\n", 1)[1].rstrip("\n"), authoring.rstrip("\n")


if __name__ == "__main__":  # pragma: no cover - a maintenance command
    import sys

    if "--write-menu-fixture" not in sys.argv:
        raise SystemExit("usage: python -m lusora_worker.agents.planner --write-menu-fixture")
    MENU_FIXTURE.write_text(render_menu_fixture(), encoding="utf-8")
    print(f"wrote {MENU_FIXTURE}")
