"""Prompt packs on the worker side (D42–D44).

The renderer exists twice — here and in platform/src/lib/prompts.ts — because
both the worker and the platform compose prompts. The first block mirrors
platform/test/prompts.test.ts case for case: if these two drift, the composed
preview on the Prompts screen stops telling the truth about what the model
will receive.
"""

from __future__ import annotations

import pytest

from lusora_contracts import prompts as P


# ---------- renderer contract (mirrored in platform/test/prompts.test.ts) ----------


def test_render_substitutes_and_drops_unknown():
    assert P.render("Hello {{name}}!", {"name": "world"}) == "Hello world!"
    assert P.render("Hello {{missing}}!", {}) == "Hello !"


def test_optional_block_takes_its_label_with_it():
    template = "{{#rules}}RULES: {{rules}}\n{{/rules}}end"
    assert P.render(template, {"rules": "be brief"}) == "RULES: be brief\nend"
    assert P.render(template, {"rules": ""}) == "end"
    assert P.render(template, {}) == "end"


def test_empty_collections_and_false_count_as_absent():
    assert P.render("{{#a}}x{{/a}}", {"a": []}) == ""
    assert P.render("{{#a}}x{{/a}}", {"a": False}) == ""
    assert P.render("{{#a}}x{{/a}}", {"a": ["one"]}) == "x"


def test_floats_render_without_trailing_zeros():
    # "avg hold 4s", not "avg hold 4.0s" — the prompt reads as written prose
    assert P.render("{{avg_hold}}s", {"avg_hold": 4.0}) == "4s"
    assert P.render("{{avg_hold}}s", {"avg_hold": 2.5}) == "2.5s"


def test_compose_appends_the_welded_half():
    system, user = P.compose(
        "script",
        {"system": "VOICE: grave.", "user": "Write about {{title}}."},
        {"title": "Ships", "language": "en-US"},
    )
    assert system.startswith("VOICE: grave.")
    assert "Output ONLY the narration text" in system
    assert "Write the ENTIRE script in en-US." in system
    assert user == "Write about Ships."


def test_compose_falls_back_to_the_default_prompt():
    """Videos enqueued before M10 carry no snapshot."""
    system, user = P.compose("planner", None, {"script": "x", "component_menu": "- FactCard"})
    assert "HARD RULES" in system
    assert "- FactCard" in system
    assert "Respond with the JSON object only." in user


# ---------- loading ----------


def test_every_shipped_prompt_declares_its_directory_as_its_role():
    for role in P.ROLES:
        for doc in P.list_prompts(role):
            assert doc["role"] == role
        assert any(d["name"] == "default" for d in P.list_prompts(role)), role


def test_unknown_role_is_a_hard_error():
    with pytest.raises(ValueError, match="unknown prompt role"):
        P.load_prompt("director", "default")


def test_missing_prompt_raises_rather_than_narrating_in_the_wrong_voice():
    with pytest.raises(FileNotFoundError):
        P.load_prompt("script", "no-such-prompt")


# ---------- resolution (the worker's own fallback ladder) ----------


def test_resolve_prefers_the_channel_then_the_style_pack_then_the_default():
    pack = {"style_pack_doc": {"script": {"prompt": "doc-grave"}}}
    assert P.resolve({"script": {"prompt": "default"}, **pack}, "script")["name"] == "default"
    assert P.resolve(pack, "script")["name"] == "doc-grave"
    assert P.resolve({}, "script")["name"] == "default"


def test_resolve_does_not_leak_the_style_pack_prompt_into_the_planner():
    pack = {"style_pack_doc": {"script": {"prompt": "doc-grave"}}}
    assert P.resolve(pack, "planner")["name"] == "default"
