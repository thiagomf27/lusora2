"""The match cut's photos (D111, documentary plan slice 6c).

Dark Palace's `matchcut_fotos`: real photos of one KIND of place — stone
circles, lighthouses, volcanoes — found on Commons (free licences) and in free
stock, downloaded, near-duplicates dropped, then shown to a vision judge on a
numbered sheet. The judge keeps the photos that clearly show one of that kind
and marks each subject's centre and height; MatchCut aligns every kept photo
on that point. Fewer than six good photos and the hook goes without it.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx
from lusora_contracts import prompts as prompt_packs

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..providers import footage, llm, sources

ROLE = "match_cut"
MIN_PHOTOS = 6
MAX_PHOTOS = 12
UA = footage.UA


class _JudgeDown(Exception):
    """The vision provider could not answer."""


def _pexels_photos(kind: str, n: int) -> list[dict[str, Any]]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        return []
    try:
        resp = httpx.get("https://api.pexels.com/v1/search", params={"query": kind, "per_page": n,
                                                                    "orientation": "landscape"},
                         headers={"Authorization": key}, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError:
        return []
    return [{"url": (p.get("src") or {}).get("large"), "title": p.get("alt") or kind,
             "author": p.get("photographer") or "", "license": "Pexels License", "page": p.get("url") or ""}
            for p in resp.json().get("photos") or [] if (p.get("src") or {}).get("large")]


def candidates(kind: str) -> list[dict[str, Any]]:
    """Commons first (real, free-licence), then stock."""
    found: list[dict[str, Any]] = []
    try:
        photos, _why = footage.commons_photos(kind, 24, min_width=900)
        found += [{"url": p["url"], "title": p["title"], "author": p.get("author", ""),
                   "license": p["license"], "page": p.get("page", "")} for p in photos]
    except Exception:  # noqa: BLE001 - a site refusing is fewer photos, not an error
        pass
    return found + _pexels_photos(kind, 12)


def _download(url: str, dest: Path) -> tuple[int, int] | None:
    """The photo, at most 1600 px wide, and its size — or None."""
    raw = dest.with_suffix(".raw")
    try:
        with httpx.stream("GET", url, headers=UA, timeout=60, follow_redirects=True) as resp:
            resp.raise_for_status()
            with open(raw, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
    except httpx.HTTPError:
        raw.unlink(missing_ok=True)
        return None
    proc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-vf", "scale='min(1600,iw)':-2",
                           "-frames:v", "1", "-q:v", "3", str(dest)], capture_output=True)
    raw.unlink(missing_ok=True)
    if proc.returncode != 0 or not dest.exists():
        return None
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height", "-of", "csv=p=0", str(dest)], capture_output=True, text=True)
    try:
        w, h = (int(v) for v in probe.stdout.strip().split(",")[:2])
    except ValueError:
        return None
    return w, h


def validate_keep(answer: Any, count: int) -> list[str]:
    if not isinstance(answer, dict) or not isinstance(answer.get("keep"), list):
        return ['the answer must be an object {"keep": [...]}']
    problems, seen = [], set()
    for i, k in enumerate(answer["keep"]):
        try:
            n, x, y, h = int(k["n"]), float(k["x"]), float(k["y"]), float(k.get("h", 0.35))
        except (KeyError, TypeError, ValueError):
            problems.append(f"keep[{i}]: needs n, x, y and h")
            continue
        if not 0 <= n < count:
            problems.append(f"keep[{i}]: #{n} is not on the sheet (0-{count - 1})")
        elif n in seen:
            problems.append(f"#{n} is kept twice")
        seen.add(n)
        if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < h <= 1):
            problems.append(f"#{n}: x, y and h are fractions between 0 and 1")
    return problems


def build(ctx: StageContext, kind: str, see_fn: llm.SeeFn = llm.see) -> dict[str, Any] | None:
    """{"photos": [...MatchCut photos], "credits": [...]} or None."""
    from . import pick_shots

    conf = pick_shots.settings(ctx.cfg)
    chain = llm.chain_of(conf["llm"])
    if not conf["enabled"] or chain == ["mock"]:
        return None  # no vision judge: the photos cannot be checked or aligned
    folder = ctx.folder / "matchcut"
    folder.mkdir(exist_ok=True)
    got: list[dict[str, Any]] = []
    hashes: list[int] = []
    for n, c in enumerate(candidates(kind)):
        dest = folder / f"mc_{n:02d}.jpg"
        size = _download(str(c["url"]), dest)
        if size is None:
            continue
        digest = sources.perceptual_hash(dest)
        if digest is not None and any(bin(digest ^ o).count("1") <= 10 for o in hashes):
            dest.unlink(missing_ok=True)
            continue  # the same picture uploaded twice counts once
        if digest is not None:
            hashes.append(digest)
        got.append({**c, "path": dest, "w": size[0], "h": size[1]})
    if len(got) < MIN_PHOTOS:
        return None
    cols = 5
    offers = [{"id": str(k), "thumb": str(g["path"])} for k, g in enumerate(got)]
    rows = [offers[i:i + cols] for i in range(0, len(offers), cols)]
    sheet, numbered = pick_shots.build_sheet(folder, rows, 0, cols, "mc_sheet", numbers_only=True)
    order = [int(c["id"]) for _r, c in numbered]
    system, user = prompt_packs.compose(ROLE, (ctx.cfg.get("prompts") or {}).get(ROLE),
                                        {"kind": kind, "count": len(order)})
    provider = conf["llm"]
    model = None if isinstance(provider, list) else conf.get("model")
    try:
        with budget_gate(ctx, stage="hook_plan", provider=provider, operation="vision.match_cut",
                         estimated_units=3000, model=model, details={"kind": kind}) as cost:
            try:
                result = see_fn(provider, model, system, user, [sheet], 4000, 0.2)
            except StageError as exc:
                raise _JudgeDown(str(exc)) from exc  # the gate records it as failed
            cost.actual(result.total_tokens, {"input_tokens": result.input_tokens,
                                              "output_tokens": result.output_tokens,
                                              "answered_by": result.provider})
    except _JudgeDown as exc:
        return None  # a judge that cannot answer costs the match cut, not the video
    try:
        answer = llm.extract_json(result.text)
    except (ValueError, json.JSONDecodeError):
        return None
    if validate_keep(answer, len(order)):
        return None
    photos, credits = [], []
    for k in answer["keep"][:MAX_PHOTOS]:
        g = got[order[int(k["n"])]]
        photos.append({"src": str(g["path"].relative_to(ctx.folder)), "w": g["w"], "h": g["h"],
                       "ax": round(float(k["x"]), 3), "ay": round(float(k["y"]), 3),
                       "th": round(min(1.0, max(0.05, float(k.get("h", 0.35)))), 3)})
        credits.append({key: g[key] for key in ("title", "author", "license", "page")})
    if len(photos) < MIN_PHOTOS:
        return None
    return {"photos": photos, "credits": credits}
