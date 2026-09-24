"""D93: timing chunked narration from local Whisper + pauses (align.py), and
the readers that use it (throughput slice 5d)."""

import json

from test_agents import FakeDb

from lusora_worker import align
from lusora_worker.align import Heard
from lusora_worker.compiler import core
from lusora_worker.context import StageContext
from lusora_worker.pipeline import steps
from lusora_worker.providers import tts

SENTENCES = [
    "In 1900, the nation had forty-five states.",
    "A lifetime later, at the end of the century, Americans walked on the moon.",
    "They split the atom.",
]


def _heard(words_and_times):
    return [Heard(w, s, e) for w, s, e in words_and_times]


# what whisper "heard": loose times (sentence 3 heard ~0.5 s late), a
# mis-hearing ("centuary"), and "forty-five" as one word
HEARD = _heard([
    ("In", 0.10, 0.25), ("1900,", 0.30, 0.90), ("the", 1.00, 1.10), ("nation", 1.10, 1.50),
    ("had", 1.50, 1.70), ("forty-five", 1.70, 2.30), ("states.", 2.30, 2.90),
    ("A", 3.30, 3.40), ("lifetime", 3.40, 3.90), ("later,", 3.90, 4.40),
    ("at", 4.80, 4.90), ("the", 4.90, 5.00), ("end", 5.00, 5.20), ("of", 5.20, 5.30),
    ("the", 5.30, 5.40), ("centuary,", 5.40, 6.00),
    ("Americans", 6.40, 7.00), ("walked", 7.00, 7.30), ("on", 7.30, 7.40), ("the", 7.40, 7.50),
    ("moon.", 7.50, 8.00),
    ("They", 9.00, 9.20), ("split", 9.20, 9.50), ("the", 9.50, 9.60), ("atom.", 9.60, 10.10),
])
# the real pauses: after each sentence (3.20, 8.50) and at the commas (4.70, 6.30)
PAUSES = [3.20, 4.70, 6.30, 8.50]


def test_whisper_picks_the_pause_and_the_pause_gives_the_time():
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    # sentence 2 heard at 3.30, snapped to the pause ending at 3.20; sentence 3
    # heard at 9.00 — 0.5 s late — still snapped to ITS pause, 8.50, not to a
    # comma's
    assert timing.starts == [0.0, 3.2, 8.5]
    assert timing.unplaced == 0


def test_a_comma_pause_nearer_the_guess_than_the_sentence_end_is_not_taken():
    """The failure that ruled out pauses alone: the comma in "A lifetime later,"
    sits between the sentence's first word and the next sentence. Whisper has
    already said which words are sentence 2's, so only a pause beside ITS
    first word can be its start."""
    timing = align.align_chunk(SENTENCES, HEARD, [3.20, 4.70, 6.30, 8.50], duration=10.5)
    assert 4.70 not in timing.starts and 6.30 not in timing.starts


def test_words_come_out_on_the_compilers_own_tokens():
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    for sentence, words in zip(SENTENCES, timing.words):
        assert [w["text"] for w in words] == core.tokenize(sentence)
    first = timing.words[0]
    # "forty-five" is two tokens sharing the heard word's span
    forty, five = first[5], first[6]
    assert (forty["text"], five["text"]) == ("forty", "five")
    assert forty["start_s"] == 1.7 and five["end_s"] == 2.3


def test_a_misheard_word_is_timed_from_its_neighbours():
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    century = next(w for w in timing.words[1] if w["text"].startswith("century"))
    assert 5.3 <= century["start_s"] <= 6.4


def test_words_never_leave_their_sentence():
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    bounds = timing.starts + [10.5]
    for i, words in enumerate(timing.words):
        for w in words:
            assert bounds[i] <= w["start_s"] <= w["end_s"] <= bounds[i + 1]


def test_nothing_heard_still_times_every_sentence_and_says_so():
    """Whisper returned nothing (silence, a crash): every word is spread by
    characters, sentence starts snap to the nearest pause, and the count of
    estimated sentences is reported — the video is never failed for it."""
    timing = align.align_chunk(SENTENCES, [], PAUSES, duration=10.5)
    assert timing.unplaced == 2
    assert timing.starts[0] == 0.0 and timing.starts == sorted(timing.starts)
    assert len(set(timing.starts)) == 3


# ---------------- chunking ----------------


def test_chunks_break_at_paragraphs_when_they_can():
    script = "One. Two.\n\nThree. Four.\n\nFive."
    sentences = tts.split_sentences(script)
    assert tts.chunk_sentences(script, sentences, limit=14) == [[0, 1], [2, 3], [4]]
    assert tts.chunk_sentences(script, sentences, limit=1000) == [[0, 1, 2, 3, 4]]


def test_a_long_paragraph_is_split_between_sentences_never_inside_one():
    script = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota."
    sentences = tts.split_sentences(script)
    chunks = tts.chunk_sentences(script, sentences, limit=20)
    assert chunks == [[0], [1], [2]]
    assert tts.chunk_sentences("A very long single sentence here.", ["A very long single sentence here."],
                               limit=5) == [[0]]


# ---------------- the readers ----------------


def _timings_with_words():
    return [
        {"text": "They split the atom.", "start_s": 0.0, "end_s": 2.0,
         "words": [{"text": "They", "start_s": 0.1, "end_s": 0.3},
                   {"text": "split", "start_s": 0.3, "end_s": 0.6},
                   {"text": "the", "start_s": 0.6, "end_s": 0.7},
                   {"text": "atom.", "start_s": 1.5, "end_s": 1.9}]},
    ]


