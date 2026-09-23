"""Source-policy chain semantics (D12)."""

import json
from pathlib import Path

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
    sources.begin_run()
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
            body = [{"id": "seg_1", "score": 0.30, "sim": 0.30, "license": "cc0"}]
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


def _seg(seg_id, score=0.9, sim=None):
    """A hit as broll-engine returns it: `sim` is the raw cosine the gate
    reads, `score` the ranked order. No media_type — the library dropped the
    field, every row is an mp4."""
    return {"id": seg_id, "score": score,
            "sim": score if sim is None else sim, "license": "cc0"}


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


# ---------------- the broll-engine contract (Slice 3) ----------------


def _captured(monkeypatch, *segments):
    """Patch the library and hand back the /search params it was called with."""
    seen: dict = {}

    def handler(request):
        if request.url.path == "/search":
            seen.update(dict(request.url.params))
            return httpx.Response(200, json=list(segments))
        if request.url.path.startswith("/clips/"):
            return httpx.Response(200, content=b"mp4-bytes")
        return httpx.Response(200, json=[])

    _patch_library(monkeypatch, handler)
    return seen


def _item(vid="v1", start=0.0, end=6.0):
    return {"id": vid, "beat_id": "b1", "start_s": start, "end_s": end}


def test_a_library_hit_is_always_a_video(tmp_path, monkeypatch):
    """Every library row is an mp4 — an uploaded still is stored as a still
    CLIP. The adapter used to read a `media_type` field the library no longer
    has, take the image branch for every hit, and write mp4 bytes to a .jpg."""
    _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    item = _item()
    assert sources.resolve_item(ctx, item, "harbour cranes",
                                [{"source": "library", "min_score": 0.5}])
    assert item["media_type"] == "video"
    assert item["asset"]["path"] == "clips/v1.mp4"
    assert (tmp_path / "clips" / "v1.mp4").read_bytes() == b"mp4-bytes"
    assert "motion" not in item, "ken burns belongs to stills, not to a clip"


def test_min_score_reads_sim_so_a_reused_clip_survives(tmp_path, monkeypatch):
    """The re-run case. `score` carries the library's -1.0 same-project block,
    so a clip this video already placed ranks far below any threshold while
    still being a perfect match. Gating on `score` would drop it — and on a
    re-run that is every clip already placed, i.e. the whole library."""
    _captured(monkeypatch, _seg("seg_1", score=-0.55, sim=0.98))
    ctx = make_ctx(tmp_path)
    item = _item()
    assert sources.resolve_item(ctx, item, "harbour cranes",
                                [{"source": "library", "min_score": 0.5}])
    assert item["asset"]["id"] == "seg_1"


def test_a_weak_hit_is_skipped_not_a_stopping_point(tmp_path, monkeypatch):
    """Results are ordered by `score` and gated on `sim`, so the two do not
    agree on order and the walk cannot stop at the first miss."""
    _captured(monkeypatch,
              _seg("weak", score=0.90, sim=0.10),
              _seg("strong", score=0.60, sim=0.80))
    ctx = make_ctx(tmp_path)
    item = _item()
    assert sources.resolve_item(ctx, item, "harbour cranes",
                                [{"source": "library", "min_score": 0.5}])
    assert item["asset"]["id"] == "strong"


def test_a_library_with_no_sim_cannot_be_thresholded(tmp_path, monkeypatch):
    """Pointed at a library predating the raw-similarity field, a configured
    min_score has nothing correct to read: fall through and say why, rather
    than quietly gating on `score`."""
    _captured(monkeypatch, {"id": "seg_1", "score": 0.9, "license": "cc0"})
    ctx = make_ctx(tmp_path)
    assert not sources.resolve_item(ctx, _item(), "cranes",
                                    [{"source": "library", "min_score": 0.5}])
    assert any(p == "library" and not ok and "sim" in (e or "")
               for p, ok, e in ctx.db.health)


def test_without_a_threshold_a_missing_sim_is_harmless(tmp_path, monkeypatch):
    """No min_score means nothing to compare, so the same library works."""
    _captured(monkeypatch, {"id": "seg_1", "score": 0.9, "license": "cc0"})
    ctx = make_ctx(tmp_path)
    item = _item()
    assert sources.resolve_item(ctx, item, "cranes", [{"source": "library"}])
    assert item["asset"]["id"] == "seg_1"


