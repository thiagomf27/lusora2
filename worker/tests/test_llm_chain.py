"""Gemini, fallback chains and the quota ledger (D116).

A provider argument to `chat`/`see` may be a plain string (unchanged
behaviour) or a list — the first element that is ready and answers wins, a
failure is classified into a shared ledger so later calls skip a provider
that is out for quota or login, and a network error or 5xx is weather, never
a mark. The suite never reaches the network: every provider is faked with
monkeypatch, as `test_tts.py` fakes `httpx`.
"""

from __future__ import annotations

import json
import threading

import pytest

from lusora_worker.errors import StageError
from lusora_worker.providers import llm, quota


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("boom", request=None, response=self)

    def json(self):
        return self._payload


def _gemini_reply(text="{}", **usage):
    return FakeResponse(
        {
            "candidates": [{"content": {"parts": [{"text": text}]}}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 20, **usage},
        }
    )


def _anthropic_reply(text="answer", input_tokens=3, output_tokens=4):
    return FakeResponse(
        {"content": [{"text": text}], "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens}}
    )


def _openai_reply(text="{}"):
    return FakeResponse(
        {
            "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
    )


@pytest.fixture(autouse=True)
def isolated_ledger(tmp_path, monkeypatch):
    """Every test gets its own quota ledger file — never the repo's real
    data/llm_quota.json, which every OTHER worker process on this machine
    also reads."""
    monkeypatch.setenv("VIDEOS_ROOT", str(tmp_path / "videos"))


@pytest.fixture
def calls(monkeypatch):
    """Every fake POST, in order, as {"url", "headers", "json"}."""
    records: list[dict] = []

    def fake_post(url, headers=None, json=None, timeout=None):
        records.append({"url": url, "headers": headers, "json": json})
        if "generativelanguage" in url:
            return _gemini_reply("hello")
        if url.endswith("/messages"):
            return _anthropic_reply()
        return _openai_reply()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    return records


# ---------------- the gemini provider ----------------


def test_gemini_text_request_shape(monkeypatch, calls):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    result = llm.chat("gemini", None, "sys", "user", 1000, 0.2)
    call = calls[0]
    assert call["headers"]["x-goog-api-key"] == "k"
    assert "k" not in call["url"], "the key never rides in the URL, so it can't leak into a log"
    assert call["json"]["systemInstruction"] == {"parts": [{"text": "sys"}]}
    assert call["json"]["contents"] == [{"role": "user", "parts": [{"text": "user"}]}]
    assert call["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert result.text == "hello"
    assert result.input_tokens == 10
    assert result.output_tokens == 20
    assert result.provider == "gemini"


def test_gemini_expect_json_false_omits_the_mime_type(monkeypatch, calls):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    llm.chat("gemini", None, "sys", "user", 1000, 0.2, expect_json=False)
    assert "responseMimeType" not in calls[0]["json"]["generationConfig"]


def test_gemini_vision_sends_an_inline_data_part(monkeypatch, calls, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xdb not a real jpeg")
    result = llm.see("gemini", None, "sys", "user", [frame], 1000, 0.2)
    parts = calls[0]["json"]["contents"][0]["parts"]
    assert parts[0]["inlineData"]["mimeType"] == "image/jpeg"
    assert "data" in parts[0]["inlineData"]
    assert parts[-1] == {"text": "user"}
    assert result.provider == "gemini"


def test_gemini_default_model_is_an_openai_kind_capability_only(monkeypatch):
    """`json_mode` means openai's `response_format`, a key only that branch
    reads — gemini's own branch asks for JSON straight from `expect_json`."""
    assert llm.PROVIDERS["gemini"].kind == "gemini"
    assert llm.PROVIDERS["gemini"].json_mode is False
    assert llm.PROVIDERS["gemini"].vision is True


# ---------------- chain_of ----------------


def test_chain_of_normalizes_every_shape():
    assert llm.chain_of(None, "mock") == ["mock"]
    assert llm.chain_of("a", "mock") == ["a"]
    assert llm.chain_of(["a", "b"], "mock") == ["a", "b"]


def test_a_plain_string_provider_behaves_exactly_as_before(monkeypatch, calls):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    result = llm.chat("deepseek", None, "sys", "user", 1000)
    assert result.provider == "deepseek"
    assert len(calls) == 1


# ---------------- gate_provider ----------------


def test_gate_provider_skips_an_out_element():
    quota.mark_out("deepseek", "quota", 100)
    assert llm.gate_provider(["deepseek", "anthropic"]) == "anthropic"


def test_gate_provider_falls_back_to_the_first_when_every_element_is_out():
    quota.mark_out("deepseek", "quota", 100)
    quota.mark_out("anthropic", "quota", 100)
    assert llm.gate_provider(["deepseek", "anthropic"]) == "deepseek"


# ---------------- chains: falling over ----------------


def test_a_quota_failure_falls_over_and_marks_the_first_out(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    hits: list[str] = []

    def fake_post(url, headers=None, json=None, timeout=None):
        hits.append(url)
        if url.endswith("/chat/completions"):
            return FakeResponse({"error": {"message": "Rate limit exceeded: quota exceeded"}}, status=429)
        return _anthropic_reply()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    result = llm.chat(["deepseek", "anthropic"], None, "sys", "user", 1000)
    assert result.provider == "anthropic"
    assert quota.out_reason("deepseek") != ""

    hits.clear()
    result2 = llm.chat(["deepseek", "anthropic"], None, "sys", "user", 1000)
    assert result2.provider == "anthropic"
    assert len(hits) == 1, "deepseek is out — the second call must not even try it"
    assert hits[0].endswith("/messages")


def test_a_5xx_moves_the_chain_on_without_marking_the_ledger(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    def fake_post(url, headers=None, json=None, timeout=None):
        if url.endswith("/chat/completions"):
            return FakeResponse({"error": {"message": "internal error"}}, status=503)
        return _anthropic_reply()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    result = llm.chat(["deepseek", "anthropic"], None, "sys", "user", 1000)
    assert result.provider == "anthropic"
    assert quota.out_reason("deepseek") == "", "weather, not quota — the next call may still try it"


def test_every_element_failing_raises_one_error_naming_them_all(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse({"error": {"message": "boom"}}, status=500))
    with pytest.raises(StageError) as exc:
        llm.chat(["deepseek", "anthropic"], None, "sys", "user", 1000)
    message = str(exc.value)
    assert "deepseek" in message and "anthropic" in message


def test_a_chain_elements_model_suffix_is_used(monkeypatch, calls):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    result = llm.chat(["anthropic/claude-haiku-4-5-20251001"], None, "sys", "user", 1000)
    assert calls[0]["json"]["model"] == "claude-haiku-4-5-20251001"
    assert result.model == "claude-haiku-4-5-20251001"


def test_an_out_element_is_skipped_without_being_tried(monkeypatch, calls):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    quota.mark_out("deepseek", "quota exceeded", 3600)
    result = llm.chat(["deepseek", "anthropic"], None, "sys", "user", 1000)
    assert result.provider == "anthropic"
    assert len(calls) == 1


# ---------------- see(): the same chain rules ----------------


def test_see_falls_over_on_a_text_only_element(monkeypatch, tmp_path):
    """A provider without `vision` fails like any other chain element — the
    call moves on rather than aborting."""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    frame = tmp_path / "f.jpg"
    frame.write_bytes(b"jpg")

    def fake_post(url, headers=None, json=None, timeout=None):
        return _anthropic_reply()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    result = llm.see(["deepseek", "anthropic"], None, "sys", "user", [frame], 1000, 0.2)
    assert result.provider == "anthropic"


# ---------------- the ledger ----------------


def test_ledger_out_reason_is_empty_until_marked():
    assert quota.out_reason("deepseek") == ""


def test_mark_out_is_read_back_and_expires():
    quota.mark_out("deepseek", "quota exceeded", 0.0)
    # 0-second mark: already expired by the time out_reason checks the clock
    assert quota.out_reason("deepseek") == ""
    quota.mark_out("deepseek", "quota exceeded", 3600)
    assert quota.out_reason("deepseek") == "quota exceeded"


def test_ledger_survives_two_threads_marking_at_once():
    def mark(n: int) -> None:
        for _ in range(25):
            quota.mark_out(f"p{n}", "reason", 100)

    threads = [threading.Thread(target=mark, args=(n,)) for n in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    doc = json.loads(quota._path().read_text())
    assert set(doc) == {f"p{n}" for n in range(6)}
    for n in range(6):
        assert quota.out_reason(f"p{n}") == "reason"


# ---------------- classifying a failure ----------------


def test_classify_429_marks_out_for_six_hours_by_default():
    out, seconds = quota.classify("deepseek", "quota exceeded", 429)
    assert out
    assert seconds == pytest.approx(quota.SIX_HOURS)


def test_classify_5xx_is_weather_not_quota():
    out, _seconds = quota.classify("deepseek", "internal error", 503)
    assert not out


def test_classify_network_error_is_weather_not_quota():
    out, _seconds = quota.classify("deepseek", "Connection refused", None)
    assert not out


def test_classify_auth_text_marks_out_even_without_an_http_status():
    """claude_cli fails through a subprocess, never an HTTP status."""
    out, seconds = quota.classify("claude_cli", "claude_cli failed: not logged in", None)
    assert out
    assert seconds == pytest.approx(quota.SIX_HOURS)


def test_classify_gemini_daily_quota_resets_at_the_next_pacific_midnight():
    out, seconds = quota.classify(
        "gemini", '{"error":{"message":"quota_exhausted: this model has limit: 0 on the free tier"}}', 429
    )
    assert out
    assert 0 < seconds <= 24 * 3600


def test_classify_gemini_per_minute_429_is_not_treated_as_daily():
    out, seconds = quota.classify("gemini", '{"error":{"message":"quota_exhausted perMinute"}}', 429)
    assert out
    assert seconds == pytest.approx(quota.SIX_HOURS)


# ---------------- parsing a reset time out of the failure text ----------------


def test_reset_seconds_reads_a_retry_delay():
    assert quota._reset_seconds('{"error":{"details":[{"retryDelay":"21s"}]}}') == pytest.approx(21.0)


def test_reset_seconds_reads_resets_in_hours():
    assert quota._reset_seconds("quota exceeded, resets in 3h") == pytest.approx(3 * 3600.0)


def test_reset_seconds_reads_a_clock_time():
    seconds = quota._reset_seconds("try again at 4:26 PM")
    assert seconds is not None and 0 < seconds <= 24 * 3600


def test_reset_seconds_is_none_when_nothing_is_named():
    assert quota._reset_seconds("a plain failure with no reset hint") is None
