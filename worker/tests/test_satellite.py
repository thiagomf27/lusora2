"""The satellite dive (D110, documentary plan slice 6b).

Dark Palace dives from space onto the first exact place its hook names, on
public-domain NASA imagery. In LUSORA the place is found by OpenStreetMap's
geocoder when the gazetteer does not know it, the imagery comes from NASA GIBS
in the same plate-carrée projection SatelliteLocate maps through, and the dive
is a mode of that component — so every map in the video gets real imagery,
not only the hook's.
"""

import json

import pytest

from lusora_worker.agents import hook_plan
from lusora_worker.compiler import geo
from lusora_worker.providers import imagery


def test_the_online_geocoder_is_off_in_tests_and_the_gazetteer_still_answers():
    assert geo.lookup("Berlin") == (52.52, 13.405)
    assert geo.lookup("Centralia, Pennsylvania") is None, "offline: an unknown place still fails loud"


def test_the_geocoder_asks_once_and_remembers(tmp_path, monkeypatch):
    monkeypatch.setenv("LUSORA_GEOCODER", "nominatim")
    monkeypatch.setattr(geo, "_cache_path", lambda: tmp_path / "geocode_cache.json")
    monkeypatch.setattr(geo.time, "sleep", lambda s: None)
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"lat": "40.80423", "lon": "-76.34088"}]

    monkeypatch.setattr(geo.httpx, "get", lambda *a, **k: (calls.append(k["params"]["q"]), Resp())[1])
    assert geo.lookup("Centralia, Pennsylvania") == (40.80423, -76.34088)
    assert geo.lookup("centralia, pennsylvania") == (40.80423, -76.34088)
    assert calls == ["Centralia, Pennsylvania"], "the second lookup is the cache"


def test_a_plate_is_the_window_the_component_frames():
    box = imagery.bbox(40.8, -76.34, 0.6, 16 / 9)
    assert box["north"] - box["south"] == pytest.approx(0.6)
    assert box["east"] - box["west"] == pytest.approx(0.6 * 16 / 9, abs=1e-4)
    assert (box["west"] + box["east"]) / 2 == pytest.approx(-76.34, abs=1e-4)
    edge = imagery.bbox(0, 179.5, 12, 16 / 9)
    assert edge["east"] == 180 and edge["east"] - edge["west"] == pytest.approx(12 * 16 / 9, abs=1e-4), "shifted, never wrapped"


def test_a_dive_fetches_coarse_to_fine_and_a_locate_one_plate(tmp_path, monkeypatch):
    fetched = []

    def fake(folder, box, width=1920):
        fetched.append(round(box["north"] - box["south"], 2))
        return {"src": f"plates/{len(fetched)}.jpg", **box}

    monkeypatch.setattr(imagery, "fetch_plate", fake)
    dive = imagery.plates_for(tmp_path, 40.8, -76.34, "neighbourhood", True, 16 / 9)
    assert fetched == [180.0, 52.0, 15.6, 3.9, 0.78], "planet, the steps, then the place (each 1.3x wider)"
    assert len(dive["plates"]) == 5
    fetched.clear()
    locate = imagery.plates_for(tmp_path, 40.8, -76.34, "city", False, 16 / 9)
    assert fetched == [4.0] and "plate" in locate


def test_no_imagery_leaves_the_schematic_map(tmp_path, monkeypatch):
    monkeypatch.setattr(imagery, "fetch_plate", lambda *a, **k: None)
    assert imagery.plates_for(tmp_path, 1, 1, "city", True, 16 / 9) == {}


def test_resolve_gives_every_map_real_imagery(tmp_path, monkeypatch):
    from lusora_worker.pipeline import steps

    from test_gather_footage import ctx_for

    monkeypatch.setattr(imagery, "plates_for",
                        lambda folder, lat, lng, zoom, dive, aspect: {"plates" if dive else "plate": "X"})
    plan = {"tracks": {"visual": [], "overlays": [
        {"id": "o1", "component": "SatelliteLocate", "props": {"place_name": "Berlin", "lat": 52.5, "lng": 13.4, "dive": True}},
        {"id": "o2", "component": "SatelliteLocate", "props": {"place_name": "Paris", "lat": 48.9, "lng": 2.35}},
        {"id": "o3", "component": "SatelliteLocate", "props": {"place_name": "Rome", "lat": 41.9, "lng": 12.5,
                                                               "plate": {"src": "mine.jpg"}}},
    ]}}
    ctx = ctx_for(tmp_path)
    steps._resolve_plates(ctx, plan)
    props = [o["props"] for o in plan["tracks"]["overlays"]]
    assert props[0]["plates"] == "X" and props[1]["plate"] == "X"
    assert props[2]["plate"] == {"src": "mine.jpg"}, "a plate a person gave is kept"


