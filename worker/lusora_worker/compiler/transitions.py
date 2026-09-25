"""Transition placement (D95): the style pack declares a mix, this places it.

Every junction in the visual track gets its transition from the first rule
that fires:

  1. human     — a beat's own `transition_out` (D89), on the beat's last shot.
                 Written by `_visual_item`; nothing here overrides it.
  2. section   — `transitions.section_break`, where the mood span changes.
  3. filler    — kinds from `transitions.mix` in proportion to their weights,
                 until `animated_share` of the junctions are not cuts.
  4. default   — `transitions.default`, already on every other item.

Arithmetic only, like the rest of the compiler: no model chooses a transition
(D89), and the same beats compile to the same plan. A pack that sets none of
the D95 fields leaves the track exactly as `_visual_item` wrote it, so a
snapshot taken before this existed re-runs byte-identically (Principle 7).
"""

from __future__ import annotations

from typing import Any, Callable

from . import sound

# How far a section boundary may sit from the junction it lands on. Mood spans
# are built from beat times and junctions are beat boundaries snapped by
# `_make_contiguous` (which tolerates 0.75 s), so a real boundary is always
# closer than this; anything further is not the same moment.
_SECTION_SNAP_S = 1.0

# Footage a filler transition must leave spare on BOTH sides, above its own
# length. `_fit_transitions` would trim a tighter one down, and filler is the
# one kind of transition nobody asked for at that particular junction — so it
# goes where it fits whole, rather than being placed and then shaved.
_FILLER_MARGIN_S = 0.15


def pack_problems(transitions: dict[str, Any]) -> list[str]:
    """What is wrong with a style pack's transitions block, beyond the schema.

    Cross-field rules, shared with the platform's `transitionPackProblems`
    through contracts/fixtures/rules/transition_rules.json (`pack_cases`).
    """
    allowed = [str(k) for k in transitions.get("allowed") or []]
    problems: list[str] = []
    default = str(transitions.get("default", "cut"))
    if allowed and default not in allowed:
        problems.append(f"default transition '{default}' is not in allowed {allowed}")
    mix = transitions.get("mix") or {}
    if transitions.get("animated_share") and not mix:
        problems.append("animated_share needs a mix to fill it — name at least one kind in transitions.mix")
    for kind in mix:
        if kind not in allowed:
            problems.append(f"transitions.mix names '{kind}', which is not in allowed {allowed}")
    section = transitions.get("section_break")
    if section and section not in allowed:
        problems.append(f"transitions.section_break '{section}' is not in allowed {allowed}")
    for kind in transitions.get("durations") or {}:
        if kind not in allowed:
            problems.append(f"transitions.durations names '{kind}', which is not in allowed {allowed}")
    return problems


def place_transitions(
    visual: list[dict[str, Any]],
    beats_by_id: dict[str, dict[str, Any]],
    beat_times: list[tuple[float, float, str]],
    style: dict[str, Any],
    on_note: Callable[[str], None] | None = None,
) -> None:
    """Rewrite `transition_out` on the visual track, in place (rules 2-3).

    Runs before `_fit_transitions`, which then trims whatever this placed
    against both neighbours exactly as it trims a human's choice.
    """
    transitions = style.get("transitions") or {}
    share = float(transitions.get("animated_share") or 0)
    mix = {str(k): float(v) for k, v in (transitions.get("mix") or {}).items() if float(v) > 0}
    section = transitions.get("section_break")
    durations = {str(k): float(v) for k, v in (transitions.get("durations") or {}).items()}
    base_s = float(transitions.get("duration_s", 0.5))
    junctions = len(visual) - 1
    if junctions < 1:
        return

    def length(kind: str) -> float:
        return durations.get(kind, base_s)

    # rule 1: a junction a human chose is settled before anything is placed
    fixed = {
        i for i in range(junctions)
        if _beat_final(visual, i)
        and (beats_by_id.get(str(visual[i].get("beat_id"))) or {}).get("transition_out")
    }

    # rule 2: section breaks, where the music's mood span changes
    sections = 0
    if section:
        min_span = float((style.get("music") or {}).get("min_span_s", 20))
        for start, _end, _mood in sound.mood_spans(beat_times, min_span)[1:]:
            i = _nearest_junction(visual, start, fixed)
            if i is None:
                continue
            visual[i]["transition_out"] = {
                "type": str(section), "duration_s": length(str(section)), "placed_by": "section_break",
            }
            fixed.add(i)
            sections += 1

    # rule 3: filler, spread evenly over the beat-final junctions still open
    if share > 0 and mix:
        target = round(share * junctions)
        remaining = target - sum(1 for i in range(junctions) if _animated(visual, i))
        eligible = [
            i for i in range(junctions)
            if i not in fixed and _beat_final(visual, i) and not _animated(visual, i)
        ]
        if remaining > 0 and eligible:
            # Error diffusion: each eligible junction owes a fraction of a
            # transition, and one is placed when a whole one is owed. A junction
            # that cannot take it (a neighbour already animated, shots too
            # short) passes the debt on, so the count is still met and stays
            # evenly spread instead of bunching where the shots happen to be long.
            step = remaining / len(eligible)
            owed = 0.0
            picker = _WeightedRoundRobin(mix)
            for i in eligible:
                if remaining <= 0:
                    break
                owed += step
                if owed < 1 - 1e-9:
                    continue
                if _animated(visual, i - 1) or _animated(visual, i + 1):
                    continue
                kind = picker.peek()
                if _room(visual, i) < length(kind) + _FILLER_MARGIN_S:
                    continue
                picker.take()
                visual[i]["transition_out"] = {"type": kind, "duration_s": length(kind), "placed_by": "filler"}
                owed -= 1
                remaining -= 1

    # per-kind lengths apply to every transition of that kind, whoever chose it
    if durations:
        for item in visual:
            transition = item.get("transition_out") or {}
            kind = transition.get("type")
            if kind in durations:
                item["transition_out"] = {**transition, "duration_s": durations[kind]}

    if on_note and (share > 0 or section):
        animated = sum(1 for i in range(junctions) if _animated(visual, i))
        asked = f"; the pack asks {share:.0%}" if share > 0 else ""
        on_note(
            f"transitions: {animated} of {junctions} junctions animated "
            f"({animated / junctions:.0%}{asked}), {sections} at section breaks"
        )


