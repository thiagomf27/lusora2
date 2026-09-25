"""The directed-edit block, judged against the script it decorates.

docs/05-roadmap/directed-edit-test.md. A Claude web pass writes the
high-judgment edit decisions for a locked script — sections and their mood,
overlays attached to verbatim phrases, the key shots — and the block is pasted
under the script. It is a HUMAN-PROVIDED artifact, like an uploaded beats.json:
nothing here calls a model, and nothing here repairs. A phrase that does not
match fails loudly, so the fix goes back to the author rather than being guessed.

Everything is checked that can be checked before any money is spent. The rules
are the ones `validate_beat_sheet` applies to a beat's overlay, reused rather
than restated, plus the ones only a phrase-addressed block needs: every phrase
found exactly once, no two pins sharing words, sections in order.

`platform/src/lib/editHints.ts` mirrors this for the paste box, and both assert
`contracts/fixtures/rules/edit_hints_rules.json`. Two checks exist only here,
because they need Python-side tables the platform does not carry: a number
anchor's value against the number runs actually spoken (textmatch), and a place
against the gazetteer. The table marks those cases `worker_only`.
"""

from __future__ import annotations

import math
from typing import Any

import lusora_contracts

from .compiler import geo
from .compiler.textmatch import compare_key, number_run, tokenize
from .validators import (
    _schema_errors,
    check_prop_value,
    emphasis_policy,
    max_overlays_for,
    overlays_per_minute,
)

# Narration speed used to estimate time from words before any audio exists.
# Measured on the descoberta voice (vid_bb05c1b483eb, vid_05544aeb5c28); a
# per-voice setting replaces it later.
DEFAULT_WPM = 142.0

# A phrase longer than this still works — longer is more likely to be unique —
# but it is past what the edit-pass prompt asks for, so it is worth a word.
LONG_PHRASE_WORDS = 8

# The prompt asks for at most this share of the estimated budget, because the
# real narration may run faster than the estimate and the worker re-checks with
# the real duration.
SAFE_BUDGET_SHARE = 0.9


# ---------------- phrases ----------------


def _keyed(script: str) -> tuple[list[str], list[str], list[int]]:
    """(whitespace words, comparison keys, owning word index per key).

    Keys come from the compiler's own `tokenize` + `compare_key`, so a phrase
    matches here exactly when the compiler would call the two the same words:
    case, diacritics and punctuation folded, dashes split, `Dr.` = `doutor`.
    """
    words = script.split()
    keys: list[str] = []
    owner: list[int] = []
    for index, word in enumerate(words):
        for token in tokenize(word):
            keys.append(compare_key(token))
            owner.append(index)
    return words, keys, owner


def _phrase_keys(phrase: str) -> list[str]:
    return [compare_key(t) for t in tokenize(phrase)]


def locate_phrase(script: str, phrase: str) -> list[tuple[int, int]]:
    """Every place `phrase` occurs, as inclusive whitespace-word ranges.

    Word ranges, not character offsets, because every span `cut_beats` makes is
    a run of whole whitespace-words — so a pin maps straight onto the pieces.
    """
    _words, keys, owner = _keyed(script)
    wanted = _phrase_keys(phrase)
    if not wanted:
        return []
    n = len(wanted)
    return [
        (owner[i], owner[i + n - 1])
        for i in range(len(keys) - n + 1)
        if keys[i:i + n] == wanted
    ]


def script_span(script: str, span: tuple[int, int]) -> str:
    """The script's OWN words for a located range. This, not the author's
    copy, is what becomes an anchor's source_words."""
    words = script.split()
    return " ".join(words[span[0]:span[1] + 1])


def _closest(script: str, phrase: str) -> str:
    """The script's words where the longest leading run of `phrase` matches,
    so a not-found message shows what the script actually says."""
    words, keys, owner = _keyed(script)
    wanted = _phrase_keys(phrase)
    for k in range(len(wanted) - 1, 1, -1):
        for i in range(len(keys) - k + 1):
            if keys[i:i + k] == wanted[:k]:
                start = owner[i]
                return " ".join(words[start:start + len(phrase.split())])
    return ""


