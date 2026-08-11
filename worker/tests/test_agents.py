"""Beat planner agent: validate→repair loop and the budget gate."""

import json
import re

import pytest

from lusora_worker import validators
from lusora_worker.agents import planner
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers.llm import LLMResult
from lusora_worker.textsplit import normalize, split_sentences

SCRIPT = "The port fed the capital. Nearly 70% of all grain passed through it."

# 6 short sentences, ~5 words each, split after sentence 3 (word-balanced,
# sentence-aligned) when chunked into 2. Chunking tests set
# planner.chunk_target_beats to 1 so a fixture this small still triggers
# multiple chunks without needing a realistically long script — and so each
# chunk's pacing-range check (validators.py) tolerates the fake's 1 beat.
SCRIPT_LONG = (
    "Sentence one about ships. Sentence two about ports. Sentence three about grain. "
    "Sentence four about workers. Sentence five about cranes. Sentence six about trade."
)


def _chunk_text_from_prompt(user: str) -> str:
    match = re.search(r"SCRIPT \(\d+s of narration\):\n(.*?)\n\n", user, re.DOTALL)
    assert match, f"could not find SCRIPT section in prompt: {user!r}"
    return match.group(1)

CFG = {
    "language": "en-US",
    "planner": {"llm": "deepseek"},
    "budget": {"max_usd_per_video": 0.8},
    "style_pack_doc": {
        "name": "t",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 8.0},
        "overlays": {"density": "normal"},
        "transitions": {"allowed": ["cut"], "default": "cut"},
    },
}


class FakeDb:
    def __init__(self):
        self.cost_events = []
        self.events = []

    def cost_event(self, **kw):
        self.cost_events.append(kw)

    def spent_and_reserved(self, video_id):
        return sum(e["usd"] for e in self.cost_events if e["status"] in ("completed", "reserved"))

    def release_reservation(self, video_id, provider, operation):
        for e in self.cost_events:
            if e["status"] == "reserved" and e["provider"] == provider:
                e["status"] = "refunded"

    def event(self, video_id, stage, status, message=None):
        self.events.append((stage, status, message))

    def provider_health(self, provider, ok, error=None):
        pass


def make_ctx(tmp_path, cfg=None):
    return StageContext(
        video={"id": "vid_t", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg=cfg or json.loads(json.dumps(CFG)),
        db=FakeDb(),
        config=None,
    )


def chunking_ctx(tmp_path, *, spine=False, target_beats=1):
    """A cfg that chunks a 6-sentence fixture, with the spine pass off unless a
    test is exercising it — the deterministic word-balanced split is the
    fallback path and stays the one most tests measure."""
    cfg = json.loads(json.dumps(CFG))
    cfg["planner"]["chunk_target_beats"] = target_beats
    cfg["planner"]["spine"] = {"enabled": spine}
    return make_ctx(tmp_path, cfg)


def good_beats():
    return {
        "version": "1.0",
        "video_id": "vid_t",
        "beats": [
            {"id": "b1", "kind": "narration", "script_text": "The port fed the capital.",
             "visual_intent": "aerial harbor 1940s, cranes, grain ships"},
            {"id": "b2", "kind": "narration",
             "script_text": "Nearly 70% of all grain passed through it.",
             "visual_intent": "dock workers unloading sacks, archival",
             "anchors": [{"type": "percentage", "value": 70, "label": "of grain",
                          "source_words": "Nearly 70%"}],
             "overlay": {"component": "AnimatedCounter", "anchor_ref": 0}},
        ],
    }


def reply(doc):
    return LLMResult(text=json.dumps(doc), input_tokens=1000, output_tokens=500)


def test_accepts_valid_first_attempt(tmp_path):
    ctx = make_ctx(tmp_path)
    doc = planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=lambda *a: reply(good_beats()))
    assert len(doc["beats"]) == 2
    completed = [e for e in ctx.db.cost_events if e["status"] == "completed"]
    assert len(completed) == 1
    assert completed[0]["units"] == 1500  # actual tokens recorded


