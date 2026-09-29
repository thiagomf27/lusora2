"""Stopping a video whose footage is thin (D105).

The user, after the first render with internet footage: "some themes will not
have a satisfactory quantity of videos or quality, so it would be good to have
a previous step to check this or an option to wait for the approval". Three
checks answer it: an early topic check right after the subjects pass, a
coverage check after the shot judge, and — in review mode — a stop after the
judge whatever the numbers. The first two are REQUESTED gates: a stage asks
for a human about its own output, on any video, and the same approval file a
review-mode gate uses lets it continue.
"""

import json
from types import SimpleNamespace

import pytest

from lusora_worker.agents import gather_footage as gf
from lusora_worker.pipeline import checkpoints
from lusora_worker.providers import footage
from lusora_worker.providers.llm import LLMResult

from test_gather_footage import ctx_for, write_video
from test_pipelines import _review_db


def _manifest(policy="auto"):
    return {"name": "g", "version": "1.0", "default_checkpoint_policy": policy, "stages": [
        {"name": "check", "produces": ["check.json"]},
        {"name": "render", "requires": ["check.json"], "produces": ["final.mp4"]},
    ]}


def _run(tmp_path, monkeypatch, thin: bool, folder_name="vid_r"):
    from lusora_worker.pipeline import orchestrator
    from lusora_worker.pipeline import stages as stages_mod

    ran: list[str] = []

    def check(ctx):
        ran.append("check")
        ctx.write_json("check.json", {})
        if thin:
            checkpoints.request(ctx, "check", "only 2 of 9 subjects have footage online")

    def render(ctx):
        ran.append("render")
        (ctx.folder / "final.mp4").write_text("x")

    monkeypatch.setitem(stages_mod.STEP_REGISTRY, "check", stages_mod.Step(check))
    monkeypatch.setitem(stages_mod.STEP_REGISTRY, "render", stages_mod.Step(render))
    (tmp_path / folder_name).mkdir(exist_ok=True)
    db = _review_db()
    orchestrator.process_video(db, SimpleNamespace(videos_root=tmp_path, worker_id="w"),
                               {"id": folder_name, "channel_id": "CH", "title": "T",
                                "cfg": {"pipeline_doc": _manifest()}})
    return ran, db, tmp_path / folder_name


def test_a_requested_gate_stops_even_an_auto_video(tmp_path, monkeypatch):
    ran, db, folder = _run(tmp_path, monkeypatch, thin=True)
    assert ran == ["check"], "nothing past the stage that asked runs"
    assert db.statuses == [("awaiting_approval", None)]
    assert any("only 2 of 9 subjects" in (m or "") for _s, _k, m in db.events), "the reason reaches the log"


def test_a_healthy_stage_asks_nothing(tmp_path, monkeypatch):
    ran, db, _ = _run(tmp_path, monkeypatch, thin=False)
    assert ran == ["check", "render"] and db.statuses == [("rendered", None)]


def test_the_same_approval_file_lets_it_continue(tmp_path, monkeypatch):
    ran, db, folder = _run(tmp_path, monkeypatch, thin=True)
    (folder / "approvals").mkdir()
    (folder / "approvals" / "check.json").write_text('{"approved_by": "me"}')
    ran2, db2, _ = _run(tmp_path, monkeypatch, thin=True)
    assert ran2 == ["render"], "the check is done and approved; the request stands but is answered"
    assert db2.statuses == [("rendered", None)]


def test_a_stage_that_runs_again_drops_its_old_request(tmp_path, monkeypatch):
    """A request is about the output it was raised on. The check re-runs when
    its artifact is removed, and a healthy second answer must not stop."""
    ran, db, folder = _run(tmp_path, monkeypatch, thin=True)
    (folder / "check.json").unlink()
    ran2, db2, _ = _run(tmp_path, monkeypatch, thin=False)
    assert ran2 == ["check", "render"] and db2.statuses == [("rendered", None)]


# ---------------- the topic check ----------------


def test_the_topic_check_counts_footage_per_subject_and_stops_a_thin_one(tmp_path, monkeypatch):
    from lusora_worker.pipeline import steps

    write_video(tmp_path)
    monkeypatch.setenv("YTDLP_PROXY", "direct")
    good = [{"id": f"y{k}", "title": f"Centralia fire {k}", "channel": "c", "duration": 300, "views": 1,
             "url": f"https://youtube.com/watch?v=y{k}"} for k in range(3)]
    monkeypatch.setattr(footage, "youtube_search", lambda q, n=8: good if "Centralia mine fire" in q else [])
    monkeypatch.setattr(footage, "commons_photos", lambda q, n=2, min_width=1000, safety=True: ([], []))
    ctx = ctx_for(tmp_path, {"enabled": True, "check_min_share": 0.75})
    steps.run_footage_check(ctx)
    doc = json.loads((tmp_path / "footage_check.json").read_text())
    assert doc["subjects"]["s1"]["youtube"] == 3 and doc["thin"] == ["s2"]
    assert checkpoints.requested(ctx, "footage_check"), "1 of 2 covered is under 75%"
    assert "thin topic: only 1 of 2 subjects" in checkpoints.request_reason(ctx, "footage_check")
    report = (tmp_path / "footage_report.md").read_text()
    assert "| s2 ⚠ the coal town | Centralia 1890s | 0 | 0 |" in report


