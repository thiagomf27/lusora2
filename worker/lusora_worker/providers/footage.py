"""The open internet as a footage source (D104, documentary plan slice 4).

Four fetchers, each answering one question and never deciding anything:

- `youtube_search`: metadata only (id, title, channel, length, views) through
  yt-dlp's search, via $YTDLP_PROXY. Nothing is downloaded before a model has
  chosen from the titles (agents/gather_footage.py).
- `youtube_download`: one chosen video, WHOLE, video only, at most 720p. A
  section download would hand the stream to ffmpeg, which cannot speak SOCKS,
  so it would bypass the proxy; whole files are small at 720p without audio
  (a 7.7-minute video is ~27 MB, 12 s through the proxy).
- `scene_shots`: a downloaded video cut at its scene changes into shots of
  2.3 s or more, a long take offered as ~6 s pieces, each with a middle frame
  for the contact sheet (Dark Palace's `tomadas`).
- `commons_photos` / `archive_photos`: free-licence photos (public domain, CC0,
  CC BY, CC BY-SA — never NC, ND or unknown), with shop and junk titles and
  small files left out (Dark Palace's `fontes_reais`).

The proxy is required for YouTube and never used for the photo APIs; set
YTDLP_PROXY=direct to allow a proxyless YouTube connection on purpose, the way
the b-roll library does.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from . import adult_filter

UA = {"User-Agent": "LUSORA/1.0 (documentary b-roll research; free-licence archive photos)"}
FORMAT_720 = "bv*[height<=720][ext=mp4]/bv*[height<=720]/18"
VETO_TITLE = ("vlog", "reaction", "reacts", "challenge", "podcast", "interview", "i spent", "asmr", "gameplay",
              "#shorts", "unboxing", "prank", "tier list")
STOCK_SITES = re.compile(r"shutterstock|pond5|getty|storyblocks|envato|artgrid|dreamstime", re.I)
JUNK = re.compile(r"\b(die-?cast|scale model|model kit|replica|toy|lego|funko|poster|t-?shirt|mug|sticker|decal|"
                  r"for sale|logo|icon|coat of arms|flag of|signature|stamp|coin|banknote|screenshot)\b", re.I)


class ProxyMissing(RuntimeError):
    """YTDLP_PROXY is not set: YouTube is not reached at all."""


def _proxy_args() -> list[str]:
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    if not proxy:
        raise ProxyMissing("YTDLP_PROXY is not set — YouTube is only reached through a proxy "
                           "(set it to 'direct' to allow a proxyless connection on purpose)")
    return [] if proxy.lower() == "direct" else ["--proxy", proxy]


def _yt_dlp(args: list[str], timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "yt_dlp", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


# ---------------- YouTube ----------------


def youtube_search(query: str, n: int = 8) -> list[dict[str, Any]]:
    """Metadata of the first `n` results. Raises ProxyMissing; any other
    failure is an empty list (one search that fails is not a video that fails)."""
    args = [*_proxy_args(), "--dump-json", "--flat-playlist", "--no-warnings", f"ytsearch{n}:{query}"]
    try:
        proc = _yt_dlp(args, timeout=120)
    except subprocess.TimeoutExpired:
        return []
    out = []
    for line in (proc.stdout or "").splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if not j.get("id"):
            continue
        out.append({"id": str(j["id"]), "title": str(j.get("title") or ""),
                    "channel": str(j.get("channel") or j.get("uploader") or ""),
                    "duration": float(j.get("duration") or 0), "views": int(j.get("view_count") or 0),
                    "url": f"https://www.youtube.com/watch?v={j['id']}"})
    return out


def usable_result(result: dict[str, Any], max_seconds: float) -> bool:
    """A result worth showing the model: long enough to hold footage, short
    enough to download whole, not a vlog or reaction, not a stock-site preview
    reel (watermarked from end to end)."""
    title = result["title"].lower()
    return (20 <= result["duration"] <= max_seconds
            and not any(v in title for v in VETO_TITLE)
            and not STOCK_SITES.search(f"{result['title']} {result['channel']}"))


def youtube_download(video_id: str, dest: Path) -> dict[str, Any] | None:
    """The whole video, no audio, at most 720p, to `dest`. Returns what
    yt-dlp says about it, or None when it could not be fetched."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return {"id": video_id}
    tmp = dest.with_name(f"_{dest.stem}.%(ext)s")
    args = [*_proxy_args(), "-f", FORMAT_720, "-N", "8", "--no-playlist", "--no-warnings", "--print-json",
            "-o", str(tmp), f"https://www.youtube.com/watch?v={video_id}"]
    try:
        proc = _yt_dlp(args, timeout=600)
    except subprocess.TimeoutExpired:
        proc = None
    got = next(iter(sorted(dest.parent.glob(f"_{dest.stem}.*"))), None)
    if proc is None or proc.returncode != 0 or got is None:
        for leftover in dest.parent.glob(f"_{dest.stem}.*"):
            leftover.unlink(missing_ok=True)
        return None
    if got.suffix.lower() == ".mp4":
        got.replace(dest)
    else:  # webm/vp9 without an mp4 rendition: remux, the codec is fine in mp4
        remux = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(got), "-c", "copy", "-an",
                                "-movflags", "+faststart", str(dest)], capture_output=True)
        got.unlink(missing_ok=True)
        if remux.returncode != 0:
            dest.unlink(missing_ok=True)
            return None
    info = next((json.loads(x) for x in (proc.stdout or "").splitlines() if x.startswith("{")), {})
    return {"id": video_id, "title": info.get("title"), "channel": info.get("channel"),
            "duration": info.get("duration")}