def _short(text: str) -> str:
    return text if len(text) <= 50 else text[:47] + "…"


def _locate_one(script: str, phrase: str, where: str, errors: list[str]) -> tuple[int, int] | None:
    """The single range `phrase` occupies, or None with the reason recorded."""
    if not _phrase_keys(phrase):
        errors.append(f"{where}: has no words to match")
        return None
    hits = locate_phrase(script, phrase)
    if len(hits) == 1:
        return hits[0]
    if not hits:
        closest = _closest(script, phrase)
        hint = f'; the script says "{closest}"' if closest else ""
        errors.append(f"{where}: not in the script — copy the words exactly{hint}")
    else:
        errors.append(
            f"{where}: appears {len(hits)} times in the script — add words until it appears once"
        )
    return None


# ---------------- the block ----------------


def validate_edit_hints(
    hints: dict[str, Any],
    script: str,
    cfg: dict[str, Any],
    *,
    duration_s: float | None = None,
    wpm: float = DEFAULT_WPM,
) -> tuple[list[str], list[str]]:
    """(errors, warnings) for an edit block against its script.

    `cfg` carries the video's resolved `style_pack_doc` — the same snapshot the
    worker validates beats against, so `allowed_components` is already narrowed
    by the channel's component pack and exclusions. `duration_s` is the real
    narration length when there is one; before narration it is estimated from
    the word count at `wpm`.

    Errors are what would fail the video; warnings are what the author should
    see and may accept.
    """
    errors = _schema_errors("edit_hints", hints)
    if errors:
        return errors, []  # structure first; everything below assumes the shape
    warnings: list[str] = []

    style = cfg.get("style_pack_doc") or {}
    words = script.split()
    seconds_per_word = 60.0 / wpm
    if duration_s is None:
        duration_s = len(words) * seconds_per_word

    expected_pack = style.get("name")
    if expected_pack and hints["style_pack"] != expected_pack:
        errors.append(
            f'style_pack is "{hints["style_pack"]}" but this video uses "{expected_pack}" — '
            f'generate the edit pass for "{expected_pack}"'
        )

    _check_sections(hints["sections"], script, style, seconds_per_word, errors, warnings)

    located: list[tuple[int, tuple[int, int], dict[str, Any]]] = []
    for n, pin in enumerate(hints["pins"], start=1):
        where = f'pin {n} ("{_short(pin["at"])}")'
        span = _locate_one(script, pin["at"], where, errors)
        if span is not None:
            located.append((n, span, pin))
            if len(pin["at"].split()) > LONG_PHRASE_WORDS:
                warnings.append(
                    f"{where}: {len(pin['at'].split())} words — longer than {LONG_PHRASE_WORDS} "
                    "words; fine if it is needed to be unique"
                )
        _check_pin_shape(pin, where, errors)
        _check_pin_overlay(pin, where, style, errors, warnings, script, span)

    located.sort(key=lambda item: item[1][0])
    for (a, span_a, _pa), (b, span_b, _pb) in zip(located, located[1:]):
        if span_b[0] <= span_a[1]:
            errors.append(
                f"pin {a} and pin {b} share words — two pins cannot cover the same words"
            )

    _check_budgets(hints["pins"], style, duration_s, errors, warnings)
    _check_crowding(located, seconds_per_word, warnings)
    return errors, warnings