def test_repair_loop_feeds_violations_back(tmp_path):
    ctx = make_ctx(tmp_path)
    bad = good_beats()
    bad["beats"][1]["overlay"]["component"] = "GlitterBomb"
    calls = []

    def chat_fn(provider, model, system, user, max_tokens):
        calls.append(user)
        return reply(bad if len(calls) == 1 else good_beats())

    doc = planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert len(calls) == 2
    assert "GlitterBomb" in calls[1]           # ALL violations fed back
    assert "REJECTED" in calls[1]
    assert doc["beats"][1]["overlay"]["component"] == "AnimatedCounter"


def test_gives_up_after_max_attempts(tmp_path):
    ctx = make_ctx(tmp_path)
    bad = good_beats()
    bad["beats"][0]["script_text"] = "Never in the script."
    with pytest.raises(StageError, match="3 attempts"):
        planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=lambda *a: reply(bad))
    assert len([e for e in ctx.db.cost_events if e["status"] == "completed"]) == 3


def test_budget_gate_blocks_before_spending(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["budget"]["max_usd_per_video"] = 0.0000001
    ctx = make_ctx(tmp_path, cfg)
    called = []

    def chat_fn(*a):
        called.append(1)
        return reply(good_beats())

    with pytest.raises(StageError, match="exceed budget"):
        planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert called == []  # the operation never ran: gate is pre-spend
    assert any(e["status"] == "estimated" for e in ctx.db.cost_events)
    assert not any(e["status"] == "completed" for e in ctx.db.cost_events)


def test_unknown_provider_price_is_hard_error(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["planner"]["llm"] = "grok"
    ctx = make_ctx(tmp_path, cfg)
    with pytest.raises(StageError, match="no price"):
        planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=lambda *a: reply(good_beats()))


# ---------- prompt packs in the agents (D42-D45) ----------


def test_planner_uses_the_snapshotted_prompt_and_still_welds_the_contract(tmp_path):
    """The editable half comes from cfg.prompts; the HARD RULES and the JSON
    shape are composed from the CURRENT contracts, never from the snapshot —
    they encode what validate_beat_sheet is about to enforce."""
    cfg = json.loads(json.dumps(CFG))
    cfg["prompts"] = {
        "planner": {
            "name": "house",
            "source": "channel",
            "system": "HOUSE VOICE: terse.",
            "user": "SCRIPT:\n{{script}}",
        }
    }
    ctx = make_ctx(tmp_path, cfg)
    seen = {}

    def chat_fn(provider, model, system, user, max_tokens):
        seen["system"], seen["user"] = system, user
        return reply(good_beats())

    planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert seen["system"].startswith("HOUSE VOICE: terse.")
    assert "HARD RULES" in seen["system"]
    assert "COMPONENT MENU" in seen["system"]
    assert SCRIPT in seen["user"]
    assert "Respond with the JSON object only." in seen["user"]


def test_repair_prompt_does_not_accumulate_across_attempts(tmp_path):
    """Attempt 3 must carry attempt 2's violations only: appending to the
    previous user message would re-send already-fixed complaints and grow the
    bill every round."""
    ctx = make_ctx(tmp_path)
    bad = good_beats()
    bad["beats"][0]["script_text"] = "Never in the script."
    users = []

    def chat_fn(provider, model, system, user, max_tokens):
        users.append(user)
        return reply(bad)

    with pytest.raises(StageError):
        planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)

    assert len(users) == 3
    rejected = "YOUR PREVIOUS ATTEMPT WAS REJECTED"
    assert users[0].count(rejected) == 0
    assert users[1].count(rejected) == 1
    assert users[2].count(rejected) == 1  # not 2
    assert len(users[2]) <= len(users[1]) + 200