def test_a_covered_topic_runs_on_and_the_footage_stage_reuses_its_searches(tmp_path, monkeypatch):
    from lusora_worker.pipeline import steps

    write_video(tmp_path)
    monkeypatch.setenv("YTDLP_PROXY", "direct")
    asked = []
    result = [{"id": "y1", "title": "Centralia footage", "channel": "c", "duration": 300, "views": 1,
               "url": "https://youtube.com/watch?v=y1"}] * 2

    def search(q, n=8):
        asked.append(q)
        return [dict(r, id=f"{q[:3]}{k}") for k, r in enumerate(result)]

    monkeypatch.setattr(footage, "youtube_search", search)
    monkeypatch.setattr(footage, "commons_photos", lambda q, n=2, min_width=1000, safety=True: ([], []))
    ctx = ctx_for(tmp_path, {"enabled": True, "photos": False}, planner="mock")
    steps.run_footage_check(ctx)
    assert not checkpoints.requested(ctx, "footage_check")
    searched = len(asked)
    monkeypatch.setattr(footage, "youtube_download", lambda vid, dest: None)
    gf.gather(ctx)
    assert len(asked) == searched, "gather_footage asked YouTube nothing the check had not"


def test_footage_off_checks_nothing(tmp_path):
    from lusora_worker.pipeline import steps

    write_video(tmp_path)
    ctx = ctx_for(tmp_path)
    steps.run_footage_check(ctx)
    assert not checkpoints.requested(ctx, "footage_check")
    assert json.loads((tmp_path / "footage_check.json").read_text())["subjects"] == {}


# ---------------- the coverage check ----------------


@pytest.mark.parametrize("ratings, stops", [([4, 4, 4, 2], True), ([4, 4, 4, 4], False)])
def test_thin_coverage_after_the_judge_stops_before_the_render(tmp_path, monkeypatch, ratings, stops):
    from lusora_worker.pipeline import steps

    from test_pick_shots import OfferingStock
    from lusora_worker.providers import sources
    from lusora_worker.agents import pick_shots

    items = write_video(tmp_path)  # four shots
    monkeypatch.setitem(sources.ADAPTERS, "stock", OfferingStock({it["id"]: [f"c{k}"] for k, it in enumerate(items)}))
    monkeypatch.setattr(pick_shots, "_thumb", lambda url, dest: (dest.write_bytes(b""), False)[1])
    monkeypatch.setattr(pick_shots, "build_sheet", lambda workdir, rows, first, cols, name, numbers_only=False: (
        tmp_path / "sheet.jpg", [(r, c) for r, row in enumerate(rows) for c in row]))

    def see(*_a):
        return LLMResult(text=json.dumps({"ratings": [{"n": n, "rating": r} for n, r in enumerate(ratings)]}),
                         input_tokens=1, output_tokens=1)

    monkeypatch.setattr(pick_shots, "judge", lambda ctx, sheet, rows_text, count, conf, see_fn, label:
                        [{"n": n, "rating": r} for n, r in enumerate(ratings)])
    ctx = ctx_for(tmp_path, chain=[{"source": "stock"}])
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True, "min_coverage": 0.8}
    steps.run_pick_shots(ctx)
    assert checkpoints.requested(ctx, "pick_shots") is stops
    if stops:
        assert "3 of 4 shots have a candidate rated 3+" in checkpoints.request_reason(ctx, "pick_shots")
        assert "| b3 | line 3 | 2" in (tmp_path / "footage_report.md").read_text()