def _check_sections(
    sections: list[dict[str, Any]],
    script: str,
    style: dict[str, Any],
    seconds_per_word: float,
    errors: list[str],
    warnings: list[str],
) -> None:
    starts: list[tuple[int, int]] = []
    for n, section in enumerate(sections, start=1):
        where = f'section {n} ("{_short(section["from"])}")'
        span = _locate_one(script, section["from"], where, errors)
        if span is None:
            continue
        if n == 1 and span[0] != 0:
            opening = " ".join(script.split()[:6])
            errors.append(f'section 1 must start at the script\'s first words ("{opening}")')
        if starts and span[0] <= starts[-1][1]:
            errors.append(f"{where}: starts before section {starts[-1][0]} — list sections in script order")
        starts.append((n, span[0]))

    min_span = float(((style.get("music") or {}).get("min_span_s")) or 0)
    if not min_span:
        return
    total = len(script.split())
    bounds = [s for _n, s in starts] + [total]
    for (n, start), end in zip(starts, bounds[1:]):
        seconds = (end - start) * seconds_per_word
        if seconds < min_span:
            warnings.append(
                f"section {n} is ~{seconds:.0f}s long, shorter than the music's minimum span "
                f"({min_span:g}s) — its mood will be absorbed by its neighbours"
            )


def _check_pin_shape(pin: dict[str, Any], where: str, errors: list[str]) -> None:
    """What the schema cannot say in a sentence the author can act on."""
    if not pin.get("overlay") and not pin.get("visual_intent"):
        errors.append(f"{where}: needs an overlay, a visual_intent, or both")
    if pin.get("anchor") and not pin.get("overlay"):
        errors.append(f"{where}: an anchor needs an overlay to show it")
    if pin.get("queries") and not pin.get("visual_intent"):
        errors.append(f"{where}: queries need a visual_intent beside them")
    for i, query in enumerate(pin.get("queries") or []):
        count = len(str(query).split())
        if not 1 <= count <= 5:
            errors.append(
                f'{where}: queries[{i}] "{_short(str(query))}" is {count} words — a keyword '
                "query is 2-4 words, never more than 5"
            )


def _check_pin_overlay(
    pin: dict[str, Any],
    where: str,
    style: dict[str, Any],
    errors: list[str],
    warnings: list[str],
    script: str,
    span: tuple[int, int] | None,
) -> None:
    """The overlay rules `validate_beat_sheet` applies, for a pin's overlay."""
    overlay = pin.get("overlay")
    if not overlay:
        return
    name = overlay["component"]
    entry = lusora_contracts.catalog_component(name)
    if entry is None:
        errors.append(f"{where}: component '{name}' is not in the catalog")
        return
    allowed = (style.get("overlays") or {}).get("allowed_components")
    if allowed and name not in allowed:
        errors.append(f"{where}: component '{name}' is not in the style pack's allowed_components {allowed}")

    anchor = pin.get("anchor")
    emphasis_enabled, _ = emphasis_policy(style)
    takes = entry["anchor_types"]
    if not takes:
        # D86: no anchor types means no fact, so this is an emphasis graphic
        # whatever anyone declares — and it takes no anchor.
        if anchor:
            errors.append(f"{where}: '{name}' carries no fact, so it takes no anchor — remove the anchor")
        if not emphasis_enabled:
            errors.append(
                f"{where}: '{name}' is an emphasis graphic, and this style pack does not use "
                "emphasis — choose a component that shows a fact"
            )
    elif not anchor:
        errors.append(f"{where}: '{name}' shows a fact and needs an anchor (types {takes})")
    elif anchor["type"] not in takes:
        errors.append(f"{where}: '{name}' cannot attach to anchor type '{anchor['type']}' — it takes {takes}")

    if anchor and anchor["type"] == "comparison":
        items = anchor.get("value")
        well_formed = (
            isinstance(items, list) and len(items) >= 2 and all(
                isinstance(it, dict) and isinstance(it.get("label"), str)
                and isinstance(it.get("value"), (int, float)) and not isinstance(it.get("value"), bool)
                for it in items
            )
        )
        if not well_formed:
            errors.append(
                f'{where}: a comparison anchor\'s value is a list of {{"label": "…", "value": number}} '
                "objects, one per compared quantity"
            )

    hint = overlay.get("props_hint") or {}
    for prop, value in hint.items():
        spec = entry["props"].get(prop)
        if spec is None:
            errors.append(f"{where}: prop '{prop}' unknown for {name}")
            continue
        err = check_prop_value(spec, prop, value)
        if err:
            errors.append(
                f"{where}: props_hint {err} — props_hint carries concrete values, never the prop schema itself"
            )

    for prop, spec in entry["props"].items():
        if not spec.get("required") or prop in hint or "default" in spec or spec.get("computed"):
            continue
        if anchor and _anchor_supplies(anchor, spec, prop):
            continue
        errors.append(f"{where}: '{name}' needs required prop '{prop}' in props_hint")

    if anchor and span is not None:
        _check_spoken_number(anchor, script_span(script, span), where, errors, warnings)
        _check_place(entry, anchor, hint, name, where, errors)


