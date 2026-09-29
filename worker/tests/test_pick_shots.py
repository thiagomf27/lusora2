"""The shot judge (D103, documentary plan slice 3).

Run 01 of the Centralia benchmark placed whatever a keyword search returned
first: a tropical garbage fire under "the town dump", a palm-lined street under
"1960s small town". Slice 2 made the searches ask about the story; these tests
pin the piece that LOOKS at the answers — candidates on a contact sheet, rated
by a vision judge, the best one fetched — and the rule that a judge that cannot
answer costs quality, never the video.
"""

import json
import os
import stat
import subprocess
from pathlib import Path

import pytest

from lusora_worker import validators
from lusora_worker.agents import pick_shots
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers import llm, sources
from lusora_worker.providers.llm import LLMResult

from test_agents import CFG, FakeDb


def ctx_for(tmp_path, pick=None, chain=None, budget=1.0):
    cfg = json.loads(json.dumps(CFG))
    cfg["budget"] = {"max_usd_per_video": budget}
    cfg["source_policy"] = {"visual": {"chain": chain or [{"source": "stock"}]}}
    if pick is not None:
        cfg["source_policy"]["visual"]["pick"] = pick
    db = FakeDb()
    db.asset_usage = lambda *a: None
    return StageContext(video={"id": "vid_p", "channel_id": "CH", "title": "Centralia"},
                        folder=tmp_path, cfg=cfg, db=db, config=None)


# ---------------- the answer ----------------


def test_a_complete_answer_passes():
    answer = {"ratings": [{"n": 0, "rating": 5, "logo": ""}, {"n": 1, "rating": 1, "logo": "top-right"}]}
    assert validators.validate_ratings(answer, 2) == []


@pytest.mark.parametrize("answer, expected", [
    ({"ratings": [{"n": 0, "rating": 4, "logo": ""}]}, "not rated: #1"),
    ({"ratings": [{"n": 0, "rating": 4}, {"n": 0, "rating": 2}, {"n": 1, "rating": 3}]}, "#0 is rated twice"),
    ({"ratings": [{"n": 0, "rating": 6}, {"n": 1, "rating": 3}]}, "rating 6 is not an integer 1-5"),
    ({"ratings": [{"n": 0, "rating": "4"}, {"n": 1, "rating": 3}]}, "rating '4' is not an integer"),
    ({"ratings": [{"n": 0, "rating": 4, "logo": "center"}, {"n": 1, "rating": 3}]}, "logo 'center'"),
    ({"ratings": [{"n": 7, "rating": 4}, {"n": 0, "rating": 3}, {"n": 1, "rating": 3}]}, "#7 is not on the sheet"),
    ([{"n": 0}], "must be an object"),
])
def test_every_thumbnail_must_be_rated_once_and_properly(answer, expected):
    problems = validators.validate_ratings(answer, 2)
    assert any(expected in p for p in problems), problems


# ---------------- the provider ----------------


def test_a_text_only_provider_is_refused_by_name():
    with pytest.raises(StageError, match="'deepseek' cannot see images"):
        llm.see("deepseek", None, "sys", "user", [])


def test_every_provider_declares_whether_it_can_see():
    for name, spec in llm.PROVIDERS.items():
        assert isinstance(spec.vision, bool), name
    assert llm.PROVIDERS["claude_cli"].vision and not llm.PROVIDERS["deepseek"].vision


@pytest.fixture
def fake_claude(tmp_path, monkeypatch):
    """A stand-in `claude` binary: records its argv, the files beside it and
    its environment, and answers like `claude -p --output-format json`."""
    record = tmp_path / "record.json"
    script = tmp_path / "claude"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        f"rec = {str(record)!r}\n"
        "prompt = sys.stdin.read()\n"
        "json.dump({'argv': sys.argv[1:], 'files': sorted(os.listdir('.')), 'prompt': prompt,\n"
        "           'claudecode': os.environ.get('CLAUDECODE')}, open(rec, 'w'))\n"
        "print(json.dumps({'type': 'result', 'is_error': False, 'result': '{\"ratings\": []}',\n"
        "                  'usage': {'input_tokens': 5, 'cache_read_input_tokens': 1000, 'output_tokens': 40}}))\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("CLAUDE_BIN", str(script))
    monkeypatch.setenv("CLAUDECODE", "1")
    return record


