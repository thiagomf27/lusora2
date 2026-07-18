"""
discover.py — cold-path candidate finding WITHOUT downloading video bytes.

Tiered to spend requests wisely:

  Tier 0  discover_youtube()  — Data API search.list (ids/title/desc/thumb in
          one call) + videos.list (ISO-8601 durations) to drop over-long
          videos before they can reach the fine pass.
  Tier 2  fetch_storyboard()  — yt-dlp `sb` storyboard: a tiny sprite-sheet
          JPEG of frames sampled across the video, as a base64 data URI for
          GLM. No video bytes. attach_storyboards() runs this ONLY for the
          thumbnail-ranked shortlist.
  Stock   discover_pexels() / discover_pixabay() — whole-clip candidates.

Env: YOUTUBE_API_KEY (required for tier 0), PEXELS_API_KEY / PIXABAY_API_KEY
(each source is skipped silently when its key is missing).
"""

from __future__ import annotations

import base64
import os
import re

import requests

from .schema import Candidate

# drop videos longer than this before they cost a download + fine pass
MAX_DURATION_S = float(os.environ.get("BROLL_MAX_DURATION_S", "900"))
# ... and shorter than this: excludes Shorts/teasers, which make poor b-roll
# sources. At >=240 the Data API query itself asks for videoDuration=medium
# (4-20 min), so Shorts don't even consume candidate slots.
MIN_DURATION_S = float(os.environ.get("BROLL_MIN_DURATION_S", "240"))

# Cookies are STRICTLY OPT-IN: nothing is read unless one of these is set.
# Use a THROWAWAY account only — yt-dlp's wiki warns accounts used for
# automated downloading risk bans, and a personal account would identify
# you to YouTube regardless of the proxy.
#   BROLL_COOKIES_BROWSER — live browser profile, "chrome" or "chrome:Profile 2"
#   BROLL_COOKIES_FILE    — exported Netscape cookies.txt (takes precedence)
COOKIES_BROWSER = os.environ.get("BROLL_COOKIES_BROWSER", "")
COOKIES_FILE = os.environ.get("BROLL_COOKIES_FILE", "")


def ytdlp_network_opts(require_proxy: bool = True) -> dict:
    """
    Proxy + cookies for EVERY yt-dlp touchpoint, so the throwaway account
    and the exit IP always travel together. yt-dlp does NOT inherit system
    proxy settings — the `proxy` option must be passed explicitly, or the
    traffic goes out over the real IP.

    $YTDLP_PROXY is REQUIRED (fail loudly, never silently leak); set it to
    the literal string "direct" to explicitly allow a proxyless connection.
    """
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    opts: dict = {}
    if proxy.lower() == "direct":
        pass                                    # explicit, deliberate opt-out
    elif proxy:
        opts["proxy"] = proxy
    elif require_proxy:
        raise RuntimeError(
            "YTDLP_PROXY is not set — refusing to contact YouTube over your "
            "real IP. Put YTDLP_PROXY=<scheme>://[user:pass@]host:port in "
            ".env, or YTDLP_PROXY=direct to explicitly allow no proxy."
        )
    if COOKIES_FILE:
        if not os.path.exists(COOKIES_FILE):
            raise RuntimeError(
                f"BROLL_COOKIES_FILE points at a missing file: {COOKIES_FILE}")
        opts["cookiefile"] = COOKIES_FILE
    elif COOKIES_BROWSER:
        browser, _, profile = COOKIES_BROWSER.partition(":")
        opts["cookiesfrombrowser"] = ((browser, profile) if profile
                                      else (browser,))
    return opts


def _requests_proxies(require: bool = False) -> dict:
    """
    The same exit IP for plain HTTP fetches (storyboard sprites, Data API,
    stock APIs). The Data API key belongs to the same throwaway identity as
    the cookies, so keyed API calls must not leak the home IP either —
    `require=True` fails loudly instead of silently going direct.
    """
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    if proxy.lower() == "direct":
        return {}
    if proxy:
        return {"http": proxy, "https": proxy}
    if require:
        raise RuntimeError(
            "YTDLP_PROXY is not set — refusing to call discovery APIs over "
            "your real IP. Put YTDLP_PROXY=<scheme>://[user:pass@]host:port "
            "in .env, or YTDLP_PROXY=direct to explicitly allow no proxy."
        )
    return {}


def _fetch_image_data_uri(url: str | None) -> str | None:
    """
    Download an image (through the proxy — thumbnails live on YouTube/stock
    CDNs) and inline it as a base64 data URI. The GLM endpoint rejects remote
    image URLs (400 code 1210), so every thumb_uri must be model-ready.
    """
    if not url:
        return None
    try:
        r = requests.get(url, timeout=30, proxies=_requests_proxies())
        r.raise_for_status()
        mime = r.headers.get("content-type", "image/jpeg").split(";")[0]
        return f"data:{mime};base64," + base64.b64encode(r.content).decode()
    except Exception as e:
        print(f"[thumb] {url}: {e}")
        return None


