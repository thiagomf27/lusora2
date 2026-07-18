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
    def resolve(self, ctx: StageContext, item: dict, query: str, source_cfg: dict) -> Resolution | None: ...


# ---------------- library (broll-lib-maker over HTTP, D11) ----------------


class LibraryAdapter:
    def resolve(self, ctx: StageContext, item: dict, query: str, source_cfg: dict) -> Resolution | None:
        base = ctx.config.library_api_url if ctx.config else os.environ.get("LIBRARY_API_URL", "")
        if not base:
            ctx.db.provider_health("library", False, "LIBRARY_API_URL not set")
            return None
        params: dict[str, Any] = {"query": query, "limit": 5}
        for key in ("tags", "niches", "media_types", "licenses"):
            if source_cfg.get(key):
                params[key] = ",".join(source_cfg[key])
        if source_cfg.get("profile"):
            params["profile"] = source_cfg["profile"]
        if source_cfg.get("include_global") is not None:
            params["include_global"] = str(bool(source_cfg["include_global"])).lower()
        params["channel_id"] = ctx.channel_id

        try:
            resp = httpx.get(f"{base}/search", params=params, timeout=30)
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except httpx.HTTPError as e:
            ctx.db.provider_health("library", False, f"search failed: {e}")
            return None

        min_score = float(source_cfg.get("min_score", 0.0))
        best = results[0] if results else None
        if not best or float(best.get("score", 0)) < min_score:
            return None  # honest fallthrough — the library always returns *something*

        seg_id = str(best.get("id") or best.get("segment_id"))
        ext = "mp4" if best.get("media_type") == "video_clip" else "jpg"
        out_rel = f"clips/{item['id']}.{ext}"
        try:
            clip = httpx.get(f"{base}/segments/{seg_id}/download", timeout=120)
            clip.raise_for_status()
            (ctx.folder / out_rel).write_bytes(clip.content)
            httpx.post(f"{base}/segments/{seg_id}/mark_used",
                       json={"channel_id": ctx.channel_id, "project_id": ctx.video_id}, timeout=30)
        except httpx.HTTPError as e:
            ctx.db.provider_health("library", False, f"acquire failed for {seg_id}: {e}")
            return None

        ctx.db.provider_health("library", True)
        return Resolution(
            source="library", id=seg_id, provider=None,
            license=best.get("license"), path=out_rel,
            score=float(best.get("score", 0)), query=query[:200],
            media_type="video" if ext == "mp4" else "image",
        )


# ---------------- stock (pexels, cached searches) ----------------


class PexelsAdapter:
    def resolve(self, ctx: StageContext, item: dict, query: str, source_cfg: dict) -> Resolution | None:
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

        try:
            if want_video:
                hits = data.get("videos") or []
                if not hits:
                    return None
                files = sorted(hits[0]["video_files"], key=lambda f: f.get("width") or 0, reverse=True)
                dl_url = files[0]["link"]
                asset_id = str(hits[0]["id"])
                ext = "mp4"
            else:
                hits = data.get("photos") or []
                if not hits:
                    return None
                dl_url = hits[0]["src"]["large2x"]
                asset_id = str(hits[0]["id"])
                ext = "jpg"
            out_rel = f"clips/{item['id']}.{ext}"
            with httpx.stream("GET", dl_url, timeout=180, follow_redirects=True) as resp:
                resp.raise_for_status()
                with open(ctx.folder / out_rel, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
        except (httpx.HTTPError, KeyError, IndexError) as e:
            ctx.db.provider_health("stock.pexels", False, f"download failed: {e}")
            return None

        ctx.db.provider_health("stock.pexels", True)
        return Resolution(
            source="stock", id=asset_id, provider="pexels", license="stock-licensed",
            path=out_rel, score=None, query=query[:200],
            media_type="video" if ext == "mp4" else "image",
        )


# ---------------- ai image (budget-gated generation) ----------------


class AiImageAdapter:
    def resolve(self, ctx: StageContext, item: dict, query: str, source_cfg: dict) -> Resolution | None:
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
        return Resolution(source="ai", id=None, provider="mock", license="owned",
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
        return Resolution(source="ai", id=None, provider="openai", license="owned",
                          path=out_rel, score=None, query=query[:200], media_type="image")


ADAPTERS: dict[str, SourceAdapter] = {
    "library": LibraryAdapter(),
    "stock": PexelsAdapter(),
    "ai_image": AiImageAdapter(),
}


def resolve_item(ctx: StageContext, item: dict, query: str, chain: list[dict]) -> bool:
    """Walk the chain in order, stop at the first acceptable asset.
    Returns False only when the chain is exhausted (caller fails loud)."""
    for source_cfg in chain:
        adapter = ADAPTERS.get(str(source_cfg.get("source")))
        if adapter is None:
            continue
        resolution = adapter.resolve(ctx, item, query, source_cfg)
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
        return True
    return False