def test_search_more_judges_new_candidates_for_the_asked_shots_and_stops_again(tmp_path, monkeypatch):
    """D108: at the footage gate a person asks for more on one shot instead of
    approving. Only that shot is judged again, on what it has not been shown;
    everything already rated stays; the video stops again for review."""
    from lusora_worker.agents import pick_shots
    from lusora_worker.pipeline import steps
    from lusora_worker.providers import sources

    from test_pick_shots import QueryStock

    items = write_video(tmp_path, beats_subjects=("s1", "s2"))
    beats = json.loads((tmp_path / "beats.json").read_text())
    beats["beats"][0]["queries"] = ["first ask", "second ask"]
    (tmp_path / "beats.json").write_text(json.dumps(beats))
    stock = QueryStock({"first ask": ["a"], "second ask": ["b"], "q1": ["c"]})
    monkeypatch.setitem(sources.ADAPTERS, "stock", stock)
    monkeypatch.setattr(pick_shots, "_thumb", lambda url, dest: (dest.write_bytes(b""), True)[1])
    monkeypatch.setattr(pick_shots, "build_sheet", lambda workdir, rows, first, cols, name, numbers_only=False: (
        tmp_path / "sheet.jpg", [(r, c) for r, row in enumerate(rows) for c in row]))
    judged = []

    def judge(ctx, sheet, rows_text, count, conf, see_fn, label):
        judged.append(count)
        return [{"n": n, "rating": 4} for n in range(count)]

    monkeypatch.setattr(pick_shots, "judge", judge)
    (tmp_path / "shot_picks.json").write_text(json.dumps({
        "version": "1.0", "video_id": "vid_f", "enabled": True, "sheets": 1, "unjudged": [],
        "items": {"v0": {"beat_id": "b0", "candidates": [{"source": "stock", "provider": "pexels", "id": "a",
                                                          "query": "first ask", "rating": 2}]},
                  "v1": {"beat_id": "b1", "candidates": [{"source": "stock", "provider": "pexels", "id": "c",
                                                          "query": "q1", "rating": 5}]}}}))
    (tmp_path / "footage_requests.json").write_text(json.dumps({"requests": [{"item_id": "v0"}]}))
    ctx = ctx_for(tmp_path, chain=[{"source": "stock"}])
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True}
    assert not steps.picks_fresh(ctx), "a pending request makes the stage run again"
    steps.run_pick_shots(ctx)
    doc = json.loads((tmp_path / "shot_picks.json").read_text())
    assert [(c["id"], c["rating"]) for c in doc["items"]["v0"]["candidates"]] == [("b", 4), ("a", 2)]
    assert doc["items"]["v1"]["candidates"][0]["id"] == "c", "a shot nobody asked about is untouched"
    assert stock.asked[-1][0] == "second ask" and "first ask" not in stock.asked[-1], \
        "without typed words it asks what the shot was not asked"
    assert judged == [1]
    assert not (tmp_path / "footage_requests.json").exists()
    assert json.loads((tmp_path / "footage_requests.done.json").read_text())["requests"] == [{"item_id": "v0"}]
    assert checkpoints.requested(ctx, "pick_shots") and "searched more for 1 shots" in \
        checkpoints.request_reason(ctx, "pick_shots"), "it stops again, even with coverage fine"
    assert steps.picks_fresh(ctx)


def test_typed_words_are_searched_as_typed(tmp_path, monkeypatch):
    from lusora_worker.agents import gather_footage, pick_shots

    from test_pick_shots import QueryStock
    from lusora_worker.providers import sources

    items = write_video(tmp_path, beats_subjects=("s1",))
    stock = QueryStock({"centralia gas station": ["z"]})
    monkeypatch.setitem(sources.ADAPTERS, "stock", stock)
    monkeypatch.setattr(pick_shots, "judge", lambda *a: [{"n": 0, "rating": 5}])
    monkeypatch.setattr(pick_shots, "build_sheet", lambda workdir, rows, first, cols, name, numbers_only=False: (
        tmp_path / "sheet.jpg", [(r, c) for r, row in enumerate(rows) for c in row]))
    fetched = []
    monkeypatch.setattr(gather_footage, "fetch_one_video", lambda ctx, q, sid, see_fn=None: fetched.append((q, sid)))
    ctx = ctx_for(tmp_path, chain=[{"source": "stock"}])
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True}
    doc = {"version": "1.0", "video_id": "vid_f", "enabled": True, "sheets": 0, "unjudged": ["v0"], "items": {}}
    beat = {"id": "b0", "subject": "s1"}
    added = pick_shots.research(ctx, doc, [(items[0], beat, ["q0"], "centralia gas station")], [{"source": "stock"}])
    assert fetched == [("centralia gas station", "s1")], "one new YouTube video for the beat's subject"
    assert stock.asked[-1] == ["centralia gas station"] and added == 1
    assert doc["items"]["v0"]["candidates"][0]["id"] == "z" and doc["unjudged"] == []


def test_review_mode_always_stops_after_the_judge():
    from lusora_contracts.pipelines import load_pipeline

    assert "pick_shots" in checkpoints.gated_stages(load_pipeline("documentary"))
