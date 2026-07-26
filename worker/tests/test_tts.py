"""ai33 adapter resilience: transient aggregator failures must not fail the stage.

A 503 from the aggregator once cost a whole narration run (every sentence
already synthesized was thrown away), so both the submit and the poll ride
out retryable statuses and transport errors.
"""

import httpx
import pytest

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