def test_the_cli_looks_at_copies_with_only_its_read_tool(tmp_path, fake_claude):
    sheet = tmp_path / "sheet_01.jpg"
    sheet.write_bytes(b"jpg")
    result = llm.see("claude_cli", "haiku", "SYSTEM", "USER", [sheet])
    seen = json.loads(fake_claude.read_text())
    assert seen["files"] == ["00_sheet_01.jpg"], "the scratch folder holds only the images"
    assert seen["argv"][seen["argv"].index("--tools") + 1] == "Read"
    assert seen["argv"][seen["argv"].index("--model") + 1] == "haiku"
    assert "00_sheet_01.jpg" in seen["prompt"] and "SYSTEM" in seen["prompt"] and "USER" in seen["prompt"]
    assert seen["claudecode"] is None, "a parent Claude session's variables never reach the child"
    assert result.input_tokens == 1005 and result.output_tokens == 40


def test_a_text_call_on_the_cli_gets_no_tools(fake_claude):
    llm.chat("claude_cli", None, "SYSTEM", "USER")
    seen = json.loads(fake_claude.read_text())
    assert seen["argv"][seen["argv"].index("--tools") + 1] == ""
    assert seen["argv"][seen["argv"].index("--model") + 1] == "sonnet"


# ---------------- the stage ----------------


def _jpg(path: Path, color: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=64x36",
                    "-frames:v", "1", str(path)], check=True)


class OfferingStock:
    """A keyword source that offers candidates and fetches by id."""

    query_kind = "keyword"

    def __init__(self, offers: dict[str, list[str]], broken: set[str] = frozenset()):
        self.offers = offers          # item id -> candidate ids, in search order
        self.broken = set(broken)     # ids whose download fails
        self.fetched: list[tuple[str, str]] = []
        self.searched: list[str] = []

    def candidates(self, ctx, item, queries, source_cfg, limit):
        return [{"source": "stock", "provider": "pexels", "id": cid, "query": queries[0],
                 "page_size": limit, "thumb": f"https://thumbs/{cid}.jpg"}
                for cid in self.offers.get(item["id"], [])][:limit]

    def fetch(self, ctx, item, candidate, source_cfg, ledger=None):
        self.fetched.append((item["id"], candidate["id"]))
        if candidate["id"] in self.broken:
            return None
        path = f"clips/{item['id']}.jpg"
        (ctx.folder / path).write_bytes(candidate["id"].encode())
        return sources.Resolution(source="stock", id=candidate["id"], provider="pexels",
                                  license="royalty-free", path=path, score=None,
                                  query=candidate["query"], media_type="image")

    def resolve(self, ctx, item, query, source_cfg, ledger=None):
        self.searched.append(item["id"])
        path = f"clips/{item['id']}.jpg"
        (ctx.folder / path).write_bytes(b"first hit")
        return sources.Resolution(source="stock", id=f"plain-{item['id']}", provider="pexels",
                                  license="royalty-free", path=path, score=None, query=query,
                                  media_type="image")


@pytest.fixture
def stock(monkeypatch):
    saved = dict(sources.ADAPTERS)
    holder = {}

    def install(adapter):
        sources.ADAPTERS["stock"] = adapter
        holder["a"] = adapter
        return adapter

    yield install
    sources.ADAPTERS.clear()
    sources.ADAPTERS.update(saved)


@pytest.fixture
def local_thumbs(monkeypatch):
    """Thumbnails come from disk instead of the CDN; `thumb-dead` never arrives."""
    def fake_thumb(url, dest):
        if "dead" in url:
            return False
        _jpg(dest, "gray")
        return True

    monkeypatch.setattr(pick_shots, "_thumb", fake_thumb)


