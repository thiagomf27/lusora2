"""D60: the stage list is data, and the manifest agrees with the worker.

The load-bearing claim of the refactor is that nothing about a faceless run
changed — so the first test pins the exact stage order and done-check the
hardcoded STAGES constant had.
"""

import pytest
import yaml
from lusora_contracts.pipelines import (
    DEFAULT_PIPELINE,
    PipelineError,
    check_requires,
    list_pipelines,
    load_pipeline,
    stage_names,
    validate_pipeline,
)

from lusora_worker.pipeline import steps
from lusora_worker.pipeline.stages import (
    STEP_REGISTRY,
    UnknownStageError,
    build_stages,
)

# The list as it stood in worker/lusora_worker/pipeline/stages.py before the
# manifest existed: (name, asserted artifact, done-check). Changing this test
# means changing what a faceless video does, which is a decision-log matter.
PRE_REFACTOR = [
    ("script", "script.txt", None),
    ("narration", "audio.mp3", None),
    ("transcript", "subtitles.srt", None),
    ("plan_beats", "beats.json", None),
    ("compile_plan", "edit_plan.json", steps.plan_compiled_and_fresh),
    ("resolve_assets", "clips/", steps.assets_resolved),
    ("resolve_audio", "audio/", steps.audio_resolved),
    ("validate", None, None),
    ("render", "final.mp4", steps.render_fresh),
    ("qa", None, None),
    ("finalize", "thumb.jpg", steps.finalize_fresh),
]


def test_faceless_is_the_pre_refactor_stage_list():
    stages = build_stages(load_pipeline("faceless"))
    assert [(s.name, s.artifact, s.is_done) for s in stages] == PRE_REFACTOR


def test_default_pipeline_exists_and_is_production():
    manifest = load_pipeline(DEFAULT_PIPELINE)
    assert DEFAULT_PIPELINE in list_pipelines()
    assert manifest["stability"] == "production"


def test_every_shipped_manifest_binds_to_the_registry():
    """A manifest naming a stage no worker build has is the one failure mode
    data-driven stages introduce; CI catches it for every shipped pipeline."""
    for name in list_pipelines():
        manifest = load_pipeline(name)
        for stage in stage_names(manifest):
            assert stage in STEP_REGISTRY, f"{name}.yaml names unknown stage {stage!r}"
        build_stages(manifest)


def test_unknown_stage_fails_at_build_not_mid_video():
    manifest = {"name": "bogus", "version": "1.0", "stages": [{"name": "teleport"}]}
    with pytest.raises(UnknownStageError, match="teleport"):
        build_stages(manifest)


def test_stages_producing_nothing_always_run():
    stages = {s.name: s for s in build_stages(load_pipeline("faceless"))}
    # validate judges the plan, qa judges the file: neither emits an artifact,
    # so neither may ever be skipped as "already done"
    for name in ("validate", "qa"):
        assert stages[name].artifact is None
        assert stages[name].is_done is None


def test_missing_pipeline_names_the_ones_that_exist():
    with pytest.raises(PipelineError, match="faceless"):
        load_pipeline("no-such-pipeline")


def test_schema_violations_are_rejected():
    with pytest.raises(PipelineError, match="schema violations"):
        validate_pipeline({"name": "x", "version": "1.0"})  # no stages
    with pytest.raises(PipelineError, match="schema violations"):
        validate_pipeline({"name": "x", "version": "1.0", "stages": [{"name": "script", "invented": 1}]})


def test_duplicate_stage_is_rejected():
    doc = {"name": "x", "version": "1.0", "stages": [{"name": "validate"}, {"name": "validate"}]}
    with pytest.raises(PipelineError, match="duplicate stage"):
        validate_pipeline(doc)


def test_requires_must_be_produced_by_an_earlier_stage():
    doc = {
        "name": "x",
        "version": "1.0",
        "stages": [
            {"name": "render", "requires": ["edit_plan.json"], "produces": ["final.mp4"]},
            {"name": "compile_plan", "requires": ["beats.json"], "produces": ["edit_plan.json"]},
        ],
    }
    # edit_plan.json IS a bootstrap artifact (manual-first upload), so the
    # order above is legal; a genuinely undeclared artifact is not
    check_requires(doc)
    doc["stages"][0]["requires"] = ["storyboard.json"]
    with pytest.raises(PipelineError, match="storyboard.json"):
        check_requires(doc)