def test_the_compiler_takes_aligned_words_instead_of_an_even_spread():
    timeline = core._word_timeline(_timings_with_words())
    assert [w["start_s"] for w in timeline] == [0.1, 0.3, 0.6, 1.5]


def test_the_compiler_spreads_evenly_when_the_words_do_not_line_up():
    item = _timings_with_words()[0]
    item["words"] = item["words"][:2]  # a count that disagrees with tokenize()
    timeline = core._word_timeline([item])
    assert [w["start_s"] for w in timeline] == [0.0, 0.5, 1.0, 1.5]


def test_word_captions_come_from_the_aligned_words_without_whisper(tmp_path, monkeypatch):
    ctx = StageContext(video={"id": "v", "channel_id": "CH", "title": "T"}, folder=tmp_path,
                       cfg={"transcript": {"granularity": "word"}}, db=FakeDb(), config=None)
    (tmp_path / "tts_timings.json").write_text(json.dumps({"items": _timings_with_words()}))
    monkeypatch.setattr(steps.whisper, "transcribe",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no whisper pass")))

    steps.run_transcript(ctx)

    cues = [c.text for c in steps.read_srt(tmp_path / "subtitles.srt")]
    assert cues == ["They", "split", "the", "atom."]


# ---------------- slow speech: pauses folded into words ----------------


def test_a_pause_whisper_folded_into_the_first_word_is_still_found():
    """At 0.7x Whisper heard "The" as lasting 1.04 s, starting where the
    previous sentence ended; the real pause ended 0.96 s after that guess —
    outside the snap window, but inside the word's own span."""
    sentences = ["It drew millions of workers.", "The economy shifted."]
    heard = _heard([("It", 0.0, 0.3), ("drew", 0.3, 0.6), ("millions", 0.6, 1.1), ("of", 1.1, 1.3),
                    ("workers.", 1.3, 1.8), ("The", 1.8, 2.84), ("economy", 2.84, 3.4),
                    ("shifted.", 3.4, 4.0)])
    timing = align.align_chunk(sentences, heard, [2.76], duration=4.2)
    assert timing.starts == [0.0, 2.76]
    assert timing.words[1][0]["start_s"] == 2.76


def test_a_word_containing_a_mid_sentence_pause_starts_after_it():
    heard = _heard([("A", 0.0, 0.2), ("lifetime", 0.2, 0.7), ("later,", 0.7, 1.2),
                    ("at", 1.2, 2.0), ("last.", 2.0, 2.5)])
    timing = align.align_chunk(["A lifetime later, at last."], heard, [1.85], duration=2.6)
    at = next(w for w in timing.words[0] if w["text"] == "at")
    assert at["start_s"] == 1.85


def test_captions_show_words_as_the_script_wrote_them():
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    shown = align.written_words(timing.words[0])
    assert [w["text"] for w in shown] == SENTENCES[0].split()
    forty_five = shown[5]
    assert forty_five["text"] == "forty-five"
    assert (forty_five["start_s"], forty_five["end_s"]) == (1.7, 2.3)


def test_word_cues_join_split_tokens_back_into_the_written_word(tmp_path):
    timing = align.align_chunk(SENTENCES[:1], HEARD[:7], [], duration=3.0)
    ctx = StageContext(video={"id": "v", "channel_id": "CH", "title": "T"}, folder=tmp_path,
                       cfg={"transcript": {"granularity": "word"}}, db=FakeDb(), config=None)
    (tmp_path / "tts_timings.json").write_text(json.dumps({"items": [
        {"text": SENTENCES[0], "start_s": 0.0, "end_s": 3.0, "words": timing.words[0]}]}))
    steps.run_transcript(ctx)
    cues = [c.text for c in steps.read_srt(tmp_path / "subtitles.srt")]
    assert "forty-five" in cues and "forty" not in cues


# ---------------- beats still meet (the 5-minute test's failure) ----------------


def test_words_tile_their_sentence_so_beats_meet():
    """Real word ends stop at the pause; a beat is timed first-word-start to
    last-word-end, and the compiler fails a plan with a gap over 0.75 s. The
    5-minute test video died on exactly that (0.76 s)."""
    timing = align.align_chunk(SENTENCES, HEARD, PAUSES, duration=10.5)
    bounds = timing.starts + [10.5]
    for i, ws in enumerate(timing.words):
        assert ws[0]["start_s"] == bounds[i] and ws[-1]["end_s"] == bounds[i + 1]
        assert all(a["end_s"] == b["start_s"] for a, b in zip(ws, ws[1:]))


def test_beats_split_at_a_long_pause_compile_without_a_gap():
    sentences = ["It drew millions of workers.", "The economy shifted."]
    heard = _heard([("It", 0.0, 0.3), ("drew", 0.3, 0.6), ("millions", 0.6, 1.1), ("of", 1.1, 1.3),
                    ("workers.", 1.3, 1.8), ("The", 2.8, 3.0), ("economy", 3.0, 3.5),
                    ("shifted.", 3.5, 4.0)])  # a full second of silence after "workers."
    timing = align.align_chunk(sentences, heard, [2.8], duration=4.2)
    bounds = timing.starts + [4.2]
    items = [{"text": s, "start_s": bounds[i], "end_s": bounds[i + 1], "words": timing.words[i]}
             for i, s in enumerate(sentences)]
    beats = [{"id": "b1", "script_text": sentences[0]}, {"id": "b2", "script_text": sentences[1]}]
    (_b1, (s1, e1, _)), (_b2, (s2, e2, _)) = core._align_beats(beats, items, 0.0)
    assert e1 == s2 == 2.8, "the pause belongs to the beat before it, as with the old spread"