def _video(tmp_path, n_items=3):
    (tmp_path / "clips").mkdir(exist_ok=True)
    items = [{"id": f"v{i}", "beat_id": f"b{i}", "start_s": 3.0 * i, "end_s": 3.0 * (i + 1), "asset": {}}
             for i in range(n_items)]
    (tmp_path / "edit_plan.json").write_text(json.dumps({"tracks": {"visual": items, "overlays": []}}))
    (tmp_path / "beats.json").write_text(json.dumps({"beats": [
        {"id": f"b{i}", "script_text": f"line {i}", "visual_intent": f"intent {i}", "queries": [f"query {i}"]}
        for i in range(n_items)]}))
    return items


def test_the_judge_rates_every_shot_on_one_sheet_and_the_best_comes_first(tmp_path, stock, local_thumbs):
    _video(tmp_path, 2)
    stock(OfferingStock({"v0": ["a", "b", "c"], "v1": ["d", "e"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True, "llm": "claude_cli", "shots_per_sheet": 6})
    calls = []

    def see(provider, model, system, user, images, max_tokens, temperature):
        calls.append((user, images))
        assert Path(images[0]).exists(), "the sheet is on disk when the judge is asked"
        return LLMResult(text=json.dumps({"ratings": [
            {"n": 0, "rating": 2, "logo": "", "desc": "palm trees"},
            {"n": 1, "rating": 5, "logo": "top-right", "desc": "coal town aerial"},
            {"n": 2, "rating": 4, "logo": "", "desc": "mine tunnel"},
            {"n": 3, "rating": 3, "logo": "", "desc": "smoke"},
            {"n": 4, "rating": 1, "logo": "", "desc": "office"},
        ]}), input_tokens=1500, output_tokens=200)

    doc = pick_shots.pick(ctx, [(it, {"script_text": "s", "visual_intent": "i"}, ["q"])
                               for it in json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]],
                          ctx.cfg["source_policy"]["visual"]["chain"], see_fn=see)
    assert len(calls) == 1, "two shots fit one sheet"
    assert "shot 1 (#0-#2)" in calls[0][0] and "shot 2 (#3-#4)" in calls[0][0]
    assert [c["id"] for c in doc["items"]["v0"]["candidates"]] == ["b", "c", "a"]
    assert doc["items"]["v0"]["candidates"][0]["logo"] == "top-right"
    assert pick_shots.best_candidates(doc, "v1", 3) == [doc["items"]["v1"]["candidates"][0]]
    assert validators.validate_shot_picks(doc) == []


def test_a_grayscale_thumbnail_does_not_wipe_the_cells_before_it(tmp_path, monkeypatch):
    """A black-and-white archival still is a grayscale JPEG. Before every cell
    was forced to one pixel format, the format change rebuilt ffmpeg's tile
    filter mid-sequence and the cells before it came out black — on the first
    Centralia run, two whole rows the judge then rated 'not visible'."""
    def thumb(url, dest):
        vf = ["-vf", "format=gray"] if "bw" in url else []
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=64x36",
                        *vf, "-frames:v", "1", str(dest)], check=True)
        return True

    monkeypatch.setattr(pick_shots, "_thumb", thumb)
    rows = [[{"id": "a", "thumb": "https://x/a.jpg"}], [{"id": "b", "thumb": "https://x/bw.jpg"}]]
    sheet, numbered = pick_shots.build_sheet(tmp_path / "sheets", rows, 0, 2, "sheet_01")
    assert len(numbered) == 2
    for top in (pick_shots.LABEL_H, pick_shots.CELL_H + 2 * pick_shots.LABEL_H):
        pixel = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(sheet), "-vf",
             f"crop={pick_shots.CELL_W}:{pick_shots.CELL_H - 20}:0:{top + 10},scale=1:1",
             "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
        assert pixel[0] > 200, f"the cell at y={top} is on the sheet, white, not black"


def test_a_thumbnail_that_never_arrives_takes_no_number(tmp_path, local_thumbs):
    rows = [[{"id": "a", "thumb": "https://x/a.jpg"}, {"id": "dead", "thumb": "https://x/thumb-dead.jpg"},
             {"id": "c", "thumb": "https://x/c.jpg"}]]
    sheet, numbered = pick_shots.build_sheet(tmp_path / "sheets", rows, 0, 4, "sheet_01")
    assert [c["id"] for _r, c in numbered] == ["a", "c"]
    assert sheet.exists()
    assert sorted(p.name for p in (tmp_path / "sheets").iterdir()) == ["sheet_01.jpg"], "cells are cleaned up"