def probe_seconds(path: Path) -> float:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                           str(path)], capture_output=True, text=True)
    try:
        return float(proc.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return 0.0


def scene_shots(path: Path, thumbs_dir: Path, folder: Path, max_n: int = 30) -> list[dict[str, Any]]:
    """Cut points from ffmpeg's scene score, shots of 2.3 s or more, a long
    take (a drone flight) offered in ~6 s pieces, at most `max_n` spread
    evenly over the video, each with a middle frame. Thumb paths are relative
    to `folder` (the video folder)."""
    proc = subprocess.run(["ffmpeg", "-i", str(path), "-vf", "scale=320:-2,select='gt(scene,0.28)',showinfo",
                           "-an", "-f", "null", "-"], capture_output=True, text=True, errors="replace")
    total = probe_seconds(path)
    bounds = [0.0] + [float(x) for x in re.findall(r"pts_time:([0-9.]+)", proc.stderr)] + [total]
    shots: list[tuple[float, float]] = []
    for a, b in zip(bounds, bounds[1:]):
        if b - a < 2.3:
            continue
        if b - a > 12:
            shots += [(round(a + 0.15 + j * 6, 2), 5.7) for j in range(int((b - a) // 6))]
        else:
            shots.append((round(a + 0.15, 2), round(b - a - 0.3, 2)))
    if len(shots) > max_n:
        shots = [shots[round(k * (len(shots) - 1) / (max_n - 1))] for k in range(max_n)]
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for n, (start, dur) in enumerate(shots):
        thumb = thumbs_dir / f"{path.stem}_{n:02d}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start + dur / 2:.2f}", "-i", str(path),
                        "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(thumb)], capture_output=True)
        if thumb.exists():
            out.append({"n": n, "start": start, "dur": dur, "thumb": str(thumb.relative_to(folder))})
    return out


# ---------------- Commons and archive.org ----------------

COMMONS = "https://commons.wikimedia.org/w/api.php"
IA_SEARCH = "https://archive.org/advancedsearch.php"
IA_META = "https://archive.org/metadata"
IA_DL = "https://archive.org/download"

_HOST_LOCKS: dict[str, threading.Lock] = {}
_HOST_NEXT: dict[str, float] = {}


def _get(url: str, params: dict | None = None, timeout: float = 40) -> dict:
    """One API call, politely: one at a time per site with a short gap. A
    refusal is raised at once — that search is skipped, never waited out
    (Wikimedia's Retry-After of 600 s once held a Dark Palace run 20 minutes)."""
    host = httpx.URL(url).host
    lock = _HOST_LOCKS.setdefault(host, threading.Lock())
    with lock:
        wait = _HOST_NEXT.get(host, 0.0) - time.time()
        if wait > 0:
            time.sleep(wait)
        _HOST_NEXT[host] = time.time() + (0.2 if "archive.org" in host else 0.5)
    resp = httpx.get(url, params=params, headers=UA, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def license_ok(text: str) -> bool:
    """Public domain, CC0, CC BY, CC BY-SA — never NC, ND or unknown."""
    t = (text or "").lower().replace("_", " ").replace("-", " ")
    if not t or " nc" in f" {t}" or "noncommercial" in t or " nd" in f" {t}" or "noderiv" in t:
        return False
    return (any(k in t for k in ("public domain", "publicdomain", "pd ", "pdm", "cc0", "zero", "cc by",
                                 "licenses/by", "cc by sa", "licenses/by sa"))
            or t.startswith("pd"))


def _strip_html(s: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(s or ""))).strip()


def commons_photos(query: str, n: int = 4, min_width: int = 1000, safety: bool = True) -> tuple[list[dict], list[str]]:
    """(photos, skipped reasons). Each photo: id, title, url (<=1920 px), thumb,
    width, height, license, author, page."""
    skipped: list[str] = []
    if safety and not adult_filter.safe(query):
        return [], [f"commons '{query}': the search itself is adult ({adult_filter.reason(query)})"]
    d = _get(COMMONS, {"action": "query", "format": "json", "generator": "search",
                       "gsrsearch": f"{query} filetype:bitmap", "gsrnamespace": 6, "gsrlimit": n * 3,
                       "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1920,
                       "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription|Categories|ObjectName"})
    out = []
    pages = sorted(((d.get("query") or {}).get("pages") or {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        lic = _strip_html((meta.get("LicenseShortName") or {}).get("value"))
        title = re.sub(r"^File:|\.\w+$", "", str(p.get("title", "")))
        mime = str(info.get("mime", ""))
        if not mime.startswith("image/") or mime == "image/svg+xml" or int(info.get("width") or 0) < min_width:
            continue
        if not license_ok(lic):
            skipped.append(f"commons '{title[:50]}': licence {lic or 'none'}")
            continue
        if JUNK.search(title):
            continue
        about = [_strip_html((meta.get(k) or {}).get("value")) for k in ("ImageDescription", "Categories", "ObjectName")]
        if safety and not adult_filter.safe(title, *about):
            skipped.append(f"commons '{title[:50]}': 18+ filter ({adult_filter.reason(title, *about)})")
            continue
        thumb = str(info.get("thumburl") or info.get("url"))
        out.append({"id": f"commons:{p.get('pageid')}", "provider": "commons", "title": title[:200],
                    "url": thumb, "thumb": thumb, "width": info.get("width"), "height": info.get("height"),
                    "license": lic, "author": _strip_html((meta.get("Artist") or {}).get("value"))[:80],
                    "page": str(info.get("descriptionurl") or "")})
        if len(out) >= n:
            break
    return out, skipped


def archive_photos(query: str, n: int = 3, min_width: int = 1000, safety: bool = True) -> tuple[list[dict], list[str]]:
    skipped: list[str] = []
    if safety and not adult_filter.safe(query):
        return [], [f"archive.org '{query}': the search itself is adult"]
    d = _get(IA_SEARCH, {"q": f"({query}) AND mediatype:(image) AND licenseurl:*",
                         "fl[]": ["identifier", "title", "licenseurl", "creator", "description", "subject"],
                         "rows": n * 4, "output": "json"})
    out = []
    for it in (d.get("response") or {}).get("docs") or []:
        lic = str(it.get("licenseurl") or "")
        title = it.get("title") if isinstance(it.get("title"), str) else " ".join(it.get("title") or [])
        if not license_ok(lic) or JUNK.search(title or ""):
            continue
        texts = [it.get(k) if isinstance(it.get(k), str) else " ".join(map(str, it.get(k) or []))
                 for k in ("description", "subject")]
        if safety and not adult_filter.safe(title, *(_strip_html(t) for t in texts)):
            skipped.append(f"archive.org '{str(title)[:50]}': 18+ filter")
            continue
        try:
            files = _get(f"{IA_META}/{it['identifier']}").get("files") or []
        except (httpx.HTTPError, ValueError):
            continue
        images = [f for f in files if f.get("format") in ("JPEG", "PNG") and int(f.get("width") or min_width) >= min_width]
        if not images:
            continue
        best = max(images, key=lambda f: int(f.get("size") or 0))
        from urllib.parse import quote
        out.append({"id": f"archive_org:{it['identifier']}", "provider": "archive_org", "title": str(title)[:200],
                    "url": f"{IA_DL}/{it['identifier']}/{quote(best['name'])}",
                    "thumb": f"https://archive.org/services/img/{it['identifier']}",
                    "width": int(best.get("width") or 0) or None, "height": int(best.get("height") or 0) or None,
                    "license": lic, "author": str(it.get("creator") or "")[:80],
                    "page": f"https://archive.org/details/{it['identifier']}"})
        if len(out) >= n:
            break
    return out, skipped