def test_search_is_always_channel_scoped(tmp_path, monkeypatch):
    """Fail closed. /channels here returns nothing, so the lusora channel has
    no library channel of its own — the search must still carry a channel_id,
    or the library applies no channel filter and every channel's private
    uploads are in scope."""
    seen = _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    assert sources.resolve_item(ctx, _item(), "cranes",
                                [{"source": "library", "min_score": 0.5}])
    assert seen["channel_id"] == "CH", "the unmatched name, so is_mine is false"
    assert seen["include_global"] == "true", "...and only the global pool passes"


def test_include_global_false_with_no_library_channel_matches_nothing(tmp_path, monkeypatch):
    """The other half of the same rule: asked for this channel's own footage
    only, a channel that has none in the library gets nothing — not everyone's."""
    seen = _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    sources.resolve_item(ctx, _item(), "cranes",
                         [{"source": "library", "include_global": False,
                           "min_score": 0.5}])
    assert seen["channel_id"] == "CH"
    assert seen["include_global"] == "false"


def test_the_slot_length_aims_the_duration_fit(tmp_path, monkeypatch):
    """Ranking prefers clips near `prefer_seconds`; the caller knows the slot,
    so it says so instead of leaving ranking on its 5s default."""
    seen = _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    assert sources.resolve_item(ctx, _item(start=3.0, end=15.5), "cranes",
                                [{"source": "library", "min_score": 0.5}])
    assert seen["prefer_seconds"] == "12.5"


def test_licences_go_out_as_an_any_of_list(tmp_path, monkeypatch):
    """A source policy names every copyright status it will accept."""
    seen = _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    assert sources.resolve_item(
        ctx, _item(), "cranes",
        [{"source": "library", "min_score": 0.5, "licenses": ["cc0", "own"]}])
    assert seen["licenses"] == "cc0,own"


def test_inert_config_fields_are_not_sent(tmp_path, monkeypatch):
    """D76: media_types has nothing to select between (every row is an mp4)
    and profile is not a per-request choice. Sending either would be a filter
    the library silently ignores."""
    seen = _captured(monkeypatch, _seg("seg_1"))
    ctx = make_ctx(tmp_path)
    assert sources.resolve_item(
        ctx, _item(), "cranes",
        [{"source": "library", "min_score": 0.5,
          "media_types": ["video_clip"], "profile": "archive"}])
    assert "media_type" not in seen and "profile" not in seen


# ---------------- the image generator gets a real prompt (slice 7) ----------------


def test_the_image_prompt_carries_the_videos_visual_language(tmp_path):
    """`ai_image` is the terminal fallback in every source chain on this machine,
    so it catches every beat the library and stock miss — and its whole prompt
    was `f"{query}. {style}"`. No composition guidance, nothing about what never
    to draw, and no sight of `visual_language`, which is the one sentence that
    makes a generated frame and a sourced clip belong to the same video."""
    from lusora_worker.providers.sources import image_prompt

    ctx = make_ctx(tmp_path)
    ctx.cfg["style_pack_doc"] = {"visual_language": "Cold northern light, muted palette."}
    ctx.cfg["content_rules"] = "No identifiable faces."
    prompt = image_prompt(ctx, "a harbour at dawn", {"style": "Kodachrome."})

    assert prompt.startswith("a harbour at dawn"), "subject first — image models weight early tokens"
    assert "Cold northern light" in prompt
    assert "Kodachrome." in prompt
    assert "No identifiable faces." in prompt
    assert "Never draw text" in prompt
    assert "CENTRE CROP" in prompt


def test_the_generated_frame_is_asked_for_in_the_videos_own_orientation(tmp_path):
    """gpt-image-1 sells three shapes and 16:9 is not one of them, so this picks
    the nearest rather than always asking for 1536x1024 whatever the output is —
    which is what a portrait channel used to get."""
    from lusora_worker.providers.sources import _IMAGE_SIZES, image_aspect

    assert image_aspect({"output": {"width": 1920, "height": 1080}}) == "landscape"
    assert image_aspect({"output": {"width": 1080, "height": 1920}}) == "portrait"
    assert image_aspect({"output": {"width": 1080, "height": 1080}}) == "square"
    assert image_aspect({}) == "landscape", "the default output is 1920x1080"
    assert _IMAGE_SIZES["portrait"] == "1024x1536"