def test_a_manifest_edited_while_the_worker_runs_is_picked_up(tmp_path, monkeypatch):
    """Same reasoning as the catalog and the sound packs: the worker is a
    long-lived poller, and a stale stage list would need a restart to fix."""
    import lusora_contracts.pipelines as p

    monkeypatch.setattr(p, "PIPELINES_DIR", tmp_path)
    p.load_pipeline.cache_clear()
    doc = {"name": "tiny", "version": "1.0", "stages": [{"name": "validate"}]}
    path = tmp_path / "tiny.yaml"
    path.write_text(yaml.safe_dump(doc), encoding="utf-8")
    try:
        assert stage_names(p.load_pipeline("tiny")) == ["validate"]
        doc["stages"].append({"name": "render", "produces": ["final.mp4"]})
        doc["version"] = "1.1"
        path.write_text(yaml.safe_dump(doc), encoding="utf-8")
        assert stage_names(p.load_pipeline("tiny")) == ["validate", "render"], "cache went stale"
    finally:
        p.load_pipeline.cache_clear()


def test_manifest_name_must_match_its_filename(tmp_path, monkeypatch):
    import lusora_contracts.pipelines as p

    monkeypatch.setattr(p, "PIPELINES_DIR", tmp_path)
    p.load_pipeline.cache_clear()
    (tmp_path / "alpha.yaml").write_text(
        yaml.safe_dump({"name": "beta", "version": "1.0", "stages": [{"name": "validate"}]}),
        encoding="utf-8",
    )
    try:
        with pytest.raises(PipelineError, match="expected 'alpha'"):
            p.load_pipeline("alpha")
    finally:
        p.load_pipeline.cache_clear()


# ---------------- selection at run time (the snapshot rule) ----------------


