"""ai33 adapter resilience: transient aggregator failures must not fail the stage.

A 503 from the aggregator once cost a whole narration run (every sentence
already synthesized was thrown away), so both the submit and the poll ride
out retryable statuses and transport errors.
"""

import json
import random
import subprocess
import threading
import time as _time

import httpx
import pytest
from test_agents import FakeDb

from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers import tts


@pytest.fixture(autouse=True)
def _no_sleeping(monkeypatch):
    monkeypatch.setattr(tts.time, "sleep", lambda _s: None)


def _response(status: int, payload: dict | None = None) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        json=payload if payload is not None else {},
        request=httpx.Request("GET", "https://api.ai33.pro/v3/task/t1"),
    )


def test_poll_rides_out_a_503_then_succeeds(monkeypatch):
    replies = [
        _response(503),
        _response(429),
        _response(200, {"data": {"status": "processing"}}),
        _response(200, {"data": {"status": "done", "metadata": {"audio_url": "https://cdn/x.mp3"}, "credit_cost": 3}}),
    ]
    monkeypatch.setattr(tts.httpx, "get", lambda *a, **k: replies.pop(0))
    url, credits = tts._ai33_wait("https://api.ai33.pro", {}, "t1", 1)
    assert url == "https://cdn/x.mp3"
    assert credits == 3
    assert replies == []


def test_poll_rides_out_a_dropped_connection(monkeypatch):
    calls = {"n": 0}

    def flaky(*_a, **_k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("connection reset")
        return _response(200, {"data": {"status": "done", "metadata": {"audio_url": "https://cdn/y.mp3"}}})

    monkeypatch.setattr(tts.httpx, "get", flaky)
    url, _ = tts._ai33_wait("https://api.ai33.pro", {}, "t1", 1)
    assert url == "https://cdn/y.mp3"


def test_poll_still_fails_loud_on_a_real_error(monkeypatch):
    # 404 is the request being wrong, not the service being busy: fail immediately
    monkeypatch.setattr(tts.httpx, "get", lambda *a, **k: _response(404))
    with pytest.raises(StageError, match="task poll failed"):
        tts._ai33_wait("https://api.ai33.pro", {}, "t1", 1)


def test_poll_reports_the_last_transient_status_when_it_never_recovers(monkeypatch):
    monkeypatch.setattr(tts.httpx, "get", lambda *a, **k: _response(503))
    monkeypatch.setattr(tts.time, "time", lambda: 1e12)  # already past the deadline
    with pytest.raises(StageError, match="timed out"):
        tts._ai33_wait("https://api.ai33.pro", {}, "t1", 1, timeout_s=0)


def test_submit_rides_out_a_503_then_succeeds(monkeypatch):
    replies = [_response(503), _response(200, {"success": True, "task_id": "t9"})]
    monkeypatch.setattr(tts.httpx, "post", lambda *a, **k: replies.pop(0))
    assert tts._ai33_submit("https://api.ai33.pro", {}, "v", "hello", 1)["task_id"] == "t9"


def test_submit_gives_up_after_its_attempts(monkeypatch):
    monkeypatch.setattr(tts.httpx, "post", lambda *a, **k: _response(502))
    with pytest.raises(StageError, match="after 3 attempts"):
        tts._ai33_submit("https://api.ai33.pro", {}, "v", "hello", 1, attempts=3)


# ---------------- parallel, resumable narration (throughput slice 5) ----------------

SCRIPT = "One harbour. Two cranes stand. Three ships wait here. Four men walk out. Five."


class Ai33:
    """A fake aggregator. A sentence's audio lasts 0.2 s per word, so every
    part has a distinct, checkable duration."""

    def __init__(self, tmp_path, *, reject=(), barrier=None, jitter=0.02):
        self.tmp = tmp_path
        self.reject = set(reject)
        self.barrier = barrier
        self.jitter = jitter
        self.submitted: list[str] = []
        self.tasks: dict[str, str] = {}
        self.lock = threading.Lock()

    def _mp3(self, text):
        out = self.tmp / f"src-{abs(hash(text))}.mp3"
        if not out.exists():
            seconds = 0.2 * len(text.split())
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                            f"sine=frequency=440:duration={seconds}", "-q:a", "5", str(out)],
                           check=True)
        return out

    def post(self, url, headers=None, files=None, timeout=None):
        text = files["text"][1]
        if self.barrier is not None:
            self.barrier.wait()
        _time.sleep(random.uniform(0, self.jitter))
        with self.lock:
            self.submitted.append(text)
            task = f"t{len(self.tasks)}"
            self.tasks[task] = text
        if text in self.reject:
            return _response(200, {"success": False, "message": "voice unavailable"})
        return _response(200, {"success": True, "task_id": task})

    def get(self, url, headers=None, timeout=None):
        task = url.rsplit("/", 1)[-1]
        return _response(200, {"data": {"status": "done", "credit_cost": 1,
                                        "metadata": {"audio_url": f"https://cdn.test/{task}"}}})

    def stream(self, method, url, **kw):
        data = self._mp3(self.tasks[url.rsplit("/", 1)[-1]]).read_bytes()

        class Stream:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def raise_for_status(self):
                pass

            def iter_bytes(self):
                yield data

        return Stream()


