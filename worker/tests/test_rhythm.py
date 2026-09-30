"""Rhythm, repetition, captions (D113, documentary plan slice 8).

Dark Palace's `montar` after the hook: about one shot per five seconds, no
still past six, cuts on a spoken word, never two graphics in a row, a look
already shown in the last 30 s waits, and one source video in at most three
blocks and never two in a row. Its captions are short phrases shown from their
first spoken word. These pin each rule, and that a pack or channel without the
knobs compiles and resolves exactly as before.
"""

import json

from lusora_worker import validators
from lusora_worker.compiler import captions, rhythm
from lusora_worker.providers import sources

from test_texture import compile_with

ON = {"shot_s": 5.0, "max_still_s": 6.0, "snap_to_words": True, "min_graphic_gap_s": 2.0}


def conf(**over):
    return {**rhythm.DEFAULTS, **over}


# ---------------- shots ----------------


def test_a_long_shot_becomes_one_per_five_seconds():
    assert rhythm.split_long([(0.0, 12.0)], False, conf(shot_s=5)) == [(0.0, 4.0), (4.0, 8.0), (8.0, 12.0)]


def test_a_shot_of_exactly_the_limit_stays_whole():
    assert rhythm.split_long([(0.0, 5.05)], False, conf(shot_s=5)) == [(0.0, 5.05)]


def test_the_still_limit_applies_only_to_a_planned_photo():
    spans = [(0.0, 7.0)]
    assert rhythm.split_long(spans, False, conf(max_still_s=6)) == spans
    assert rhythm.split_long(spans, True, conf(max_still_s=6)) == [(0.0, 3.5), (3.5, 7.0)]


def test_no_part_comes_out_under_the_hold_floor():
    assert rhythm.split_long([(0.0, 5.4)], False, conf(shot_s=5), floor=2.8) == [(0.0, 5.4)]
    assert rhythm.snap([(0.0, 2.6), (2.6, 5.2)], [2.4], floor=2.5) == [(0.0, 2.6), (2.6, 5.2)]


def test_off_splits_nothing():
    assert rhythm.split_long([(0.0, 30.0)], True, conf()) == [(0.0, 30.0)]


def test_a_cut_moves_onto_the_nearest_word():
    spans = [(0.0, 4.0), (4.0, 8.0)]
    assert rhythm.snap(spans, [0.0, 1.1, 3.7, 4.6, 6.0]) == [(0.0, 3.7), (3.7, 8.0)]


def test_a_cut_with_no_word_near_or_no_room_stays():
    assert rhythm.snap([(0.0, 4.0), (4.0, 8.0)], [0.0, 2.0, 6.0]) == [(0.0, 4.0), (4.0, 8.0)], "nothing within 0.5 s"
    assert rhythm.snap([(0.0, 1.3), (1.3, 5.0)], [0.9]) == [(0.0, 1.3), (1.3, 5.0)], "would leave 0.9 s"


# ---------------- graphics ----------------


def ov(component, start, end, beat="b"):
    return {"id": f"o_{component}_{start}", "kind": "component", "component": component, "beat_id": beat,
            "start_s": start, "end_s": end, "props": {}}


def test_a_second_panel_in_a_row_is_dropped_and_the_first_keeps_the_moment():
    notes = []
    kept = rhythm.space_graphics([ov("DataTable", 30, 36), ov("BarChart", 36.2, 41)], conf(min_graphic_gap_s=2), 20, notes.append)
    assert [o["component"] for o in kept] == ["DataTable"]
    assert "two graphics in a row" in notes[0]


def test_corner_tags_the_hook_and_a_real_gap_never_count():
    items = [ov("ComparisonSplit", 10, 15), ov("SatelliteLocate", 15.2, 20),  # both in the hook
             ov("DataTable", 30, 36), ov("StatTag", 36.2, 40), ov("BarChart", 38.5, 43)]
    kept = rhythm.space_graphics(items, conf(min_graphic_gap_s=2), 22, None)
    assert [o["component"] for o in kept] == [o["component"] for o in items]


# ---------------- captions ----------------


def test_phrases_break_on_length_and_punctuation():
    words = "In a quiet corner of eastern Pennsylvania, there is a town where the ground has been burning for more than 60 years.".split()
    got = [" ".join(words[i] for i in g) for g in captions.phrases(words, 40, 8)]
    assert got == ["In a quiet corner of eastern", "Pennsylvania, there is a town where the",
                   "ground has been burning for more than 60 years."], "'years.' alone finishes its phrase"


def test_a_short_tail_joins_the_phrase_before():
    words = "The roads lead nowhere at all now".split()
    got = [" ".join(words[i] for i in g) for g in captions.phrases(words, 40, 6)]
    assert got == ["The roads lead nowhere at all now"]
    words = "Steam rises. It never stops.".split()
    got = [" ".join(words[i] for i in g) for g in captions.phrases(words, 40, 8)]
    assert got == ["Steam rises.", "It never stops."], "a sentence of its own stays its own"


