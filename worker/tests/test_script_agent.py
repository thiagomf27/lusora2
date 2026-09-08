"""Script agent: prompt pack composition and narration length (D42, D45)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lusora_worker.agents import script as script_agent
from lusora_worker.errors import StageError
from lusora_worker.context import StageContext
from lusora_worker.providers.llm import LLMResult

from test_agents import FakeDb

CFG = {
    "language": "pt-BR",
    "script": {"llm": "deepseek"},
    "budget": {"max_usd_per_video": 0.8},
    "content_rules": "No speculation.",
    "style_pack_doc": {
        "name": "t",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 8.0},
        "overlays": {"density": "normal"},
        "transitions": {"allowed": ["cut"], "default": "cut"},
        "script_persona": "Grave, precise narrator.",
    },
}


def make_ctx(tmp_path, cfg=None):
    return StageContext(
        video={"id": "vid_s", "channel_id": "CH", "title": "The Harbour That Emptied"},
        folder=tmp_path,
        cfg=cfg or json.loads(json.dumps(CFG)),
        db=FakeDb(),
        config=None,
    )


def reply(text: str) -> LLMResult:
    return LLMResult(text=text, input_tokens=100, output_tokens=200)


_SENTENCES = (
    "Em janeiro de 1820 o oficial britanico Edward Bransfield avistou a peninsula. "
    "A tripulacao registou a data no diario de bordo e seguiu para sul. "
    "Ninguem a bordo sabia que estava a ver um continente. "
)


def narration_for(user: str) -> str:
    """A reply the length the prompt actually asked for.

    These tests assert what reaches the MODEL, not what comes back, so the fake
    only has to behave like a model that read its instructions — which since
    slice 3 includes the length. A fixed placeholder word would now be rejected
    by validate_script, and the rejection would be about the fixture."""
    import re

    match = re.search(r"roughly (\d+) words", user)
    target = int(match.group(1)) if match else 225
    words = _SENTENCES.split()
    return " ".join((words * (target // len(words) + 2))[:target])


def capture(tmp_path, cfg=None) -> dict:
    ctx = make_ctx(tmp_path, cfg)
    seen: dict = {}

    def chat_fn(provider, model, system, user, max_tokens, temperature=None, expect_json=True):
        seen.update(system=system, user=user, model=model, max_tokens=max_tokens)
        return reply(narration_for(user))

    out = script_agent.generate_script(ctx, chat_fn=chat_fn)
    seen["out"] = out
    return seen


# ---------- D45: length is style pack data ----------


def test_target_length_falls_back_to_the_default_when_nothing_says_otherwise():
    assert script_agent.target_seconds({}) == script_agent.DEFAULT_TARGET_SECONDS


def test_style_pack_sets_the_length():
    cfg = {"style_pack_doc": {"script": {"target_seconds": 600}}}
    assert script_agent.target_seconds(cfg) == 600


def test_channel_or_video_override_beats_the_style_pack():
    """Both ride on script.target_seconds in the merged snapshot, so one check
    covers the channel field and the per-video override."""
    cfg = {"script": {"target_seconds": 45}, "style_pack_doc": {"script": {"target_seconds": 600}}}
    assert script_agent.target_seconds(cfg) == 45


def test_length_reaches_the_prompt_as_seconds_and_words(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["style_pack_doc"]["script"] = {"target_seconds": 600}
    seen = capture(tmp_path, cfg)
    assert "about 600 seconds" in seen["user"]
    assert f"roughly {round(600 * script_agent.WORDS_PER_SECOND)} words" in seen["user"]


# ---------- D42/D43: composition ----------


def test_persona_language_and_rules_reach_the_model(tmp_path):
    seen = capture(tmp_path)
    assert "Grave, precise narrator." in seen["system"]
    # the welded half carries the output contract and the language
    assert "Output ONLY the narration text" in seen["system"]
    assert "Write the ENTIRE script in pt-BR." in seen["system"]
    assert "The Harbour That Emptied" in seen["user"]
    assert "No speculation." in seen["user"]


def test_optional_blocks_disappear_with_their_labels(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["content_rules"] = ""
    del cfg["style_pack_doc"]["script_persona"]
    seen = capture(tmp_path, cfg)
    assert "Channel content rules" not in seen["user"]
    assert "Persona" not in seen["system"]


def test_snapshotted_prompt_replaces_the_editable_half_only(tmp_path):
    cfg = json.loads(json.dumps(CFG))
    cfg["prompts"] = {
        "script": {
            "name": "house",
            "source": "video",
            "system": "HOUSE VOICE: {{persona}}",
            "user": "Write about {{title}}.",
            "max_tokens": 20000,
        }
    }
    seen = capture(tmp_path, cfg)
    assert seen["system"].startswith("HOUSE VOICE: Grave, precise narrator.")
    assert "Output ONLY the narration text" in seen["system"]  # welded, still there
    assert seen["user"] == "Write about The Harbour That Emptied."
    assert seen["max_tokens"] == 20000


# ---------------- the output contract, checked (slice 3) ----------------


def test_a_clean_script_is_returned_untouched(tmp_path):
    """The guard must be invisible when the model behaves, or it is just a tax
    on every video."""
    seen = capture(tmp_path)
    assert seen["out"].startswith("Em janeiro de 1820")


def test_markdown_in_the_narration_is_sent_back_once_and_repaired(tmp_path):
    """The seam this closes is not hypothetical: three shipped videos in
    data/videos carry `*Alcedo*` in script.txt, so the TTS read the asterisks
    aloud and the planner quoted them as verbatim span text. The welded half of
    the prompt has always forbidden markdown; nothing checked that the model
    listened."""
    ctx = make_ctx(tmp_path)
    calls = []

    def chat_fn(provider, model, system, user, max_tokens, temperature=None, expect_json=True):
        calls.append(user)
        body = narration_for(user)
        return reply(body.replace("peninsula", "*peninsula*") if len(calls) == 1 else body)

    out = script_agent.generate_script(ctx, chat_fn=chat_fn)
    assert len(calls) == 2, "one repair, not three"
    assert "REJECTED" in calls[1] and "markdown italics" in calls[1]
    assert "*" not in out


def test_a_script_that_stays_dirty_stops_the_stage_with_the_reason(tmp_path):
    """A model that ignores the correction twice is a prompt problem, and the
    stage is `receivable_on_upload` — so it stops with something a human can
    act on rather than sending asterisks to the TTS."""
    ctx = make_ctx(tmp_path)

    def chat_fn(provider, model, system, user, max_tokens, temperature=None, expect_json=True):
        return reply("Narrator: " + narration_for(user))

    with pytest.raises(StageError, match="speaker label"):
        script_agent.generate_script(ctx, chat_fn=chat_fn)


def test_the_repair_call_is_billed_like_the_first_one(tmp_path):
    """A second call is a second cost event. It goes through the same budget
    gate, so a video that repairs cannot quietly exceed its budget."""
    ctx = make_ctx(tmp_path)
    calls = []

    def chat_fn(provider, model, system, user, max_tokens, temperature=None, expect_json=True):
        calls.append(user)
        body = narration_for(user)
        return reply("# Heading\n" + body if len(calls) == 1 else body)

    script_agent.generate_script(ctx, chat_fn=chat_fn)
    events = [e for e in ctx.db.cost_events
              if e["operation"] == "llm.generate_script" and e.get("status") == "completed"]
    assert len(events) == 2, events
    assert any((e.get("details") or {}).get("repair") == 1 for e in events)


def test_every_script_this_repo_has_shipped_would_be_judged_the_same_way():
    """A false violation costs a repair call, and one that survives the repair
    stops a video that was fine — so the rules are checked against real
    narration, not only against synthetic dirt. Of 22 scripts on disk, the only
    ones that fail are the three that genuinely carry markdown."""
    from lusora_worker.validators import validate_script

    root = Path(__file__).resolve().parents[2]
    scripts = sorted(root.glob("evals/overlays/*/script.txt"))
    assert scripts, "the eval scripts are the corpus this is checked against"
    for path in scripts:
        assert validate_script(path.read_text(encoding="utf-8")) == [], path.name
