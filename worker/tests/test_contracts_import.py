"""M0 smoke: the contracts package is importable and schemas load."""

import json

import pytest

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


def _write_pack(tmp_path, monkeypatch, name, payload):
    """Point the loader at a throwaway component-packs dir."""
    packs = tmp_path / "component-packs"
    packs.mkdir(exist_ok=True)
    (packs / f"{name}.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(c, "COMPONENT_PACKS_DIR", packs)
    c.load_catalog.cache_clear()


def _entry(name, pack):
    return {
        "name": name,
        "pack": pack,
        "when_to_use": "a test",
        "when_not_to_use": "anything real",
        "anchor_types": [],
        "props": {},
        "renderer": "remotion",
    }


def test_data_packs_merge_into_the_catalog(tmp_path, monkeypatch):
    # Baseline measured with the pack dir already redirected: any real pack
    # installed in contracts/component-packs must not change the arithmetic.
    empty = tmp_path / "empty-packs"
    empty.mkdir()
    monkeypatch.setattr(c, "COMPONENT_PACKS_DIR", empty)
    c.load_catalog.cache_clear()
    core = len(c.load_catalog()["components"])
    _write_pack(tmp_path, monkeypatch, "extra", {"pack": "extra", "components": [_entry("TestPlate", "extra")]})
    try:
        catalog = c.load_catalog()
        assert len(catalog["components"]) == core + 1
        assert c.catalog_component("TestPlate")["pack"] == "extra"
    finally:
        monkeypatch.undo()
        c.load_catalog.cache_clear()


def test_a_pack_written_after_first_load_is_picked_up(tmp_path, monkeypatch):
    """The worker runs forever: a component added through the platform must be
    live for the next video without a restart."""
    packs = tmp_path / "component-packs"
    packs.mkdir()
    monkeypatch.setattr(c, "COMPONENT_PACKS_DIR", packs)
    c.load_catalog.cache_clear()
    try:
        assert c.catalog_component("LateArrival") is None  # warms the cache
        (packs / "late.json").write_text(
            json.dumps({"pack": "late", "components": [_entry("LateArrival", "late")]}),
            encoding="utf-8",
        )
        assert c.catalog_component("LateArrival") is not None, "cache went stale"
    finally:
        monkeypatch.undo()
        c.load_catalog.cache_clear()


def test_data_pack_shadowing_a_core_name_raises(tmp_path, monkeypatch):
    _write_pack(tmp_path, monkeypatch, "extra", {"pack": "extra", "components": [_entry("FactCard", "extra")]})
    try:
        with pytest.raises(ValueError, match="already defined"):
            c.load_catalog()
    finally:
        monkeypatch.undo()
        c.load_catalog.cache_clear()


def test_data_pack_name_must_match_filename(tmp_path, monkeypatch):
    _write_pack(tmp_path, monkeypatch, "extra", {"pack": "other", "components": []})
    try:
        with pytest.raises(ValueError, match="expected 'extra'"):
            c.load_catalog()
    finally:
        monkeypatch.undo()
        c.load_catalog.cache_clear()


def test_status_transitions_match_editor_rules():
    assert c.can_transition("admin", "draft", "queued")
    assert not c.can_transition("editor", "draft", "queued")
    assert c.can_transition("editor", "in_review", "approved")
    assert not c.can_transition("editor", "queued", "producing")
    assert not c.can_transition("admin", "posted", "queued")
