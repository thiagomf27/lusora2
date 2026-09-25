"""Transition placement (D95): the pack declares a mix, the compiler places it."""

import copy
import json

import pytest

import lusora_contracts
from lusora_worker.compiler import compile_plan
from lusora_worker.compiler.core import CompileError
from lusora_worker.compiler.transitions import pack_problems

HOLD = 4.0
BEATS = 60  # 59 junctions


def _word(n: int) -> str:
    # letters only: a digit would go through the number-matching path of alignment
    return "".join(chr(ord("a") + int(d)) for d in str(n))


def _mood(n: int) -> str:
    # three 80 s mood spans, far above the 20 s music floor: breaks after b20 and b40
    return ["neutral", "tense", "somber"][(n - 1) // 20]


def _sheet(overrides: dict[int, dict] | None = None):
    overrides = overrides or {}
    beats, timings = [], []
    for n in range(1, BEATS + 1):
        text = f"Scene {_word(n)}."
        beats.append({"id": f"b{n}", "kind": "narration", "script_text": text,
                      "visual_intent": "harbour", "mood": _mood(n), **overrides.get(n, {})})
        timings.append({"text": text, "start_s": (n - 1) * HOLD, "end_s": n * HOLD})
    return {"version": "1.0", "video_id": "vid_t", "beats": beats}, timings


def _cfg(**transitions):
    return {
        "captions": {"enabled": True},
        "output": {"fps": 30, "width": 1280, "height": 720},
        "style_pack_doc": {
            "name": "test",
            "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0},
            "overlays": {"density": "normal"},
            "transitions": {"allowed": ["cut", "crossfade", "fade", "fade_to_black"],
                            "default": "cut", **transitions},
        },
        "theme_doc": {"typography": {"caption_preset": "plain"}},
    }


def _compile(cfg, overrides=None, notes=None):
    doc, timings = _sheet(overrides)
    return compile_plan(doc, timings, cfg, BEATS * HOLD, on_note=notes.append if notes is not None else None)


def _kinds(plan):
    visual = plan["tracks"]["visual"]
    return [(v.get("transition_out") or {}).get("type", "cut") for v in visual[:-1]]


def test_a_pack_without_d95_fields_compiles_exactly_as_before():
    plain = _compile(_cfg())
    # a mix with no share is inert: nothing reads it
    assert _compile(_cfg(mix={"crossfade": 1})) == plain
    assert set(_kinds(plain)) == {"cut"}


def test_the_share_is_met_evenly_and_never_side_by_side():
    kinds = _kinds(_compile(_cfg(animated_share=0.3, mix={"crossfade": 1})))
    animated = [i for i, k in enumerate(kinds) if k != "cut"]
    assert abs(len(animated) - round(0.3 * 59)) <= 1
    assert all(b - a > 1 for a, b in zip(animated, animated[1:]))
    # spread, not bunched: no stretch of the video longer than ~2.5x the mean gap is bare
    gaps = [b - a for a, b in zip([-1, *animated], [*animated, 59])]
    assert max(gaps) <= 2.5 * (60 / len(animated))


def test_section_breaks_land_where_the_mood_span_changes():
    plan = _compile(_cfg(section_break="fade_to_black", durations={"fade_to_black": 0.8}))
    kinds = _kinds(plan)
    assert [i for i, k in enumerate(kinds) if k != "cut"] == [19, 39]
    assert kinds[19] == kinds[39] == "fade_to_black"
    assert plan["tracks"]["visual"][19]["transition_out"]["duration_s"] == 0.8
    assert plan["tracks"]["visual"][19]["transition_out"]["placed_by"] == "section_break"


def test_section_breaks_count_toward_the_share():
    with_sections = _kinds(_compile(_cfg(animated_share=0.3, mix={"crossfade": 1},
                                         section_break="fade_to_black")))
    assert with_sections[19] == with_sections[39] == "fade_to_black"
    assert abs(sum(k != "cut" for k in with_sections) - round(0.3 * 59)) <= 1


def test_a_human_choice_wins_over_every_rule():
    # b20 is where the first section break would go; b5 would otherwise take filler
    overrides = {20: {"transition_out": "crossfade"}, 5: {"transition_out": "cut"}}
    kinds = _kinds(_compile(_cfg(animated_share=0.6, mix={"fade": 1},
                                 section_break="fade_to_black"), overrides))
    assert kinds[19] == "crossfade"
    assert kinds[4] == "cut"
    visual = _compile(_cfg(animated_share=0.6, mix={"fade": 1}, section_break="fade_to_black"),
                      overrides)["tracks"]["visual"]
    assert "placed_by" not in visual[19]["transition_out"], "a human's choice is not the compiler's"


def test_a_mix_follows_its_weights_and_interleaves():
    for weights in ({"crossfade": 1, "fade": 1}, {"crossfade": 2, "fade": 1}, {"crossfade": 3, "fade": 1}):
        kinds = _kinds(_compile(_cfg(animated_share=0.5, mix=weights)))
        animated = [k for k in kinds if k != "cut"]
        share = weights["crossfade"] / sum(weights.values())
        assert abs(animated.count("crossfade") - share * len(animated)) <= 1, weights
        # the heavy kind never runs longer than its weight
        run = longest = 0
        for k in animated:
            run = run + 1 if k == "crossfade" else 0
            longest = max(longest, run)
        assert longest <= weights["crossfade"], weights


def test_the_same_beats_compile_to_the_same_transitions():
    cfg = _cfg(animated_share=0.3, mix={"crossfade": 2, "fade_to_black": 1}, section_break="fade")
    assert _compile(cfg) == _compile(copy.deepcopy(cfg))


def test_filler_never_goes_where_the_shots_cannot_hold_it():
    doc, timings = _sheet()
    short = 0.6  # 0.55 s of room: under a 0.5 s crossfade plus the 0.15 s margin
    for n, t in enumerate(timings):
        t["start_s"], t["end_s"] = n * short, (n + 1) * short
    cfg = _cfg(animated_share=0.3, mix={"crossfade": 1})
    cfg["style_pack_doc"]["pacing"] = {"avg_hold_seconds": 0.6, "min_hold": 0.5, "max_hold": 6.0}
    plan = compile_plan(doc, timings, cfg, BEATS * short)
    assert set(_kinds(plan)) == {"cut"}


def test_the_compile_note_says_what_the_share_delivered():
    notes: list[str] = []
    _compile(_cfg(animated_share=0.3, mix={"crossfade": 1}), notes=notes)
    assert any(n.startswith("transitions: ") and "the pack asks 30%" in n for n in notes)


def test_a_share_with_no_mix_refuses_to_compile():
    with pytest.raises(CompileError, match="animated_share needs a mix"):
        _compile(_cfg(animated_share=0.3))


def test_the_shared_pack_rules_hold_on_the_python_side():
    """contracts/fixtures/rules/transition_rules.json `pack_cases`, the twin of
    platform/test/transitionRules.test.ts."""
    table = json.loads(
        (lusora_contracts.CONTRACTS_ROOT / "fixtures" / "rules" / "transition_rules.json").read_text()
    )
    for case in table["pack_cases"]:
        problems = pack_problems(case["transitions"])
        if not case["expect"]:
            assert problems == [], case["name"]
        for needle in case["expect"]:
            assert any(needle in p for p in problems), f"{case['name']}: {problems}"
