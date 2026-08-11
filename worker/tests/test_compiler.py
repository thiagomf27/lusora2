"""Compiler v1: alignment, hold enforcement, overlay compilation."""

import pytest

from lusora_worker.compiler import compile_plan
from lusora_worker.compiler.core import CompileError

CFG = {
    "captions": {"enabled": True},
    "output": {"fps": 30, "width": 1280, "height": 720},
    "style_pack_doc": {
        "name": "test",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0},
        "overlays": {"density": "normal"},
        "transitions": {"allowed": ["cut", "crossfade"], "default": "crossfade"},
    },
    "theme_doc": {"typography": {"caption_preset": "plain"}},
}


def timings(*pairs):
    return [{"text": t, "start_s": a, "end_s": b} for (t, a, b) in pairs]


def beats(*items):
    return {"version": "1.0", "video_id": "vid_t", "beats": list(items)}


def test_alignment_and_captions():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "First sentence.", "visual_intent": "a"},
        {"id": "b2", "kind": "narration", "script_text": "Second one here.", "visual_intent": "b"},
    )
    st = timings(("First sentence.", 0.0, 3.0), ("Second one here.", 3.0, 6.5))
    plan = compile_plan(doc, st, CFG, 6.5)
    visual = plan["tracks"]["visual"]
    assert [v["beat_id"] for v in visual] == ["b1", "b2"]
    assert visual[0]["start_s"] == 0.0
    assert visual[0]["end_s"] == visual[1]["start_s"] == 3.0
    assert visual[1]["end_s"] == 6.5
    assert len(plan["tracks"]["captions"]["items"]) == 2
    assert plan["tracks"]["audio"]["voiceover"]["duration_s"] == 6.5


def test_beat_spanning_two_sentences():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One. Two.", "visual_intent": "a"},
    )
    st = timings(("One.", 0.0, 2.0), ("Two.", 2.0, 4.0))
    plan = compile_plan(doc, st, CFG, 4.0)
    assert len(plan["tracks"]["visual"]) == 1
    assert plan["tracks"]["visual"][0]["end_s"] == 4.0


def test_max_hold_auto_split():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "A. B. C. D.", "visual_intent": "long"},
    )
    st = timings(("A.", 0, 4), ("B.", 4, 8), ("C.", 8, 12), ("D.", 12, 16))
    plan = compile_plan(doc, st, CFG, 16.0)
    visual = plan["tracks"]["visual"]
    assert len(visual) > 1, "16s beat must be split (max_hold 6)"
    for v in visual:
        assert v["end_s"] - v["start_s"] <= 6.0 + 1e-6
        assert v["beat_id"] == "b1"
    assert visual[0]["start_s"] == 0.0
    assert visual[-1]["end_s"] == 16.0
    for a, b in zip(visual, visual[1:]):
        assert a["end_s"] == b["start_s"]


def test_misaligned_beat_fails_loud():
    doc = beats({"id": "b1", "kind": "narration", "script_text": "Not in audio.", "visual_intent": "x"})
    st = timings(("Something else entirely.", 0.0, 3.0))
    with pytest.raises(CompileError):
        compile_plan(doc, st, CFG, 3.0)


def test_alignment_tolerates_asr_punctuation_and_caption_straddling():
    """Real failure modes hit in production: (1) a caption/ASR chunk
    boundary that cuts across a script sentence boundary, (2) the
    ASR/caption text using commas where the script uses periods. Neither
    is a real divergence — only the words matter for alignment."""
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "The floor was old.", "visual_intent": "a"},
        {"id": "b2", "kind": "narration", "script_text": "Oil stained the boards.", "visual_intent": "b"},
    )
    # one caption straddles the sentence boundary, and uses a comma instead of the script's period
    st = timings(
        ("The floor was old, oil stained the", 0.0, 3.5),
        ("boards.", 3.5, 4.0),
    )
    plan = compile_plan(doc, st, CFG, 4.0)
    visual = plan["tracks"]["visual"]
    assert [v["beat_id"] for v in visual] == ["b1", "b2"]
    assert visual[0]["start_s"] == 0.0
    assert visual[1]["end_s"] == 4.0


