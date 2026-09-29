"""Footage from the open internet (D104, documentary plan slice 4).

After slices 2 and 3 the searches asked about the story and a judge looked at
the answers, but the answers could only come from Pexels — which has no 1962
Pennsylvania, so the Centralia dump fire stayed a tropical garbage fire. These
tests pin the reach that fixes it: YouTube footage chosen from its titles and
cut into shots, free-licence archive photos, the 18+ filter in front of both,
and the pool offered to the judge beside stock. Nothing here touches the
network; the fetchers are faked at their edges.
"""

import json
import subprocess
from pathlib import Path

import pytest

from lusora_worker.agents import gather_footage as gf
from lusora_worker.agents import pick_shots
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers import adult_filter, footage, sources
from lusora_worker.providers.llm import LLMResult

from test_agents import CFG, FakeDb

SUBJECTS = {
    "version": "1.0", "video_id": "vid_f", "main_idea": "A coal town emptied by a mine fire.",
    "visual_thread": ["coal town", "mine fire"], "hook_end_cut": 0,
    "subjects": [
        {"id": "s1", "name": "the mine fire", "queries": ["smoke from ground", "burning ground"],
         "youtube": "Centralia mine fire", "first_cut": 0},
        {"id": "s2", "name": "the coal town", "queries": ["anthracite town", "coal town 1890s"],
         "youtube": "Centralia 1890s", "first_cut": 1},
    ],
}


def ctx_for(tmp_path, footage_conf=None, chain=None, planner="deepseek"):
    cfg = json.loads(json.dumps(CFG))
    cfg["planner"] = {"llm": planner}
    cfg["budget"] = {"max_usd_per_video": 1.0}
    cfg["source_policy"] = {"visual": {"chain": chain or [{"source": "youtube"}, {"source": "stock"}]}}
    if footage_conf is not None:
        cfg["source_policy"]["visual"]["footage"] = footage_conf
    db = FakeDb()
    db.asset_usage = lambda *a: None
    return StageContext(video={"id": "vid_f", "channel_id": "CH", "title": "Centralia"},
                        folder=tmp_path, cfg=cfg, db=db, config=None)


def write_video(tmp_path, beats_subjects=("s1", "s2", "s1", "s1")):
    (tmp_path / "subjects.json").write_text(json.dumps(SUBJECTS))
    beats = [{"id": f"b{i}", "script_text": f"line {i}", "visual_intent": f"intent {i}", "subject": s,
              "queries": [f"q{i}"]} for i, s in enumerate(beats_subjects)]
    (tmp_path / "beats.json").write_text(json.dumps({"beats": beats}))
    items = [{"id": f"v{i}", "beat_id": f"b{i}", "start_s": 3.0 * i, "end_s": 3.0 * (i + 1), "asset": {}}
             for i in range(len(beats_subjects))]
    (tmp_path / "edit_plan.json").write_text(json.dumps({"tracks": {"visual": items, "overlays": []}}))
    return items


def color_video(path: Path, colors=("red", "blue", "green"), seconds=4.0):
    """A clip with a hard scene change between each colour."""
    inputs, filters = [], []
    for k, c in enumerate(colors):
        inputs += ["-f", "lavfi", "-i", f"color=c={c}:s=320x180:d={seconds}:r=10"]
        filters.append(f"[{k}:v]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex",
                    "".join(filters) + f"concat=n={len(colors)}:v=1:a=0", "-pix_fmt", "yuv420p", str(path)],
                   check=True)


# ---------------- the filters ----------------


@pytest.mark.parametrize("text, safe", [
    ("Centralia mine fire 1962", True),
    ("Sussex coast aerial", True),          # whole words only
    ("Pueblo ruins skeleton", True),        # dark is not adult
    ("nude beach", False),
    ("fuzilamento de presos", False),       # Portuguese
    ("裸体 照片", False),                    # substring languages
])
def test_the_word_filter_bars_adult_content_and_nothing_merely_dark(text, safe):
    assert adult_filter.safe(text) is safe