def test_phrases_show_from_their_first_spoken_word_and_cover_the_sentence():
    text = "Steam still rises from the cracks, and the roads lead nowhere at all."
    words = text.split()
    timed = [{"start_s": 1.0 + 0.4 * i, "end_s": 1.35 + 0.4 * i} for i in range(len(words))]
    items = captions.chunk_items([{"text": text, "start_s": 1.0, "end_s": 6.0, "words": timed}], 2.0,
                                 {"max_chars": 40, "max_words": 8})
    assert [c["text"] for c in items] == ["Steam still rises from the cracks,", "and the roads lead nowhere at all."]
    assert items[0]["start_s"] == 3.0 and items[-1]["end_s"] == 8.0
    assert items[0]["end_s"] == items[1]["start_s"] == round(2.0 + 1.0 + 0.4 * 6, 3), "the second starts on 'and'"


def test_without_word_timing_the_chunk_is_spread_evenly():
    items = captions.chunk_items([{"text": "One two three four. Five six seven eight.", "start_s": 0, "end_s": 8}], 0,
                                 {"max_chars": 40, "max_words": 8})
    assert [(c["start_s"], c["end_s"]) for c in items] == [(0, 4.0), (4.0, 8)]


# ---------------- in the compiler ----------------


def test_a_rhythmic_plan_compiles_and_validates(tmp_path):
    plan, cfg = compile_with({"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10, "rhythm": {"shot_s": 2.5}},
                              "captions": {"chunk": {"max_chars": 20, "max_words": 4}}}, None)
    visual = plan["tracks"]["visual"]
    assert max(v["end_s"] - v["start_s"] for v in visual) <= 2.6
    assert len(plan["tracks"]["captions"]["items"]) > 6
    assert validators.validate_plan(plan, tmp_path, cfg, 18.0, require_assets=False) == []


def test_a_pack_without_the_blocks_compiles_byte_identically():
    plain, _ = compile_with({}, None)
    off, _ = compile_with({"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10, "rhythm": {}},
                           "captions": {}}, None)
    assert json.dumps(plain, sort_keys=True) == json.dumps(off, sort_keys=True)


# ---------------- repetition ----------------


def ledger(**dedup):
    return sources.Ledger({"source_policy": {"visual": {"dedup": dedup}}})


def place(led, asset_id, beat, start, source="youtube"):
    led.remember({"source": source, "provider": source, "id": asset_id}, None, {"beat_id": beat, "start_s": start})


def test_one_source_video_in_at_most_n_beats():
    led = ledger(max_beats_per_source=2)
    place(led, "abc#1", "b1", 0)
    place(led, "abc#2", "b1", 3)
    place(led, "abc#3", "b4", 20)
    assert led.at({"beat_id": "b9", "start_s": 60}).blocked("youtube", "youtube", "abc#7")
    assert not led.at({"beat_id": "b4", "start_s": 24}).blocked("youtube", "youtube", "abc#8"), "its own beat"
    assert not led.at({"beat_id": "b9", "start_s": 60}).blocked("youtube", "youtube", "xyz#1")


def test_never_the_source_the_beat_next_door_used():
    led = ledger(source_in_adjacent_beats=False)
    place(led, "abc#1", "b1", 0)
    place(led, "def#1", "b2", 5)
    place(led, "ghi#1", "b4", 15)
    assert led.at({"beat_id": "b3", "start_s": 10}).blocked("youtube", "youtube", "def#9"), "b2 is right before"
    assert led.at({"beat_id": "b3", "start_s": 10}).blocked("youtube", "youtube", "ghi#9"), "b4 is right after"
    assert not led.at({"beat_id": "b3", "start_s": 10}).blocked("youtube", "youtube", "abc#9")
    assert not led.at({"beat_id": "b2", "start_s": 7}).blocked("youtube", "youtube", "def#2"), "inside one beat is fine"


def test_the_source_rules_are_off_by_default_and_skip_what_has_no_parent():
    led = ledger()
    place(led, "abc#1", "b1", 0)
    assert not led.at({"beat_id": "b2", "start_s": 5}).blocked("youtube", "youtube", "abc#2")
    strict = ledger(max_beats_per_source=1, source_in_adjacent_beats=False)
    place(strict, "123", "b1", 0, source="stock")
    assert not strict.at({"beat_id": "b2", "start_s": 5}).blocked("stock", "stock", "456")


def test_the_look_check_can_run_over_seconds(monkeypatch):
    monkeypatch.setattr(sources, "perceptual_hash", lambda path: 0b1111)
    led = ledger(min_hamming_distance=13, reuse_window_s=30)
    led.remember({"source": "stock", "id": "1"}, "a.mp4", {"beat_id": "b1", "start_s": 0})
    assert led.at({"beat_id": "b2", "start_s": 20}).too_similar(0b1111) == 0
    assert led.at({"beat_id": "b9", "start_s": 45}).too_similar(0b1111) is None, "shown 45 s ago: a callback"
