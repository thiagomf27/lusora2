"""Source-policy chain semantics (D12)."""

import json

import httpx
import pytest

from lusora_worker.context import StageContext
from lusora_worker.providers import sources

from test_agents import FakeDb


class FakeConfig:
    library_api_url = "http://library.test"
    videos_root = None


def make_ctx(tmp_path):
    (tmp_path / "clips").mkdir(exist_ok=True)
    ctx = StageContext(
        video={"id": "vid_t", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg={"output": {"width": 320, "height": 180}, "budget": {"max_usd_per_video": 1}},
        db=FakeDb(),
        config=FakeConfig(),
    )
    ctx.db.asset_usages = []
    ctx.db.asset_usage = lambda *a: ctx.db.asset_usages.append(a)
    ctx.db.health = []
    ctx.db.provider_health = lambda p, ok, e=None: ctx.db.health.append((p, ok, e))
    return ctx


class Yes:
    def __init__(self, source="stock"):
        self.calls = 0
        self.source = source

    def resolve(self, ctx, item, query, source_cfg):
        self.calls += 1
        return sources.Resolution(source=self.source, id="a1", provider="p", license="cc0",
                                  path="clips/x.jpg", score=0.9, query=query, media_type="image")


class No:
    def __init__(self):
        self.calls = 0

    def resolve(self, ctx, item, query, source_cfg):
        self.calls += 1
        return None


@pytest.fixture(autouse=True)
def restore_adapters():
    saved = dict(sources.ADAPTERS)
    yield
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update(saved)


def test_chain_order_is_preference(tmp_path):
    ctx = make_ctx(tmp_path)
    first, second = Yes("library"), Yes("stock")
    sources.ADAPTERS.update({"library": first, "stock": second})
    item = {"id": "v1", "beat_id": "b1", "asset": {"source": "manual", "path": ""}}
    ok = sources.resolve_item(ctx, item, "q", [{"source": "library"}, {"source": "stock"}])
    assert ok
    assert first.calls == 1 and second.calls == 0
    assert item["asset"]["source"] == "library"
    assert ctx.db.asset_usages[0][2] == "library"


def test_fallthrough_then_stop(tmp_path):
    ctx = make_ctx(tmp_path)
    first, second = No(), Yes()
    sources.ADAPTERS.update({"library": first, "stock": second})
    item = {"id": "v1", "beat_id": "b1", "asset": {"source": "manual", "path": ""}}
    ok = sources.resolve_item(ctx, item, "q", [{"source": "library"}, {"source": "stock"}])
    assert ok
    assert first.calls == 1 and second.calls == 1
    assert item["asset"]["source"] == "stock"
    assert item["motion"]["type"] == "ken_burns"  # image gets motion defaults


def test_chain_exhausted_returns_false(tmp_path):
    ctx = make_ctx(tmp_path)
    sources.ADAPTERS.update({"library": No(), "stock": No()})
    item = {"id": "v1", "beat_id": "b1", "asset": {"source": "manual", "path": ""}}
    ok = sources.resolve_item(ctx, item, "q", [{"source": "library"}, {"source": "stock"}])
    assert not ok
    assert ctx.db.asset_usages == []


def test_omitted_source_is_forbidden(tmp_path):
    ctx = make_ctx(tmp_path)
    stock = Yes()
    sources.ADAPTERS.update({"stock": stock})
    item = {"id": "v1", "beat_id": "b1", "asset": {"source": "manual", "path": ""}}
    # stock exists as an adapter but is NOT in the chain -> never consulted
    ok = sources.resolve_item(ctx, item, "q", [{"source": "library"}])
    assert not ok
    assert stock.calls == 0


def test_library_min_score_fallthrough(tmp_path, monkeypatch):
    ctx = make_ctx(tmp_path)
    def fake_get(url, **kw):
        if url.endswith("/channels") or url.endswith("/niches"):
            body = []
        else:
            body = [{"id": "seg_1", "score": 0.30, "media_type": "image", "license": "cc0"}]
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))
    monkeypatch.setattr(sources.httpx, "get", fake_get)
    adapter = sources.LibraryAdapter()
    item = {"id": "v1", "beat_id": "b1"}
    result = adapter.resolve(ctx, item, "harbor", {"source": "library", "min_score": 0.55})
    assert result is None  # below threshold: honest fallthrough


def test_library_unreachable_falls_through(tmp_path, monkeypatch):
    ctx = make_ctx(tmp_path)
    def fake_get(url, **kw):
        raise httpx.ConnectError("refused", request=httpx.Request("GET", url))
    monkeypatch.setattr(sources.httpx, "get", fake_get)
    adapter = sources.LibraryAdapter()
    result = adapter.resolve(ctx, {"id": "v1"}, "harbor", {"source": "library"})
    assert result is None
    assert any(p == "library" and not ok for p, ok, _ in ctx.db.health)


