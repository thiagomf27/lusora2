"""Narration text (D115, documentary plan slice 10).

Dark Palace's `fala.py` (with `falavel.py` and `extenso.py`) and its voice
reviewer's comparison, ported. tests/fixtures/speech_golden.json is THEIR
output on their own examples and a few more, generated from a copy of the
Dark Palace modules; the port must reproduce it exactly. The one intended
difference (English years) is pinned on its own.

Then the narration stage: what the provider is sent, at what speed, and the
review that asks for a part again when the voice did not say it.
"""

import json
from pathlib import Path

import pytest

from lusora_worker import align
from lusora_worker.context import StageContext
from lusora_worker.providers import tts
from lusora_worker.speech import review, spoken, words
from lusora_worker.speech.numbers import speakable_numbers

from test_agents import FakeDb
from test_tts import Ai33, _billed_chars, _timings

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "speech_golden.json").read_text())
EN_YEAR = ("en", "In 1962 the fire started in the dump.", "In nineteen sixty two the fire started in the dump.")


@pytest.mark.parametrize("lang,text,expected", GOLDEN["prepare"])
def test_the_voice_is_sent_what_dark_palace_sent(lang, text, expected):
    assert spoken.prepare(text, lang) == expected


@pytest.mark.parametrize("lang,text,expected", GOLDEN["spoken_form"])
def test_the_spoken_form_matches(lang, text, expected):
    if lang == "en" and any(t.isdigit() and 1100 <= int(t) <= 2099 for t in text.replace(",", " ").split()):
        pytest.skip("English years are said as years here (see below)")
    assert spoken.spoken_form(text, lang) == expected


def test_numbers_words_ordinals_and_gender_match():
    assert all(words.in_words(n, l, f) == e for l, n, f, e in GOLDEN["in_words"])
    assert all(words.ordinal(n, l, f) == e for l, n, f, e in GOLDEN["ordinal"])
    assert all(words.is_feminine(w, l) == e for l, w, e in GOLDEN["feminine"])
    assert all(spoken.is_number(w, l) == e for l, w, e in GOLDEN["is_number"])


def test_slips_match():
    for lang, expected, heard, found in GOLDEN["slips"]:
        if (lang, expected, heard) == EN_YEAR:
            continue
        got = [{"esperado": s["expected"], "ouvido": s["heard"].replace("(nothing)", "(nada)")}
               for s in review.slips(expected, heard, lang)]
        assert got == found, (expected, heard)


def test_an_english_year_said_as_a_year_is_not_a_slip():
    lang, expected, heard = EN_YEAR
    assert review.slips(expected, heard, lang) == []
    assert review.slips(expected, heard.replace("sixty", "fifty"), lang), "a wrong year still is"


def test_the_number_pass_leaves_small_numbers_and_years():
    assert speakable_numbers("In 1962, 60 years.", "en") == "In 1962, 60 years."
    assert speakable_numbers("It cost $15 million.", "en") == "It cost 15 million dollars."


# ---------------- the narration stage ----------------


class Recording(Ai33):
    def post(self, url, headers=None, files=None, timeout=None):
        with self.lock:
            self.speeds = getattr(self, "speeds", []) + [files["speed"][1]]
        return super().post(url, headers=headers, files=files, timeout=timeout)


def narrate(tmp_path, monkeypatch, fake, script, voice_cfg):
    monkeypatch.setenv("AI33_API_KEY", "k")
    monkeypatch.setattr(tts.httpx, "post", fake.post)
    monkeypatch.setattr(tts.httpx, "get", fake.get)
    monkeypatch.setattr(tts.httpx, "stream", fake.stream)
    folder = tmp_path / "video"
    folder.mkdir(exist_ok=True)
    ctx = StageContext(
        video={"id": "vid_s", "channel_id": "CH", "title": "T"}, folder=folder,
        cfg={"voice": {"provider": "ai33", "voice_id": "v", **voice_cfg}, "language": "en",
             "budget": {"max_usd_per_video": 5}},
        db=FakeDb(), config=None,
    )
    ctx.db.provider_health = lambda *a, **k: None
    tts.synthesize(ctx, script)
    return ctx


