"""select_overlays: the overlay question in its own call (slice 5, D87).

The slice was re-aimed before it was built. It was specified to improve
RESTRAINT, on the evidence of a 57-second case with a budget of four where the
planner blew the ceiling. The first baseline on real reference videos said the
opposite at reference scale — restraint 86%, recall 44%, every run finishing
well under budget — so the craft half now pushes toward the overlays that are
never written, and toward the 18 components the planner never reaches for.
Restraint is the thing being PROTECTED here, not the thing being improved.
"""

import json

import pytest

from lusora_worker import validators
from lusora_worker.agents import overlay as overlay_agent
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers.llm import LLMResult

from test_agents import CFG, FakeDb

SCRIPT = "The port fed the capital. Nearly 70% of all grain passed through it."


def _cfg(**over):
    cfg = json.loads(json.dumps(CFG))
    style = cfg["style_pack_doc"]
    style["overlays"] = {**style["overlays"], **over.pop("overlays", {})}
    cfg.update(over)
    return cfg


def _ctx(tmp_path, cfg=None):
    return StageContext(
        video={"id": "vid_o", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg=cfg or _cfg(),
        db=FakeDb(),
        config=None,
    )


def _beats():
    return {
        "version": "1.1",
        "video_id": "vid_o",
        "beats": [
            {"id": "b1", "kind": "narration", "script_text": "The port fed the capital.",
             "visual_intent": "aerial harbour, 1940s"},
            {"id": "b2", "kind": "narration",
             "script_text": "Nearly 70% of all grain passed through it.",
             "visual_intent": "dock workers unloading sacks",
             "anchors": [{"type": "percentage", "value": 70, "label": "of grain",
                          "source_words": "Nearly 70%"}]},
        ],
    }


def _reply(doc):
    return LLMResult(text=json.dumps(doc), input_tokens=500, output_tokens=200)


def _two_anchored_beats():
    """Two beats that can each legally take a counter — needed to exceed a
    budget, since the density ceiling is `ceil(per_minute * s / 60) + 1` and so
    is never lower than one."""
    doc = _beats()
    doc["beats"][0]["anchors"] = [
        {"type": "number", "value": 12, "label": "quays", "source_words": "The port"}
    ]
    return doc


def _selection(**over):
    doc = {
        "version": "1.0", "video_id": "vid_o",
        "selections": [{"beat_id": "b2", "component": "AnimatedCounter",
                        "role": "anchor", "anchor_ref": 0, "why": "the figure lands here"}],
        "declined": [{"beat_id": "b1", "why": "nothing in it to show"}],
    }
    doc.update(over)
    return doc


# ---------------- the shortlisted menu ----------------


def test_select_overlays_sees_only_components_its_anchor_type_permits():
    menu = [e["name"] for e in overlay_agent._candidate_menu(["percentage"], None, False)]
    assert "AnimatedCounter" in menu and "StatTag" in menu and "PieChart" in menu
    assert "DateStamp" not in menu, "a date component cannot attach to a percentage"
    assert "QuoteBlock" not in menu


def test_the_exhibit_family_appears_when_the_pack_enables_emphasis():
    """The baseline's second finding: 18 components were never once chosen, the
    whole exhibit family among them. They are unreachable in a 29-entry list
    read once for a video, and unavoidable in a six-entry list read beside the
    beat — but only where the pack allows the class at all."""
    off = [e["name"] for e in overlay_agent._candidate_menu(["percentage"], None, False)]
    on = [e["name"] for e in overlay_agent._candidate_menu(["percentage"], None, True)]
    for exhibit in ("DocumentCard", "DataTable", "FramedExhibit", "FactSheet"):
        assert exhibit not in off
        assert exhibit in on


def test_a_candidate_with_no_legal_component_is_never_offered(tmp_path):
    """A beat with no anchor, on a pack with no emphasis class, has nothing it
    could be given — asking about it spends tokens to be told no."""
    beats = _beats()["beats"]
    candidates = overlay_agent.build_candidates(beats, _cfg())
    assert [c["beat"]["id"] for c in candidates] == ["b2"]


def test_every_beat_becomes_a_candidate_once_emphasis_is_on(tmp_path):
    cfg = _cfg(overlays={"emphasis": {"enabled": True, "per_minute": 1.0}})
    candidates = overlay_agent.build_candidates(_beats()["beats"], cfg)
    assert [c["beat"]["id"] for c in candidates] == ["b1", "b2"]


def test_the_shortlisted_menu_is_an_order_of_magnitude_smaller():
    """The whole reason the question can be asked per beat at all."""
    from lusora_worker.agents.planner import _catalog_menu

    whole = _catalog_menu(None)
    one = "\n".join(
        f"    - {e['name']}: {e['when_to_use']}"
        for e in overlay_agent._candidate_menu(["percentage"], None, False)
    )
    assert len(one) < len(whole) / 8, (len(one), len(whole))


def test_an_allowed_list_still_filters_the_shortlist():
    menu = [e["name"] for e in overlay_agent._candidate_menu(["percentage"], ["StatTag"], True)]
    assert menu == ["StatTag"]


def test_the_candidate_block_shows_the_anchor_the_component_would_fill():
    """The model cannot choose between a counter and a document without seeing
    what the beat actually says and what it can show."""
    beat = _beats()["beats"][1]
    block = overlay_agent._render_candidate(
        beat, overlay_agent._candidate_menu(["percentage"], None, False)
    )
    assert "b2" in block
    assert "Nearly 70%" in block
    assert "[0] percentage" in block
    assert "AnimatedCounter" in block


# ---------------- validation ----------------


def test_a_selection_naming_an_unknown_beat_is_rejected():
    doc = _selection(selections=[{"beat_id": "b99", "component": "AnimatedCounter",
                                  "role": "anchor", "anchor_ref": 0}], declined=[])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("no such beat" in v for v in violations), violations


def test_a_selection_whose_anchor_type_mismatches_is_rejected():
    doc = _selection(selections=[{"beat_id": "b2", "component": "DateStamp",
                                  "role": "anchor", "anchor_ref": 0}], declined=[])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("cannot attach to anchor type 'percentage'" in v for v in violations), violations


def test_a_selection_outside_the_allowed_components_is_rejected():
    cfg = _cfg(overlays={"allowed_components": ["StatTag"]})
    violations = validators.validate_overlay_selection(_selection(), _beats()["beats"], cfg, 60)
    assert any("allowed_components" in v for v in violations), violations


def test_a_fact_carrying_component_without_an_anchor_ref_is_rejected():
    doc = _selection(selections=[{"beat_id": "b2", "component": "AnimatedCounter",
                                  "role": "anchor"}], declined=[])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("requires an anchor_ref" in v for v in violations), violations


def test_two_selections_on_one_beat_are_rejected():
    """A beat is the span an overlay is held over, so it can hold one."""
    doc = _selection(selections=[
        {"beat_id": "b2", "component": "AnimatedCounter", "role": "anchor", "anchor_ref": 0},
        {"beat_id": "b2", "component": "StatTag", "role": "anchor", "anchor_ref": 0},
    ], declined=[])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("already has a selection" in v for v in violations), violations


def test_a_beat_both_selected_and_declined_is_rejected():
    doc = _selection(declined=[{"beat_id": "b2", "why": "changed my mind"}])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("both selected and declined" in v for v in violations), violations


def test_the_two_budgets_stay_separate():
    """D59's rule survives the move: an emphasis graphic must not eat the
    anchor budget, and neither can borrow from the other."""
    cfg = _cfg(overlays={"density": {"per_minute": 0.1},
                         "emphasis": {"enabled": True, "per_minute": 60.0},
                         "allowed_components": ["AnimatedCounter", "HammerStatement"]})
    beats = _beats()["beats"]
    # one emphasis graphic, well inside a huge emphasis budget, on a video whose
    # ANCHOR budget is nearly zero — it must not be charged to the anchor ceiling
    doc = _selection(selections=[{"beat_id": "b1", "component": "HammerStatement",
                                  "role": "emphasis",
                                  "props_hint": {"text": "The port fed the capital"}}],
                     declined=[])
    assert validators.validate_overlay_selection(doc, beats, cfg, 60) == []


def test_selection_beyond_the_density_budget_is_reported_for_repair():
    cfg = _cfg(overlays={"density": {"per_minute": 0.0}})   # ceiling of 1
    doc = _selection(selections=[
        {"beat_id": "b1", "component": "AnimatedCounter", "role": "anchor", "anchor_ref": 0},
        {"beat_id": "b2", "component": "AnimatedCounter", "role": "anchor", "anchor_ref": 0},
    ], declined=[])
    violations = validators.validate_overlay_selection(
        doc, _two_anchored_beats()["beats"], cfg, 600
    )
    assert any("exceed the density budget" in v for v in violations), violations


def test_an_emphasis_component_on_a_pack_with_the_class_off_is_rejected():
    """The D86 rule, carried into the new artifact: a component that carries no
    fact is an emphasis graphic whatever the selection declares."""
    doc = _selection(selections=[{"beat_id": "b1", "component": "HammerStatement",
                                  "role": "anchor"}], declined=[])
    violations = validators.validate_overlay_selection(doc, _beats()["beats"], _cfg(), 60)
    assert any("does not enable that class" in v for v in violations), violations


# ---------------- the agent loop ----------------


def test_a_valid_answer_is_accepted_and_billed(tmp_path):
    ctx = _ctx(tmp_path)
    doc = overlay_agent.select_overlays(
        ctx, _beats(), 60.0, chat_fn=lambda *a: _reply(_selection())
    )
    assert [s["beat_id"] for s in doc["selections"]] == ["b2"]
    completed = [e for e in ctx.db.cost_events if e["status"] == "completed"]
    assert len(completed) == 1
    assert completed[0]["operation"] == "llm.select_overlays"


def test_selection_beyond_the_budget_is_repaired(tmp_path):
    """The repair loop works on the new artifact, and every violation of THIS
    attempt goes back (Principle 5)."""
    cfg = _cfg(overlays={"density": {"per_minute": 0.0}})   # ceiling of 1
    ctx = _ctx(tmp_path, cfg)
    seen: list[str] = []
    greedy = _selection(selections=[
        {"beat_id": "b1", "component": "AnimatedCounter", "role": "anchor", "anchor_ref": 0},
        {"beat_id": "b2", "component": "AnimatedCounter", "role": "anchor", "anchor_ref": 0},
    ], declined=[])

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        seen.append(user)
        if len(seen) == 1:
            return _reply(greedy)
        return _reply(_selection())

    doc = overlay_agent.select_overlays(ctx, _two_anchored_beats(), 600.0, chat_fn=chat_fn)
    assert [s["beat_id"] for s in doc["selections"]] == ["b2"]
    assert "exceed the density budget" in seen[1], "the violation must reach the retry"


def test_three_bad_answers_stop_the_stage_with_one_reason(tmp_path):
    ctx = _ctx(tmp_path)
    bad = _selection(selections=[{"beat_id": "b99", "component": "AnimatedCounter",
                                  "role": "anchor", "anchor_ref": 0}], declined=[])
    with pytest.raises(StageError, match="overlay selection failed after 3 attempts"):
        overlay_agent.select_overlays(ctx, _beats(), 60.0, chat_fn=lambda *a: _reply(bad))


def test_unparseable_output_is_a_violation_not_a_crash(tmp_path):
    ctx = _ctx(tmp_path)
    reply = LLMResult(text="sorry, I can't do that", input_tokens=10, output_tokens=5)
    with pytest.raises(StageError, match="failed after 3 attempts"):
        overlay_agent.select_overlays(ctx, _beats(), 60.0, chat_fn=lambda *a: reply)


def test_a_video_with_no_candidate_costs_nothing(tmp_path):
    """No anchors, no emphasis class: there is nothing to ask about, and the
    stage must not spend a call finding that out."""
    ctx = _ctx(tmp_path)
    bare = {"version": "1.1", "video_id": "vid_o", "beats": [
        {"id": "b1", "kind": "narration", "script_text": SCRIPT, "visual_intent": "a harbour"}]}

    def explode(*a):
        raise AssertionError("no provider call should happen")

    doc = overlay_agent.select_overlays(ctx, bare, 60.0, chat_fn=explode)
    assert doc["selections"] == []
    assert ctx.db.cost_events == []


def test_the_selector_calls_at_its_prompt_pack_temperature(tmp_path):
    seen: list[float] = []

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        seen.append(temperature)
        return _reply(_selection())

    overlay_agent.select_overlays(_ctx(tmp_path), _beats(), 60.0, chat_fn=chat_fn)
    assert seen == [0.2]


def test_the_prompt_names_both_budgets_and_every_candidate(tmp_path):
    cfg = _cfg(overlays={"emphasis": {"enabled": True, "per_minute": 1.0}})
    ctx = _ctx(tmp_path, cfg)
    seen: dict[str, str] = {}

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        seen["system"], seen["user"] = system, user
        return _reply(_selection())

    overlay_agent.select_overlays(ctx, _beats(), 60.0, chat_fn=chat_fn)
    assert "BEAT b1" in seen["user"] and "BEAT b2" in seen["user"]
    assert "at most" in seen["user"]
    assert "emphasis graphics" in seen["user"]
    # the re-aim, in the shipped prompt rather than only in the decision log
    assert "under-using your budget" in seen["system"].lower()
    assert "counter every time" in seen["system"].lower()


def test_a_timed_beat_is_always_a_candidate(tmp_path):
    """D86: a timed beat is outside the class system, so the emphasis gate does
    not apply to it. Without this a cold open could never get its title card on
    v3, where the planner writes no overlays at all."""
    doc = _beats()
    doc["beats"].insert(0, {
        "id": "b0", "kind": "timed", "timing": {"start_s": 0, "end_s": 4.5},
        "visual_intent": "slow push-in on a bombed cathedral at dawn"})
    # emphasis OFF — the beat still gets a menu, and it is the pure-text one
    candidates = overlay_agent.build_candidates(doc["beats"], _cfg())
    cold = next(c for c in candidates if c["beat"]["id"] == "b0")
    names = [e["name"] for e in cold["menu"]]
    assert "KineticTitle" in names
    assert all(not e["anchor_types"] for e in cold["menu"]), "it can carry no fact"


def test_the_shortlist_shows_how_to_fill_the_component_it_offers():
    """The re-aim worked and then tripped over itself: the selector started
    reaching for StepFlow, Timeline and DocumentCard — the exhibit family the
    baseline never touched — and burned three attempts guessing that `steps`
    takes strings rather than objects.

    The planner deliberately gets NO prop schemas (thirty entries is 2k tokens
    read once for a video, and a model handed a schema fills it). Here the menu
    is six entries, so the same information is nearly free — and offering a
    component while hiding how to fill it asks for a decision the model cannot
    express."""
    menu = [e for e in overlay_agent._candidate_menu([], None, True)
            if e["name"] in ("StepFlow", "Timeline")]
    block = overlay_agent._render_candidate(
        {"id": "b1", "kind": "narration", "script_text": "a ledger", "anchors": []}, menu
    )
    assert '"steps"' in block and '"type":"object"' in block, block
    assert '"events"' in block


def test_the_shortlist_never_shows_the_emphasis_prop():
    """D86's collision does not come back through the selector's own menu."""
    block = overlay_agent._render_candidate(
        {"id": "b1", "script_text": "x", "anchors": []},
        overlay_agent._candidate_menu([], None, True),
    )
    assert '"emphasis"' not in block


def test_the_shortlist_stays_cheap_even_with_props():
    """Small enough to send per candidate: the whole reason the question can be
    asked per beat at all."""
    from lusora_worker.agents.planner import _catalog_menu

    block = overlay_agent._render_candidate(
        {"id": "b1", "script_text": "x",
         "anchors": [{"type": "percentage", "value": 70, "source_words": "70%"}]},
        overlay_agent._candidate_menu(["percentage"], None, False),
    )
    assert len(block) < len(_catalog_menu(None, props=True)) / 8
