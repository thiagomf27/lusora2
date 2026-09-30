"""The ai_image source's nano_banana provider and provider chain (D117).

Every call is faked: the suite never reaches Google or OpenAI.
"""

import base64
import json

import pytest

from lusora_worker.providers import quota, sources

from test_sources import make_ctx

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 200
MODELS = {"models": [
    {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3-pro-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.1-flash-image-preview", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.1-flash-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.1-flash-lite-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/imagen-4.0-generate", "supportedGenerationMethods": ["predict"]},
]}


class Reply:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        assert self.status_code < 400


def _gemini_image(data=PNG, mime="image/png"):
    return Reply({"candidates": [{"content": {"parts": [
        {"text": "here you go"},
        {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}},
    ]}}]})


def _openai_image():
    return Reply({"data": [{"b64_json": base64.b64encode(PNG).decode()}]})


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEOS_ROOT", str(tmp_path / "videos"))
    monkeypatch.setenv("GEMINI_API_KEY", "gk")
    monkeypatch.setenv("OPENAI_API_KEY", "ok")
    monkeypatch.delenv("GEMINI_IMAGE_MODEL", raising=False)
    monkeypatch.setattr(sources, "_GEMINI_IMAGE_MODEL", {})
    monkeypatch.setattr(sources, "image_prompt", lambda ctx, query, cfg: f"PROMPT {query}")


@pytest.fixture
def net(monkeypatch):
    """Fake network: `net.gemini` / `net.openai` are the next replies; every
    request is recorded."""

    class Net:
        gemini = staticmethod(_gemini_image)
        openai = staticmethod(_openai_image)
        posts: list = []
        gets: list = []

    Net.posts, Net.gets = [], []

    def post(url, headers=None, json=None, timeout=None):
        Net.posts.append({"url": url, "headers": headers, "json": json})
        return Net.gemini() if "generativelanguage" in url else Net.openai()

    def get(url, params=None, headers=None, timeout=None):
        Net.gets.append({"url": url, "headers": headers})
        return Reply(MODELS)

    monkeypatch.setattr(sources.httpx, "post", post)
    monkeypatch.setattr(sources.httpx, "get", get)
    return Net


def _resolve(ctx, provider, item_id="v1"):
    return sources.AiImageAdapter().resolve(ctx, {"id": item_id}, "a coal town", {"provider": provider})


def _gemini_posts(net):
    return [p for p in net.posts if "generativelanguage" in p["url"]]


# ---------------- nano_banana ----------------


def test_a_gemini_image_becomes_a_resolution_a_file_and_a_completed_cost(tmp_path, net):
    ctx = make_ctx(tmp_path)
    found = _resolve(ctx, "nano_banana")
    assert found["provider"] == "nano_banana" and found["source"] == "ai" and found["license"] == "own"
    assert (tmp_path / found["path"]).read_bytes() == PNG
    call = _gemini_posts(net)[0]
    assert call["url"].endswith("/models/gemini-3.1-flash-image:generateContent")
    assert call["headers"] == {"x-goog-api-key": "gk"} and "gk" not in call["url"]
    assert call["json"]["contents"] == [{"parts": [{"text": "PROMPT a coal town"}]}]
    assert call["json"]["generationConfig"] == {"responseModalities": ["IMAGE"],
                                                 "imageConfig": {"aspectRatio": "16:9"}}
    done = [e for e in ctx.db.cost_events if e["status"] == "completed"]
    assert [e["provider"] for e in done] == ["nano_banana"]
    assert ("ai_image.nano_banana", True, None) in ctx.db.health


def test_the_aspect_follows_the_output_shape(tmp_path, net):
    ctx = make_ctx(tmp_path)
    ctx.cfg["output"] = {"width": 1080, "height": 1920}
    _resolve(ctx, "nano_banana")
    assert _gemini_posts(net)[0]["json"]["generationConfig"]["imageConfig"]["aspectRatio"] == "9:16"


def test_a_jpeg_answer_is_written_as_jpeg(tmp_path, net):
    net.gemini = staticmethod(lambda: _gemini_image(mime="image/jpeg"))
    found = _resolve(make_ctx(tmp_path), "nano_banana")
    assert found["path"] == "clips/v1.jpg"


def test_an_answer_with_no_image_is_none_and_writes_nothing(tmp_path, net):
    net.gemini = staticmethod(lambda: Reply({"candidates": [{"content": {"parts": [{"text": "no"}]}}]}))
    ctx = make_ctx(tmp_path)
    assert _resolve(ctx, "nano_banana") is None
    assert list((tmp_path / "clips").iterdir()) == []
    assert [e["status"] for e in ctx.db.cost_events][-1] == "failed"