def test_planner_prompt_max_tokens_overrides_the_default(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["prompts"] = {
        "planner": {"name": "big", "source": "channel", "system": "x", "user": "{{script}}",
                    "max_tokens": 24000, "model_hint": "deepseek-v4-pro"}
    }
    ctx = make_ctx(tmp_path, cfg)
    seen = {}

    def chat_fn(provider, model, system, user, max_tokens):
        seen["max_tokens"], seen["model"] = max_tokens, model
        return reply(good_beats())

    planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert seen["max_tokens"] == 24000
    assert seen["model"] == "deepseek-v4-pro"  # channel config still wins when set


# ---------- chunking for long scripts ----------


def test_chunk_script_no_op_below_threshold():
    assert planner._chunk_script(SCRIPT, 1) == [SCRIPT]
    # more chunks requested than sentences available: still a no-op
    assert planner._chunk_script(SCRIPT, 5) == [SCRIPT]


def test_chunk_script_splits_into_balanced_sentence_aligned_slices():
    chunks = planner._chunk_script(SCRIPT_LONG, 2)
    assert len(chunks) == 2
    # sentence-aligned, no overlap/gaps: rejoining reproduces the script
    assert normalize(" ".join(chunks)) == normalize(SCRIPT_LONG)
    # roughly balanced (3 sentences each, given the fixture)
    assert chunks[0].count(".") == 3
    assert chunks[1].count(".") == 3


def _long_chat_fn(calls, fail_on_position=None):
    def chat_fn(provider, model, system, user, max_tokens):
        calls.append((system, user))
        if fail_on_position and fail_on_position in user:
            bad_doc = {"version": "1.0", "video_id": "vid_t",
                       "beats": [{"id": "b1", "kind": "narration",
                                  "script_text": "not in the script at all",
                                  "visual_intent": "x"}]}
            return reply(bad_doc)
        chunk_text = _chunk_text_from_prompt(user)
        idx = len(calls) - 1
        doc = {"version": "1.0", "video_id": "vid_t",
               "beats": [{"id": "b1", "kind": "narration", "script_text": chunk_text,
                          "visual_intent": f"visual for chunk {idx}", "mood": "neutral"}]}
        return reply(doc)
    return chat_fn


def test_long_script_is_planned_in_chunks_with_full_context(tmp_path):
    ctx = chunking_ctx(tmp_path)
    calls: list[str] = []
    doc = planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_long_chat_fn(calls))

    assert len(calls) == 2  # one call per chunk
    assert "This call covers part 1 of 2" in calls[0][1]
    assert "This call covers part 2 of 2" in calls[1][1]
    # each call sees the FULL script for context...
    assert "FULL SCRIPT" in calls[0][1] and SCRIPT_LONG in calls[0][1]
    # ...but is scoped to its own section, not the whole script (welded HARD RULE 1)
    assert "YOUR SECTION only" in calls[0][0]

    # ids renumbered sequentially across the merge, no collisions
    assert [b["id"] for b in doc["beats"]] == ["b1", "b2"]
    # merged doc covers the whole script (final validation passed)
    covered = normalize(" ".join(b["script_text"] for b in doc["beats"]))
    assert covered == normalize(SCRIPT_LONG)


def test_carry_forward_passes_previous_chunk_into_the_next(tmp_path):
    ctx = chunking_ctx(tmp_path)
    calls: list[str] = []
    planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_long_chat_fn(calls))

    assert "PREVIOUS BEATS" not in calls[0][1]  # nothing to carry into chunk 1
    assert "PREVIOUS BEATS" in calls[1][1]
    assert "visual for chunk 0" in calls[1][1]  # chunk 1's own beat, carried forward


def test_chunk_failure_names_the_section(tmp_path):
    ctx = chunking_ctx(tmp_path)
    calls: list[str] = []
    chat_fn = _long_chat_fn(calls, fail_on_position="part 2 of 2")
    with pytest.raises(StageError, match=r"section 2/2"):
        planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=chat_fn)
    # chunk 1 succeeded (1 call); chunk 2 exhausted all 3 repair attempts
    assert len(calls) == 1 + 3