# ---------------- keyword vs semantic queries (beat sheet v1.1, D53) ----------------


class Records:
    """An adapter that answers, remembering what it was asked."""

    def __init__(self, query_kind, answer=True):
        self.query_kind = query_kind
        self.asked: list[str] = []
        self.answer = answer

    def resolve(self, ctx, item, query, source_cfg):
        self.asked.append(query)
        if not self.answer:
            return None
        return sources.Resolution(source="stock", id="a1", provider="p", license="cc0",
                                  path="clips/x.jpg", score=0.9, query=query, media_type="image")


INTENT = "aerial view of a 1940s industrial district, smokestacks, workers assembling aircraft wings"


def test_stock_gets_the_keyword_queries_and_the_library_the_scout_sentence(tmp_path):
    library, stock = Records("semantic", answer=False), Records("keyword")
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update({"library": library, "stock": stock})
    chain = [{"source": "library"}, {"source": "stock"}]

    ok = sources.resolve_item(make_ctx(tmp_path), {"id": "v1", "beat_id": "b1"}, INTENT, chain,
                              ["1940s aircraft factory", "wartime assembly line"])
    assert ok
    assert library.asked == [INTENT], "the library embeds meaning: it wants the whole sentence"
    assert stock.asked == ["1940s aircraft factory"], "stock matches words: 2-4 of them"


def test_a_second_query_is_tried_before_the_chain_falls_through(tmp_path):
    """A different phrasing of the same shot is a better answer than the next
    source down, which is a worse source by definition (D12: order = preference)."""
    stock, ai = Records("keyword", answer=False), Records("semantic")
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update({"stock": stock, "ai_image": ai})
    chain = [{"source": "stock"}, {"source": "ai_image"}]

    sources.resolve_item(make_ctx(tmp_path), {"id": "v1", "beat_id": "b1"}, INTENT, chain,
                         ["1940s aircraft factory", "wartime assembly line", "factory workers 1940s"])
    assert stock.asked == ["1940s aircraft factory", "wartime assembly line", "factory workers 1940s"]
    assert ai.asked == [INTENT]


def test_a_v1_0_beat_still_resolves_with_keywords_derived_from_its_intent(tmp_path):
    stock = Records("keyword")
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update({"stock": stock})

    ok = sources.resolve_item(make_ctx(tmp_path), {"id": "v1", "beat_id": "b1"}, INTENT,
                              [{"source": "stock"}])
    assert ok
    assert stock.asked == ["aerial 1940s industrial"], "content words only, subject first"


def test_an_adapter_that_declares_nothing_is_asked_the_intent(tmp_path):
    """Back-compatible default: a source that never said it wants keywords
    keeps getting exactly what it got before v1.1."""
    plain = Yes()
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update({"stock": plain})
    item = {"id": "v1", "beat_id": "b1"}
    sources.resolve_item(make_ctx(tmp_path), item, INTENT, [{"source": "stock"}], ["short query"])
    assert item["asset"]["query"] == INTENT


def test_the_real_adapters_declare_their_kind():
    assert sources.PexelsAdapter.query_kind == "keyword"
    assert sources.LibraryAdapter.query_kind == "semantic"
    assert sources.AiImageAdapter.query_kind == "semantic"


# ---------------- intra-video dedup (D54) ----------------


def _library_results(*segments):
    """A fake library returning a ranked result list, and serving bytes."""
    def handler(request):
        if request.url.path == "/search":
            return httpx.Response(200, json=list(segments))
        if request.url.path.startswith("/clips/"):
            seg = request.url.path.rsplit("/", 1)[-1]
            return httpx.Response(200, content=f"bytes-of-{seg}".encode())
        return httpx.Response(200, json=[])
    return handler


def _seg(seg_id, score=0.9):
    return {"id": seg_id, "score": score, "media_type": "image", "license": "cc0"}


