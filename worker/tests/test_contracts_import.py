"""M0 smoke: the contracts package is importable and schemas load."""

import lusora_contracts as c


def test_schemas_load():
    for name in c.SCHEMA_NAMES:
        schema = c.load_schema(name)
        assert "$schema" in schema or "title" in schema, name


def test_catalog_and_prices_load():
    catalog = c.load_catalog()
    assert len(catalog["components"]) >= 4
    prices = c.load_prices()
    assert "mock" in prices["prices"]


def test_status_transitions_match_editor_rules():
    assert c.can_transition("admin", "draft", "queued")
    assert not c.can_transition("editor", "draft", "queued")
    assert c.can_transition("editor", "in_review", "approved")
    assert not c.can_transition("editor", "queued", "producing")
    assert not c.can_transition("admin", "posted", "queued")