def _anchor_supplies(anchor: dict[str, Any], spec: dict[str, Any], prop: str) -> bool:
    """Whether the compiler fills this prop from the anchor (`_compile_overlay`):
    a `from_anchor` field, or a `label` copied from the anchor's own label."""
    ref = spec.get("from_anchor")
    if ref:
        field, _, rest = ref.partition("[")
        value = anchor.get(field)
        if not rest:
            return value is not None
        index = int(rest.rstrip("]"))
        return isinstance(value, list) and index < len(value)
    return prop == "label" and bool(anchor.get("label"))


def _check_spoken_number(
    anchor: dict[str, Any], phrase: str, where: str, errors: list[str], warnings: list[str]
) -> None:
    """"Never invent numbers": a number/percentage anchor's value must be one of
    the values the phrase can be read as. Worker-only — it needs textmatch's
    number runs ('oitenta por cento' = 80, '1.200' = 1200)."""
    if anchor["type"] not in ("number", "percentage"):
        return
    value = anchor.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return
    wanted = str(int(value)) if float(value).is_integer() else str(value)
    tokens = tokenize(phrase)
    spoken: set[str] = set()
    i = 0
    while i < len(tokens):
        take, keys = number_run(tokens, i)
        if take:
            spoken |= set(keys)
            i += take
        else:
            i += 1
    if not spoken:
        warnings.append(
            f'{where}: no number found in "{_short(phrase)}" to check the anchor value {wanted} '
            "against — make sure it is the figure the narration says"
        )
    elif wanted not in spoken:
        errors.append(
            f'{where}: anchor value {wanted} is not the number spoken in "{_short(phrase)}" '
            f"(it reads as {', '.join(sorted(spoken))}) — never compute or round a new figure"
        )


def _check_place(
    entry: dict[str, Any], anchor: dict[str, Any], hint: dict[str, Any], name: str, where: str,
    errors: list[str],
) -> None:
    """The compiler geocodes a place (`_compile_overlay`) and stops the video on
    a miss. Worker-only — the gazetteer is Python."""
    if not any(spec.get("computed") == "geocode" for spec in entry["props"].values()):
        return
    place = hint.get("place_name") or anchor.get("value")
    if place and geo.lookup(str(place)) is None:
        errors.append(
            f"{where}: cannot geocode place '{place}' for {name} — add it to the gazetteer "
            "or choose another place"
        )


def _check_budgets(
    pins: list[dict[str, Any]],
    style: dict[str, Any],
    duration_s: float,
    errors: list[str],
    warnings: list[str],
) -> None:
    """The two budgets `validate_beat_sheet` enforces (D59), at the estimated
    duration. The worker re-checks with the real one before any model call."""
    anchor_count = emphasis_count = 0
    for pin in pins:
        entry = lusora_contracts.catalog_component((pin.get("overlay") or {}).get("component", ""))
        if entry is None:
            continue
        if entry["anchor_types"]:
            anchor_count += 1
        else:
            emphasis_count += 1

    minutes = duration_s / 60
    ceiling = max_overlays_for(style, duration_s)
    safe = math.floor(overlays_per_minute(style) * minutes * SAFE_BUDGET_SHARE)
    if anchor_count > ceiling:
        errors.append(
            f"{anchor_count} fact graphics exceed the budget (max {ceiling} for ~{duration_s:.0f}s)"
        )
    elif anchor_count > safe:
        warnings.append(
            f"{anchor_count} fact graphics is above the safe budget of {safe} — if the narration "
            "runs faster than estimated this fails after narration"
        )

    enabled, per_minute = emphasis_policy(style)
    if not enabled:
        return  # an emphasis graphic on this pack is already an error per pin
    max_emphasis = math.ceil(per_minute * minutes) + 1
    safe_emphasis = math.floor(per_minute * minutes * SAFE_BUDGET_SHARE)
    if emphasis_count > max_emphasis:
        errors.append(
            f"{emphasis_count} emphasis graphics exceed the budget (max {max_emphasis} for ~{duration_s:.0f}s)"
        )
    elif emphasis_count > safe_emphasis:
        warnings.append(
            f"{emphasis_count} emphasis graphics is above the safe budget of {safe_emphasis} — if the "
            "narration runs faster than estimated this fails after narration"
        )