def _patch_library(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real_get, real_stream, real_post = httpx.get, httpx.stream, httpx.post
    client = httpx.Client(transport=transport)
    monkeypatch.setattr(httpx, "get", lambda url, **kw: client.get(url, **{k: v for k, v in kw.items() if k != "timeout"}))
    monkeypatch.setattr(httpx, "stream", lambda method, url, **kw: client.stream(method, url))
    monkeypatch.setattr(httpx, "post", lambda url, **kw: client.post(url, json=kw.get("json")))
    return real_get, real_stream, real_post


def test_a_segment_is_not_used_twice_in_one_video(tmp_path, monkeypatch):
    """Two beats about the same subject rank the same segment first. The
    second one takes the next result down instead of repeating the shot."""
    _patch_library(monkeypatch, _library_results(_seg("seg_1"), _seg("seg_2"), _seg("seg_3")))
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    ledger = sources.Ledger()

    first, second = {"id": "v1", "beat_id": "b1"}, {"id": "v2", "beat_id": "b2"}
    assert sources.resolve_item(ctx, first, "harbour cranes", chain, None, ledger)
    assert sources.resolve_item(ctx, second, "harbour cranes at dusk", chain, None, ledger)
    assert first["asset"]["id"] == "seg_1"
    assert second["asset"]["id"] == "seg_2", "the same query, a different segment"


def test_without_a_ledger_the_same_segment_comes_back(tmp_path, monkeypatch):
    """The behaviour D54 replaces — kept as a test so the ledger is what makes
    the difference, not some other change in the adapter."""
    _patch_library(monkeypatch, _library_results(_seg("seg_1"), _seg("seg_2")))
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    a, b = {"id": "v1", "beat_id": "b1"}, {"id": "v2", "beat_id": "b2"}
    sources.resolve_item(ctx, a, "harbour cranes", chain)
    sources.resolve_item(ctx, b, "harbour cranes", chain)
    assert a["asset"]["id"] == b["asset"]["id"] == "seg_1"


def test_the_reuse_window_is_config_driven(tmp_path, monkeypatch):
    """A window of 1 blocks only the shot immediately before, so a segment can
    come back later as a callback."""
    _patch_library(monkeypatch, _library_results(_seg("seg_1"), _seg("seg_2")))
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    ledger = sources.Ledger({"source_policy": {"visual": {"dedup": {"reuse_window_items": 1}}}})
    picks = []
    for i in range(3):
        item = {"id": f"v{i}", "beat_id": f"b{i}"}
        sources.resolve_item(ctx, item, "harbour cranes", chain, None, ledger)
        picks.append(item["asset"]["id"])
    assert picks == ["seg_1", "seg_2", "seg_1"]


def test_dedup_is_off_until_the_chain_runs_out_of_candidates(tmp_path, monkeypatch):
    """A ledger never fails a video: with everything used, the source falls
    through and the chain decides, exactly as when nothing matched."""
    _patch_library(monkeypatch, _library_results(_seg("seg_1")))
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    ledger = sources.Ledger()
    sources.resolve_item(ctx, {"id": "v1", "beat_id": "b1"}, "cranes", chain, None, ledger)
    assert not sources.resolve_item(ctx, {"id": "v2", "beat_id": "b2"}, "cranes", chain, None, ledger)


def test_the_ledger_is_rebuilt_from_the_plan(tmp_path):
    """No new artifact: the plan already records provenance, so a resumed
    worker knows what the killed one had already spent (Principle 1)."""
    plan = {"tracks": {"visual": [
        {"id": "v1", "asset": {"source": "library", "id": "seg_1", "path": "clips/v1.jpg"}},
        {"id": "v2", "asset": {"source": "manual", "path": ""}},  # unresolved
    ]}}
    ledger = sources.Ledger.from_plan(plan, tmp_path, {})
    assert ledger.blocked("library", None, "seg_1")
    assert not ledger.blocked("library", None, "seg_9")


def test_a_generated_image_is_never_a_repeat():
    ledger = sources.Ledger()
    ledger.remember({"source": "ai", "provider": "openai", "id": None})
    assert not ledger.blocked("ai", "openai", None)


def test_near_duplicate_detection_is_deterministic_and_config_driven(tmp_path):
    from lusora_worker.media import run_ffmpeg

    def frame(path, colour):
        run_ffmpeg("t", ["-f", "lavfi", "-i", f"color=c={colour}:s=320x180",
                         "-frames:v", "1", str(path)])
        return path

    same_a = frame(tmp_path / "a.jpg", "0x102030")
    same_b = frame(tmp_path / "b.jpg", "0x102030")
    assert sources.perceptual_hash(same_a) == sources.perceptual_hash(same_b)
    # ...and the same file always hashes to the same number
    assert sources.perceptual_hash(same_a) == sources.perceptual_hash(same_a)

    off = sources.Ledger({"source_policy": {"visual": {"dedup": {"min_hamming_distance": 0}}}})
    off.remember({"source": "stock", "id": "1"}, same_a)
    assert off.too_similar(sources.perceptual_hash(same_b)) is None, "0 = off"

    on = sources.Ledger({"source_policy": {"visual": {"dedup": {"min_hamming_distance": 6}}}})
    on.remember({"source": "stock", "id": "1"}, same_a)
    assert on.too_similar(sources.perceptual_hash(same_b)) == 0


def test_an_unreadable_file_has_no_opinion_about_similarity(tmp_path):
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    assert sources.perceptual_hash(tmp_path / "broken.jpg") is None
