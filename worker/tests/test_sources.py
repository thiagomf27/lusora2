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
