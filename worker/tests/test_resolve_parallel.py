"""Throughput slice 4: resolve_assets fetches in parallel and commits in plan
order (docs/05-roadmap/throughput-plan.md).

The claim every test here checks is the one that makes the parallelism safe to
ship: given the same provider answers, the plan a parallel run writes is the
plan the serial run writes.
"""

import json
import random
import threading
import time

import pytest
from test_agents import FakeDb

from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.pipeline import steps
from lusora_worker.providers import sources


class Library:
    """A stand-in for the library: every query ranks the same segments, the
    ledger's reuse block applies, and a commit is recorded as mark_used."""

    query_kind = "semantic"

    def __init__(self, ranking, *, jitter=0.02, barrier=None, empty_for=()):
        self.ranking = list(ranking)
        self.jitter = jitter
        self.barrier = barrier
        self.empty_for = set(empty_for)
        self.marked: list[str] = []
        self.calls: list[str] = []
        self._lock = threading.Lock()

    def resolve(self, ctx, item, query, source_cfg, ledger=None):
        with self._lock:
            self.calls.append(item["id"])
        # only the parallel fetches meet at the barrier; a re-fetch after a
        # conflict runs alone on the commit (main) thread
        if self.barrier is not None and threading.current_thread() is not threading.main_thread():
            self.barrier.wait()
        time.sleep(random.uniform(0, self.jitter))
        if item["id"] in self.empty_for:
            return None
        for seg in self.ranking:
            if ledger is not None and ledger.blocked("library", None, seg):
                continue
            path = f"clips/{item['id']}.jpg"
            (ctx.folder / path).write_bytes(seg.encode())
            return sources.Resolution(
                source="library", id=seg, provider=None, license="cc0", path=path,
                score=0.9, query=query[:200], media_type="image",
                _on_commit=lambda seg=seg: self.marked.append(seg),
            )
        return None


@pytest.fixture(autouse=True)
def restore_adapters():
    saved = dict(sources.ADAPTERS)
    yield
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update(saved)


def _video(tmp_path, n):
    folder = tmp_path
    (folder / "clips").mkdir(exist_ok=True)
    items = [{"id": f"v{i}", "beat_id": f"b{i}", "start_s": 3.0 * i, "end_s": 3.0 * (i + 1),
              "asset": {}} for i in range(n)]
    (folder / "edit_plan.json").write_text(json.dumps(
        {"tracks": {"visual": items, "overlays": []}}), encoding="utf-8")
    (folder / "beats.json").write_text(json.dumps(
        {"beats": [{"id": f"b{i}", "visual_intent": f"harbour shot {i}"} for i in range(n)]}),
        encoding="utf-8")
    db = FakeDb()
    db.usages = []
    db.asset_usage = lambda *a: db.usages.append(a)
    db.provider_health = lambda *a, **k: None
    return StageContext(
        video={"id": "vid_p", "channel_id": "CH", "title": "T"},
        folder=folder,
        cfg={"source_policy": {"visual": {"chain": [{"source": "library"}]}},
             "budget": {"max_usd_per_video": 1}},
        db=db,
        config=None,
    )


def _assets(ctx):
    plan = json.loads((ctx.folder / "edit_plan.json").read_text(encoding="utf-8"))
    return [item["asset"].get("id") for item in plan["tracks"]["visual"]]


def test_parallel_and_serial_write_the_same_plan(tmp_path, monkeypatch):
    ranking = [f"seg_{i}" for i in range(20)]

    monkeypatch.setenv("ASSET_PARALLELISM", "1")
    (tmp_path / "serial").mkdir()
    serial_ctx = _video(tmp_path / "serial", 12)
    sources.ADAPTERS["library"] = serial_lib = Library(ranking)
    steps.run_resolve_assets(serial_ctx)

    monkeypatch.setenv("ASSET_PARALLELISM", "6")
    (tmp_path / "parallel").mkdir()
    parallel_ctx = _video(tmp_path / "parallel", 12)
    sources.ADAPTERS["library"] = parallel_lib = Library(ranking)
    steps.run_resolve_assets(parallel_ctx)

    assert _assets(parallel_ctx) == _assets(serial_ctx) == ranking[:12]
    assert parallel_lib.marked == serial_lib.marked, "marked once each, in plan order"
    assert [u[1] for u in parallel_ctx.db.usages] == [f"b{i}" for i in range(12)]