def test_a_judge_that_cannot_answer_leaves_its_shots_to_the_plain_search(tmp_path, stock, local_thumbs):
    _video(tmp_path, 2)
    stock(OfferingStock({"v0": ["a"], "v1": ["b"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True, "llm": "claude_cli"})

    def down(*_a):
        raise StageError("llm", "claude_cli failed: usage limit reached")

    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    doc = pick_shots.pick(ctx, [(it, {}, ["q"]) for it in items], [{"source": "stock"}], see_fn=down)
    assert doc["unjudged"] == ["v0", "v1"] and doc["items"] == {} and doc["sheets"] == 0
    assert any("did not answer" in (m or "") for _s, _k, m in ctx.db.events)
    assert [e["status"] for e in ctx.db.cost_events][-1] == "failed", "the failed call is on the ledger"


def test_a_budget_stop_still_stops_the_video(tmp_path, stock, local_thumbs):
    _video(tmp_path, 1)
    stock(OfferingStock({"v0": ["a"]}))
    # anthropic is priced; a budget of nothing cannot reserve a sheet
    ctx = ctx_for(tmp_path, pick={"enabled": True, "llm": "anthropic"}, budget=0.0)
    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    with pytest.raises(StageError, match="would exceed budget"):
        pick_shots.pick(ctx, [(it, {}, ["q"]) for it in items], [{"source": "stock"}],
                        see_fn=lambda *a: pytest.fail("never called"))


def test_a_rejected_answer_is_repaired_once(tmp_path, stock, local_thumbs):
    _video(tmp_path, 1)
    stock(OfferingStock({"v0": ["a", "b"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True})
    answers = [{"ratings": [{"n": 0, "rating": 4}]},
               {"ratings": [{"n": 0, "rating": 4}, {"n": 1, "rating": 2}]}]
    users = []

    def see(provider, model, system, user, images, *_):
        users.append(user)
        return LLMResult(text=json.dumps(answers.pop(0)), input_tokens=1, output_tokens=1)

    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    doc = pick_shots.pick(ctx, [(it, {}, ["q"]) for it in items], [{"source": "stock"}], see_fn=see)
    assert "not rated: #1" in users[1]
    assert [c["rating"] for c in doc["items"]["v0"]["candidates"]] == [4, 2]


def test_a_last_answer_that_skips_thumbnails_keeps_what_it_rated(tmp_path, stock, local_thumbs):
    _video(tmp_path, 1)
    stock(OfferingStock({"v0": ["a", "b"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True})

    def see(*_a):
        return LLMResult(text=json.dumps({"ratings": [{"n": 1, "rating": 4}]}), input_tokens=1, output_tokens=1)

    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    doc = pick_shots.pick(ctx, [(it, {}, ["q"]) for it in items], [{"source": "stock"}], see_fn=see)
    assert [(c["id"], c["rating"]) for c in doc["items"]["v0"]["candidates"]] == [("b", 4)]
    assert doc["unjudged"] == []


class QueryStock(OfferingStock):
    """Candidates depend on the query asked, like a real search."""

    def __init__(self, by_query: dict[str, list[str]]):
        super().__init__({})
        self.by_query = by_query
        self.asked: list[list[str]] = []

    def candidates(self, ctx, item, queries, source_cfg, limit):
        self.asked.append(list(queries))
        out = []
        for query in queries[:2]:
            out += [{"source": "stock", "provider": "pexels", "id": cid, "query": query,
                     "page_size": limit, "thumb": f"https://thumbs/{cid}.jpg"}
                    for cid in self.by_query.get(query, [])]
        return out[:limit]


def test_a_weak_shot_gets_a_second_round_on_the_searches_it_did_not_ask(tmp_path, stock, local_thumbs):
    _video(tmp_path, 2)
    adapter = stock(QueryStock({"beat q": ["sunny"], "subject q": ["suburb"], "thread q": ["coal town"],
                                "good q": ["mine"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True, "min_rating": 3})
    ratings = iter([
        # round 1: v0 sees sunny + suburb (both 1); v1 sees mine (5)
        [{"n": 0, "rating": 1}, {"n": 1, "rating": 1}, {"n": 2, "rating": 5}],
        # round 2: v0 only, on the thread search
        [{"n": 0, "rating": 4}],
    ])
    sheets = []

    def see(provider, model, system, user, images, *_):
        sheets.append(user)
        return LLMResult(text=json.dumps({"ratings": next(ratings)}), input_tokens=1, output_tokens=1)

    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    shots = [(items[0], {}, ["beat q", "subject q", "thread q"]), (items[1], {}, ["good q"])]
    doc = pick_shots.pick(ctx, shots, [{"source": "stock"}], see_fn=see)
    assert adapter.asked[-1] == ["thread q"], "round 2 asks only what round 1 did not"
    assert len(sheets) == 2 and "shot 2" not in sheets[1], "the good shot is not judged again"
    assert [(c["id"], c["rating"]) for c in doc["items"]["v0"]["candidates"]] == [
        ("coal town", 4), ("sunny", 1), ("suburb", 1)]
    assert doc["sheets"] == 2


def test_the_mock_judge_keeps_the_search_order_without_a_sheet(tmp_path, stock):
    _video(tmp_path, 1)
    stock(OfferingStock({"v0": ["a", "b", "c"]}))
    ctx = ctx_for(tmp_path, pick={"enabled": True, "llm": "mock"})
    items = json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]
    doc = pick_shots.pick(ctx, [(it, {}, ["q"]) for it in items], [{"source": "stock"}],
                          see_fn=lambda *a: pytest.fail("mock never looks"))
    assert [c["id"] for c in doc["items"]["v0"]["candidates"]] == ["a", "b", "c"]
    assert not (tmp_path / "sheets").exists()


def test_pick_off_writes_a_doc_that_changes_nothing(tmp_path):
    from lusora_worker.pipeline import steps

    _video(tmp_path, 1)
    ctx = ctx_for(tmp_path)
    steps.run_pick_shots(ctx)
    doc = json.loads((tmp_path / "shot_picks.json").read_text())
    assert doc["enabled"] is False and doc["items"] == {}
    assert validators.validate_shot_picks(doc) == []


# ---------------- resolve_assets places the picks ----------------


def _resolve(tmp_path, adapter, picks, monkeypatch, n_items=3):
    from lusora_worker.pipeline import steps

    monkeypatch.setenv("ASSET_PARALLELISM", "1")
    _video(tmp_path, n_items)
    (tmp_path / "shot_picks.json").write_text(json.dumps(
        {"version": "1.0", "video_id": "vid_p", "enabled": True, "items": {
            item_id: {"candidates": [{"source": "stock", "provider": "pexels", "id": cid, "query": "q",
                                      "rating": rating, "logo": ""} for cid, rating in cands]}
            for item_id, cands in picks.items()}}))
    ctx = ctx_for(tmp_path, pick={"enabled": True, "min_rating": 3})
    ctx.db.provider_health = lambda *a, **k: None
    steps.run_resolve_assets(ctx)
    return json.loads((tmp_path / "edit_plan.json").read_text())["tracks"]["visual"]


def test_resolve_places_the_best_pick_not_already_on_screen(tmp_path, stock, monkeypatch):
    adapter = stock(OfferingStock({}, broken={"x"}))
    placed = _resolve(tmp_path, adapter, {
        "v0": [("a", 5), ("b", 4)],
        "v1": [("a", 5), ("c", 4)],          # a is on screen already: c
        "v2": [("x", 5), ("d", 3), ("e", 2)],  # x will not download: d; e is under min_rating
    }, monkeypatch)
    assert [v["asset"]["id"] for v in placed] == ["a", "c", "d"]
    assert adapter.searched == [], "every shot had a usable pick"


def test_a_weak_pick_beats_the_plain_search_and_an_unusable_one_does_not(tmp_path, stock, monkeypatch):
    """Nothing at min_rating: a 2 ('right words, wrong picture') is still placed,
    because the plain search's first hit is one of the candidates the judge
    already rated no higher. A shot whose candidates are all 1s, or that was
    never judged, asks the plain search."""
    adapter = stock(OfferingStock({}))
    placed = _resolve(tmp_path, adapter, {"v0": [("a", 1)], "v1": [("b", 4)], "v2": [("c", 2)]},
                      monkeypatch, n_items=4)
    assert [v["asset"]["id"] for v in placed] == ["plain-v0", "b", "c", "plain-v3"]
    assert adapter.searched == ["v0", "v3"]


def test_an_uploaded_picks_file_is_checked(tmp_path, stock, monkeypatch):
    from lusora_worker.pipeline import steps

    stock(OfferingStock({}))
    _video(tmp_path, 1)
    (tmp_path / "shot_picks.json").write_text(json.dumps({"version": "1.0", "items": {}}))
    with pytest.raises(StageError, match="shot_picks.json invalid"):
        steps.run_resolve_assets(ctx_for(tmp_path))


# ---------------- a dead link is not a dead source ----------------


class _Stream:
    def __init__(self, url, fail):
        self.url, self.fail = url, fail

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        import httpx

        if self.fail:
            raise httpx.HTTPStatusError("gone", request=httpx.Request("GET", self.url),
                                        response=httpx.Response(404))

    def iter_bytes(self):
        yield b"photo"


def test_a_failed_download_moves_on_to_the_next_hit(tmp_path, monkeypatch):
    """sources.py returned None for the whole source on one failed download, so
    a dead link sent the beat down the chain with good hits still unread."""
    (tmp_path / "clips").mkdir()
    adapter = sources.PexelsAdapter()
    hits = [{"id": 1, "alt": "coal town", "src": {"large2x": "https://dead/1.jpg"}},
            {"id": 2, "alt": "coal town", "src": {"large2x": "https://ok/2.jpg"}}]
    monkeypatch.setattr(adapter, "_search", lambda *a, **k: hits)
    monkeypatch.setattr(sources.httpx, "stream", lambda method, url, **k: _Stream(url, "dead" in url))
    ctx = ctx_for(tmp_path)
    ctx.db.provider_health = lambda *a, **k: None
    found = adapter.resolve(ctx, {"id": "v0"}, "coal town", {"source": "stock", "media_types": ["image"]})
    assert found is not None and found["id"] == "2"


def test_a_picked_candidate_is_fetched_from_the_cached_search(tmp_path, monkeypatch):
    (tmp_path / "clips").mkdir()
    adapter = sources.PexelsAdapter()
    asked = []

    def search(ctx, query, source_cfg, per_page=5):
        asked.append((query, per_page))
        return [{"id": 7, "src": {"large2x": "https://ok/7.jpg"}}, {"id": 9, "src": {"large2x": "https://ok/9.jpg"}}]

    monkeypatch.setattr(adapter, "_search", search)
    monkeypatch.setattr(sources.httpx, "stream", lambda method, url, **k: _Stream(url, False))
    monkeypatch.setattr(sources, "reframe", lambda path, logo="": "")
    ctx = ctx_for(tmp_path)
    ctx.db.provider_health = lambda *a, **k: None
    found = adapter.fetch(ctx, {"id": "v0"}, {"id": "9", "query": "coal town", "page_size": 6, "logo": ""},
                          {"source": "stock", "media_types": ["image"]})
    assert found["id"] == "9" and asked == [("coal town", 6)]


def test_letterbox_bars_are_found_and_thin_ones_left_alone(tmp_path):
    boxed, plain = tmp_path / "boxed.mp4", tmp_path / "plain.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=320x140:d=5:r=10",
                    "-vf", "pad=320:180:0:20:black", "-pix_fmt", "yuv420p", str(boxed)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=320x180:d=5:r=10",
                    "-pix_fmt", "yuv420p", str(plain)], check=True)
    assert sources.letterbox_crop(boxed) == "crop=320:140:0:20"
    assert sources.letterbox_crop(plain) == ""
    assert sources.reframe(plain, "") == "" and sources.reframe(plain, "top-left").startswith("crop=iw*0.86")
