"""The directed-edit A/B report (docs/05-roadmap/directed-edit-test.md, slice 5).

Two synthetic arms on the script and block of the first hand run: a control on
faceless_v3 and a directed fork, sharing the narration files byte for byte.
The report must pair them in either order, say when a pair is not clean, count
overlays by the catalog's class, read the round-trips off the paste log, and
turn filled score sheets into the adopt/stop verdict of Part 2.
"""

from __future__ import annotations

import copy
import json
import random
from pathlib import Path

import lusora_contracts
import pytest
from lusora_contracts.pipelines import load_pipeline

from lusora_worker import ab_report
from lusora_worker.ab_report import RUBRIC, ReportError, ScoresIncomplete

FIXTURES = lusora_contracts.CONTRACTS_ROOT / "fixtures"
RULES = json.loads((FIXTURES / "rules" / "edit_hints_rules.json").read_text(encoding="utf-8"))
HINTS = json.loads((FIXTURES / "edit_hints.json").read_text(encoding="utf-8"))
SCRIPT: str = RULES["script"]
DURATION = 111.0


@pytest.fixture(autouse=True)
def _no_database(monkeypatch):
    # The report degrades without a database; the tests must not reach the real one.
    monkeypatch.delenv("DATABASE_URL", raising=False)


def _beats(size: int) -> list[dict]:
    """The script cut into runs of `size` words: whole words, no retyping."""
    words = SCRIPT.split()
    return [
        {"id": f"b{n + 1}", "kind": "narration", "script_text": " ".join(words[i:i + size]),
         "visual_intent": f"shot {n}", "queries": ["q"], "mood": "curious" if n < 4 else "warm"}
        for n, i in enumerate(range(0, len(words), size))
    ]


def _plan(beats: list[dict], overlays: list[dict]) -> dict:
    step = DURATION / len(beats)
    return {
        "version": "1.0",
        "tracks": {
            "visual": [
                {"id": f"v_{b['id']}", "beat_id": b["id"], "start_s": round(i * step, 3),
                 "end_s": round((i + 1) * step, 3),
                 "asset": {"source": "stock", "provider": "pexels", "id": b["id"], "query": b["visual_intent"]}}
                for i, b in enumerate(beats)
            ],
            "overlays": overlays,
            "audio": {"voiceover": {"path": "audio.mp3", "start_s": 0, "duration_s": DURATION}, "music": [{}, {}]},
        },
    }


def _cfg(pipeline: str) -> dict:
    return {
        "channel_id": "DIRECTED_TEST_01",
        "style_pack": "directed-test",
        "style_pack_doc": json.loads((lusora_contracts.CONTRACTS_ROOT / "style-packs" / "directed-test.json").read_text()),
        "voice": {"provider": "ai33", "voice_id": "x"},
        "pipeline": pipeline,
        "pipeline_doc": load_pipeline(pipeline),
    }


def _arm(root: Path, video_id: str, pipeline: str, beats: list[dict], overlays: list[dict]) -> Path:
    folder = root / video_id
    folder.mkdir(parents=True)
    (folder / "cfg.json").write_text(json.dumps(_cfg(pipeline)), encoding="utf-8")
    (folder / "script.txt").write_text(SCRIPT, encoding="utf-8")
    (folder / "audio.mp3").write_bytes(b"\x01\x02")
    (folder / "subtitles.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nx\n", encoding="utf-8")
    (folder / "tts_timings.json").write_text("{}", encoding="utf-8")
    (folder / "beats.json").write_text(json.dumps({"beats": beats}), encoding="utf-8")
    (folder / "beat_cuts.json").write_text(json.dumps({"cuts": [{"script_text": b["script_text"]} for b in beats]}), encoding="utf-8")
    (folder / "edit_plan.json").write_text(json.dumps(_plan(beats, overlays)), encoding="utf-8")
    return folder


@pytest.fixture
def arms(tmp_path, monkeypatch):
    root = tmp_path / "videos"
    monkeypatch.setenv("VIDEOS_ROOT", str(root))
    control = _arm(root, "vid_control", "faceless_v3", _beats(12),
                   [{"component": "TextCounter"}, {"component": "TextTitle"}])
    (control / "overlays.json").write_text(json.dumps({"selections": [{}, {}, {}]}), encoding="utf-8")
    directed_beats = _beats(9)
    directed_beats[0]["overlay"] = {"component": "TextTitle"}
    directed_beats[3]["overlay"] = {"component": "TextCounter"}
    directed = _arm(root, "vid_directed", "faceless_directed", directed_beats,
                    [{"component": "TextTitle"}, {"component": "TextCounter"}])
    (directed / "edit_hints.json").write_text(json.dumps(HINTS, ensure_ascii=False), encoding="utf-8")
    (directed / "ab_fork.json").write_text(json.dumps({"from": "vid_control"}), encoding="utf-8")
    return root