def test_the_image_prompt_is_data_and_can_be_replaced_per_video(tmp_path):
    """The point of making it a pack (D42): improving it is an edit to a JSON
    file, not a deploy. It used to be an f-string in the adapter."""
    from lusora_worker.providers.sources import image_prompt

    ctx = make_ctx(tmp_path)
    ctx.cfg["prompts"] = {"image": {"name": "custom", "role": "image",
                                    "system": "Ink on paper, no colour.",
                                    "user": "{{query}}"}}
    prompt = image_prompt(ctx, "a harbour at dawn", {"style": "ignored by this pack"})
    assert prompt == "a harbour at dawn\n\nInk on paper, no colour."


# ---------------- identity: never A's name over B's face (slice 1) ----------------


class Recorder:
    """A stub that records every question it was asked and what it was told."""

    def __init__(self, answer_to=None, source="stock"):
        self.asked: list[tuple[str, bool]] = []
        self.answer_to = answer_to          # substring that makes it answer
        self.source = source

    def resolve(self, ctx, item, query, source_cfg, ledger=None):
        self.asked.append((query, bool(source_cfg.get("no_person"))))
        if self.answer_to is None or self.answer_to.lower() in query.lower():
            return sources.Resolution(
                source=self.source, id="a1", provider="p", license="cc0",
                path="clips/x.jpg", score=0.9, query=query, media_type="image")
        return None


CHAIN = [{"source": "library"}, {"source": "stock"}, {"source": "ai_image"}]


def test_stock_and_ai_are_never_asked_who_a_person_is(tmp_path):
    """The reproduction, at its root. Pexels does not have Carsten Borchgrevink;
    it has photographs of men, and it answers confidently. So it is not asked —
    the identity question goes only to sources that could know him."""
    lib, stock, ai = Recorder(source="library"), Recorder(), Recorder(source="ai")
    sources.ADAPTERS.update({"library": lib, "stock": stock, "ai_image": ai})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b61", "start_s": 0, "end_s": 4}

    sources.resolve_item(ctx, item, "man leaping from a rowboat onto rock", CHAIN,
                         ["man jumping rowboat shore"], None,
                         identity="Carsten Borchgrevink")

    identity_qs = [q for q, _ in lib.asked if "Borchgrevink" in q]
    assert identity_qs, "the library WAS asked about the person"
    assert not any("Borchgrevink" in q for q, _ in stock.asked), stock.asked
    assert not any("Borchgrevink" in q for q, _ in ai.asked), ai.asked


def test_the_identity_question_wins_when_a_source_can_answer_it(tmp_path):
    """The good path: a library that has him is used, and the scene question
    never runs, so the video shows the actual person."""
    lib = Recorder(answer_to="Borchgrevink", source="library")
    stock = Recorder()
    sources.ADAPTERS.update({"library": lib, "stock": stock, "ai_image": Recorder(source="ai")})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b61", "start_s": 0, "end_s": 4}

    assert sources.resolve_item(ctx, item, "a man on a shore", CHAIN, ["shore"], None,
                                identity="Carsten Borchgrevink")
    assert item["asset"]["source"] == "library"
    assert stock.asked == [], "the scene question is not asked when the person was found"


def test_the_scene_question_runs_on_the_whole_chain_and_claims_nobody(tmp_path):
    """When the person cannot be found the frame is still filled — by the scene,
    from any source, flagged so that none of them answers with a person."""
    lib, stock = Recorder(answer_to="__never__", source="library"), Recorder()
    sources.ADAPTERS.update({"library": lib, "stock": stock, "ai_image": Recorder(source="ai")})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b61", "start_s": 0, "end_s": 4}

    assert sources.resolve_item(ctx, item, "a rocky shore", CHAIN, ["rocky shore"], None,
                                identity="Carsten Borchgrevink")
    assert item["asset"]["source"] == "stock", "stock is good at shores, just not at people"
    assert stock.asked and all(no_person for _q, no_person in stock.asked), stock.asked
    assert not any("Borchgrevink" in q for q, _ in stock.asked)


def test_a_beat_with_no_identity_behaves_exactly_as_before(tmp_path):
    """The regression that matters: almost every beat is not about a person, and
    none of them may change."""
    stock = Recorder()
    sources.ADAPTERS.update({"library": Recorder(answer_to="__never__", source="library"),
                             "stock": stock, "ai_image": Recorder(source="ai")})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b1", "start_s": 0, "end_s": 4}

    assert sources.resolve_item(ctx, item, "a rocky shore", CHAIN, ["rocky shore"], None)
    assert all(no_person is False for _q, no_person in stock.asked), stock.asked