# --------------------------------------------------------------------------- #
#  Tier 0 — YouTube Data API
# --------------------------------------------------------------------------- #
def _iso8601_seconds(dur: str) -> float:
    """'PT1H2M3S' -> 3723.0"""
    m = re.fullmatch(
        r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", dur or "")
    if not m:
        return 0.0
    d, h, mn, s = (int(x) if x else 0 for x in m.groups())
    return float(((d * 24 + h) * 60 + mn) * 60 + s)


def discover_youtube(query: str, max_results: int = 20) -> list[Candidate]:
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return []
    proxies = _requests_proxies(require=True)
    params = {"part": "snippet", "q": query, "type": "video",
              "videoEmbeddable": "true", "maxResults": max_results,
              "key": key}
    if MIN_DURATION_S >= 240:
        params["videoDuration"] = "medium"    # 4-20 min: no Shorts at all
    search = requests.get(
        "https://www.googleapis.com/youtube/v3/search",
        params=params, timeout=30, proxies=proxies,
    )
    search.raise_for_status()
    items = search.json().get("items", [])
    if not items:
        return []

    ids = [it["id"]["videoId"] for it in items]
    videos = requests.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={"part": "contentDetails", "id": ",".join(ids), "key": key},
        timeout=30, proxies=proxies,
    )
    videos.raise_for_status()
    durations = {
        it["id"]: _iso8601_seconds(it["contentDetails"]["duration"])
        for it in videos.json().get("items", [])
    }

    cands = []
    for it in items:
        vid = it["id"]["videoId"]
        dur = durations.get(vid, 0.0)
        if not MIN_DURATION_S <= dur <= MAX_DURATION_S:
            continue          # Shorts/teasers or too long for the fine pass
        sn = it["snippet"]
        thumbs = sn.get("thumbnails", {})
        thumb = (thumbs.get("high") or thumbs.get("medium")
                 or thumbs.get("default") or {}).get("url")
        cands.append(Candidate(
            video_id=vid, source="youtube",
            title=sn.get("title", ""), description=sn.get("description", ""),
            thumb_uri=_fetch_image_data_uri(thumb),
            source_channel_id=sn.get("channelId"),
            source_channel_name=sn.get("channelTitle"),
        ))
    return cands


# --------------------------------------------------------------------------- #
#  Tier 2 — yt-dlp storyboard mosaic (shortlist only)
# --------------------------------------------------------------------------- #
def fetch_storyboard(video_id: str) -> str | None:
    """
    Pull one sprite-sheet JPEG from the video's `sb` storyboard formats
    (~20 KB of frames sampled across the whole video) and return it as a
    base64 data URI for GLM. No video bytes are downloaded.
    """
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            **ytdlp_network_opts()}   # proxy + throwaway cookies, together
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://youtu.be/{video_id}",
                                    download=False)
        sbs = [f for f in info.get("formats", [])
               if f.get("format_id", "").startswith("sb")]
        if not sbs:
            return None
        # sb0 is the highest-res storyboard; prefer it
        sb = sorted(sbs, key=lambda f: f["format_id"])[0]
        frags = sb.get("fragments") or [{"url": sb.get("url")}]
        url = frags[len(frags) // 2].get("url")   # mid-video sheet
        if not url:
            return None
        jpeg = requests.get(url, timeout=30, proxies=_requests_proxies())
        jpeg.raise_for_status()
        return ("data:image/jpeg;base64,"
                + base64.b64encode(jpeg.content).decode())
    except Exception as e:
        print(f"[storyboard] {video_id}: {e}")
        return None


def attach_storyboards(cands: list[Candidate], top_n: int = 5) -> None:
    """Fetch storyboards for the shortlist only — one request each."""
    for c in cands[:top_n]:
        if c.source == "youtube" and not c.storyboard_uri:
            c.storyboard_uri = fetch_storyboard(c.video_id)


# --------------------------------------------------------------------------- #
#  Stock sources — whole-clip candidates
# --------------------------------------------------------------------------- #
def discover_pexels(query: str, max_results: int = 10) -> list[Candidate]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        return []
    r = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "per_page": max_results},
        headers={"Authorization": key}, timeout=30,
        proxies=_requests_proxies(require=True),
    )
    r.raise_for_status()
    cands = []
    for v in r.json().get("videos", []):
        if not 3.0 <= float(v.get("duration", 0)) <= MAX_DURATION_S:
            continue
        cands.append(Candidate(
            video_id=f"pexels:{v['id']}", source="pexels",
            title=v.get("url", "").rstrip("/").split("/")[-1].replace("-", " "),
            thumb_uri=_fetch_image_data_uri(v.get("image")),
        ))
    return cands


def discover_pixabay(query: str, max_results: int = 10) -> list[Candidate]:
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        return []
    r = requests.get(
        "https://pixabay.com/api/videos/",
        params={"key": key, "q": query, "per_page": max_results},
        timeout=30, proxies=_requests_proxies(require=True),
    )
    r.raise_for_status()
    cands = []
    for v in r.json().get("hits", []):
        if not 3.0 <= float(v.get("duration", 0)) <= MAX_DURATION_S:
            continue
        thumb = (v.get("videos", {}).get("tiny", {}).get("thumbnail")
                 or v.get("userImageURL"))
        cands.append(Candidate(
            video_id=f"pixabay:{v['id']}", source="pixabay",
            title=v.get("tags", ""),
            thumb_uri=_fetch_image_data_uri(thumb),
        ))
    return cands


# --------------------------------------------------------------------------- #
#  The one entry point pipeline.acquire() calls
# --------------------------------------------------------------------------- #
def discover(query: str, max_results: int = 20) -> list[Candidate]:
    """All sources whose API key is configured, YouTube first."""
    cands = discover_youtube(query, max_results)
    cands += discover_pexels(query)
    cands += discover_pixabay(query)
    return cands