def test_chunks_get_a_slack_free_share_of_the_overlay_budget(tmp_path):
    """Regression: validate_beat_sheet grants the density budget a +1 slack.
    Handing each chunk its own share re-granted that slack per chunk, so every
    chunk passed while their sum overshot the video's real ceiling (observed
    live: 14 overlays against a 13-overlay budget). Chunks are now told a
    floor'd, slack-free share, and only the merged sheet is density-checked."""
    ctx = chunking_ctx(tmp_path)
    calls: list[tuple[str, str]] = []
    planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_long_chat_fn(calls))

    hints = [
        int(re.search(r"Use AT MOST (\d+) overlays", user).group(1))
        for _system, user in calls
    ]
    assert len(hints) == 2
    style = CFG["style_pack_doc"]
    whole_video_ceiling = validators.max_overlays_for(style, 8.0)
    # the sum of the per-chunk hints must not exceed what the merge allows
    assert sum(hints) <= whole_video_ceiling


def test_chunk_validation_defers_whole_video_checks(tmp_path):
    """A chunk stuffed with overlays is NOT rejected per chunk (density is a
    whole-video property), but the merged sheet is — one budget, judged once."""
    ctx = chunking_ctx(tmp_path)

    def overlay_heavy(provider, model, system, user, max_tokens):
        chunk_text = _chunk_text_from_prompt(user)
        beats = []
        for i, sentence in enumerate(split_sentences(chunk_text)):
            beats.append({
                "id": f"b{i + 1}", "kind": "narration", "script_text": sentence,
                "visual_intent": "archival street scene, desaturated", "mood": "neutral",
                "anchors": [{"type": "name", "label": "who", "source_words": sentence.split()[0]}],
                "overlay": {"component": "NamePlate", "anchor_ref": 0},
            })
        return reply({"version": "1.0", "video_id": "vid_t", "beats": beats})

    with pytest.raises(StageError, match="merged beat sheet failed final validation"):
        planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=overlay_heavy)


def test_short_script_stays_a_single_unchunked_call(tmp_path):
    """Below planner.chunk_target_beats, behavior is byte-identical to the
    pre-chunking prompt: no section/full-script/carry-forward scaffolding."""
    ctx = make_ctx(tmp_path)
    seen = {}

    def chat_fn(provider, model, system, user, max_tokens):
        seen["user"] = user
        return reply(good_beats())

    planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert "This call covers part" not in seen["user"]
    assert "FULL SCRIPT" not in seen["user"]
    assert "PREVIOUS BEATS" not in seen["user"]
    assert "cover the ENTIRE script" in (
        planner._build_prompt(make_ctx(tmp_path), SCRIPT, 8.0)[0]
    )


# ---------------- the spine pass (D52) ----------------


def _spine_chat_fn(calls, spine_doc):
    """First call is the spine, every call after it plans one section."""
    def chat_fn(provider, model, system, user, max_tokens):
        calls.append((system, user))
        if len(calls) == 1:
            return reply(spine_doc) if isinstance(spine_doc, dict) else LLMResult(
                text=spine_doc, input_tokens=200, output_tokens=80
            )
        chunk_text = _chunk_text_from_prompt(user)
        return reply({"version": "1.0", "video_id": "vid_t",
                      "beats": [{"id": "b1", "kind": "narration", "script_text": chunk_text,
                                 "visual_intent": f"visual for section {len(calls) - 1}",
                                 "mood": "neutral"}]})
    return chat_fn


GOOD_SPINE = {
    "arc": "a port at work, then the war reaches it",
    "sections": [
        {"start_sentence": 0, "summary": "the port at work before the war"},
        {"start_sentence": 4, "summary": "the war reaches the docks"},
    ],
}


def test_spine_cuts_the_sections_and_reaches_every_section_prompt(tmp_path):
    ctx = chunking_ctx(tmp_path, spine=True)
    calls: list[tuple[str, str]] = []
    doc = planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_spine_chat_fn(calls, GOOD_SPINE))

    assert len(calls) == 3, "one spine call, then one per section"
    # the spine saw numbered sentences, not raw prose — its answer is indices
    assert "0. Sentence one about ships." in calls[0][1]
    # the cut landed where the spine asked (sentence 4), not at the word-balanced
    # midpoint (sentence 3) the deterministic split would have chosen
    assert doc["beats"][0]["script_text"].endswith("Sentence four about workers.")
    # every planning call sees the whole spine with its own section marked
    for i, (_system, user) in enumerate(calls[1:]):
        assert "a port at work, then the war reaches it" in user
        assert "the war reaches the docks" in user
        assert f"{i + 1}. " in user
    assert "<- YOUR SECTION" in calls[1][1]