# ---------------- the portrait guard ----------------


def test_the_guard_reads_a_single_person_as_a_subject_and_a_crowd_as_a_scene():
    """The rule is about a portrait standing in for someone, not about human
    beings appearing on screen — so plurals are deliberately absent from the
    list. Portuguese too, because the narration is."""
    assert sources.reads_as_a_person("Man in Black Jacket Standing on Rocky Shore")
    assert sources.reads_as_a_person("retrato de um homem")
    assert sources.reads_as_a_person("close-up portrait, studio lighting")
    assert not sources.reads_as_a_person("A crowd of workers leaves the factory gates")
    assert not sources.reads_as_a_person("shipyard welding work near large ship")
    assert not sources.reads_as_a_person("rocky coastline with waves")
    assert not sources.reads_as_a_person(""), "no description is not a person"


def test_the_guard_does_not_fire_on_words_that_merely_contain_one():
    """`man` inside `many`, `human` or `manager` is how a word-list guard starts
    rejecting everything."""
    for text in ("many ships at anchor", "a human settlement from the air",
                 "the manager's office, empty", "romance languages on a map"):
        assert not sources.reads_as_a_person(text), text


def test_a_stock_video_is_judged_by_its_url_because_it_carries_nothing_else():
    """A Pexels photo has `alt`; a video has neither alt nor tags, and its URL is
    built from its title, which is the only thing Pexels says about it."""
    assert sources._slug_words(
        "https://www.pexels.com/video/shipyard-welding-work-near-large-ship-38415766/"
    ) == "shipyard welding work near large ship"


# ---------------- detection, read from the plan (slice 1) ----------------


def _plan_with_overlay(**overlay):
    base = {"id": "o1", "beat_id": "b61", "locked": False, "kind": "component",
            "start_s": 1.0, "end_s": 5.0}
    return {"tracks": {"overlays": [{**base, **overlay}]}}


def test_a_nameplate_is_the_sheet_declaring_a_person_belongs_to_the_moment():
    """Free detection, needing no new field: a component that attaches to a
    `name` anchor, with a name in its props, is exactly the reproduction."""
    from lusora_worker.pipeline.steps import identities_in

    plan = _plan_with_overlay(component="NamePlate",
                              props={"name": "Carsten Borchgrevink", "role": "norueguês"})
    assert identities_in(plan) == {"b61": "Carsten Borchgrevink"}


def test_a_component_that_takes_no_name_anchor_is_not_an_identity():
    """A counter, a chart or a date card says nothing about who is on screen."""
    from lusora_worker.pipeline.steps import identities_in

    assert identities_in(_plan_with_overlay(component="AnimatedCounter",
                                            props={"value": 70, "label": "of grain"})) == {}
    assert identities_in(_plan_with_overlay(component="ChapterCard",
                                            props={"title": "Part One"})) == {}


def test_detection_reads_the_plan_because_v3_beats_carry_no_overlay():
    """On faceless_v3 the selections live in overlays.json and are merged into
    beats only in the compiler's memory, so a beat sheet on disk has no
    `overlay` at all. Reading the plan is what makes this work on every
    pipeline rather than on the two that predate D87."""
    from lusora_worker.pipeline.steps import identities_in

    path = (Path(__file__).resolve().parents[2] / "data" / "videos"
            / "vid_bb05c1b483eb" / "edit_plan.json")
    if not path.exists():
        pytest.skip("the reproduction is not on this machine")
    plan = json.loads(path.read_text(encoding="utf-8"))
    assert identities_in(plan) == {"b61": "Carsten Borchgrevink"}


# ---------------- an identity answer must name the entity ----------------


