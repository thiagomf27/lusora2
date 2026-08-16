"""The beats process, phase by phase (destination-map slice 5, front half).

These pin the DETERMINISTIC half: where the narration may be cut, when each
piece is spoken, and which pieces join into one beat. What a beat SHOWS is not
here — that waits on the catalog's type_name vocabulary and the style pack's
overlay numbers.
"""

import pytest

from lusora_worker.beatphases import Piece, beat_parts, script_split, srt_alignment
from lusora_worker.srt import SrtItem

SCRIPT = (
    "The war began in nineteen fourteen. It changed everything; nobody expected it. "
    "Then, after four long years of fighting across the continent, it finally ended."
)


def test_split_cuts_at_sentence_ends_first():
    pieces = script_split(SCRIPT, min_chars=0)
    assert pieces[0] == "The war began in nineteen fourteen."
    assert all(p.strip() for p in pieces)


def test_split_never_loses_a_word():
    """Every piece is spoken, so the pieces must reconstruct the script."""
    joined = " ".join(script_split(SCRIPT))
    for word in SCRIPT.replace(";", "").replace(",", "").split():
        assert word in joined


def test_a_fragment_under_the_floor_is_folded_forward():
    """A three-word piece is not a shot."""
    pieces = script_split("Yes. It was the largest engineering project of the decade.", min_chars=24)
    assert len(pieces) == 1, pieces


def test_a_long_sentence_descends_to_weaker_punctuation():
    """A comma is a worse cut than a full stop, so it is taken only when the
    piece is already over the ceiling."""
    long_sentence = "It was built in Glasgow, shipped to Belfast, fitted out over winter, and launched in spring."
    assert len(script_split(long_sentence, max_chars=1000)) == 1
    assert len(script_split(long_sentence, max_chars=30)) > 1


def test_segment_cues_supply_the_breaks_directly():
    """With `segment` cues the ASR already chose the chunking — D63. Inventing
    a second answer over the top of it would just disagree with the timings."""
    srt = [SrtItem(0, 2, "first chunk here"), SrtItem(2, 4, "second chunk here")]
    assert script_split(SCRIPT, srt, granularity="segment", min_chars=0) == [
        "first chunk here",
        "second chunk here",
    ]


def test_alignment_is_monotonic_and_covers_the_audio():
    """The compiler lays these end to end; one inverted span eats its neighbour."""
    pieces = script_split(SCRIPT)
    srt = [SrtItem(0, 3, "a"), SrtItem(3, 7, "b"), SrtItem(7, 12, "c")]
    aligned = srt_alignment(pieces, srt, 12.0)
    assert len(aligned) == len(pieces)
    assert aligned[0].start_s == 0
    assert aligned[-1].end_s == pytest.approx(12.0)
    for a, b in zip(aligned, aligned[1:]):
        assert b.start_s >= a.end_s


def test_alignment_without_a_transcript_degrades_proportionally():
    """The honest degrade: every piece still gets a slot, none of them exact."""
    aligned = srt_alignment(["aaaa", "bbbbbbbb"], [], 12.0)
    assert aligned[0].start_s == 0
    assert aligned[-1].end_s == pytest.approx(12.0)
    assert aligned[1].duration > aligned[0].duration


def test_parts_join_anything_under_the_hold_floor():
    pieces = [Piece("one", 0, 1), Piece("two", 1, 2), Piece("three", 2, 9)]
    parts = beat_parts(pieces, min_hold=3.0)
    assert len(parts) == 1
    assert parts[0].text == "one two three"
    assert (parts[0].start_s, parts[0].end_s) == (0, 9)


def test_a_trailing_short_part_is_absorbed_backwards():
    """The last beat has nothing ahead of it to join, so it folds back."""
    parts = beat_parts([Piece("long one", 0, 8), Piece("scrap", 8, 8.4)], min_hold=3.0)
    assert len(parts) == 1
    assert parts[0].end_s == pytest.approx(8.4)


def test_parts_leave_a_comfortable_beat_alone():
    pieces = [Piece("one", 0, 5), Piece("two", 5, 10)]
    assert len(beat_parts(pieces, min_hold=3.0)) == 2


def test_the_hold_ceiling_is_not_this_functions_job():
    """The compiler divides an over-long slot (hold_ceiling_ratio) and can do it
    without inventing a beat that has no script text of its own."""
    parts = beat_parts([Piece("one very long held shot", 0, 45)], min_hold=3.0)
    assert len(parts) == 1


def test_a_slow_pack_and_a_fast_pack_produce_different_beats():
    """The point of the rewire: boundaries follow the style pack's hold window,
    which the old sentence-count heuristic ignored entirely."""
    pieces = script_split(SCRIPT)
    aligned = srt_alignment(pieces, [SrtItem(0, 4, "a"), SrtItem(4, 8, "b"), SrtItem(8, 12, "c")], 12.0)
    assert len(beat_parts(aligned, min_hold=1.0)) > len(beat_parts(aligned, min_hold=20.0))


def test_empty_script_is_not_a_crash():
    assert script_split("") == []
    assert srt_alignment([], [], 10.0) == []
    assert beat_parts([], min_hold=3.0) == []