def _check_crowding(
    located: list[tuple[int, tuple[int, int], dict[str, Any]]],
    seconds_per_word: float,
    warnings: list[str],
) -> None:
    """A graphic whose next neighbour starts before it is readable.

    Two overlay pins always land on separate beats, and a graphic is on screen
    from its own phrase. So the time it can have is at most the words from its
    phrase to the next graphic's — and the compiler drops an overlay that would
    render below its `duration_hint_s.min` rather than flash it. Estimated at the
    narration speed, so it is a warning: the author may move a pin, or accept it.
    """
    graphics = [(n, span, pin) for n, span, pin in located if pin.get("overlay")]
    for (n, span, pin), (m, next_span, next_pin) in zip(graphics, graphics[1:]):
        entry = lusora_contracts.catalog_component(pin["overlay"]["component"])
        minimum = float(((entry or {}).get("duration_hint_s") or {}).get("min") or 0)
        seconds = (next_span[0] - span[0]) * seconds_per_word
        if minimum and seconds < minimum:
            warnings.append(
                f'pin {n} ("{_short(pin["at"])}"): {pin["overlay"]["component"]} gets ~{seconds:.1f}s '
                f'before pin {m} ("{_short(next_pin["at"])}") starts, and needs {minimum:g}s to be '
                "readable — the compiler would drop it; move one of the two pins, or drop one"
            )


# ---------------- applying the block (slice 4, D94) ----------------


def is_directed(cfg: dict[str, Any]) -> bool:
    """Whether this video runs the directed edit: its pipeline SNAPSHOT lists the
    `edit_hints` stage. Read from the snapshot (Principle 7), the way
    `select_overlays` is detected, so every other pipeline behaves exactly as it
    did — the switch cannot be flipped by a stray file in a folder."""
    stages = ((cfg.get("pipeline_doc") or {}).get("stages")) or []
    return "edit_hints" in [stage.get("name") for stage in stages]


def pin_spans(hints: dict[str, Any], script: str) -> list[dict[str, Any]]:
    """Every pin as a whitespace-word range plus what it asks of the cut.

    `graphic` pins may not share a beat with another graphic; `shot` pins may
    not share one with another shot; an `emphasis` graphic starts its own beat,
    because nothing else can time it (it has no anchor to be spoken). Raises
    when a phrase no longer locates exactly once — the edit_hints stage checked
    that, so reaching here means the script changed underneath the block.
    """
    spans: list[dict[str, Any]] = []
    for n, pin in enumerate(hints.get("pins") or [], start=1):
        hits = locate_phrase(script, pin["at"])
        if len(hits) != 1:
            raise ValueError(f'pin {n} ("{_short(pin["at"])}") locates {len(hits)} times in the script')
        component = (pin.get("overlay") or {}).get("component")
        entry = lusora_contracts.catalog_component(component) if component else None
        spans.append({
            "n": n,
            "start": hits[0][0],
            "end": hits[0][1],
            "graphic": bool(component),
            "emphasis": bool(entry is not None and not entry["anchor_types"]),
            "shot": bool(pin.get("visual_intent")),
            "pin": pin,
        })
    return sorted(spans, key=lambda s: s["start"])