def test_a_library_hit_that_does_not_name_the_entity_is_not_an_answer(tmp_path):
    """Found by running a video, which is the only way it could have been.

    Restricting WHO may answer the identity question is not enough: asked for
    "Royal Geographical Society", the live library returned a formal portrait of
    a 19th-century naval officer at sim 0.50 — high, because the query carries
    the shot description too — and slice 1 accepted it. That is the same
    wrong-face-under-a-name bug, one source over.

    A similarity threshold could not have caught it. Only the name can.
    """
    class Library:
        def __init__(self): self.offered = []
        def resolve(self, ctx, item, query, source_cfg, ledger=None):
            self.offered.append(source_cfg.get("must_name"))
            described = "A formal portrait of a 19th-century naval officer"
            # both guards, as the real adapter applies them
            if source_cfg.get("must_name") and not sources.mentions(described, source_cfg["must_name"]):
                return None
            if source_cfg.get("no_person") and sources.reads_as_a_person(described):
                return None
            return sources.Resolution(source="library", id="seg1", provider=None, license="cc0",
                                      path="clips/x.mp4", score=0.5, query=query,
                                      media_type="video")

    lib = Library()
    sources.ADAPTERS.update({"library": lib, "stock": Recorder(answer_to="__never__"),
                             "ai_image": Recorder(answer_to="__never__", source="ai")})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b6", "start_s": 0, "end_s": 4}

    assert not sources.resolve_item(ctx, item, "a weathered explorer aboard a ship",
                                    CHAIN, ["explorer ship"], None,
                                    identity="Royal Geographical Society")
    assert "Royal Geographical Society" in lib.offered, "the requirement reached the adapter"


def test_a_hit_that_does_name_the_entity_is_accepted(tmp_path):
    """The rule has to be able to say yes, or an identity beat could never show
    the thing it is about."""
    class Library:
        def resolve(self, ctx, item, query, source_cfg, ledger=None):
            described = "Royal Geographical Society medal ceremony, 1901"
            if source_cfg.get("must_name") and not sources.mentions(described, source_cfg["must_name"]):
                return None
            return sources.Resolution(source="library", id="seg2", provider=None, license="cc0",
                                      path="clips/x.mp4", score=0.5, query=query,
                                      media_type="video")

    sources.ADAPTERS.update({"library": Library(), "stock": Recorder(), "ai_image": Recorder(source="ai")})
    ctx = make_ctx(tmp_path)
    item = {"id": "v1", "beat_id": "b6", "start_s": 0, "end_s": 4}
    assert sources.resolve_item(ctx, item, "a ceremony", CHAIN, ["ceremony"], None,
                                identity="Royal Geographical Society")
    assert item["asset"]["source"] == "library"


def test_mentions_needs_every_token_not_the_longest_one():
    """Matching on one token would let "Southern Cross" be answered by anything
    containing "cross". Strict on purpose: a miss falls to the scene question,
    which is safe, while a false accept is the whole bug."""
    assert sources.mentions("Carsten Borchgrevink at Cape Adare, 1899", "Carsten Borchgrevink")
    assert sources.mentions("borchgrevink, carsten — landing party", "Carsten Borchgrevink")
    assert not sources.mentions("a crucifix on a hill", "Southern Cross")
    assert not sources.mentions("A formal portrait of a naval officer", "Royal Geographical Society")
    assert not sources.mentions("", "Carsten Borchgrevink")


# ---------------- which Pexels rendition is downloaded (throughput slice 1) ----------------

OUT = {"width": 1920, "height": 1080, "fps": 30}


def _file(w, h, fps=30, tag=None):
    return {"width": w, "height": h, "fps": fps, "file_type": "video/mp4",
            "link": tag or f"https://pexels.test/{w}x{h}@{fps}.mp4"}


def _short(f):
    return min(f["width"], f["height"])


def test_the_rendition_at_the_plan_size_wins_over_a_bigger_one():
    files = [_file(3840, 2160), _file(1920, 1080), _file(1280, 720)]
    assert _short(sources.pick_video_file(files, OUT)) == 1080


def test_without_the_plan_size_the_largest_below_it_beats_anything_above():
    """A mild upscale in the render is cheaper than a 4K download and a transcode."""
    files = [_file(3840, 2160), _file(2560, 1440), _file(1280, 720), _file(1600, 900)]
    assert _short(sources.pick_video_file(files, OUT)) == 900


def test_above_the_plan_size_is_taken_only_when_everything_else_is_under_720():
    files = [_file(3840, 2160), _file(2560, 1440), _file(960, 540)]
    assert _short(sources.pick_video_file(files, OUT)) == 1440


def test_only_small_renditions_means_the_largest_of_them():
    files = [_file(640, 360), _file(960, 540)]
    assert _short(sources.pick_video_file(files, OUT)) == 540


def test_portrait_is_judged_on_its_short_side_too():
    portrait = {"width": 1080, "height": 1920, "fps": 30}
    files = [_file(2160, 3840), _file(1080, 1920), _file(720, 1280)]
    assert _short(sources.pick_video_file(files, portrait)) == 1080