@pytest.mark.parametrize("licence, ok", [
    ("Public domain", True), ("CC0", True), ("CC BY 4.0", True), ("CC BY-SA 3.0", True),
    ("https://creativecommons.org/licenses/by/4.0/", True),
    ("CC BY-NC 2.0", False), ("CC BY-ND 4.0", False), ("", False), ("All rights reserved", False),
])
def test_only_licences_a_monetised_channel_may_use(licence, ok):
    assert footage.license_ok(licence) is ok


def test_a_result_must_be_downloadable_footage():
    base = {"title": "Centralia Mine Fire", "channel": "Geographics", "duration": 600}
    assert footage.usable_result(base, 1500)
    assert not footage.usable_result({**base, "duration": 3000}, 1500), "too long to download whole"
    assert not footage.usable_result({**base, "duration": 12}, 1500), "too short to hold footage"
    assert not footage.usable_result({**base, "title": "I spent 24h in Centralia (vlog)"}, 1500)
    assert not footage.usable_result({**base, "channel": "Shutterstock Footage"}, 1500)
    assert not footage.usable_result(
        {**base, "title": "Burning garbage at dump ground releasing toxic smoke | stock", "channel": "Cinefootage"},
        1500), "a stock agency's watermarked preview reel"
    assert footage.usable_result({**base, "title": "Livestock on a Pennsylvania farm"}, 1500)


def test_youtube_searches_name_the_place():
    """The first Centralia run searched YouTube with the stock queries and got
    Old Faithful for 'steam cracks in ground': one video in eleven was of
    Centralia. A search must name the place."""
    anchor = gf.anchor_name({"title": "Centralia: The Town Burning From Below", "subjects": [
        {"name": "Centralia's burning ground"}, {"name": "The 1962 dump fire"}, {"name": "Centralia today"}]})
    assert anchor == "Centralia"
    assert gf.youtube_query({"name": "The 1962 dump fire", "queries": ["town dump"]}, anchor) == "Centralia 1962 dump fire"
    assert gf.youtube_query({"name": "Centralia today"}, anchor) == "Centralia today"
    assert gf.youtube_query({"name": "x", "youtube": "Todd Domboski sinkhole 1981"}, anchor) == \
        "Todd Domboski sinkhole 1981", "the subjects pass's own search wins"
    assert gf.anchor_name({"subjects": [{"name": "Anthracite coal mining"}]}) == "", "one mention is not an anchor"


def test_youtube_is_never_reached_without_a_proxy(monkeypatch):
    monkeypatch.delenv("YTDLP_PROXY", raising=False)
    with pytest.raises(footage.ProxyMissing):
        footage.youtube_search("Centralia")
    monkeypatch.setenv("YTDLP_PROXY", "direct")
    assert footage._proxy_args() == []


# ---------------- choosing ----------------


def test_the_most_seen_subject_comes_first_and_the_hook_counts_double():
    beats = [{"subject": "s2"}, {"subject": "s1"}, {"subject": "s1"}, {"subject": "s2"}]
    # hook_end_cut 0: the first beat (s2) counts double -> s2 3, s1 2
    assert gf.subject_usage(SUBJECTS, beats) == ["s2", "s1"]


def test_video_picks_are_checked_against_each_subjects_own_list():
    results = {"s1": [{"id": "a"}, {"id": "b"}], "s2": [{"id": "c"}]}
    quota = {"s1": 1, "s2": 1}
    assert gf.validate_picks({"picks": {"s1": [1], "s2": []}}, results, quota) == []
    problems = gf.validate_picks({"picks": {"s1": [0, 1], "s2": [3], "s9": [0]}}, results, quota)
    assert any("s1: 2 picked, it may take 1" in p for p in problems)
    assert any("s2: [3] not in its list" in p for p in problems)
    assert any("s9 is not a subject" in p for p in problems)