def test_visual_ledger_is_threaded_between_sections(tmp_path):
    ctx = chunking_ctx(tmp_path, spine=True)
    calls: list[tuple[str, str]] = []
    planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_spine_chat_fn(calls, GOOD_SPINE))

    assert "ALREADY ON SCREEN" not in calls[1][1], "nothing spent yet in section 1"
    assert "visual for section 1" in calls[2][1], "section 2 sees what section 1 shot"


def test_a_spine_that_is_not_a_partition_degrades_to_the_word_split(tmp_path):
    """The spine is an improvement on a split that already works, so every
    failure mode falls back rather than failing the video."""
    for label, bad in [
        ("does not start at 0", {"sections": [{"start_sentence": 2, "summary": "x"}]}),
        ("not increasing", {"sections": [{"start_sentence": 0}, {"start_sentence": 0}]}),
        ("out of range", {"sections": [{"start_sentence": 0}, {"start_sentence": 99}]}),
        ("empty", {"sections": []}),
        ("unparseable", "sorry, I can't do that"),
        ("wrong shape", {"sections": [{"summary": "no index at all"}]}),
    ]:
        ctx = chunking_ctx(tmp_path, spine=True)
        calls: list[tuple[str, str]] = []
        doc = planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_spine_chat_fn(calls, bad))
        covered = normalize(" ".join(b["script_text"] for b in doc["beats"]))
        assert covered == normalize(SCRIPT_LONG), label
        assert len(doc["beats"]) == 2, label
        assert any("word count" in (m or "") for _s, _st, m in ctx.db.events), label


def test_spine_is_skipped_when_the_channel_turns_it_off(tmp_path):
    ctx = chunking_ctx(tmp_path, spine=False)
    calls: list[tuple[str, str]] = []
    planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_long_chat_fn(calls))
    assert len(calls) == 2, "two sections, no spine call"


def test_a_short_video_never_pays_for_a_spine(tmp_path):
    ctx = make_ctx(tmp_path)
    calls: list[tuple[str, str]] = []

    def chat_fn(provider, model, system, user, max_tokens):
        calls.append((system, user))
        return reply(good_beats())

    planner.plan_beats(ctx, SCRIPT, 8.0, chat_fn=chat_fn)
    assert len(calls) == 1
    assert not [e for e in ctx.db.cost_events if e["operation"] == "llm.plan_spine"]


def test_the_spine_call_is_billed_like_any_other(tmp_path):
    ctx = chunking_ctx(tmp_path, spine=True)
    planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_spine_chat_fn([], GOOD_SPINE))
    spine_events = [e for e in ctx.db.cost_events if e["operation"] == "llm.plan_spine"]
    assert [e["status"] for e in spine_events][0] == "estimated"
    completed = [e for e in spine_events if e["status"] == "completed"]
    assert len(completed) == 1 and completed[0]["units"] > 0


def test_an_oversized_spine_section_is_split_by_code(tmp_path):
    """The spine says where the story turns; it does not get to hand one call a
    section twice the size a call can plan."""
    ctx = chunking_ctx(tmp_path, spine=True)
    calls: list[tuple[str, str]] = []
    lopsided = {"arc": "", "sections": [
        {"start_sentence": 0, "summary": "almost everything"},
        {"start_sentence": 5, "summary": "the last sentence"},
    ]}
    doc = planner.plan_beats(ctx, SCRIPT_LONG, 8.0, chat_fn=_spine_chat_fn(calls, lopsided))
    assert len(calls) > 3, "the 5-sentence section was divided further"
    assert normalize(" ".join(b["script_text"] for b in doc["beats"])) == normalize(SCRIPT_LONG)