def test_the_fetches_really_overlap(tmp_path, monkeypatch):
    """Four fetches that each wait for the other three: a serial loop would
    time out on the barrier."""
    monkeypatch.setenv("ASSET_PARALLELISM", "4")
    ctx = _video(tmp_path, 4)
    sources.ADAPTERS["library"] = Library(["a", "b", "c", "d"], barrier=threading.Barrier(4, timeout=5))
    steps.run_resolve_assets(ctx)
    assert _assets(ctx) == ["a", "b", "c", "d"]


def test_an_answer_an_earlier_item_took_is_asked_again(tmp_path, monkeypatch):
    """Every fetch starts before any commit, so all of them see an empty ledger
    and pick the same top segment. Only the first may keep it; each later one
    is fetched again against the live ledger and gets the next one down — and
    a loser is never marked used in the library."""
    monkeypatch.setenv("ASSET_PARALLELISM", "3")
    ctx = _video(tmp_path, 3)
    lib = Library(["top", "second", "third"], barrier=threading.Barrier(3, timeout=5))
    sources.ADAPTERS["library"] = lib
    steps.run_resolve_assets(ctx)

    assert _assets(ctx) == ["top", "second", "third"]
    assert lib.marked == ["top", "second", "third"]
    assert sorted(lib.calls) == ["v0", "v1", "v1", "v2", "v2"], "one re-fetch per loser"
    taken = [m for _s, _st, m in ctx.db.events if m and "taken by an earlier beat" in m]
    assert len(taken) == 2


def test_the_first_failure_in_plan_order_is_the_one_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_PARALLELISM", "4")
    ctx = _video(tmp_path, 6)
    sources.ADAPTERS["library"] = Library([f"s{i}" for i in range(9)], empty_for={"v2", "v4"})

    with pytest.raises(StageError, match=r"beat b2 \(item v2\)"):
        steps.run_resolve_assets(ctx)
    # what came before the failure was placed and checkpointed
    assert _assets(ctx)[:2] == ["s0", "s1"]


def test_a_resumed_run_fetches_only_what_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSET_PARALLELISM", "4")
    ctx = _video(tmp_path, 5)
    sources.ADAPTERS["library"] = Library([f"s{i}" for i in range(9)], empty_for={"v3"})
    with pytest.raises(StageError):
        steps.run_resolve_assets(ctx)

    sources.ADAPTERS["library"] = again = Library([f"s{i}" for i in range(9)])
    steps.run_resolve_assets(ctx)

    # v3 and v4 may both pick s3 and v4 be asked again; v0-v2 are never asked
    assert set(again.calls) == {"v3", "v4"}
    assert _assets(ctx)[:3] == ["s0", "s1", "s2"], "kept, not refetched"
    assert len(set(_assets(ctx))) == 5, "the resumed items still avoid what is on screen"


def test_pexels_gets_its_own_cap_inside_the_pool(tmp_path, monkeypatch):
    """Its quota is per key and per hour, so it never sees the whole pool."""
    monkeypatch.setenv("ASSET_PARALLELISM", "6")
    monkeypatch.setenv("PEXELS_CONCURRENCY", "2")
    ctx = _video(tmp_path, 8)
    ctx.cfg["source_policy"]["visual"]["chain"] = [{"source": "stock"}]
    in_flight, peak, lock = [0], [0], threading.Lock()

    def fake(self, ctx, item, query, source_cfg, ledger=None):
        with lock:
            in_flight[0] += 1
            peak[0] = max(peak[0], in_flight[0])
        time.sleep(0.03)
        with lock:
            in_flight[0] -= 1
        path = f"clips/{item['id']}.jpg"
        (ctx.folder / path).write_bytes(b"x")
        return sources.Resolution(source="stock", id=item["id"], provider="pexels",
                                  license="royalty-free", path=path, score=None,
                                  query=query, media_type="image")

    monkeypatch.setattr(sources.PexelsAdapter, "_resolve", fake)
    steps.run_resolve_assets(ctx)  # begin_run() re-reads the cap from the env

    assert peak[0] == 2
    assert _assets(ctx) == [f"v{i}" for i in range(8)]
