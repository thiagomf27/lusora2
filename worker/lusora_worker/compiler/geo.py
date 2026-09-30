"""Deterministic geocoding for SatelliteLocate props (AI does judgment, code
does arithmetic — the LLM names the place, code finds the coordinates).

v1: a small offline gazetteer + fail-loud for unknown places (an online
geocoder adapter can replace lookup() later without touching callers).
"""

from __future__ import annotations

import json
import os
import threading
import time
import unicodedata
from pathlib import Path

import httpx

_GAZETTEER: dict[str, tuple[float, float]] = {
    "berlin": (52.52, 13.405),
    "london": (51.507, -0.128),
    "paris": (48.857, 2.352),
    "moscow": (55.756, 37.617),
    "stalingrad": (48.708, 44.514),
    "volgograd": (48.708, 44.514),
    "kursk": (51.730, 36.193),
    "normandy": (49.414, -0.826),
    "warsaw": (52.230, 21.011),
    "tokyo": (35.677, 139.650),
    "hiroshima": (34.385, 132.455),
    "pearl harbor": (21.365, -157.950),
    "washington": (38.907, -77.037),
    "new york": (40.713, -74.006),
    "rome": (41.903, 12.496),
    "madrid": (40.417, -3.703),
    "lisbon": (38.722, -9.139),
    "sao paulo": (-23.551, -46.633),
    "rio de janeiro": (-22.907, -43.173),
    "brasilia": (-15.794, -47.883),
    "buenos aires": (-34.604, -58.382),
    "cairo": (30.044, 31.236),
    "el alamein": (30.833, 28.950),
    "beijing": (39.904, 116.407),
    "shanghai": (31.230, 121.474),
    "kyiv": (50.450, 30.524),
    "leningrad": (59.939, 30.316),
    "saint petersburg": (59.939, 30.316),
    "dunkirk": (51.034, 2.377),
    "midway": (28.208, -177.372),
    # countries / regions (representative centroids)
    "america": (39.8, -98.6),
    "united states": (39.8, -98.6),
    "usa": (39.8, -98.6),
    "brazil": (-14.2, -51.9),
    "germany": (51.2, 10.4),
    "france": (46.6, 2.2),
    "italy": (42.8, 12.5),
    "spain": (40.2, -3.6),
    "portugal": (39.6, -8.0),
    "britain": (54.0, -2.5),
    "england": (52.6, -1.5),
    "united kingdom": (54.0, -2.5),
    "russia": (55.0, 60.0),
    "soviet union": (55.0, 60.0),
    "china": (35.9, 104.2),
    "japan": (36.2, 138.3),
    "india": (21.0, 78.0),
    "mexico": (23.6, -102.6),
    "canada": (56.1, -106.3),
    "australia": (-25.3, 133.8),
    "poland": (52.1, 19.4),
    "ukraine": (48.4, 31.2),
    "egypt": (26.8, 30.8),
    "the midwest": (41.5, -93.5),
    "midwest": (41.5, -93.5),
    "great plains": (41.1, -100.7),
    "california": (36.8, -119.4),
    "texas": (31.5, -99.3),
    "chicago": (41.878, -87.630),
}


def _norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return s.strip().lower()


def lookup(place_name: str) -> tuple[float, float] | None:
    """The gazetteer first; then OpenStreetMap's geocoder (D110), cached, so a
    town like Centralia no longer stops the video. LUSORA_GEOCODER=offline
    keeps it to the gazetteer (the tests set it)."""
    hit = _GAZETTEER.get(_norm(place_name))
    if hit is not None:
        return hit
    if os.environ.get("LUSORA_GEOCODER", "nominatim").lower() == "offline":
        return None
    return _nominatim(place_name)


# ---------------- the online geocoder (D110) ----------------

_NOMINATIM = "https://nominatim.openstreetmap.org/search"
_UA = {"User-Agent": "LUSORA/1.0 (documentary video tool; geocoding a few place names per video)"}
_LOCK = threading.Lock()
_LAST = [0.0]


def _cache_path() -> Path:
    # the repo's data/ folder, beside videos/ and stock-cache/ (worker/ is two up)
    return Path(__file__).resolve().parents[3] / "data" / "geocode_cache.json"


def _nominatim(place_name: str) -> tuple[float, float] | None:
    """One request a second at most (Nominatim's usage policy), every answer —
    a miss included — cached on disk, so a place is asked once per machine."""
    key = _norm(place_name)
    path = _cache_path()
    with _LOCK:
        cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if key in cache:
            return tuple(cache[key]) if cache[key] else None
        wait = 1.1 - (time.time() - _LAST[0])
        if wait > 0:
            time.sleep(wait)
        _LAST[0] = time.time()
        try:
            resp = httpx.get(_NOMINATIM, params={"q": place_name, "format": "json", "limit": 1},
                             headers=_UA, timeout=30)
            resp.raise_for_status()
            rows = resp.json()
        except (httpx.HTTPError, ValueError):
            return None  # not cached: an outage must not outlive itself
        coords = [round(float(rows[0]["lat"]), 5), round(float(rows[0]["lon"]), 5)] if rows else None
        cache[key] = coords
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(cache, indent=1, ensure_ascii=False), encoding="utf-8")
        return tuple(coords) if coords else None
