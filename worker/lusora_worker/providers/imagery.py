"""Real satellite plates for SatelliteLocate (D110).

NASA GIBS serves public-domain imagery through WMS in EPSG:4326 — plate carrée,
exactly the projection SatelliteLocate maps its plates through — so one GetMap
per bbox is one plate, with no reprojection. Blue Marble covers the planet to
~500 m a pixel; Landsat WELD's annual true colour goes to ~30 m, towns and strip
mines but not rooftops. Plates are cached by bbox under data/sat_cache and
copied into the video folder, which is the renderer's public dir.

Credit: "Imagery: NASA EOSDIS GIBS (Blue Marble, Landsat WELD)".
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

import httpx

WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
BLUE_MARBLE = "BlueMarble_NextGeneration"
LANDSAT = "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual"
UA = {"User-Agent": "LUSORA/1.0 (documentary video tool)"}
CREDIT = "Imagery: NASA EOSDIS GIBS (Blue Marble, Landsat WELD) — public domain"

# SatelliteLocate's own latitude span per zoom (engine ZOOM_SPAN) — the view the
# component frames, so a static plate is fetched at exactly that window
ZOOM_SPAN = {"neighbourhood": 0.6, "city": 4, "region": 12, "country": 30, "continent": 70, "world": 150}
# the dive's intermediate steps, coarse to fine
DIVE_STEPS = (40.0, 12.0, 3.0)
# a dive plate is fetched a little wider than the view it has to cover, so it
# is fully opaque (the component fades a plate in between 1.05x and 0.8x)
MARGIN = 1.3


def _cache_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "sat_cache"


def bbox(lat: float, lng: float, lat_span: float, aspect: float) -> dict[str, float]:
    lng_span = min(360.0, lat_span * aspect)
    south, north = max(-90.0, lat - lat_span / 2), min(90.0, lat + lat_span / 2)
    west, east = lng - lng_span / 2, lng + lng_span / 2
    if west < -180:
        west, east = -180.0, -180.0 + lng_span
    if east > 180:
        west, east = 180.0 - lng_span, 180.0
    return {"west": round(west, 5), "south": round(south, 5), "east": round(east, 5), "north": round(north, 5)}


def fetch_plate(folder: Path, box: dict[str, float], width: int = 1920) -> dict[str, Any] | None:
    """One plate for `box`, into folder/plates/; the plate dict SatelliteLocate
    takes ({src, west, south, east, north}), or None when GIBS did not answer."""
    lat_span = box["north"] - box["south"]
    lng_span = box["east"] - box["west"]
    layer = BLUE_MARBLE if lat_span >= 5 else LANDSAT
    height = max(64, round(width * lat_span / max(lng_span, 1e-9)))
    key = hashlib.sha1(f"{layer}:{box}:{width}".encode()).hexdigest()[:16]
    cached = _cache_dir() / f"{key}.jpg"
    if not cached.exists():
        params = {"SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1", "LAYERS": layer, "SRS": "EPSG:4326",
                  "BBOX": f"{box['west']},{box['south']},{box['east']},{box['north']}",
                  "WIDTH": width, "HEIGHT": height, "FORMAT": "image/jpeg"}
        try:
            resp = httpx.get(WMS, params=params, headers=UA, timeout=90)
            resp.raise_for_status()
        except httpx.HTTPError:
            return None
        if not resp.headers.get("content-type", "").startswith("image/"):
            return None  # a WMS error document, not a picture
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(resp.content)
    rel = f"plates/{key}.jpg"
    (folder / "plates").mkdir(exist_ok=True)
    shutil.copyfile(cached, folder / rel)
    return {"src": rel, **box}


def plates_for(folder: Path, lat: float, lng: float, zoom: str, dive: bool, aspect: float) -> dict[str, Any]:
    """The props SatelliteLocate needs for real imagery: `plate` for a static
    locate (exactly the window it frames), `plates` coarse-to-fine for a dive.
    Empty when nothing could be fetched — the component then keeps its
    schematic stand-in, which is a worse map, not a broken video."""
    end = float(ZOOM_SPAN.get(zoom, 12))
    if not dive:
        plate = fetch_plate(folder, bbox(lat, lng, end, aspect))
        return {"plate": plate} if plate else {}
    boxes = [{"west": -180.0, "south": -90.0, "east": 180.0, "north": 90.0}]
    boxes += [bbox(lat, lng, span * MARGIN, aspect) for span in DIVE_STEPS if span > end * MARGIN]
    boxes.append(bbox(lat, lng, end * MARGIN, aspect))
    plates = [p for p in (fetch_plate(folder, b, 2048 if i == 0 else 1920) for i, b in enumerate(boxes)) if p]
    return {"plates": plates} if len(plates) >= 2 else {}