def test_alignment_tolerates_one_stray_asr_word():
    """A mis-heard/hallucinated word inserted by the ASR shouldn't break
    alignment as long as the real script words are found shortly after."""
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "He named the boat Alcedo.", "visual_intent": "a"},
    )
    st = timings(("He named the boat Wood Alcedo.", 0.0, 3.0))
    plan = compile_plan(doc, st, CFG, 3.0)
    assert plan["tracks"]["visual"][0]["beat_id"] == "b1"


def test_alignment_still_fails_on_a_real_word_substitution():
    """A genuine wording divergence (not punctuation, not a number-format
    difference, not an insertion) must still fail loud — this isn't a
    license to accept anything."""
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "He read the letter aloud.", "visual_intent": "a"},
    )
    st = timings(("He burned the letter aloud.", 0.0, 2.0))
    with pytest.raises(CompileError, match="read"):
        compile_plan(doc, st, CFG, 2.0)


@pytest.mark.parametrize(
    "script_words,narration_words",
    [
        ("Fifty feet away.", "50 feet away."),  # simple cardinal, spoken -> digit
        ("Lot forty-seven sold.", "Lot 47 sold."),  # hyphenated compound -> digit
        ("A 1950s trawler.", "A nineteen-fifties trawler."),  # digit -> century-decade compound
        ("Back in the fifties.", "Back in the 50s."),  # bare decade plural -> digit decade
    ],
)
def test_alignment_tolerates_number_word_digit_equivalence(script_words, narration_words):
    """Whisper (and hand-authored captions) render numbers however they
    like — digits, spelled out, hyphenated compounds, decades — while the
    script may use a different convention. None of that is a real content
    divergence."""
    doc = beats({"id": "b1", "kind": "narration", "script_text": script_words, "visual_intent": "a"})
    st = timings((narration_words, 0.0, 2.0))
    plan = compile_plan(doc, st, CFG, 2.0)
    assert plan["tracks"]["visual"][0]["beat_id"] == "b1"


@pytest.mark.parametrize(
    "script_words,narration_words",
    [
        # accents: the script and the transcript never agree on them
        ("Estêvão partiu ao amanhecer.", "Estevao partiu ao amanhecer."),
        ("O coracao da frota.", "O coração da frota."),
        # years: digits vs the spoken form, pt and en
        ("Em 1945 a guerra acabou.", "Em mil novecentos e quarenta e cinco a guerra acabou."),
        ("In 1945 the war ended.", "In nineteen forty-five the war ended."),
        # scales and grouped digits
        ("Vinte mil soldados marcharam.", "20.000 soldados marcharam."),
        ("Twelve hundred men waited.", "1,200 men waited."),
        # decimals
        ("It fell 3.5 meters.", "It fell three point five meters."),
        # units the other side wrote as a symbol, in both directions
        ("Cinquenta por cento da frota.", "50% da frota."),
        ("50% da frota afundou.", "Cinquenta por cento da frota afundou."),
        ("It cost five dollars.", "It cost $5."),
        # decades, written long or short
        ("Os anos 1950 mudaram tudo.", "Os anos 50 mudaram tudo."),
        # roman numerals and ordinals
        ("O Século XX começou.", "O século vinte começou."),
        ("The 20th century began.", "The twentieth century began."),
        # abbreviations and unit names, written short or spoken in full
        ("O Dr. Alberto chegou.", "O doutor Alberto chegou."),
        ("Avançaram 30 km ao norte.", "Avançaram trinta quilômetros ao norte."),
        ("Custou US$ 5 milhões.", "Custou cinco milhões de dólares."),
        # dashes: typography, not wording
        ("A state-of-the-art radar.", "A state of the art radar."),
        ("A guerra—a maior de todas.", "A guerra a maior de todas."),
    ],
)
def test_alignment_tolerates_written_vs_spoken_forms(script_words, narration_words):
    """The script is the source of truth; the SRT is only a timing source,
    and it renders the same spoken words with different spelling
    conventions. None of that is a content divergence (textmatch.py)."""
    doc = beats({"id": "b1", "kind": "narration", "script_text": script_words, "visual_intent": "a"})
    st = timings((narration_words, 0.0, 2.0))
    plan = compile_plan(doc, st, CFG, 2.0)
    assert plan["tracks"]["visual"][0]["beat_id"] == "b1"