def test_a_tiny_image_counts_as_no_image(tmp_path, net):
    net.gemini = staticmethod(lambda: _gemini_image(data=b"x" * 50))
    assert _resolve(make_ctx(tmp_path), "nano_banana") is None


# ---------------- the model ----------------


def test_the_best_image_model_is_chosen_once_per_process(tmp_path, net):
    """Flash (not lite) before Pro, newest first, stable before its preview;
    Imagen (`predict`) and text models never."""
    ctx = make_ctx(tmp_path)
    _resolve(ctx, "nano_banana", "v1")
    _resolve(ctx, "nano_banana", "v2")
    assert len(net.gets) == 1 and net.gets[0]["headers"] == {"x-goog-api-key": "gk"}
    assert all("gemini-3.1-flash-image:" in p["url"] for p in _gemini_posts(net))


def test_gemini_image_model_env_wins_without_a_listing(tmp_path, net, monkeypatch):
    monkeypatch.setenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    _resolve(make_ctx(tmp_path), "nano_banana")
    assert net.gets == []
    assert "gemini-2.5-flash-image:" in _gemini_posts(net)[0]["url"]


# ---------------- the chain ----------------


def test_no_image_moves_the_chain_to_the_next_provider(tmp_path, net):
    net.gemini = staticmethod(lambda: Reply({"candidates": []}))
    found = _resolve(make_ctx(tmp_path), ["nano_banana", "openai"])
    assert found["provider"] == "openai"
    assert quota.out_reason("nano_banana") == "", "an empty answer is not a quota"


def test_a_free_tier_429_marks_nano_banana_out_until_tomorrow(tmp_path, net):
    """Dark Palace: the free tier has no image quota at all — a 429 naming
    `limit: 0`. Waiting 20 s would not help; the next item must not ask."""
    # the shape of the real refusal on this machine's key (2026-09-30),
    # retryDelay and all — the per-minute delay must NOT win
    body = {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                      "message": "You exceeded your current quota. * Quota exceeded for metric: "
                                 "generativelanguage.googleapis.com/generate_content_free_tier_requests, "
                                 "limit: 0, model: gemini-3.1-flash-image",
                      "details": [
                          {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
                              {"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"},
                              {"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},
                          {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "50s"}]}}
    net.gemini = staticmethod(lambda: Reply(body, status=429))
    ctx = make_ctx(tmp_path)
    assert _resolve(ctx, ["nano_banana", "openai"], "v1")["provider"] == "openai"
    reason = quota.out_reason("nano_banana")
    assert "429" in reason
    until = json.loads(quota._path().read_text())["nano_banana"]["out_until"]
    import time
    assert 60 < until - time.time() <= 24 * 3600, "out until the next Pacific midnight, not 50 s"
    assert any(h[0] == "ai_image.nano_banana" and h[1] is False for h in ctx.db.health)

    before = len(_gemini_posts(net))
    assert _resolve(ctx, ["nano_banana", "openai"], "v2")["provider"] == "openai"
    assert len(_gemini_posts(net)) == before, "the next item does not call nano_banana"


def test_every_provider_refusing_resolves_nothing(tmp_path, net):
    net.gemini = staticmethod(lambda: Reply({"error": {"message": "server"}}, status=500))
    net.openai = staticmethod(lambda: Reply({"error": {"message": "filtered"}}, status=400))
    assert _resolve(make_ctx(tmp_path), ["nano_banana", "openai"]) is None
    assert not quota._path().exists(), "a 500 and a content filter are not quota"


# ---------------- a plain string is unchanged ----------------


def test_a_plain_openai_behaves_as_before(tmp_path, net):
    ctx = make_ctx(tmp_path)
    found = _resolve(ctx, "openai")
    assert found["provider"] == "openai" and found["path"] == "clips/v1.png"
    assert net.posts[0]["json"] == {"model": "gpt-image-1", "prompt": "PROMPT a coal town",
                                    "size": "1536x1024", "n": 1}
    assert not quota._path().exists()


def test_a_plain_name_never_touches_the_ledger(tmp_path, net):
    """D116: one 429 on a plain-string channel must not lock the provider out
    machine-wide, and a plain name is tried even when the ledger marks it."""
    net.gemini = staticmethod(lambda: Reply({"error": {"message": "limit: 0"}}, status=429))
    assert _resolve(make_ctx(tmp_path), "nano_banana") is None
    assert not quota._path().exists()

    quota.mark_out("openai", "quota", 3600)
    assert _resolve(make_ctx(tmp_path), "openai")["provider"] == "openai"


def test_the_mock_default_is_unchanged(tmp_path, net):
    found = _resolve(make_ctx(tmp_path), None)
    assert found["provider"] == "mock" and net.posts == []