def test_a_tie_goes_to_the_frame_rate_nearest_the_output():
    files = [_file(1920, 1080, 60, "sixty"), _file(1920, 1080, 29.97, "ntsc"), _file(1920, 1080, 25, "pal")]
    assert sources.pick_video_file(files, OUT)["link"] == "ntsc"


def test_a_rendition_without_a_size_is_not_a_candidate():
    files = [{"width": None, "height": None, "file_type": "video/mp4", "link": "x"},
             {"width": 1920, "height": 1080, "file_type": "application/x-mpegURL", "link": "hls"}]
    assert sources.pick_video_file(files, OUT) is None


def test_the_stock_adapter_downloads_the_chosen_rendition(tmp_path, monkeypatch):
    fetched = []

    def handler(request):
        if request.url.host == "api.pexels.com":
            return httpx.Response(200, json={"videos": [{
                "id": 7, "url": "https://www.pexels.com/video/harbour-cranes-7/",
                "video_files": [_file(3840, 2160), _file(1920, 1080), _file(1280, 720)],
            }]})
        fetched.append(str(request.url))
        return httpx.Response(200, content=b"mp4-bytes")

    _patch_library(monkeypatch, handler)
    monkeypatch.setenv("PEXELS_API_KEY", "k")
    ctx = make_ctx(tmp_path)
    ctx.cfg["output"] = OUT
    ctx.config = type("C", (), {"library_api_url": "", "videos_root": tmp_path / "videos"})()

    res = sources.PexelsAdapter().resolve(ctx, _item(), "harbour cranes", {"source": "stock"})

    assert res is not None and res["id"] == "7"
    assert fetched == ["https://pexels.test/1920x1080@30.mp4"]


# ---------------- library lookups once per run (throughput slice 2) ----------------


def _counting_library(monkeypatch, fail_first=False):
    calls = {"channels": 0, "search": 0}

    def handler(request):
        path = request.url.path
        if path == "/channels":
            calls["channels"] += 1
            if fail_first and calls["channels"] == 1:
                return httpx.Response(503)
            return httpx.Response(200, json=[{"id": 9, "name": "CH"}])
        if path == "/search":
            calls["search"] += 1
            return httpx.Response(200, json=[_seg(f"seg_{calls['search']}")])
        if path.startswith("/clips/"):
            return httpx.Response(200, content=b"mp4-bytes")
        return httpx.Response(200, json=[])

    _patch_library(monkeypatch, handler)
    return calls


def test_the_channel_is_looked_up_once_per_run_not_once_per_item(tmp_path, monkeypatch):
    calls = _counting_library(monkeypatch)
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    for i in range(5):
        assert sources.resolve_item(ctx, _item(f"v{i}"), "harbour cranes", chain)

    assert calls == {"channels": 1, "search": 5}


def test_a_new_run_asks_again(tmp_path, monkeypatch):
    """A channel the library gains from an ingest is found by the next run."""
    calls = _counting_library(monkeypatch)
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    sources.resolve_item(ctx, _item("v1"), "harbour cranes", chain)
    sources.begin_run()
    sources.resolve_item(ctx, _item("v2"), "harbour cranes", chain)

    assert calls["channels"] == 2


def test_a_failed_lookup_is_not_remembered(tmp_path, monkeypatch):
    calls = _counting_library(monkeypatch, fail_first=True)
    ctx = make_ctx(tmp_path)
    chain = [{"source": "library", "min_score": 0.5}]
    sources.resolve_item(ctx, _item("v1"), "harbour cranes", chain)
    sources.resolve_item(ctx, _item("v2"), "harbour cranes", chain)

    assert calls["channels"] == 2


def test_the_ledger_hashes_nothing_while_the_similarity_check_is_off(tmp_path, monkeypatch):
    """Every placed shot used to be hashed — one or two ffmpeg runs each —
    whether or not any channel had asked for the check."""
    hashed = []
    monkeypatch.setattr(sources, "perceptual_hash", lambda p: hashed.append(p) or 1)

    sources.Ledger().remember({"source": "stock", "id": "1"}, tmp_path / "a.mp4")
    assert hashed == []

    on = sources.Ledger({"source_policy": {"visual": {"dedup": {"min_hamming_distance": 6}}}})
    on.remember({"source": "stock", "id": "1"}, tmp_path / "a.mp4")
    assert len(hashed) == 1