def _beat_ranges(beats: list[dict[str, Any]], script: str) -> list[tuple[int, int]]:
    """The whitespace-word range of every narration beat, in order.

    Beats' `script_text` are runs of whole script words (cut_beats never retypes),
    so cumulative word counts ARE the ranges. Verified rather than assumed: a
    sheet whose words do not add up to the script is refused."""
    ranges: list[tuple[int, int]] = []
    cursor = 0
    for beat in beats:
        count = len(str(beat.get("script_text") or "").split())
        ranges.append((cursor, cursor + count - 1))
        cursor += count
    if cursor != len(script.split()):
        raise ValueError(f"the beats cover {cursor} words and the script has {len(script.split())}")
    return ranges


def apply_edit_hints(beats_doc: dict[str, Any], script: str, hints: dict[str, Any]) -> dict[str, Any]:
    """Write the block onto a beat sheet. Pure; the caller validates the result.

    - Every overlay the planner may have written is DROPPED first: the block is
      the whole overlay decision, and DeepSeek fills no unused budget (D94).
    - A graphic pin: its anchor is appended to the beat's anchors with the
      SCRIPT's own words as source_words, and the overlay references it. The
      role is the catalog's (D86), written out so the sheet reads plainly.
    - A shot pin: its visual_intent (and queries, or none — the planner's
      queries described another shot) replace the planner's, as video.
    - Every narration beat takes the mood of the section holding most of its
      words (the first section on a tie).

    Raises ValueError when a pin straddles two beats or two graphics land in one
    beat — cut_beats makes both impossible, so either means a bug upstream.
    """
    doc = {**beats_doc, "beats": [dict(b) for b in beats_doc.get("beats") or []]}
    narration = [b for b in doc["beats"] if b.get("kind") == "narration"]
    ranges = _beat_ranges(narration, script)
    for beat in doc["beats"]:
        beat.pop("overlay", None)

    def beat_holding(span: dict[str, Any]) -> dict[str, Any]:
        for beat, (lo, hi) in zip(narration, ranges):
            if lo <= span["start"] <= hi:
                if span["end"] > hi:
                    raise ValueError(f"pin {span['n']} straddles beats {beat.get('id')} and the next")
                return beat
        raise ValueError(f"pin {span['n']} lies outside every beat")

    for span in pin_spans(hints, script):
        beat = beat_holding(span)
        pin = span["pin"]
        if span["graphic"]:
            if beat.get("overlay"):
                raise ValueError(f"pin {span['n']} lands on beat {beat.get('id')}, which already has a graphic")
            overlay: dict[str, Any] = {
                "component": pin["overlay"]["component"],
                "role": "emphasis" if span["emphasis"] else "anchor",
            }
            if pin.get("anchor"):
                anchor = {k: v for k, v in pin["anchor"].items() if k in ("type", "value", "label")}
                anchor["source_words"] = script_span(script, (span["start"], span["end"]))
                beat["anchors"] = [*(beat.get("anchors") or []), anchor]
                overlay["anchor_ref"] = len(beat["anchors"]) - 1
            if pin["overlay"].get("props_hint"):
                overlay["props_hint"] = pin["overlay"]["props_hint"]
            beat["overlay"] = overlay
        if span["shot"]:
            beat["visual_intent"] = pin["visual_intent"]
            if pin.get("queries"):
                beat["queries"] = list(pin["queries"])
            else:
                beat.pop("queries", None)
            beat["media_preference"] = "video"

    starts: list[tuple[int, str]] = []
    for section in hints.get("sections") or []:
        hits = locate_phrase(script, section["from"])
        if len(hits) != 1:
            raise ValueError(f'section "{_short(section["from"])}" locates {len(hits)} times in the script')
        starts.append((hits[0][0], section["mood"]))
    starts.sort()
    if starts:
        bounds = [s for s, _m in starts] + [len(script.split())]
        for beat, (lo, hi) in zip(narration, ranges):
            best, best_words = starts[0][1], -1
            for (start, mood), end in zip(starts, bounds[1:]):
                words = max(0, min(hi + 1, end) - max(lo, start))
                if words > best_words:
                    best, best_words = mood, words
            beat["mood"] = best
    return doc