def test_the_arms_pair_in_either_order_and_from_the_fork_alone(arms):
    for ids in (["vid_control", "vid_directed"], ["vid_directed", "vid_control"], ["vid_directed"]):
        control, other = ab_report.pair(ids, arms)
        assert (control.video_id, other.video_id) == ("vid_control", "vid_directed")
        assert other.directed and not control.directed


def test_two_directed_arms_or_one_unforked_id_are_refused(arms):
    with pytest.raises(ReportError, match="not a fork"):
        ab_report.pair(["vid_control"], arms)
    cfg = json.loads((arms / "vid_control" / "cfg.json").read_text())
    cfg.update(pipeline="faceless_directed", pipeline_doc=load_pipeline("faceless_directed"))
    (arms / "vid_control" / "cfg.json").write_text(json.dumps(cfg))
    with pytest.raises(ReportError, match="both videos run the directed"):
        ab_report.pair(["vid_control", "vid_directed"], arms)


def test_a_clean_pair_says_so_and_a_dirty_one_names_why(arms):
    control, other = ab_report.pair(["vid_directed"], arms)
    assert ab_report.integrity(control, other) == []

    (arms / "vid_directed" / "script.txt").write_text(SCRIPT + "\n", encoding="utf-8")
    (arms / "vid_directed" / "tts_timings.json").unlink()
    cfg = json.loads((arms / "vid_directed" / "cfg.json").read_text())
    cfg["theme"] = "paper-print"
    (arms / "vid_directed" / "cfg.json").write_text(json.dumps(cfg))
    (arms / "vid_directed" / "overlays.json").write_text("{}")
    (arms / "vid_control" / "edit_hints.json").write_text("{}")
    control, other = ab_report.pair(["vid_directed"], arms)
    problems = ab_report.integrity(control, other)
    assert "script.txt differs between the arms" in problems
    assert "tts_timings.json is in one arm only" in problems
    assert "the snapshots differ beyond the pipeline: theme" in problems
    assert any("control vid_control has an edit_hints.json" in p for p in problems)
    assert any("directed arm vid_directed has an overlays.json" in p for p in problems)


def test_overlays_are_classed_by_the_catalog_and_drops_counted(arms):
    control, other = ab_report.pair(["vid_directed"], arms)
    c = ab_report.overlay_stats(control)
    assert (c["anchor"], c["emphasis"]) == (1, 1)  # TextCounter takes a figure; TextTitle none
    assert (c["decided"], c["dropped"]) == (3, 1)  # the selection had three
    assert c["per_minute"] == round(2 * 60 / DURATION, 2)
    d = ab_report.overlay_stats(other)
    assert (d["decided"], d["dropped"]) == (2, 0)  # read off the sheet: no overlays.json
    assert d["emphasis_budget"] > 100  # directed-test: no practical limit


def test_the_table_prints_without_a_database(arms):
    control, other = ab_report.pair(["vid_directed"], arms)
    row = ab_report.build(control, other)
    text = ab_report.format_table(row)
    assert "(no database)" in text
    assert "pair is clean" in text
    assert "directed: 3 sections, 15 pins (13 graphics, 9 key shots)" in text
    assert "no edit_pass.json" in text
    json.dumps(row)  # --json must serialise


def test_key_shots_are_found_in_both_arms_at_the_same_words(arms):
    control, other = ab_report.pair(["vid_directed"], arms)
    moments = ab_report.key_moments(control, other)
    assert len(moments) == 9
    first = moments[0]
    assert first["at"].startswith("Cinco coisas")
    assert first["t"] == 0.0
    assert first["control"].startswith("pexels:") and first["directed"].startswith("pexels:")
    assert all("t" in m for m in moments)


def test_round_trips_come_from_the_paste_log(arms, tmp_path):
    log = tmp_path / "log.jsonl"
    lines = [
        {"ts": "2026-09-24T10:00:00Z", "event": "check", "paste_session": "s1", "block_sha256": "a", "errors": ["x", "y"]},
        {"ts": "2026-09-24T10:03:00Z", "event": "check", "paste_session": "s1", "block_sha256": "b", "errors": []},
        {"ts": "2026-09-24T10:03:30Z", "event": "check", "paste_session": "other", "block_sha256": "c", "errors": []},
        {"ts": "2026-09-24T10:04:30Z", "event": "submit", "paste_session": "s1", "video_id": "vid_directed"},
    ]
    log.write_text("\n".join(json.dumps(l) for l in lines) + "\nnot json\n", encoding="utf-8")
    (arms / "vid_directed" / "edit_pass.json").write_text(json.dumps({"paste_session": "s1", "attempts": 2}))
    _control, other = ab_report.pair(["vid_directed"], arms)
    human = ab_report.human_stats(other, log)
    assert human == {"paste_session": "s1", "round_trips": 2, "repairs": 1, "errors_per_paste": [2, 0], "minutes": 4.5}


