"""Throughput slice 0: every stage's wall time is on the record, and readable
off the folder alone (docs/05-roadmap/throughput-plan.md)."""

from types import SimpleNamespace

from test_agents import FakeDb

from lusora_worker.errors import StageError
from lusora_worker.pipeline import orchestrator
from lusora_worker.pipeline import stages as stages_mod
from lusora_worker.stage_times import format_run, main, parse


class Db(FakeDb):
    def __init__(self):
        super().__init__()
        self.statuses = []

    def event(self, video_id, stage, status, message=None):
        self.events.append((stage, status, message))

    def set_status(self, video_id, status, reason=None):
        self.statuses.append((status, reason))

    def heartbeat(self, worker_id, video_id):
        pass


def _run(tmp_path, monkeypatch, *, fail_render=False):
    def stub(name, artifact=None):
        def run(ctx):
            if name == "render" and fail_render:
                raise StageError("render", "engine failed: boom")
            if artifact:
                (ctx.folder / artifact).write_text("x", encoding="utf-8")

        return stages_mod.Step(run)

    for name, artifact in (("script", "script.txt"), ("validate", None), ("render", "final.mp4")):
        monkeypatch.setitem(stages_mod.STEP_REGISTRY, name, stub(name, artifact))
    manifest = {
        "name": "tiny",
        "version": "1.0",
        "stages": [
            {"name": "script", "produces": ["script.txt"]},
            {"name": "validate"},
            {"name": "render", "requires": ["script.txt"], "produces": ["final.mp4"]},
        ],
    }
    (tmp_path / "vid_t").mkdir(exist_ok=True)
    db = Db()
    orchestrator.process_video(
        db,
        SimpleNamespace(videos_root=tmp_path, worker_id="w1"),
        {"id": "vid_t", "channel_id": "CH", "title": "T", "cfg": {"pipeline_doc": manifest}},
    )
    return db, tmp_path / "vid_t"


def test_every_log_line_is_stamped_and_every_stage_is_timed(tmp_path, monkeypatch):
    db, folder = _run(tmp_path, monkeypatch)
    lines = (folder / "production.log").read_text(encoding="utf-8").splitlines()

    assert lines and all(line[:4].isdigit() and line[10] == "T" for line in lines)
    runs = parse(lines)
    assert [name for name, _s, _f in runs[-1].stages] == ["script", "validate", "render"]
    # the same number reaches the database, for the UI's stage list
    done = [msg for stage, status, msg in db.events if status == "done" and stage == "render"]
    assert done and done[0].startswith("took ")


def test_a_failed_stage_is_timed_and_marked(tmp_path, monkeypatch):
    db, folder = _run(tmp_path, monkeypatch, fail_render=True)
    run = parse((folder / "production.log").read_text(encoding="utf-8").splitlines())[-1]

    assert run.stages[-1][0] == "render" and run.stages[-1][2] is True
    assert "FAILED" in format_run(run)
    assert db.statuses[0][0] == "error"


def test_only_the_last_run_is_counted_by_default(tmp_path, capsys):
    folder = tmp_path / "vid_r"
    folder.mkdir()
    (folder / "production.log").write_text(
        "2026-09-23T10:00:00-03:00 claimed by w1\n"
        "2026-09-23T10:00:30-03:00 stage script done in 30.0s\n"
        "2026-09-23T10:01:00-03:00 stage narration failed after 30.0s\n"
        "2026-09-23T11:00:00-03:00 claimed by w1\n"
        "2026-09-23T11:05:00-03:00 stage narration done in 300.0s\n",
        encoding="utf-8",
    )

    assert main([str(folder)]) == 0
    out = capsys.readouterr().out
    assert "narration" in out and "script" not in out and "300.0s" in out

    assert main([str(folder), "--all"]) == 0
    assert "script" in capsys.readouterr().out


def test_an_unstamped_log_reports_nothing_rather_than_guessing(tmp_path, capsys):
    folder = tmp_path / "vid_old"
    folder.mkdir()
    (folder / "production.log").write_text(
        "claimed by worker-1\nstage script started\nstage script done\n", encoding="utf-8"
    )

    assert main([str(folder)]) == 0
    assert "no timed stages" in capsys.readouterr().out