def test_a_script_that_fails_as_one_call_succeeds_chunked(tmp_path):
    """The reason chunking exists: at doc length one call drops a sentence
    somewhere in the middle and full coverage fails for the WHOLE sheet, three
    times over. The same model, asked for one section at a time, covers each."""
    def drops_a_sentence(provider, model, system, user, max_tokens):
        chunk_text = _chunk_text_from_prompt(user)
        sentences = split_sentences(chunk_text)
        if len(sentences) > 3:
            sentences = sentences[:2] + sentences[3:]  # the classic long-call miss
        return reply({"version": "1.0", "video_id": "vid_t",
                      "beats": [{"id": f"b{i + 1}", "kind": "narration", "script_text": s,
                                 "visual_intent": f"shot {i}", "mood": "neutral"}
                                for i, s in enumerate(sentences)]})

    with pytest.raises(StageError, match="beat planner failed after 3 attempts"):
        planner.plan_beats(make_ctx(tmp_path), SCRIPT_LONG, 24.0, chat_fn=drops_a_sentence)

    doc = planner.plan_beats(
        chunking_ctx(tmp_path, target_beats=3), SCRIPT_LONG, 24.0, chat_fn=drops_a_sentence
    )
    assert normalize(" ".join(b["script_text"] for b in doc["beats"])) == normalize(SCRIPT_LONG)


def test_the_planner_can_open_cold_and_close_on_a_card(tmp_path):
    """D58: `kind: timed` is reachable now that the prompt explains it. A sheet
    with a cold open and an outro must survive validation AND compile — the
    envelope collision that used to make it impossible is gone."""
    from lusora_worker.compiler import compile_plan

    ctx = make_ctx(tmp_path)
    sheet = {
        "version": "1.1", "video_id": "vid_t",
        "beats": [
            {"id": "b1", "kind": "timed", "timing": {"start_s": 0, "end_s": 4.5},
             "visual_intent": "slow push-in on a bombed cathedral at dawn, mist",
             "queries": ["ruined cathedral dawn"], "mood": "somber",
             "overlay": {"component": "KineticTitle", "props_hint": {"text": "February 1945"}}},
            {"id": "b2", "kind": "narration", "script_text": "The port fed the capital.",
             "visual_intent": "aerial harbour, 1940s", "mood": "somber"},
            {"id": "b3", "kind": "narration",
             "script_text": "Nearly 70% of all grain passed through it.",
             "visual_intent": "dock workers unloading sacks", "mood": "somber"},
            {"id": "b4", "kind": "timed", "timing": {"start_s": 900, "end_s": 905},
             "visual_intent": "the same cathedral, rebuilt, present day",
             "queries": ["cathedral restored exterior"], "mood": "reflective"},
        ],
    }
    assert validators.validate_beat_sheet(sheet, SCRIPT, ctx.cfg, 8.0) == []

    st = [{"text": "The port fed the capital.", "start_s": 0.0, "end_s": 4.0},
          {"text": "Nearly 70% of all grain passed through it.", "start_s": 4.0, "end_s": 8.0}]
    plan = compile_plan(sheet, st, {**ctx.cfg, "captions": {"enabled": True},
                                    "theme_doc": {}, "output": {"fps": 30}}, 8.0)
    spans = [(v["beat_id"], v["start_s"], v["end_s"]) for v in plan["tracks"]["visual"]]
    assert spans[0] == ("b1", 0.0, 4.5), "the cold open holds before the first word"
    assert plan["tracks"]["audio"]["voiceover"]["start_s"] == 4.5
    assert spans[-1][0] == "b4" and spans[-1][2] - spans[-1][1] == 5.0


def test_emphasis_overlays_are_invisible_until_a_pack_enables_them(tmp_path):
    """D59's whole promise: with the class off, the composed prompt is
    byte-identical to what it was before the class existed."""
    off = make_ctx(tmp_path)
    baseline = planner._build_prompt(off, SCRIPT, 60.0)
    assert "emphasis" not in baseline[1]

    cfg = json.loads(json.dumps(CFG))
    cfg["style_pack_doc"]["overlays"]["emphasis"] = {"enabled": True, "per_minute": 1.5}
    on = planner._build_prompt(make_ctx(tmp_path, cfg), SCRIPT, 60.0)
    assert on[0] == baseline[0], "the system half is untouched either way"
    assert '"emphasis": true' in on[1]
    assert "1.5 per minute" in on[1], "the budget is a number from the pack, not prose"
