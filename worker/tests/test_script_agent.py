"""Script agent: prompt pack composition and narration length (D42, D45)."""

from __future__ import annotations

import json

from lusora_worker.agents import script as script_agent
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


def capture(tmp_path, cfg=None) -> dict:
    ctx = make_ctx(tmp_path, cfg)
    seen: dict = {}

    def chat_fn(provider, model, system, user, max_tokens):
        seen.update(system=system, user=user, model=model, max_tokens=max_tokens)
        return reply("Narração.")

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