SCRIPT = "It cost $15 million. The seam burned."


def test_the_voice_reads_the_speakable_text_and_the_timings_keep_the_script(tmp_path, monkeypatch):
    fake = Recording(tmp_path)
    ctx = narrate(tmp_path, monkeypatch, fake, SCRIPT, {"speakable": True, "speed": 0.9})
    assert sorted(fake.submitted) == ["It cost 15 million dollars.", "The seam burned."]
    assert set(fake.speeds) == {"0.9"}
    assert [t["text"] for t in _timings(ctx)] == ["It cost $15 million.", "The seam burned."]


def test_unset_the_voice_is_sent_the_script_at_its_own_pace(tmp_path, monkeypatch):
    fake = Recording(tmp_path)
    narrate(tmp_path, monkeypatch, fake, SCRIPT, {})
    assert sorted(fake.submitted) == sorted(tts.split_sentences(SCRIPT))
    assert set(fake.speeds) == {"1"}


def test_a_take_with_a_slip_is_asked_for_again_and_paid_for(tmp_path, monkeypatch):
    fake = Recording(tmp_path)
    monkeypatch.setenv("TTS_PARALLELISM", "1")  # one part at a time, so the answers below come in order
    answers = ["It cost fifty million dollars.", "It cost 15 million dollars.", "The seam burned."]
    monkeypatch.setattr(align, "transcribe_words", lambda part, lang: [
        align.Heard(w, 0.2 * k, 0.2 * k + 0.1) for k, w in enumerate(answers.pop(0).split())])
    ctx = narrate(tmp_path, monkeypatch, fake, SCRIPT,
                  {"speakable": True, "request_unit": "sentence", "review": {"enabled": True, "takes": 3}})
    assert fake.submitted.count("It cost 15 million dollars.") == 2
    report = json.loads((ctx.folder / "narration_review.json").read_text())
    by_part = {r["part"]: r for r in report["reviewed"]}
    assert by_part[1]["takes"] == 2 and by_part[1]["slips"] == []
    assert by_part[2]["takes"] == 1
    assert _billed_chars(ctx) == [2 * len("It cost 15 million dollars.") + len("The seam burned.")]
    assert not list((ctx.folder).glob("tts_parts/*take*"))


def test_the_best_take_stays_when_every_take_slips(tmp_path, monkeypatch):
    fake = Recording(tmp_path)
    monkeypatch.setattr(align, "transcribe_words",
                        lambda part, lang: [align.Heard(w, 0, 0.1) for w in "something else entirely".split()])
    ctx = narrate(tmp_path, monkeypatch, fake, "The seam burned.", {"review": {"enabled": True, "takes": 2}})
    assert fake.submitted.count("The seam burned.") == 2
    report = json.loads((ctx.folder / "narration_review.json").read_text())
    assert report["reviewed"][0]["takes"] == 2 and report["reviewed"][0]["slips"]
    assert (ctx.folder / "audio.mp3").exists()


def test_a_number_whisper_split_is_glued_back_before_the_comparison():
    """Measured on a real ai33 take (2026-09-30): Whisper's word timestamps
    gave "2" + ",750" and "$3" + ".5"; joined with spaces, a correct take read
    as "two seven hundred" and was asked for again three times."""
    heard = [align.Heard(w, 0, 0) for w in "By 1962 the town had 2 ,750 residents. It cost $3 .5 million.".split()]
    text = tts.heard_text(heard)
    assert text == "By 1962 the town had 2,750 residents. It cost $3.5 million."
    assert review.slips("By 1962 the town had 2,750 residents. It cost 3.5 million dollars.", text, "en") == []