def _ctx(tmp_path, cfg):
    from lusora_worker.context import StageContext

    from test_agents import FakeDb

    return StageContext(
        video={"id": "vid_p", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg=cfg,
        db=FakeDb(),
        config=None,
    )


def test_a_cfg_naming_no_pipeline_runs_the_default(tmp_path):
    from lusora_worker.pipeline.orchestrator import resolve_pipeline

    assert resolve_pipeline(_ctx(tmp_path, {}))["name"] == DEFAULT_PIPELINE


def test_the_snapshot_wins_over_the_file_on_disk(tmp_path):
    """Principle 7: editing faceless.yaml must not change a video already
    enqueued against it, and a re-run must walk the stages it was built with."""
    from lusora_worker.pipeline.orchestrator import resolve_pipeline

    snapshot = {"name": "faceless", "version": "0.9", "stages": [{"name": "validate"}]}
    resolved = resolve_pipeline(_ctx(tmp_path, {"pipeline": "faceless", "pipeline_doc": snapshot}))
    assert stage_names(resolved) == ["validate"]
    assert resolved["version"] == "0.9"


def test_a_corrupt_snapshot_is_rejected_rather_than_walked(tmp_path):
    from lusora_worker.pipeline.orchestrator import resolve_pipeline

    bad = {"name": "faceless", "version": "1.0", "stages": [{"name": "render"}, {"name": "render"}]}
    with pytest.raises(PipelineError, match="duplicate stage"):
        resolve_pipeline(_ctx(tmp_path, {"pipeline_doc": bad}))


# ---------------- the loop actually walks the manifest ----------------


def test_the_orchestrator_runs_the_manifest_order_and_skips_what_exists(tmp_path, monkeypatch):
    """The stage list is now data, so the loop reading it is what the old
    STAGES constant used to guarantee by construction."""
    from types import SimpleNamespace

    from lusora_worker.pipeline import orchestrator
    from lusora_worker.pipeline import stages as stages_mod

    from test_agents import FakeDb

    ran: list[str] = []

    def stub(name, artifact=None):
        def run(ctx):
            ran.append(name)
            if artifact:
                (ctx.folder / artifact).write_text("x", encoding="utf-8")

        return stages_mod.Step(run)

    for name, artifact in (("script", "script.txt"), ("validate", None), ("render", "final.mp4")):
        monkeypatch.setitem(stages_mod.STEP_REGISTRY, name, stub(name, artifact))

    class Db(FakeDb):
        def __init__(self):
            super().__init__()
            self.statuses = []

        def set_status(self, video_id, status, reason=None):
            self.statuses.append((status, reason))

        def heartbeat(self, worker_id, video_id):
            pass

    manifest = {
        "name": "tiny",
        "version": "2.0",
        "stages": [
            {"name": "script", "produces": ["script.txt"]},
            {"name": "validate"},  # judges: no artifact, runs every time
            {"name": "render", "requires": ["script.txt"], "produces": ["final.mp4"]},
        ],
    }
    folder = tmp_path / "vid_o"
    folder.mkdir()
    (folder / "script.txt").write_text("already here", encoding="utf-8")  # manual-first

    db = Db()
    config = SimpleNamespace(videos_root=tmp_path, worker_id="w1")
    orchestrator.process_video(
        db, config, {"id": "vid_o", "channel_id": "CH", "title": "T", "cfg": {"pipeline_doc": manifest}}
    )

    assert ran == ["validate", "render"], "script was uploaded — its stage must skip"
    assert db.statuses == [("rendered", None)]
    assert ("script", "done", "output already present — skipped") in db.events
    assert any(stage == "pipeline" and "tiny v2.0" in (msg or "") for stage, _, msg in db.events)


def test_an_unrunnable_pipeline_fails_the_video_with_one_reason(tmp_path):
    """Bad manifest, no work done: the video stops before the first stage."""
    from types import SimpleNamespace

    from lusora_worker.pipeline import orchestrator

    from test_agents import FakeDb

    class Db(FakeDb):
        def __init__(self):
            super().__init__()
            self.statuses = []

        def set_status(self, video_id, status, reason=None):
            self.statuses.append((status, reason))

        def heartbeat(self, worker_id, video_id):
            pass

    (tmp_path / "vid_x").mkdir()
    db = Db()
    orchestrator.process_video(
        db,
        SimpleNamespace(videos_root=tmp_path, worker_id="w1"),
        {
            "id": "vid_x",
            "channel_id": "CH",
            "title": "T",
            "cfg": {"pipeline_doc": {"name": "x", "version": "1.0", "stages": [{"name": "teleport"}]}},
        },
    )
    status, reason = db.statuses[0]
    assert status == "error"
    assert "teleport" in reason
    assert [(stage, st) for stage, st, _ in db.events if st == "failed"] == [("pipeline", "failed")]


# ---------------- review mode: the gates actually stop the loop (D62) ----------------


def _gated_manifest(policy="auto"):
    return {
        "name": "gated",
        "version": "1.0",
        "default_checkpoint_policy": policy,
        "stages": [
            {"name": "script", "produces": ["script.txt"], "human_approval_on_review_mode": True},
            {"name": "render", "requires": ["script.txt"], "produces": ["final.mp4"]},
        ],
    }


def _review_db():
    from test_agents import FakeDb

    class Db(FakeDb):
        def __init__(self):
            super().__init__()
            self.statuses = []

        def set_status(self, video_id, status, reason=None):
            self.statuses.append((status, reason))

        def heartbeat(self, worker_id, video_id):
            pass

    return Db()


def _run_gated(tmp_path, monkeypatch, cfg, folder_name="vid_g"):
    """Run a two-stage manifest whose first stage is a review gate."""
    from types import SimpleNamespace

    from lusora_worker.pipeline import orchestrator
    from lusora_worker.pipeline import stages as stages_mod

    ran: list[str] = []

    def stub(name, artifact):
        def run(ctx):
            ran.append(name)
            (ctx.folder / artifact).write_text("x", encoding="utf-8")

        return stages_mod.Step(run)

    for name, artifact in (("script", "script.txt"), ("render", "final.mp4")):
        monkeypatch.setitem(stages_mod.STEP_REGISTRY, name, stub(name, artifact))

    folder = tmp_path / folder_name
    folder.mkdir(exist_ok=True)
    db = _review_db()
    config = SimpleNamespace(videos_root=tmp_path, worker_id="w1")
    orchestrator.process_video(
        db, config, {"id": folder_name, "channel_id": "CH", "title": "T", "cfg": cfg}
    )
    return ran, db, folder


def test_auto_policy_ignores_the_gates(tmp_path, monkeypatch):
    """The flags are declarative: under auto they change nothing, which is what
    every video did before review mode existed (Principle 7)."""
    ran, db, _ = _run_gated(tmp_path, monkeypatch, {"pipeline_doc": _gated_manifest("auto")})
    assert ran == ["script", "render"]
    assert db.statuses == [("rendered", None)]


def test_guided_policy_stops_at_the_gate_and_renders_nothing(tmp_path, monkeypatch):
    """The load-bearing claim: nothing downstream of an unapproved gate runs."""
    ran, db, folder = _run_gated(
        tmp_path, monkeypatch, {"pipeline_doc": _gated_manifest("guided")}
    )
    assert ran == ["script"], "render is past the gate and must not have run"
    assert db.statuses == [("awaiting_approval", None)]
    assert not (folder / "final.mp4").exists()


def test_the_video_level_policy_overrides_the_manifest(tmp_path, monkeypatch):
    """Review mode is a policy ON a pipeline: the same manifest runs both ways,
    which is what stops a faceless-review.yaml fork existing."""
    ran, db, _ = _run_gated(
        tmp_path,
        monkeypatch,
        {"checkpoint_policy": "guided", "pipeline_doc": _gated_manifest("auto")},
    )
    assert ran == ["script"]
    assert db.statuses == [("awaiting_approval", None)]


def test_an_approval_file_lets_the_run_continue(tmp_path, monkeypatch):
    """The re-claim after approval: the artifact exists so the stage skips, and
    only the approval file can tell the loop to pass the gate."""
    folder = tmp_path / "vid_a"
    folder.mkdir()
    (folder / "script.txt").write_text("already written", encoding="utf-8")
    (folder / "approvals").mkdir()
    (folder / "approvals" / "script.json").write_text(
        '{"approved_by": "editor@example.com"}', encoding="utf-8"
    )

    ran, db, _ = _run_gated(
        tmp_path, monkeypatch, {"pipeline_doc": _gated_manifest("guided")}, folder_name="vid_a"
    )
    assert ran == ["render"], "script was already done; the gate was approved"
    assert db.statuses == [("rendered", None)]
    assert any("approved by editor@example.com" in (msg or "") for _, _, msg in db.events)


def test_an_unreadable_policy_falls_back_to_auto(tmp_path, monkeypatch):
    """A snapshot from before this existed must re-run byte-identically."""
    ran, db, _ = _run_gated(
        tmp_path,
        monkeypatch,
        {"checkpoint_policy": "nonsense", "pipeline_doc": _gated_manifest()},
    )
    assert ran == ["script", "render"]
    assert db.statuses == [("rendered", None)]


def test_faceless_gates_are_the_script_and_the_beat_sheet():
    """Where the shipped pipelines wait, pinned: nothing is narrated before the
    script is approved, and nothing is RENDERED before the beats are."""
    from lusora_worker.pipeline import checkpoints

    for name in ("faceless", "faceless_v2"):
        assert checkpoints.gated_stages(load_pipeline(name)) == ["script", "plan_beats"], name


def test_every_shipped_manifest_defaults_to_auto():
    """Review mode is opt-in per video; a manifest that gated by default would
    park every batch-enqueued video on a human."""
    for name in list_pipelines():
        manifest = load_pipeline(name)
        assert checkpoints_policy(manifest) == "auto", name


def checkpoints_policy(manifest):
    from lusora_worker.pipeline import checkpoints

    return checkpoints.policy({}, manifest)


# ---------------- review mode (D62) ----------------


def _review_db():
    """FakeDb that records statuses, so a test can prove the video was parked."""
    from test_agents import FakeDb

    class Db(FakeDb):
        def __init__(self):
            super().__init__()
            self.statuses = []

        def set_status(self, video_id, status, reason=None):
            self.statuses.append((status, reason))

        def heartbeat(self, worker_id, video_id):
            pass

    return Db()


REVIEW_MANIFEST = {
    "name": "gated",
    "version": "1.0",
    "default_checkpoint_policy": "auto",
    "stages": [
        {"name": "script", "produces": ["script.txt"], "human_approval_on_review_mode": True},
        {"name": "render", "requires": ["script.txt"], "produces": ["final.mp4"]},
    ],
}


def _run_gated(tmp_path, monkeypatch, cfg_extra, folder_name="vid_g"):
    from types import SimpleNamespace

    from lusora_worker.pipeline import orchestrator
    from lusora_worker.pipeline import stages as stages_mod

    ran: list[str] = []

    def stub(name, artifact):
        def run(ctx):
            ran.append(name)
            (ctx.folder / artifact).write_text("x", encoding="utf-8")

        return stages_mod.Step(run)

    monkeypatch.setitem(stages_mod.STEP_REGISTRY, "script", stub("script", "script.txt"))
    monkeypatch.setitem(stages_mod.STEP_REGISTRY, "render", stub("render", "final.mp4"))

    folder = tmp_path / folder_name
    folder.mkdir(exist_ok=True)
    db = _review_db()
    orchestrator.process_video(
        db,
        SimpleNamespace(videos_root=tmp_path, worker_id="w1"),
        {
            "id": folder_name,
            "channel_id": "CH",
            "title": "T",
            "cfg": {"pipeline_doc": REVIEW_MANIFEST, **cfg_extra},
        },
    )
    return ran, db, folder


def test_auto_policy_runs_straight_through_the_gate(tmp_path, monkeypatch):
    """The gates are declared on every video; under `auto` they do nothing.
    This is what makes review a POLICY rather than a second pipeline."""
    ran, db, _ = _run_gated(tmp_path, monkeypatch, {})
    assert ran == ["script", "render"]
    assert db.statuses == [("rendered", None)]


def test_guided_policy_stops_at_the_gate_before_rendering(tmp_path, monkeypatch):
    """The load-bearing claim: nothing downstream of an unapproved gate runs.
    `render` must not have executed."""
    ran, db, folder = _run_gated(tmp_path, monkeypatch, {"checkpoint_policy": "guided"})
    assert ran == ["script"], "render ran on unapproved work"
    assert db.statuses == [("awaiting_approval", None)]
    assert not (folder / "final.mp4").exists()


def test_an_approval_file_lets_the_re_claim_carry_on(tmp_path, monkeypatch):
    """Resume after approval: the stage is skipped (its artifact exists) and
    the gate passes (its approval exists), so only `render` runs."""
    ran, db, folder = _run_gated(tmp_path, monkeypatch, {"checkpoint_policy": "guided"})
    assert ran == ["script"]

    (folder / "approvals").mkdir()
    (folder / "approvals" / "script.json").write_text(
        '{"approved_by": "a@b.c", "approved_at": "2026-08-16T10:00:00Z"}', encoding="utf-8"
    )
    ran2, db2, _ = _run_gated(tmp_path, monkeypatch, {"checkpoint_policy": "guided"})
    assert ran2 == ["render"], "the approved stage should skip, and render should now run"
    assert db2.statuses == [("rendered", None)]


def test_the_manifest_default_applies_when_the_cfg_is_silent(tmp_path, monkeypatch):
    from lusora_worker.pipeline import checkpoints

    guided = {**REVIEW_MANIFEST, "default_checkpoint_policy": "guided"}
    assert checkpoints.policy({}, guided) == "guided"
    # ...and a video overrides its pipeline's default in either direction
    assert checkpoints.policy({"checkpoint_policy": "auto"}, guided) == "auto"
    assert checkpoints.policy({"checkpoint_policy": "guided"}, REVIEW_MANIFEST) == "guided"


def test_an_unknown_policy_degrades_to_auto_rather_than_stalling(tmp_path):
    """The schema rejects this at enqueue; a snapshot that carries it anyway
    must still produce a video rather than park it forever."""
    from lusora_worker.pipeline import checkpoints

    assert checkpoints.policy({"checkpoint_policy": "REVIEW"}, REVIEW_MANIFEST) == "auto"


def test_faceless_v2_gates_the_script_and_the_beat_sheet(tmp_path):
    """The shipped pipeline's promise: nothing is narrated on an unapproved
    script, and nothing is rendered on an unapproved beat sheet."""
    from lusora_worker.pipeline import checkpoints

    manifest = load_pipeline("faceless_v2")
    assert checkpoints.gated_stages(manifest) == ["script", "plan_beats"]
    names = stage_names(manifest)
    # the gates must sit BEFORE the expensive irreversible stages
    assert names.index("plan_beats") < names.index("render")
    assert manifest["stages"][0]["name"] == "research"
