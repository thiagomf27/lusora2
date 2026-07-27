"""Beat planner agent: validate→repair loop and the budget gate."""

import json

import pytest

from lusora_worker.agents import planner
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers.llm import LLMResult

SCRIPT = "The port fed the capital. Nearly 70% of all grain passed through it."

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