def _beat_final(visual: list[dict[str, Any]], i: int) -> bool:
    """Whether junction i ends a beat rather than splitting one.

    A beat too long for one hold is several shots of one thought; the cuts
    between them stay the default (D89), so only a beat's LAST shot is a place
    a section break or filler may go.
    """
    return i + 1 >= len(visual) or visual[i + 1].get("beat_id") != visual[i].get("beat_id")


def _animated(visual: list[dict[str, Any]], i: int) -> bool:
    """Whether junction i (the end of item i) is anything but a cut."""
    if i < 0 or i >= len(visual) - 1:
        return False
    return ((visual[i].get("transition_out") or {}).get("type") or "cut") != "cut"


def _room(visual: list[dict[str, Any]], i: int) -> float:
    """The longest transition junction i could hold, by the same rule as `_fit_transitions`."""
    here = float(visual[i]["end_s"]) - float(visual[i]["start_s"])
    nxt = float(visual[i + 1]["end_s"]) - float(visual[i + 1]["start_s"])
    return min(here, nxt) - 0.05


def _nearest_junction(visual: list[dict[str, Any]], at_s: float, fixed: set[int]) -> int | None:
    """The beat-final junction closest to `at_s`, if one is close enough and free."""
    best: int | None = None
    best_gap = _SECTION_SNAP_S
    for i in range(len(visual) - 1):
        if not _beat_final(visual, i):
            continue
        gap = abs(float(visual[i]["end_s"]) - at_s)
        if gap <= best_gap:
            best, best_gap = i, gap
    if best is None or best in fixed:
        return None
    return best


class _WeightedRoundRobin:
    """Kinds in proportion to their weights, interleaved, with no randomness.

    Smooth weighted round-robin (the nginx upstream scheme): every turn each
    kind gains its weight, the leader is chosen and pays back the total. Over
    any stretch the counts track the weights to within one, and the heavy kind
    is spread out rather than run together — {crossfade: 2, fade: 1} is
    X F X X F X ..., never six crossfades and then a fade.

    Chosen over hashing each shot's id because a video places only ~10-40
    filler transitions: a hash samples that few so noisily that a 1:1 mix came
    out 10:19 and a 2:1 mix ran six of one kind together. The locality a hash
    would buy was never real either — error diffusion already moves later
    filler when an earlier junction changes.
    """

    def __init__(self, weights: dict[str, float]) -> None:
        self._weights = dict(weights)
        self._total = sum(weights.values())
        self._current = {k: 0.0 for k in weights}

    def _advanced(self) -> tuple[str, dict[str, float]]:
        current = {k: self._current[k] + w for k, w in self._weights.items()}
        # ties go to the kind listed first, so the pack's own order decides them
        leader = max(current, key=lambda k: (current[k], -list(self._weights).index(k)))
        return leader, current

    def peek(self) -> str:
        return self._advanced()[0]

    def take(self) -> str:
        leader, current = self._advanced()
        current[leader] -= self._total
        self._current = current
        return leader