def _narrate(tmp_path, monkeypatch, fake, *, voice="elevenlabs_x", parallel="6"):
    monkeypatch.setenv("AI33_API_KEY", "k")
    monkeypatch.setenv("TTS_PARALLELISM", parallel)
    monkeypatch.setattr(tts.httpx, "post", fake.post)
    monkeypatch.setattr(tts.httpx, "get", fake.get)
    monkeypatch.setattr(tts.httpx, "stream", fake.stream)
    folder = tmp_path / "video"
    folder.mkdir(exist_ok=True)
    ctx = StageContext(
        video={"id": "vid_n", "channel_id": "CH", "title": "T"}, folder=folder,
        cfg={"voice": {"provider": "ai33", "voice_id": voice}, "budget": {"max_usd_per_video": 5}},
        db=FakeDb(), config=None,
    )
    ctx.db.provider_health = lambda *a, **k: None
    tts.synthesize(ctx, SCRIPT)
    return ctx


def _timings(ctx):
    return json.loads((ctx.folder / "tts_timings.json").read_text())["items"]


def _billed_chars(ctx):
    return [e["units"] for e in ctx.db.cost_events if e["status"] == "completed"]


def test_parallel_narration_matches_serial(tmp_path, monkeypatch):
    (tmp_path / "s").mkdir()
    (tmp_path / "p").mkdir()
    serial = _narrate(tmp_path / "s", monkeypatch, Ai33(tmp_path), parallel="1")
    parallel = _narrate(tmp_path / "p", monkeypatch, Ai33(tmp_path), parallel="6")

    assert [t["text"] for t in _timings(parallel)] == [t["text"] for t in _timings(serial)]
    for a, b in zip(_timings(parallel), _timings(serial)):
        assert abs(a["end_s"] - b["end_s"]) < 0.01
    # each sentence's own duration (0.2 s a word, plus mp3 padding) comes back
    # on that sentence, whatever order the parts finished in
    for t in _timings(parallel):
        expected = 0.2 * len(t["text"].split())
        assert expected <= t["end_s"] - t["start_s"] < expected + 0.1, t
    assert not (parallel.folder / tts.PARTS_DIR).exists(), "parts are removed once joined"


def test_sentences_are_really_requested_at_the_same_time(tmp_path, monkeypatch):
    fake = Ai33(tmp_path, barrier=threading.Barrier(5, timeout=5))
    _narrate(tmp_path, monkeypatch, fake, parallel="5")
    assert len(fake.submitted) == 5


def test_a_failed_run_resumes_and_pays_only_for_what_is_missing(tmp_path, monkeypatch):
    first = Ai33(tmp_path, reject={"Three ships wait here."})
    with pytest.raises(StageError, match="rejected sentence 3"):
        _narrate(tmp_path, monkeypatch, first)
    kept = sorted(p.name for p in (tmp_path / "video" / tts.PARTS_DIR).glob("*.mp3"))
    assert len(kept) == 4, kept

    again = Ai33(tmp_path)
    ctx = _narrate(tmp_path, monkeypatch, again)
    assert again.submitted == ["Three ships wait here."]
    assert _billed_chars(ctx) == [len("Three ships wait here.")]
    assert len(_timings(ctx)) == 5


def test_a_new_voice_does_not_resume_from_the_old_voices_parts(tmp_path, monkeypatch):
    with pytest.raises(StageError):
        _narrate(tmp_path, monkeypatch, Ai33(tmp_path, reject={"Five."}), voice="edge_a")

    again = Ai33(tmp_path)
    _narrate(tmp_path, monkeypatch, again, voice="edge_b")
    assert len(again.submitted) == 5