def _fill(folder: Path, x: dict, y: dict, publish: str) -> None:
    sheet = json.loads((folder / "scores.json").read_text())
    sheet.update(X=x, Y=y, publish=publish)
    (folder / "scores.json").write_text(json.dumps(sheet))


def test_blind_keeps_its_coin_and_unblinds_by_arm(arms, tmp_path, capsys):
    control, other = ab_report.pair(["vid_directed"], arms)
    row = ab_report.build(control, other)
    evals = tmp_path / "evals"
    folder = ab_report.blind(row, control, other, evals, random.Random(1))
    key = json.loads((folder / "key.json").read_text())
    out = capsys.readouterr().out
    assert f"/editor/{key['X']}" in out and f"/editor/{key['Y']}" in out
    assert "faceless" not in out and "control" not in out.replace("vid_control", "")
    ab_report.blind(row, control, other, evals, random.Random(2))
    assert json.loads((folder / "key.json").read_text()) == key, "a second --blind must not flip again"

    with pytest.raises(ScoresIncomplete, match="missing"):
        ab_report.read_scores(folder)
    directed_letter = "X" if key["X"] == "vid_directed" else "Y"
    better, worse = {k: 4 for k in RUBRIC}, {k: 3 for k in RUBRIC}
    x, y = (better, worse) if directed_letter == "X" else (worse, better)
    _fill(folder, x, y, publish=directed_letter)
    scores = ab_report.read_scores(folder)
    assert scores["delta"] == {k: 1 for k in RUBRIC}
    assert scores["publish"] == "other"


def test_a_score_outside_one_to_five_is_refused(arms, tmp_path, capsys):
    control, other = ab_report.pair(["vid_directed"], arms)
    folder = ab_report.blind(ab_report.build(control, other), control, other, tmp_path, random.Random(1))
    _fill(folder, {k: 6 for k in RUBRIC}, {k: 3 for k in RUBRIC}, "X")
    with pytest.raises(ScoresIncomplete, match="out of 1-5"):
        ab_report.read_scores(folder)


def _row(win: bool, delta: float = 1.0, round_trips: int = 1, minutes: float = 3.0) -> dict:
    return {
        "scores": {"publish": "other" if win else "control", "delta": {k: delta for k in RUBRIC}},
        "human": {"round_trips": round_trips, "repairs": round_trips - 1, "minutes": minutes},
        "failures": {"control": 0, "other": 0},
    }


def test_the_verdict_follows_the_adopt_and_stop_rules():
    assert ab_report.verdict([_row(True)] * 4 + [_row(False)])["outcome"].startswith("ADOPT")
    assert ab_report.verdict([_row(True)] * 2 + [_row(False)] * 3)["outcome"] == "STOP"
    assert ab_report.verdict([_row(True)] * 3)["outcome"].startswith("NOT YET")
    # four wins, but one video took three round-trips (decision 4)
    rows = [_row(True)] * 3 + [_row(True, round_trips=3), _row(False)]
    v = ab_report.verdict(rows)
    assert v["checks"]["no video at >= 3 round-trips"] is False
    assert v["outcome"].startswith("NO ADOPT")
    # preferred, but a category went backwards
    rows = [copy.deepcopy(_row(True)) for _ in range(4)] + [_row(False)]
    for r in rows:
        r["scores"]["delta"]["overlay_timing"] = -1
    assert ab_report.verdict(rows)["checks"]["no category <= -0.5"] is False


def test_the_summary_reads_every_scored_pair(arms, tmp_path, capsys):
    control, other = ab_report.pair(["vid_directed"], arms)
    evals = tmp_path / "evals"
    folder = ab_report.blind(ab_report.build(control, other), control, other, evals, random.Random(3))
    capsys.readouterr()
    assert "skipped" in ab_report.summary(evals, arms)  # not scored yet
    key = json.loads((folder / "key.json").read_text())
    directed_letter = "X" if key["X"] == "vid_directed" else "Y"
    _fill(folder, {k: 4 for k in RUBRIC}, {k: 4 for k in RUBRIC}, publish=directed_letter)
    text = ab_report.summary(evals, arms)
    assert "1 scored pair(s), directed preferred on 1" in text
    assert "verdict: NOT YET (1 of 5 scored pairs)" in text