def test_the_hook_dives_onto_a_place_it_can_find():
    beats = [{"id": "b1", "kind": "narration", "script_text": "In the heart of Berlin, a wall went up overnight."}]
    kept, dropped = hook_plan.check([{"beat": "b1", "form": "satellite", "says": "Berlin", "place": "Berlin, Germany"}],
                                    beats, set())
    assert dropped == [] and kept[0]["component"] == "SatelliteLocate"
    assert kept[0]["props"]["dive"] is True and kept[0]["props"]["lat"] == 52.52 and kept[0]["place"] == "Berlin"
    lost, why = hook_plan.check([{"beat": "b1", "form": "satellite", "says": "Berlin", "place": "Atlantis"}], beats, set())
    assert lost == [] and "could not be found" in why[0]


def test_a_dive_compiles_on_a_place_anchor_landing_on_its_words():
    from lusora_worker.compiler import compile_plan

    beats = [{"id": "b1", "kind": "narration", "visual_intent": "x",
              "script_text": "In the heart of Berlin, a wall went up overnight."}]
    kept, _ = hook_plan.check([{"beat": "b1", "form": "satellite", "says": "Berlin", "place": "Berlin, Germany"}],
                              beats, set())
    doc, selection = hook_plan.merge_into_selection({"version": "1.0", "video_id": "v", "beats": beats}, None,
                                                    {"moments": kept})
    assert doc["beats"][0]["anchors"][-1] == {"type": "place", "value": "Berlin", "source_words": "Berlin"}
    cfg = {"style_pack_doc": {"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10},
                              "overlays": {"density": "normal"}, "transitions": {"allowed": ["cut"], "default": "cut"}},
           "output": {"fps": 30, "width": 1920, "height": 1080}}
    plan = compile_plan(doc, [{"text": beats[0]["script_text"], "start_s": 0.0, "end_s": 8.0}], cfg, 8.0, selection)
    dive = plan["tracks"]["overlays"][0]
    assert dive["component"] == "SatelliteLocate" and dive["props"]["dive"] is True
    # "Berlin" is the 5th of 10 words over 8 s: said at ~3.2 s, the dive starts just before
    assert 2.5 < dive["start_s"] < 3.4, "it starts on 'Berlin', not at the top of the beat"


def test_the_dive_may_sit_next_to_a_graphic_and_the_graphic_moves_after_it():
    """The user's call (D110): the dive is the hook's strongest form. On the
    Centralia hook "the town of Centralia" sits right before the "1,000 -> 5"
    split, and the neighbour rule dropped the dive twice."""
    from lusora_worker.compiler import core

    beats = [{"id": "b3", "kind": "narration", "script_text": "The roads lead nowhere. And the town of Berlin,"},
             {"id": "b4", "kind": "narration", "script_text": "once home to 1,000 people, now has just 5."}]
    kept, dropped = hook_plan.check([{"beat": "b3", "form": "satellite", "says": "Berlin", "place": "Berlin"}],
                                    beats, {"b4"})
    assert dropped == [] and kept[0]["form"] == "satellite"
    lost, why = hook_plan.check([{"beat": "b3", "form": "headline", "says": "roads", "text": "ROADS"}], beats, {"b4"})
    assert lost == [] and "neighbouring" in why[0], "every other form still yields"

    notes = []
    dive = {"id": "o_b3", "component": "SatelliteLocate", "props": {"dive": True}, "start_s": 3.0, "end_s": 8.0}
    split = {"id": "o_b4", "kind": "component", "component": "ComparisonSplit", "props": {}, "start_s": 5.0, "end_s": 10.0}
    out = core._dive_first([dive, split], 60.0, notes.append)
    moved = next(o for o in out if o["id"] == "o_b4")
    assert moved["start_s"] == 8.0 and moved["end_s"] == 13.0, "after the dive, its own length kept"
    assert "moved after the satellite dive" in notes[0]
    assert core._dive_first([dive, split], 9.0, notes.append) == [dive], "no room after it: dropped"
