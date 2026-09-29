"""Every number on screen is a number the narration says (D106, slice 5).

Dark Palace's `conferir`: a figure on a chart or counter must be spoken,
within 2%. LUSORA's anchors already come from the script, but `props_hint` is
free text the overlay model writes — timeline labels, chart values, a split's
two sides — and the overlay prompt's own worked example taught it to write
"reopens with 91 dampers" over a sentence that never says 91.
"""

import json

import pytest

from lusora_worker import validators


@pytest.mark.parametrize("narration, hint, missing", [
    ("The company did around 7.3 billion dollars in sales.", {"label": "7.3 bn in sales"}, []),
    ("The company did around 7.3 billion dollars in sales.", {"value": 7300000000}, []),
    ("Seventy percent of the fleet came off the lines.", {"label": "70% of the fleet"}, []),
    ("More than 1,000 people lived here, and now just 5.", {"from": 1000, "to": 5}, []),
    ("It was measured at around 150 feet deep.", {"label": "152 ft"}, []),          # within 2%
    ("It was measured at around 150 feet deep.", {"label": "160 ft"}, [160.0]),
    ("reopened in 2002 after the dampers went in", {"events": [{"date": "2002", "label": "reopens with 91 dampers"}]},
     [91.0]),
    ("A town of miners.", {"decimals": 2, "chapter_number": 3}, []),                   # layout, not facts
])
def test_a_number_on_screen_must_be_spoken(narration, hint, missing):
    assert validators.unspoken_numbers(hint, narration) == missing


def _selection_ctx():
    beats = [
        {"id": "b1", "script_text": "The bridge opened in June 2000.", "anchors": []},
        {"id": "b2", "script_text": "It closed two days later and reopened in 2002 after the dampers went in.",
         "anchors": []},
        {"id": "b3", "script_text": "Engineers were relieved.", "anchors": []},
    ]
    cfg = {"style_pack_doc": {"overlays": {"emphasis": {"enabled": True, "per_minute": 4}}}}
    return beats, cfg


def test_the_selection_validator_refuses_an_invented_figure_for_repair():
    beats, cfg = _selection_ctx()
    doc = {"version": "1.0", "video_id": "v", "selections": [
        {"beat_id": "b2", "component": "Timeline", "role": "emphasis",
         "props_hint": {"title": "The wobble", "events": [{"date": "Jun 2000", "label": "opens"},
                                                          {"date": "2002", "label": "reopens with 91 dampers"}]},
         "why": "sequence"}], "declined": []}
    problems = validators.validate_overlay_selection(doc, beats, cfg)
    assert any("props_hint shows 91" in p and "never says" in p for p in problems), problems


def test_a_figure_spoken_one_beat_away_is_fine():
    """A chart often lands a sentence after the figures it draws."""
    beats, cfg = _selection_ctx()
    doc = {"version": "1.0", "video_id": "v", "selections": [
        {"beat_id": "b3", "component": "Timeline", "role": "emphasis",
         "props_hint": {"title": "The wobble", "events": [{"date": "2002", "label": "reopens"}]},
         "why": "sequence"}], "declined": []}
    assert not any("never says" in p for p in validators.validate_overlay_selection(doc, beats, cfg))


def test_the_overlay_prompt_no_longer_teaches_an_unspoken_number():
    import lusora_contracts

    text = json.loads((lusora_contracts.CONTRACTS_ROOT / "prompts" / "overlay" / "default.json")
                      .read_text(encoding="utf-8"))["system"]
    assert '"label":"reopens with 91 dampers"' not in text
    assert "The bridge opened in June 2000" in text, "the example's dates are now spoken"
