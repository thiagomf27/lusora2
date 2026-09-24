"""Throughput slice 6: several workers on one database, one render at a time
(docs/05-roadmap/throughput-plan.md)."""

import os
import threading
import time

import pytest
from test_agents import FakeDb

from lusora_worker.config import WorkerConfig
from lusora_worker.context import StageContext
from lusora_worker.db import Db
from lusora_worker.pipeline import orchestrator, steps


class Slots:
    """Advisory locks as the database holds them: shared by every worker."""

    def __init__(self):
        self.held: set[int] = set()
        self.lock = threading.Lock()


class WorkerDb(FakeDb):
    def __init__(self, slots: Slots):
        super().__init__()
        self.slots = slots

    def try_render_slot(self, n):
        with self.slots.lock:
            for s in range(n):
                if s not in self.slots.held:
                    self.slots.held.add(s)
                    return s
        return None

    def release_render_slot(self, s):
        with self.slots.lock:
            self.slots.held.discard(s)


def _ctx(tmp_path, db, name):
    folder = tmp_path / name
    folder.mkdir()
    return StageContext(video={"id": name, "channel_id": "CH", "title": "T"}, folder=folder,
                        cfg={}, db=db, config=None)


@pytest.fixture(autouse=True)
def fast_poll(monkeypatch):
    monkeypatch.setattr(steps, "RENDER_SLOT_POLL_S", 0.01)


def test_two_workers_never_render_at_the_same_time(tmp_path, monkeypatch):
    monkeypatch.setenv("RENDER_SLOTS", "1")
    shared = Slots()
    rendering, overlap = [0], [False]
    lock = threading.Lock()

    def worker(name):
        ctx = _ctx(tmp_path, WorkerDb(shared), name)
        for _ in range(3):
            with steps.render_slot(ctx):
                with lock:
                    rendering[0] += 1
                    overlap[0] |= rendering[0] > 1
                time.sleep(0.02)
                with lock:
                    rendering[0] -= 1

    threads = [threading.Thread(target=worker, args=(f"vid_{i}",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert overlap == [False]
    assert shared.held == set()


def test_with_two_slots_two_renders_run_together(tmp_path, monkeypatch):
    monkeypatch.setenv("RENDER_SLOTS", "2")
    shared = Slots()
    together = threading.Barrier(2, timeout=5)

    def worker(name):
        with steps.render_slot(_ctx(tmp_path, WorkerDb(shared), name)):
            together.wait()  # only passes if both hold a slot at once

    threads = [threading.Thread(target=worker, args=(f"vid_{i}",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not together.broken


def test_a_waiting_worker_says_why_once(tmp_path, monkeypatch):
    monkeypatch.setenv("RENDER_SLOTS", "1")
    shared = Slots()
    shared.held.add(0)  # another worker is rendering
    db = WorkerDb(shared)
    ctx = _ctx(tmp_path, db, "vid_w")
    threading.Timer(0.1, lambda: shared.held.discard(0)).start()

    with steps.render_slot(ctx):
        pass

    waits = [m for _s, st, m in db.events if m and "waiting for a render slot" in m]
    assert len(waits) == 1
    assert "got render slot 0" in (ctx.folder / "production.log").read_text()


def test_a_failed_render_gives_its_slot_back(tmp_path, monkeypatch):
    monkeypatch.setenv("RENDER_SLOTS", "1")
    shared = Slots()
    with pytest.raises(RuntimeError), steps.render_slot(_ctx(tmp_path, WorkerDb(shared), "vid_f")):
        raise RuntimeError("engine crashed")
    assert shared.held == set()


# ---------------- the heartbeat outlives a long stage ----------------


def test_the_pulse_beats_through_a_long_stage_and_stops_after(monkeypatch):
    beats = []

    class Db_:
        def heartbeat(self, worker_id, video_id):
            beats.append(video_id)

    with orchestrator.Pulse(Db_(), "w1", "vid_long", every=0.01):
        time.sleep(0.1)  # a render, compressed
    during = len(beats)
    time.sleep(0.05)
    assert during >= 5, "beats kept coming while the stage ran"
    assert len(beats) == during, "and stopped when it ended"
    assert set(beats) == {"vid_long"}


def test_a_failed_heartbeat_does_not_stop_the_pulse():
    calls = []

    class Flaky:
        def heartbeat(self, worker_id, video_id):
            calls.append(1)
            if len(calls) == 2:
                raise ConnectionError("db blip")

    with orchestrator.Pulse(Flaky(), "w1", "v", every=0.01):
        time.sleep(0.08)
    assert len(calls) >= 4


def test_an_unset_worker_id_is_the_hostname(monkeypatch):
    """So `docker compose up --scale worker=2` gives each replica its own id
    without per-replica config — two workers sharing one id would share one
    heartbeat row, and each would keep the other's video looking alive."""
    import socket

    monkeypatch.setenv("DATABASE_URL", "postgres://x")
    monkeypatch.setenv("WORKER_ID", "")
    assert WorkerConfig.from_env().worker_id == socket.gethostname()
    monkeypatch.setenv("WORKER_ID", "worker-7")
    assert WorkerConfig.from_env().worker_id == "worker-7"


# ---------------- the real advisory locks (needs Postgres) ----------------

PG = os.environ.get("TEST_DATABASE_URL")


@pytest.mark.skipif(not PG, reason="TEST_DATABASE_URL not set")
def test_render_slots_are_real_postgres_advisory_locks():
    a, b = Db(PG), Db(PG)  # two workers = two connections
    try:
        assert a.try_render_slot(1) == 0
        assert b.try_render_slot(1) is None, "the only slot is held by the other worker"
        assert b.try_render_slot(2) == 1, "a second slot is free"
        b.release_render_slot(1)
        a.release_render_slot(0)
        assert b.try_render_slot(1) == 0
        # a worker that dies frees its slot with it
        b.conn.close()
        assert a.try_render_slot(1) == 0
        a.release_render_slot(0)
    finally:
        for db in (a, b):
            if db._conn is not None and not db._conn.closed:
                db._conn.close()
