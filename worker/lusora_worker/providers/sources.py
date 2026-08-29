"""Source-policy resolution (D12): ordered chain + filters per asset
class, min_score fallthrough, chain-exhausted = fail loud.

Each adapter answers one question: "give me an acceptable asset for this
query under these filters, or None". A source that is unavailable
(service down, key missing) records provider_health and falls through —
only an EXHAUSTED chain fails the video.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Protocol

import httpx

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..media import run_ffmpeg

STAGE = "resolve_assets"


class Resolution(dict):
    """asset provenance dict written into the plan item (source, id,
    provider, license, path, score, query) + media_type."""


class SourceAdapter(Protocol):
    #: "semantic" = give me the beat's visual_intent (a sentence, embedded and
    #: matched by meaning). "keyword" = give me 2-4 words (matched literally).
    #: Declared per adapter because it is a property of the SERVICE, not of the
    #: beat: the same beat asks the library for "aerial view of a 1940s
    #: industrial district, smokestacks…" and Pexels for "factory 1940s".
    query_kind: str

    def resolve(
        self, ctx: StageContext, item: dict, query: str, source_cfg: dict,
        ledger: "Ledger | None" = None,
    ) -> Resolution | None: ...


# Words that carry no visual weight, so dropping them leaves the subject
# standing. en + pt-BR, because a channel's visual_intent is written in the
# channel's language. Only used to DERIVE keywords from a v1.0 beat that has
# no queries[] of its own.
_NOISE = set(
    "the a an and or of in on at to for with by from is are was were be this that it its as "
    "into over under near above below during through while shot view scene footage image "
    "photo photograph clip angle wide close up establishing archival grain style look "
    "o a os as um uma uns umas de do da dos das em no na nos nas para por com sem sobre "
    "entre ao aos e ou que se como plano vista cena imagem foto"
    .split()
)


def keywords_from_intent(intent: str, limit: int = 3) -> str:
    """A keyword query derived from a scout sentence: content words only, in
    order, subject first. The v1.0 compatibility path — a sheet with queries[]
    never reaches this."""
    words = [w.strip(".,;:!?\"'()").lower() for w in str(intent).split()]
    kept = [w for w in words if w and w not in _NOISE]
    return " ".join(kept[:limit]) or str(intent)[:60]


# ---------------- library (broll-engine over HTTP, D11) ----------------


class LibraryAdapter:
    """Adapter over broll-engine's HTTP API (api.py):
    GET /search?q=… (each hit carrying `sim` and `score`), GET /clips/{id}
    (bytes), POST /segments/{id}/mark_used. Niches/channels are lookup tables
    in the library — names resolve to ids via /niches and /channels.

    Every row it returns is an mp4, including one made from an uploaded still
    (the library stores an image as a short still clip so nothing downstream
    needs a second media type). `source.media_types` and `source.profile` in
    channel_config are therefore inert here (D76): the first has nothing to
    select between, and the second needs a per-request profile the library
    does not serve — one deployment is one library."""

    # embeddings: it matches MEANING, so it wants the whole scout sentence
    query_kind = "semantic"

    def _lookup_ids(self, base: str, endpoint: str, names: list[str]) -> list[str]:
        try:
            rows = httpx.get(f"{base}/{endpoint}", timeout=15).json()
        except (httpx.HTTPError, ValueError):
            return []
        norm = lambda s: "".join(str(s).lower().split()).replace("-", "")  # noqa: E731
        by_name = {norm(r.get("normalized_name") or r.get("name", "")): str(r["id"]) for r in rows}
        return [by_name[norm(n)] for n in names if norm(n) in by_name]

    def resolve(
        self, ctx: StageContext, item: dict, query: str, source_cfg: dict,
        ledger: "Ledger | None" = None,
    ) -> Resolution | None:
        base = (ctx.config.library_api_url if ctx.config else os.environ.get("LIBRARY_API_URL", "")).rstrip("/")
        if not base:
            ctx.db.provider_health("library", False, "LIBRARY_API_URL not set")
            return None
        params: dict[str, Any] = {"q": query, "top_k": 5, "project_id": ctx.video_id}
        # the slot this clip has to fill: ranking's duration-fit term is
        # measured against it instead of its 5s default
        slot = float(item.get("end_s", 0)) - float(item.get("start_s", 0))
        if slot > 0:
            params["prefer_seconds"] = round(slot, 3)
        if source_cfg.get("tags"):
            params["tags"] = ",".join(source_cfg["tags"])
        if source_cfg.get("licenses"):
            params["licenses"] = ",".join(source_cfg["licenses"])
        if source_cfg.get("niches"):
            niche_ids = self._lookup_ids(base, "niches", source_cfg["niches"])
            if niche_ids:
                params["niches"] = ",".join(niche_ids)
        # Scoping is FAIL-CLOSED. With no channel_id the library applies no
        # channel filter at all, so an unresolved name would search every
        # channel's private uploads — the one outcome that must not happen by
        # accident. A lusora channel that has no library channel of its own
        # (nothing ingested under that name yet) is a normal state, not an
        # error: send the unmatched name so `is_mine` is false for every row
        # and `include_global` decides, which is exactly "the global pool".
        lib_channel = self._lookup_ids(base, "channels", [ctx.channel_id])
        params["channel_id"] = lib_channel[0] if lib_channel else str(ctx.channel_id)
        params["include_global"] = str(bool(source_cfg.get("include_global", True))).lower()
        max_clip = ((ctx.cfg.get("source_policy") or {}).get("visual") or {}).get("max_clip_seconds")
        if max_clip:
            params["max_duration"] = float(max_clip)

        try:
            resp = httpx.get(f"{base}/search", params=params, timeout=60)
            resp.raise_for_status()
            results = resp.json()
        except httpx.HTTPError as e:
            ctx.db.provider_health("library", False, f"search failed: {e}")
            return None

        min_score = float(source_cfg.get("min_score", 0.0))
        # Walk the ranked results rather than taking the first: a segment this
        # video has already used is worse than the next one down, however much
        # better it scores (D54).
        for best in results:
            # THRESHOLD ON `sim`, NOT `score`. `score` is the ranked order and
            # carries a -1.0 hard block on a clip already used in this project,
            # so gating on it drops a perfect match for having been used — and
            # on a re-run of one video that is every clip already placed, i.e.
            # the library falls through to stock wholesale. `sim` is the raw
            # cosine. The list is ordered by `score`, so this cannot `break`:
            # a lower-ranked result may still be similar enough.
            sim = best.get("sim")
            if sim is None:
                if min_score <= 0:
                    sim = 1.0          # no gate configured, nothing to compare
                else:
                    ctx.db.provider_health(
                        "library", False,
                        "search results carry no `sim`: this library predates "
                        "the raw-similarity field, and min_score cannot be "
                        "applied to `score` without discarding used clips")
                    return None
            if float(sim) < min_score:
                continue
            seg_id = str(best.get("id"))
            if ledger is not None and ledger.blocked("library", None, seg_id):
                continue
            # Every library row is an mp4 — an uploaded image is stored as a
            # still CLIP, deliberately, so that nothing downstream has to know
            # about a second kind of segment. There is no image branch to take.
            out_rel = f"clips/{item['id']}.mp4"
            try:
                with httpx.stream("GET", f"{base}/clips/{seg_id}", timeout=180) as clip:
                    clip.raise_for_status()
                    with open(ctx.folder / out_rel, "wb") as f:
                        for chunk in clip.iter_bytes():
                            f.write(chunk)
            except httpx.HTTPError as e:
                ctx.db.provider_health("library", False, f"acquire failed for {seg_id}: {e}")
                return None
            if _too_similar(ctx, ledger, ctx.folder / out_rel, f"library segment {seg_id}"):
                continue
            try:
                httpx.post(
                    f"{base}/segments/{seg_id}/mark_used",
                    # the same channel the search was scoped to, so the overuse
                    # penalty it feeds is read back under the key it was
                    # written under
                    json={"project_id": ctx.video_id,
                          "channel_id": params["channel_id"]},
                    timeout=30,
                )
            except httpx.HTTPError as e:
                ctx.db.provider_health("library", False, f"mark_used failed for {seg_id}: {e}")

            ctx.db.provider_health("library", True)
            return Resolution(
                source="library", id=seg_id, provider=None,
                license=best.get("license"), path=out_rel,
                score=float(best.get("score", 0)), query=query[:200],
                media_type="video",
            )
        return None


def _too_similar(ctx: StageContext, ledger: "Ledger | None", path: Any, what: str) -> bool:
    """Reject a downloaded file that looks like one already on screen.

    Runs after the download because a perceptual hash needs the pixels; the
    cost is one wasted fetch on a repeat, against a video that visibly reuses a
    shot. Off unless the channel sets a distance."""
    if ledger is None or ledger.min_distance <= 0:
        return False
    distance = ledger.too_similar(perceptual_hash(path))
    if distance is None:
        return False
    ctx.db.event(ctx.video_id, STAGE, "progress",
                 f"skipped {what}: {distance} bits from a shot already used "
                 f"(min_hamming_distance {ledger.min_distance})")
    return True


# ---------------- stock (pexels, cached searches) ----------------


class PexelsAdapter:
    # Pexels matches WORDS. Handed a scout sentence it returns whatever shares
    # the most common ones, which is how "aerial view of a 1940s industrial
    # district, smokestacks, workers assembling aircraft wings" came back as a
    # man at a desk: every content word missed, "view" and "of" hit.
    query_kind = "keyword"

    def resolve(
        self, ctx: StageContext, item: dict, query: str, source_cfg: dict,
        ledger: "Ledger | None" = None,
    ) -> Resolution | None:
        api_key = os.environ.get("PEXELS_API_KEY")
        if not api_key:
            ctx.db.provider_health("stock.pexels", False, "PEXELS_API_KEY not set")
            return None
        want_video = "video" in (source_cfg.get("media_types") or ["video"])
        cache_dir = ctx.config.videos_root.parent / "stock-cache" if ctx.config else None
        cache_key = hashlib.sha1(f"pexels:{want_video}:{query}".encode()).hexdigest()[:16]

        data = None
        cache_file = cache_dir / f"{cache_key}.json" if cache_dir else None
        if cache_file and cache_file.exists():
            data = json.loads(cache_file.read_text())
        else:
            url = ("https://api.pexels.com/videos/search" if want_video
                   else "https://api.pexels.com/v1/search")
            try:
                resp = httpx.get(url, params={"query": query, "per_page": 5,
                                              "orientation": source_cfg.get("orientation", "landscape")},
                                 headers={"Authorization": api_key}, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                if cache_file:
                    cache_file.parent.mkdir(parents=True, exist_ok=True)
                    cache_file.write_text(json.dumps(data))
                ctx.db.cost_event(video_id=ctx.video_id, channel_id=ctx.channel_id,
                                  provider="pexels", operation="stock.search", status="completed",
                                  units=1, unit_price_usd=0, usd=0, details={"query": query[:120]})
            except httpx.HTTPError as e:
                ctx.db.provider_health("stock.pexels", False, f"search failed: {e}")
                return None

        hits = (data.get("videos") if want_video else data.get("photos")) or []
        ext = "mp4" if want_video else "jpg"
        out_rel = f"clips/{item['id']}.{ext}"
        for hit in hits:
            asset_id = str(hit.get("id"))
            if ledger is not None and ledger.blocked("stock", "pexels", asset_id):
                continue
            try:
                if want_video:
                    files = sorted(hit["video_files"], key=lambda f: f.get("width") or 0, reverse=True)
                    dl_url = files[0]["link"]
                else:
                    dl_url = hit["src"]["large2x"]
                with httpx.stream("GET", dl_url, timeout=180, follow_redirects=True) as resp:
                    resp.raise_for_status()
                    with open(ctx.folder / out_rel, "wb") as f:
                        for chunk in resp.iter_bytes():
                            f.write(chunk)
            except (httpx.HTTPError, KeyError, IndexError) as e:
                ctx.db.provider_health("stock.pexels", False, f"download failed: {e}")
                return None

            if want_video:
                normalize_video(ctx, ctx.folder / out_rel)
            if _too_similar(ctx, ledger, ctx.folder / out_rel, f"pexels {asset_id}"):
                continue
            ctx.db.provider_health("stock.pexels", True)
            return Resolution(
                source="stock", id=asset_id, provider="pexels", license="royalty-free",
                path=out_rel, score=None, query=query[:200],
                media_type="video" if want_video else "image",
            )
        return None


def normalize_video(ctx: StageContext, path) -> None:
    """Transcode oversized stock footage down to the channel's output
    resolution. Raw 4K sources stall Remotion's frame extraction and slow
    ffmpeg renders; a proxy at plan size loses nothing (renders never
    upscale) and is dramatically cheaper to decode."""
    import subprocess
    from pathlib import Path

    path = Path(path)
    target_h = int(((ctx.cfg.get("output") or {}).get("height")) or 1080)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    try:
        height = int(probe.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return  # unreadable probe — leave the file as-is; validate will judge it
    if height <= target_h:
        return
    tmp = path.with_suffix(".norm.mp4")
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path),
         "-vf", f"scale=-2:{target_h}", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "22", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(tmp)],
        capture_output=True, text=True,
    )
    if proc.returncode == 0:
        tmp.replace(path)
    else:
        tmp.unlink(missing_ok=True)  # keep the original; renderer may still cope


# ---------------- ai image (budget-gated generation) ----------------


class AiImageAdapter:
    # A generator wants the whole description; it is a prompt, not a search.
    query_kind = "semantic"

    def resolve(
        self, ctx: StageContext, item: dict, query: str, source_cfg: dict,
        ledger: "Ledger | None" = None,
    ) -> Resolution | None:
        provider = str(source_cfg.get("provider") or "mock")
        style = str(source_cfg.get("style") or "")
        prompt = f"{query}. {style}".strip()
        if provider == "mock":
            return self._mock(ctx, item, query, prompt)
        if provider == "openai":
            return self._openai(ctx, item, query, prompt)
        ctx.db.provider_health(f"ai_image.{provider}", False,
                               f"ai_image provider '{provider}' not implemented")
        return None

    def _mock(self, ctx: StageContext, item: dict, query: str, prompt: str) -> Resolution | None:
        import re
        with budget_gate(ctx, stage=STAGE, provider="mock", operation="image.generate",
                         estimated_units=1, details={"query": query[:120]}):
            out_rel = f"clips/{item['id']}.jpg"
            text = re.sub(r"[^\w\s,.-]", "", query)[:90]
            wrapped = "\n".join(text[i:i + 45] for i in range(0, len(text), 45))
            res = ctx.cfg.get("output") or {}
            w, h = int(res.get("width", 1920)), int(res.get("height", 1080))
            esc = wrapped.replace("\\", "").replace("'", "").replace(":", "\\:").replace("%", "\\%")
            run_ffmpeg(STAGE, [
                "-f", "lavfi", "-i", f"color=c=0x14161c:s={w}x{h}",
                "-vf",
                ("drawbox=x=0:y=ih*0.42:w=iw:h=ih*0.16:color=0x000000@0.35:t=fill,"
                 f"drawtext=font='DejaVu Sans':fontsize={h // 22}:fontcolor=0xcbd2e0:"
                 f"x=(w-text_w)/2:y=(h-text_h)/2:text='{esc}'"),
                "-frames:v", "1", "-q:v", "3", str(ctx.folder / out_rel),
            ])
        ctx.db.provider_health("ai_image.mock", True)
        return Resolution(source="ai", id=None, provider="mock", license="own",
                          path=out_rel, score=None, query=query[:200], media_type="image")

    def _openai(self, ctx: StageContext, item: dict, query: str, prompt: str) -> Resolution | None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            ctx.db.provider_health("ai_image.openai", False, "OPENAI_API_KEY not set")
            return None
        with budget_gate(ctx, stage=STAGE, provider="openai", operation="image.generate",
                         estimated_units=1, details={"prompt": prompt[:200]}):
            import base64
            resp = httpx.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": "gpt-image-1", "prompt": prompt, "size": "1536x1024", "n": 1},
                timeout=300,
            )
            if resp.status_code != 200:
                ctx.db.provider_health("ai_image.openai", False,
                                       f"{resp.status_code}: {resp.text[:150]}")
                raise StageError(STAGE, f"openai image generation failed: {resp.text[:200]}")
            b64 = resp.json()["data"][0]["b64_json"]
            out_rel = f"clips/{item['id']}.png"
            (ctx.folder / out_rel).write_bytes(base64.b64decode(b64))
        ctx.db.provider_health("ai_image.openai", True)
        return Resolution(source="ai", id=None, provider="openai", license="own",
                          path=out_rel, score=None, query=query[:200], media_type="image")


ADAPTERS: dict[str, SourceAdapter] = {
    "library": LibraryAdapter(),
    "stock": PexelsAdapter(),
    "ai_image": AiImageAdapter(),
}


# ---------------- the used-asset ledger (D54) ----------------


def perceptual_hash(path: Any) -> int | None:
    """A 64-bit dHash of one frame, or None when it cannot be computed.

    Difference hash: scale to 9x8 grey, then one bit per horizontal neighbour
    pair. It survives re-encoding, letterboxing and colour grading — which is
    exactly the case that matters, two stock clips of the same drone pass sold
    by two contributors — and it is arithmetic, so the same file always hashes
    the same way. Video is sampled one second in, past the fades most clips
    open with.

    Never raises: a hash that cannot be computed is a missing OPINION about
    similarity, not a reason to fail a video.
    """
    import subprocess

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", "1", "-i", str(path),
         "-vf", "scale=9:8,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    pixels = proc.stdout
    if len(pixels) < 72:  # no frame a second in (a short clip or a still)
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path),
             "-vf", "scale=9:8,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"],
            capture_output=True,
        )
        pixels = proc.stdout
    if len(pixels) < 72:
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            left = pixels[row * 9 + col]
            right = pixels[row * 9 + col + 1]
            bits = (bits << 1) | int(left > right)
    return bits


class Ledger:
    """What this video has already put on screen.

    Per-beat resolution is independent by design (D12 is a chain per item), and
    that independence is what makes two adjacent beats about the same subject
    fetch the same clip — or, worse, the same library segment three times in
    eight minutes, which reads as a mistake rather than as a motif.

    Rebuilt from the plan rather than kept in a file of its own: the plan
    already records every resolved asset's provenance, so a worker killed
    mid-stage resumes with the ledger it had, and the folder stays the data
    plane of record (Principle 1).
    """

    def __init__(self, cfg: dict[str, Any] | None = None) -> None:
        dedup = (((cfg or {}).get("source_policy") or {}).get("visual") or {}).get("dedup") or {}
        # 0 = the whole video: a segment id is spent once, which is the
        # behaviour anyone would expect and the reason the default is not a
        # small window.
        self.window = int(dedup.get("reuse_window_items", 0) or 0)
        # 0 = off. Hamming distance between two 64-bit dHashes; ~6 catches the
        # same footage re-encoded or re-graded without catching two different
        # shots of the same subject.
        self.min_distance = int(dedup.get("min_hamming_distance", 0) or 0)
        self.entries: list[tuple[str, int | None]] = []

    @classmethod
    def from_plan(cls, plan: dict[str, Any], folder: Any, cfg: dict[str, Any] | None = None) -> "Ledger":
        ledger = cls(cfg)
        for item in plan["tracks"]["visual"]:
            asset = item.get("asset") or {}
            path = str(asset.get("path") or "")
            if not path:
                continue
            ledger.remember(asset, folder / path if ledger.min_distance else None)
        return ledger

    @staticmethod
    def key(asset: dict[str, Any]) -> str:
        return f"{asset.get('source')}:{asset.get('provider') or ''}:{asset.get('id') or ''}"

    def _recent(self) -> list[tuple[str, int | None]]:
        return self.entries if self.window <= 0 else self.entries[-self.window :]

    def blocked(self, source: str, provider: str | None, asset_id: str | None) -> bool:
        """This exact asset is already on screen, recently enough to notice."""
        if not asset_id:
            return False  # a generated image has no id and is never a repeat
        key = f"{source}:{provider or ''}:{asset_id}"
        return any(k == key for k, _h in self._recent())

    def too_similar(self, digest: int | None) -> int | None:
        """The closest recent hash within min_distance, or None if it is new
        enough. Returns the distance so the caller can say WHY in a log line."""
        if digest is None or self.min_distance <= 0:
            return None
        for _key, other in reversed(self._recent()):
            if other is None:
                continue
            distance = bin(digest ^ other).count("1")
            if distance < self.min_distance:
                return distance
        return None

    def remember(self, asset: dict[str, Any], path: Any = None) -> None:
        digest = perceptual_hash(path) if path is not None else None
        self.entries.append((self.key(asset), digest))


def _queries_for(adapter: SourceAdapter, intent: str, queries: list[str] | None) -> list[str]:
    """What this source should be asked, in order of preference.

    A semantic source gets the intent, whole. A keyword source gets the beat's
    own queries[] (D53) — all of them, tried in order, so a second phrasing is a
    retry WITHIN the source before the chain falls through to a worse one — or,
    for a v1.0 beat with none, one derived from the intent."""
    if getattr(adapter, "query_kind", "semantic") != "keyword":
        return [intent]
    return [q for q in (queries or []) if str(q).strip()] or [keywords_from_intent(intent)]


def resolve_item(
    ctx: StageContext,
    item: dict,
    query: str,
    chain: list[dict],
    queries: list[str] | None = None,
    ledger: Ledger | None = None,
) -> bool:
    """Walk the chain in order, stop at the first acceptable asset.
    Returns False only when the chain is exhausted (caller fails loud).

    `query` is the beat's visual_intent; `queries` its optional keyword
    alternates (beat sheet v1.1); `ledger` is what this video has already put
    on screen (D54)."""
    for source_cfg in chain:
        adapter = ADAPTERS.get(str(source_cfg.get("source")))
        if adapter is None:
            continue
        resolution = None
        for candidate in _queries_for(adapter, query, queries):
            resolution = _call_adapter(adapter, ctx, item, candidate, source_cfg, ledger)
            if resolution is not None:
                break
        if resolution is None:
            continue
        media_type = resolution.pop("media_type", "image")
        item["media_type"] = media_type
        item["asset"] = dict(resolution)
        if media_type == "image":
            item.setdefault("motion", {"type": "ken_burns", "direction": "in",
                                       "pan": "center", "strength": 0.12})
        else:
            item.pop("motion", None)
        ctx.db.asset_usage(
            ctx.video_id, str(item.get("beat_id") or ""),
            str(resolution["source"]), resolution.get("id"),
            resolution.get("license"), resolution.get("provider"),
        )
        if ledger is not None:
            ledger.remember(item["asset"], ctx.folder / str(item["asset"]["path"]))
        return True
    return False


def _call_adapter(
    adapter: SourceAdapter, ctx: StageContext, item: dict, query: str,
    source_cfg: dict, ledger: Ledger | None,
) -> Resolution | None:
    """Adapters take the ledger; a hand-written or third-party one written
    against the pre-D54 signature keeps working without it."""
    try:
        return adapter.resolve(ctx, item, query, source_cfg, ledger)
    except TypeError:
        return adapter.resolve(ctx, item, query, source_cfg)