@pytest.mark.parametrize(
    "script_words,narration_words",
    [
        ("The year was 1945.", "The year was 1946."),
        ("Fifty feet away.", "Sixty feet away."),
        ("Twenty thousand marched.", "Two thousand marched."),
    ],
)
def test_alignment_still_fails_on_a_real_number_divergence(script_words, narration_words):
    """Tolerating number FORMATTING is not tolerating a different number."""
    doc = beats({"id": "b1", "kind": "narration", "script_text": script_words, "visual_intent": "a"})
    st = timings((narration_words, 0.0, 2.0))
    with pytest.raises(CompileError):
        compile_plan(doc, st, CFG, 2.0)


def test_uncovered_narration_fails_loud():
    doc = beats({"id": "b1", "kind": "narration", "script_text": "First.", "visual_intent": "x"})
    st = timings(("First.", 0.0, 2.0), ("Uncovered tail.", 2.0, 4.0))
    with pytest.raises(CompileError):
        compile_plan(doc, st, CFG, 4.0)


def test_overlay_props_from_anchor_and_defaults():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "Nearly 70% converted.",
            "visual_intent": "factories",
            "anchors": [
                {"type": "percentage", "value": 70, "label": "converted", "source_words": "70%"}
            ],
            "overlay": {"component": "AnimatedCounter", "anchor_ref": 0},
        },
    )
    st = timings(("Nearly 70% converted.", 0.0, 5.0))
    plan = compile_plan(doc, st, CFG, 5.0)
    overlays = plan["tracks"]["overlays"]
    assert len(overlays) == 1
    props = overlays[0]["props"]
    assert props["value"] == 70          # from_anchor: the LLM cannot get the number wrong
    assert props["label"] == "converted"  # anchor label fallback
    assert props["emphasis"] == "accent"  # default
    assert overlays[0]["end_s"] <= 5.0


def test_geocode_fills_map_props():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "The push toward Stalingrad began.",
            "visual_intent": "map",
            "anchors": [{"type": "place", "value": "Stalingrad", "source_words": "Stalingrad"}],
            "overlay": {"component": "SatelliteLocate", "anchor_ref": 0},
        },
    )
    st = timings(("The push toward Stalingrad began.", 0.0, 5.0))
    plan = compile_plan(doc, st, CFG, 5.0)
    props = plan["tracks"]["overlays"][0]["props"]
    assert props["place_name"] == "Stalingrad"
    assert abs(props["lat"] - 48.708) < 0.01
    assert props["zoom"] == "region"


def test_unknown_place_fails_loud():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "The town of Xyzzyville fell.",
            "visual_intent": "map",
            "anchors": [{"type": "place", "value": "Xyzzyville", "source_words": "Xyzzyville"}],
            "overlay": {"component": "SatelliteLocate", "anchor_ref": 0},
        },
    )
    st = timings(("The town of Xyzzyville fell.", 0.0, 4.0))
    with pytest.raises(CompileError, match="geocode"):
        compile_plan(doc, st, CFG, 4.0)


def test_leading_timed_beat_offsets_voiceover():
    doc = beats(
        {"id": "b1", "kind": "timed", "timing": {"start_s": 0.0, "end_s": 3.0},
         "visual_intent": "cold open"},
        {"id": "b2", "kind": "narration", "script_text": "Hello there.", "visual_intent": "x"},
    )
    st = timings(("Hello there.", 0.0, 2.0))
    plan = compile_plan(doc, st, CFG, 2.0)
    vo = plan["tracks"]["audio"]["voiceover"]
    assert vo["start_s"] == 3.0
    captions = plan["tracks"]["captions"]["items"]
    assert captions[0]["start_s"] == 3.0
    visual = plan["tracks"]["visual"]
    assert visual[0]["beat_id"] == "b1"
    assert visual[-1]["end_s"] == 5.0


