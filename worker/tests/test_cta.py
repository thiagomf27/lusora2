"""The subscribe button (D118, Dark Palace's `cta_widget`).

Compiler-placed on the first spoken "subscribe" in any of six languages, with
a pop and a bell pinned to it; off by default, so a pack without the block
compiles byte-identically.
"""

import json
from pathlib import Path

import pytest

import lusora_contracts
from lusora_worker import validators
from lusora_worker.compiler import compile_plan, cta

REPO = Path(__file__).resolve().parents[2]
SYNTH_DOC = json.loads((REPO / "contracts/sound-packs/synth-doc/manifest.json").read_text())

EN = [
    ("In a quiet corner of Pennsylvania, a town burns.", 0.0, 3.0),
    ("If you want the rest of the story, subscribe now.", 3.0, 8.0),
    ("Nobody set out to destroy it.", 8.0, 11.0),
]
PT = [
    ("Uma cidade inteira queima em silêncio.", 0.0, 3.0),
    ("Inscreva-se para ver o resto da história.", 3.0, 7.0),
    ("Ninguém quis destruí-la.", 7.0, 10.0),
]
NONE = [
    ("In a quiet corner of Pennsylvania, a town burns.", 0.0, 3.0),
    ("Steam rises from the ground.", 3.0, 6.0),
]


def compile_with(lines, style_extra, sound_pack=SYNTH_DOC, notes=None):
    beats = [{"id": f"b{n + 1}", "kind": "narration", "script_text": text,
              "visual_intent": "shot", "mood": "somber"} for n, (text, _s, _e) in enumerate(lines)]
    cfg = {"style_pack_doc": {"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10},
                              "overlays": {"density": "normal"},
                              "transitions": {"allowed": ["cut"], "default": "cut"}, **style_extra},
           "output": {"fps": 30, "width": 1920, "height": 1080}}
    if sound_pack is not None:
        cfg["sound_pack_doc"] = sound_pack
        cfg["theme_doc"] = {"sound": {"pack": sound_pack["name"]}}
    timings = [{"text": t, "start_s": s, "end_s": e} for t, s, e in lines]
    doc = {"version": "1.0", "video_id": "v", "beats": beats}
    plan = compile_plan(doc, timings, cfg, lines[-1][2], on_note=(notes.append if notes is not None else None))
    return plan, cfg


def _button(plan):
    return [o for o in plan["tracks"]["overlays"] if o.get("component") == "SubscribeButton"]


def _word_start(lines, needle):
    """The evenly-spread word time `_word_timeline` gives a sentence-timed word."""
    for text, s, e in lines:
        words = text.split()
        for i, w in enumerate(words):
            if needle in w.lower():
                return s + (e - s) * i / len(words)
    raise AssertionError(needle)


ON = {"cta": {"enabled": True}}


def test_a_spoken_subscribe_places_one_button_on_the_word():
    plan, _cfg = compile_with(EN, ON)
    (button,) = _button(plan)
    hit = _word_start(EN, "subscribe")
    assert button["id"] == "o_cta" and button["props"] == {"label": "Subscribe"}
    assert button["start_s"] == pytest.approx(hit - 0.15, abs=0.01)
    assert button["end_s"] == pytest.approx(button["start_s"] + 4, abs=0.01)
    assert button["beat_id"] == "b2"


def test_the_pop_and_the_bell_are_pinned_to_it():
    plan, _cfg = compile_with(EN, ON)
    (button,) = _button(plan)
    mine = [s for s in plan["tracks"]["audio"].get("sfx") or [] if s.get("origin_id") == "o_cta"]
    assert [(s["cue"], round(s["start_s"] - button["start_s"], 2)) for s in mine] == [("pop", 0.05), ("bell", 0.35)]


def test_portuguese_gets_the_portuguese_label():
    plan, _cfg = compile_with(PT, ON)
    assert _button(plan)[0]["props"] == {"label": "Inscreva-se"}


@pytest.mark.parametrize("word, label", [
    ("abonnieren", "Abonnieren"),   # Dark Palace's order read this as French
    ("abonnez-vous", "Abonnez-vous"),
    ("suscríbete", "Suscríbete"),
    ("iscriviti", "Iscriviti"),
])
def test_each_language_gets_its_own_label(word, label):
    found = cta.find_hit([{"word": "hallo", "start_s": 0}, {"word": word, "start_s": 1}])
    assert found is not None and cta.settings({})["labels"][found[1]] == label


def test_only_the_first_ask_gets_a_button():
    lines = [*EN, ("So subscribe, really, subscribe.", 11.0, 14.0)]
    assert len(_button(compile_with(lines, ON)[0])) == 1


def test_a_narration_that_never_asks_gets_nothing():
    plan, _cfg = compile_with(NONE, ON)
    assert _button(plan) == []


def test_a_cue_the_pack_lacks_is_skipped_with_a_note():
    pack = {**SYNTH_DOC, "cues": {k: v for k, v in SYNTH_DOC["cues"].items() if k != "bell"}}
    notes: list[str] = []
    plan, _cfg = compile_with(EN, ON, sound_pack=pack, notes=notes)
    mine = [s["cue"] for s in plan["tracks"]["audio"].get("sfx") or [] if s.get("origin_id") == "o_cta"]
    assert mine == ["pop"]
    assert any("bell cue 'bell' is not in sound pack" in n for n in notes)


def test_a_custom_label_and_hold_are_used():
    plan, _cfg = compile_with(EN, {"cta": {"enabled": True, "hold_s": 2.5, "labels": {"en": "Join us"}}})
    (button,) = _button(plan)
    assert button["props"] == {"label": "Join us"}
    assert button["end_s"] - button["start_s"] == pytest.approx(2.5, abs=0.01)


def test_off_and_absent_compile_byte_identically():
    """Principle 7: a pack without the block, or with it off, is the plan
    every video compiled before slice 13."""
    plain, _ = compile_with(EN, {})
    off, _ = compile_with(EN, {"cta": {"enabled": False}})
    assert json.dumps(plain, sort_keys=True) == json.dumps(off, sort_keys=True)
    assert _button(plain) == []


def test_the_compiled_plan_validates(tmp_path):
    plan, cfg = compile_with(EN, ON)
    assert _button(plan)
    assert validators.validate_plan(plan, tmp_path, cfg, EN[-1][2], require_assets=False) == []


def test_only_cues_of_one_overlay_may_sit_closer_than_the_gap():
    """The pop and the bell are one composed sound; two different overlays'
    cues 0.3 s apart are still the stutter min_gap_s exists to stop."""
    def sfx(*items):
        return {"audio": {"sfx": [{"start_s": t, "cue": "pop", "origin_id": o} for t, o in items]}}

    assert validators._check_sfx_density(sfx((7.0, "o_cta"), (7.3, "o_cta")), {}, 60) == []
    assert validators._check_sfx_density(sfx((7.0, "o_a"), (7.3, "o_b")), {}, 60)
    assert validators._check_sfx_density(sfx((7.0, None), (7.3, None)), {}, 60)


def test_the_button_is_compiler_only():
    entry = lusora_contracts.catalog_component("SubscribeButton")
    assert entry and entry["compiler_only"] is True
