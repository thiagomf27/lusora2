"""The directed-edit block (docs/05-roadmap/directed-edit-test.md, slice 1).

Most of this file is one table: contracts/fixtures/rules/edit_hints_rules.json,
which platform/test/editHints.test.ts asserts against the TypeScript twin. The
cases start from the block of the first hand run, so the table is anchored to a
real edit pass rather than to one written to pass.
"""

from __future__ import annotations

import copy
import json
from typing import Any

import lusora_contracts
import pytest

from lusora_worker.edithints import locate_phrase, script_span, validate_edit_hints

FIXTURES = lusora_contracts.CONTRACTS_ROOT / "fixtures"
TABLE = json.loads((FIXTURES / "rules" / "edit_hints_rules.json").read_text(encoding="utf-8"))
BASE = json.loads((FIXTURES / TABLE["base_fixture"]).read_text(encoding="utf-8"))


def _apply(doc: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    """The table's `set`: dotted paths, numeric segments index arrays, None deletes."""
    doc = copy.deepcopy(doc)
    for path, value in changes.items():
        *parents, last = path.split(".")
        node: Any = doc
        for key in parents:
            node = node[int(key)] if isinstance(node, list) else node[key]
        if isinstance(node, list):
            node[int(last)] = value
        elif value is None:
            node.pop(last, None)
        else:
            node[last] = value
    return doc


@pytest.mark.parametrize("case", TABLE["cases"], ids=[c["name"] for c in TABLE["cases"]])
def test_the_shared_edit_hint_rules_hold_on_the_python_side(case: dict[str, Any]) -> None:
    hints = _apply(BASE, case.get("set") or {})
    cfg = {"style_pack_doc": _apply(TABLE["style"], case.get("style_set") or {})}
    errors, warnings = validate_edit_hints(
        hints, TABLE["script"], cfg, duration_s=case.get("duration_s")
    )
    if not case["expect"]:
        assert errors == [], f"{case['name']}: {errors}"
    for needle in case["expect"]:
        assert any(needle in e for e in errors), f"{case['name']}: no error with {needle!r} in {errors}"
    for needle in case.get("warn") or []:
        assert any(needle in w for w in warnings), f"{case['name']}: no warning with {needle!r} in {warnings}"


def test_a_phrase_is_located_as_whole_script_words() -> None:
    script = "Em 1943, a fábrica — já sem donos — produzia asas."
    # the dash splits into its own token and the phrase still lands on words
    assert locate_phrase(script, "a fabrica") == [(2, 3)]
    assert script_span(script, (2, 3)) == "a fábrica"


def test_the_anchor_text_comes_from_the_script_not_from_the_author() -> None:
    """The author's copy may differ in case or accents; what becomes
    source_words is the script's own spelling, so the validator's stricter
    comparison passes by construction."""
    script = TABLE["script"]
    [span] = locate_phrase(script, "numero cinco, o genkan")
    assert script_span(script, span) == "Número cinco, o genkan."


def test_a_phrase_with_no_words_matches_nothing() -> None:
    assert locate_phrase(TABLE["script"], " — ") == []


SCRIPT_RULES = json.loads((FIXTURES / "rules" / "script_rules.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", SCRIPT_RULES["cases"], ids=[c["name"] for c in SCRIPT_RULES["cases"]])
def test_the_shared_script_rules_hold_on_the_python_side(case: dict[str, Any]) -> None:
    """The paste box checks a pasted script with a port of validate_script
    (platform/src/lib/editPaste.ts); both assert the same table."""
    from lusora_worker.validators import validate_script

    violations = validate_script(case["text"])
    if not case["expect"]:
        assert violations == [], f"{case['name']}: {violations}"
    for needle in case["expect"]:
        assert any(needle in v for v in violations), f"{case['name']}: no {needle!r} in {violations}"


def test_the_real_duration_replaces_the_estimate() -> None:
    """With the narration measured, the budget is judged on it — the worker's
    re-check before any model call."""
    cfg = {"style_pack_doc": _apply(TABLE["style"], {"overlays.emphasis.per_minute": 3})}
    # 12 emphasis graphics: over the ceiling at 111s (3/min -> 7), under it at 300s (16)
    errors, _ = validate_edit_hints(BASE, TABLE["script"], cfg, duration_s=111)
    assert any("emphasis graphics exceed" in e for e in errors)
    errors, _ = validate_edit_hints(BASE, TABLE["script"], cfg, duration_s=300)
    assert not any("emphasis graphics exceed" in e for e in errors)