def _dated_beat(position: str | None):
    """One beat carrying a date anchor and a DateStamp, optionally pre-positioned."""
    overlay: dict = {"component": "DateStamp", "anchor_ref": 0}
    if position is not None:
        overlay["props_hint"] = {"position": position}
    return beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "On 31 January 1943 the guns stopped.",
            "visual_intent": "ruined city",
            "anchors": [
                {"type": "date", "value": "31 January 1943", "source_words": "31 January 1943"}
            ],
            "overlay": overlay,
        },
    )


def _compile_dated(position, *, captions):
    cfg = {**CFG, "captions": {"enabled": captions}}
    st = timings(("On 31 January 1943 the guns stopped.", 0.0, 5.0))
    plan = compile_plan(_dated_beat(position), st, cfg, 5.0)
    return plan["tracks"]["overlays"][0]["props"]


@pytest.mark.parametrize(
    "asked,expected",
    [("bottom_left", "top_left"), ("bottom_right", "top_right")],
)
def test_captions_push_corner_overlays_off_the_bottom(asked, expected):
    # captions own the bottom strip: a bottom corner would land on top of them
    assert _compile_dated(asked, captions=True)["position"] == expected


def test_bottom_corner_kept_when_captions_are_off():
    assert _compile_dated("bottom_left", captions=False)["position"] == "bottom_left"


def test_top_corner_and_catalog_default_are_left_alone():
    assert _compile_dated("top_right", captions=True)["position"] == "top_right"
    assert _compile_dated(None, captions=True)["position"] == "top_left"  # catalog default


def test_overlay_holds_across_a_short_beats_cut():
    # A 1.5s beat cannot contain a DefinitionCard (catalog min 3s). The overlay
    # holds across the cut instead of being starved down to the beat length.
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "Call it flutter.",
            "visual_intent": "bridge deck",
            "overlay": {
                "component": "DefinitionCard",
                "props_hint": {"term": "flutter", "definition": "Self-feeding oscillation driven by airflow."},
            },
        },
        {
            "id": "b2",
            "kind": "narration",
            "script_text": "It destroyed the deck.",
            "visual_intent": "twisting roadway",
        },
    )
    st = timings(("Call it flutter.", 0.0, 1.5), ("It destroyed the deck.", 1.5, 8.0))
    plan = compile_plan(doc, st, CFG, 8.0)
    overlay = plan["tracks"]["overlays"][0]
    assert overlay["end_s"] - overlay["start_s"] >= 3.0, "catalog minimum hold must be honoured"
    assert overlay["end_s"] > 1.5, "overlay is allowed to outlive its own beat"


def test_overlays_never_overlap_each_other():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "Ninety one dampers went in.",
            "visual_intent": "dampers",
            "anchors": [{"type": "number", "value": 91, "label": "dampers", "source_words": "Ninety one"}],
            "overlay": {"component": "AnimatedCounter", "anchor_ref": 0},
        },
        {
            "id": "b2",
            "kind": "narration",
            "script_text": "The deck settled down.",
            "visual_intent": "calm bridge",
            "anchors": [{"type": "number", "value": 5, "label": "millimetres", "source_words": "settled"}],
            "overlay": {"component": "StatTag", "anchor_ref": 0},
        },
    )
    st = timings(("Ninety one dampers went in.", 0.0, 2.0), ("The deck settled down.", 2.0, 9.0))
    plan = compile_plan(doc, st, CFG, 9.0)
    first, second = plan["tracks"]["overlays"]
    assert first["end_s"] <= second["start_s"], "graphics must not be on screen together"
    assert plan["tracks"]["overlays"] == sorted(
        plan["tracks"]["overlays"], key=lambda o: o["start_s"]
    )