def test_a_rejected_pick_is_repaired(tmp_path):
    write_video(tmp_path)
    ctx = ctx_for(tmp_path)
    results = {"s1": [{"id": "a", "title": "t", "channel": "c", "duration": 60, "views": 1}]}
    answers = [{"picks": {"s1": [4]}}, {"picks": {"s1": [0]}}]
    users = []

    def chat(provider, model, system, user, max_tokens, temperature):
        users.append(user)
        return LLMResult(text=json.dumps(answers.pop(0)), input_tokens=10, output_tokens=5)

    subjects = {s["id"]: s for s in SUBJECTS["subjects"]}
    assert gf.pick_videos(ctx, subjects, results, {"s1": 1}, chat) == {"s1": [0]}
    assert "[0] t | c | 60s | 1 views" in users[0]
    assert "s1: [4] not in its list" in users[1]


# ---------------- the stage ----------------


@pytest.fixture
def fake_internet(monkeypatch, tmp_path):
    """YouTube, Commons and archive.org, faked at the fetchers."""
    downloads = []
    results = {
        "Centralia mine fire": [
            {"id": "yt1", "title": "Centralia Mine Fire documentary", "channel": "Geo", "duration": 600, "views": 9,
             "url": "https://www.youtube.com/watch?v=yt1"},
            {"id": "yt2", "title": "nude beach day", "channel": "x", "duration": 300, "views": 1,
             "url": "https://www.youtube.com/watch?v=yt2"},
        ],
        "Centralia 1890s": [
            {"id": "yt3", "title": "Anthracite towns 1890s film", "channel": "Archive", "duration": 400, "views": 5,
             "url": "https://www.youtube.com/watch?v=yt3"},
        ],
    }
    monkeypatch.setenv("YTDLP_PROXY", "direct")
    monkeypatch.setattr(footage, "youtube_search", lambda q, n=8: results.get(q, []))

    def download(video_id, dest):
        downloads.append(video_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        color_video(dest)
        return {"id": video_id}

    monkeypatch.setattr(footage, "youtube_download", download)

    def commons(q, n=4, min_width=1000, safety=True):
        return ([{"id": f"commons:{q}", "provider": "commons", "title": f"{q} photo", "url": "https://x/p.jpg",
                  "thumb": "https://x/t.jpg", "width": 2000, "height": 1300, "license": "CC BY 4.0",
                  "author": "A. Photographer", "page": "https://commons/p"}], [])

    monkeypatch.setattr(footage, "commons_photos", commons)
    monkeypatch.setattr(footage, "archive_photos", lambda q, n=3, min_width=1000, safety=True: ([], []))
    return downloads


def test_the_pool_holds_chosen_videos_cut_into_shots_and_photos(tmp_path, fake_internet):
    write_video(tmp_path)
    ctx = ctx_for(tmp_path, {"enabled": True}, planner="mock")
    doc = gf.gather(ctx)
    assert gf.validate_footage(doc) == []
    assert sorted(v["id"] for v in doc["videos"]) == ["yt1", "yt3"]
    assert "yt2" not in fake_internet, "the 18+ title never reaches a download"
    assert any("yt2: 18+ filter" in s for s in doc["skipped"])
    shots = doc["videos"][0]["shots"]
    assert len(shots) == 3, "three colours, two scene changes"
    assert all((tmp_path / s["thumb"]).exists() for s in shots)
    assert {p["subject"] for p in doc["photos"]} == {"s1", "s2"}


def test_the_cap_keeps_the_most_seen_subjects(tmp_path, fake_internet):
    write_video(tmp_path)  # s1 is on screen three times, s2 once
    ctx = ctx_for(tmp_path, {"enabled": True, "max_videos": 1, "photos": False}, planner="mock")
    doc = gf.gather(ctx)
    assert [v["id"] for v in doc["videos"]] == ["yt1"]


def test_no_proxy_costs_the_youtube_footage_not_the_video(tmp_path, fake_internet, monkeypatch):
    write_video(tmp_path)
    def no_proxy(q, n=8):
        raise footage.ProxyMissing("YTDLP_PROXY is not set")

    monkeypatch.setattr(footage, "youtube_search", no_proxy)
    ctx = ctx_for(tmp_path, {"enabled": True}, planner="mock")
    doc = gf.gather(ctx)
    assert doc["videos"] == [] and doc["photos"], "the photos still come"
    assert any("YTDLP_PROXY" in s for s in doc["skipped"])


def test_footage_off_writes_an_empty_pool(tmp_path):
    from lusora_worker.pipeline import steps

    write_video(tmp_path)
    steps.run_gather_footage(ctx_for(tmp_path))
    doc = json.loads((tmp_path / "footage.json").read_text())
    assert doc["videos"] == [] and doc["photos"] == []
    assert gf.validate_footage(doc) == []


def test_footage_needs_the_subjects(tmp_path):
    from lusora_worker.pipeline import steps

    write_video(tmp_path)
    (tmp_path / "subjects.json").unlink()
    with pytest.raises(StageError, match="subjects.json is missing"):
        steps.run_gather_footage(ctx_for(tmp_path, {"enabled": True}))


def test_scene_shots_splits_a_long_take_and_spreads_a_cap(tmp_path):
    src = tmp_path / "long.mp4"
    color_video(src, colors=("red", "blue"), seconds=20.0)   # two 20 s takes
    shots = footage.scene_shots(src, tmp_path / "thumbs", tmp_path, max_n=30)
    assert len(shots) == 6, "each 20 s take offered as three ~6 s pieces"
    assert all(s["dur"] == 5.7 for s in shots)
    capped = footage.scene_shots(src, tmp_path / "thumbs2", tmp_path, max_n=4)
    assert len(capped) == 4 and capped[0]["start"] < 1 and capped[-1]["start"] > 30, "spread, not the first four"


# ---------------- the pool as a chain source ----------------


def pool_for(tmp_path):
    (tmp_path / "footage").mkdir(exist_ok=True)
    color_video(tmp_path / "footage" / "yt_a.mp4", colors=("red", "blue", "green", "white"))
    (tmp_path / "footage" / "thumbs").mkdir(exist_ok=True)
    shots = []
    for n in range(4):
        thumb = tmp_path / "footage" / "thumbs" / f"a_{n}.jpg"
        thumb.write_bytes(b"jpg")
        shots.append({"n": n, "start": 4.0 * n + 0.15, "dur": 3.7, "thumb": f"footage/thumbs/a_{n}.jpg"})
    doc = {"version": "1.0", "video_id": "vid_f", "skipped": [],
           "videos": [{"id": "a", "subject": "s1", "title": "Centralia fire", "channel": "Geo",
                       "url": "https://www.youtube.com/watch?v=a", "file": "footage/yt_a.mp4",
                       "license": "youtube", "shots": shots},
                      {"id": "b", "subject": "s2", "title": "Coal town", "channel": "Old",
                       "url": "https://www.youtube.com/watch?v=b", "file": "footage/yt_a.mp4",
                       "license": "youtube", "shots": shots[:1]}],
           "photos": [{"id": "commons:1", "provider": "commons", "subject": "s1", "title": "Fire 1962",
                       "url": "https://x/p.jpg", "thumb": "https://x/t.jpg", "license": "CC BY 4.0",
                       "author": "A. P.", "page": "https://commons/1"}]}
    (tmp_path / "footage.json").write_text(json.dumps(doc))
    return doc


def test_each_shot_of_a_subject_is_offered_a_different_slice_of_its_footage(tmp_path):
    items = write_video(tmp_path)  # v0, v2, v3 are s1; v1 is s2
    pool_for(tmp_path)
    adapter = sources.FootageAdapter("youtube")
    ctx = ctx_for(tmp_path)
    first = [adapter.candidates(ctx, items[i], [], {}, 2)[0]["id"] for i in (0, 2, 3)]
    assert first == ["a#0", "a#2", "a#0"], "rotated by the shot's place among its subject's shots"
    s2 = adapter.candidates(ctx, items[1], [], {}, 3)
    assert [c["id"] for c in s2] == ["b#0", "a#0", "a#1"], "own subject first, then the others"
    again = adapter.candidates(ctx, items[0], [], {}, 2, exclude={"a#0", "a#1"})
    assert [c["id"] for c in again] == ["a#2", "a#3"], "a second round sees what the first did not"


def test_a_picked_youtube_shot_is_cut_from_its_source(tmp_path):
    items = write_video(tmp_path)
    pool_for(tmp_path)
    (tmp_path / "clips").mkdir()
    ctx = ctx_for(tmp_path)
    ctx.db.provider_health = lambda *a, **k: None
    found = sources.FootageAdapter("youtube").fetch(ctx, items[0], {"id": "a#1", "logo": ""}, {})
    assert found["source"] == "youtube" and found["license"] == "youtube" and found["media_type"] == "video"
    clip = tmp_path / found["path"]
    assert 2.9 < footage.probe_seconds(clip) < 3.7, "the slot (3 s) plus a margin, never past the shot"
    mean = subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-vf", "scale=1:1", "-frames:v", "1",
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    assert mean[2] > 150 and mean[0] < 80, "shot 1 is the blue scene"


def test_the_judge_sees_footage_and_stock_side_by_side(tmp_path, monkeypatch):
    items = write_video(tmp_path)
    pool_for(tmp_path)

    class Stock:
        query_kind = "keyword"

        def candidates(self, ctx, item, queries, source_cfg, limit):
            return [{"source": "stock", "provider": "pexels", "id": f"p{k}", "query": "q", "thumb": "https://t"}
                    for k in range(limit)]

    monkeypatch.setitem(sources.ADAPTERS, "stock", Stock())
    ctx = ctx_for(tmp_path, chain=[{"source": "youtube"}, {"source": "archive"}, {"source": "stock"}])
    dealt = pick_shots.gather(ctx, [(items[0], ["q"])], ctx.cfg["source_policy"]["visual"]["chain"], 6)
    assert [c["id"] for c in dealt["v0"]] == ["a#0", "commons:1", "p0", "a#1", "p1", "a#2"]


def test_credits_name_every_placed_source_once(tmp_path):
    pool = pool_for(tmp_path)
    plan = {"tracks": {"visual": [
        {"asset": {"source": "youtube", "id": "a#0"}}, {"asset": {"source": "youtube", "id": "a#3"}},
        {"asset": {"source": "archive", "id": "commons:1"}},
        {"asset": {"source": "stock", "provider": "pexels", "id": "77", "license": "royalty-free"}},
    ]}}
    text = gf.credits(ctx_for(tmp_path), pool, plan)
    assert text.count("Centralia fire — Geo — YouTube") == 1
    assert "Fire 1962 — A. P. — CC BY 4.0 — https://commons/1" in text
    assert "pexels #77" in text


def test_every_source_an_adapter_places_is_a_value_the_database_accepts():
    """asset_usage.source is a Postgres enum, and the fake database the unit
    tests use accepts anything — which is how the first real v1.3 run died in
    resolve_assets on its first YouTube shot. The enum is the union of every
    migration's CREATE TYPE and ADD VALUE."""
    import re

    import lusora_contracts

    sql = "\n".join(p.read_text(encoding="utf-8")
                    for p in sorted((lusora_contracts.CONTRACTS_ROOT / "db").glob("*.sql")))
    created = re.search(r"CREATE TYPE asset_source AS ENUM \(([^)]*)\)", sql).group(1)
    values = set(re.findall(r"'([a-z_]+)'", created))
    values |= set(re.findall(r"ALTER TYPE asset_source ADD VALUE IF NOT EXISTS '([a-z_]+)'", sql))
    placed = {"library", "stock", "ai", *(k for k in sources.ADAPTERS if k in ("youtube", "archive"))}
    assert placed <= values, f"missing from asset_source: {sorted(placed - values)}"


def test_the_library_copy_is_best_effort(tmp_path):
    pool = pool_for(tmp_path)
    ctx = ctx_for(tmp_path)
    assert gf.keep_in_library(ctx, pool, {"a"}) == "no library to hand footage to"
