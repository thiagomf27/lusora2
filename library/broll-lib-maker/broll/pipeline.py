"""
pipeline.py — orchestration. Ties every piece together.

COLD PATH (cache miss): discover -> coarse rank -> download winners ->
  fine-tag exhaustively -> cut all segments -> dedup -> store clips + rows ->
  delete source.

HOT PATH (cache hit): library_search() -> vector search -> usage-aware rank.
  No GLM, no download. Milliseconds.
"""

from __future__ import annotations

import os
import re
import subprocess

from .schema import Segment, Candidate, default_license
from .storage import VectorIndex, ObjectStore
from .tagging import GLMClient, coarse_score, fine_tag_video, tag_image
from .ranking import rank_segments


# --------------------------------------------------------------------------- #
#  External helpers you plug in (kept as thin stubs)
# --------------------------------------------------------------------------- #
_EMBEDDERS: dict = {}   # model name -> loaded SentenceTransformer


def embed_text(text: str, model: str | None = None) -> list[float]:
    """Text embedding for tags/caption/query. Model is per-profile —
    vectors from different models are incompatible, so a gallery is only
    searchable with the model that built it (None = the default model)."""
    from sentence_transformers import SentenceTransformer
    from .profiles import DEFAULT_EMBED_MODEL
    name = model or os.environ.get("BROLL_EMBED_MODEL", DEFAULT_EMBED_MODEL)
    if name not in _EMBEDDERS:
        _EMBEDDERS[name] = SentenceTransformer(name)
    return _EMBEDDERS[name].encode(text).tolist()


# discovery lives in discover.py (YouTube Data API + storyboards + stock)
from .discover import discover, attach_storyboards  # noqa: E402


# download resolution cap, applied to the SHORTER dimension ("res:N") — a
# hard height<=N filter matches nothing on vertical Shorts, where height is
# the long side (e.g. 1080x1920)
MAX_RES = int(os.environ.get("BROLL_MAX_RES", "480"))

# segments shorter than this are never cut/stored — too short to use as
# b-roll. There is deliberately NO max cap at ingest: length is a
# search-time filter (max_duration), not an ingest-time loss of footage.
MIN_CLIP_S = float(os.environ.get("BROLL_MIN_CLIP_S", "4"))


def download_segment_source_with_info(
        video_id: str, out_dir: str = "/tmp/broll_src",
        max_res: int | None = None) -> tuple[str, dict]:
    """
    Download ONE winner at low res and return (path, yt-dlp info dict).
    Because we pre-selected, volume is tiny, so cookies + random sleep are
    plenty against rate limits.
    """
    import yt_dlp
    from .discover import ytdlp_network_opts
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{video_id}.mp4")
    opts = {
        "format": "bv*+ba/b",
        "format_sort": [f"res:{max_res or MAX_RES}", "ext:mp4:m4a"],
        "merge_output_format": "mp4",
        "outtmpl": path,
        "quiet": True,
        "sleep_interval": 5,
        "max_sleep_interval": 12,        # random human-like delay
        # $YTDLP_PROXY (required); cookies only if explicitly opted in via
        # $BROLL_COOKIES_BROWSER — proxy and identity travel together
        **ytdlp_network_opts(),
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://youtu.be/{video_id}", download=True)
    return path, dict(info or {})


def download_segment_source(video_id: str, out_dir: str = "/tmp/broll_src") -> str:
    return download_segment_source_with_info(video_id, out_dir)[0]


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi"}


def is_image_url(url: str) -> bool:
    """Cheap media-kind sniff for ingest inputs (URLs, file:// spools,
    local paths): image file extension = image, anything else = video."""
    from urllib.parse import urlparse
    path = urlparse(url.strip()).path
    return os.path.splitext(path)[1].lower() in IMAGE_EXTS


def is_video_file_url(url: str) -> bool:
    """Video FILE extension (an uploaded/local file, not a YouTube link)."""
    from urllib.parse import urlparse
    path = urlparse(url.strip()).path
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


def file_sha256(path: str, prefix_len: int = 16) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:prefix_len]


_YT_ID_RE = re.compile(
    r"(?:v=|/shorts/|/embed/|/live/|youtu\.be/)([A-Za-z0-9_-]{11})(?=[?&#/]|$)")


def parse_youtube_id(url_or_id: str) -> str:
    """Accept any YouTube URL form (watch?v=, youtu.be/, shorts/, embed/,
    live/) or a bare 11-char video id."""
    s = url_or_id.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = _YT_ID_RE.search(s)
    if not m:
        raise ValueError(f"could not extract a YouTube video id from {s!r}")
    return m.group(1)


def cut_clip(src_path: str, start: float, end: float, out_path: str) -> str:
    """ffmpeg cut. Stream-copy is fast; re-encode if you need frame-accurate cuts."""
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start), "-to", str(end),
         "-i", src_path, "-c", "copy", out_path],
        check=True, capture_output=True,
    )
    return out_path


def grab_mid_frame(clip_path: str):
    """
    Mid-clip frame as a PIL Image (or None) — one decode shared by the
    perceptual hash and the stored thumbnail. Uses ffmpeg, not OpenCV:
    stream-copied cuts often start mid-GOP, where cv2's ratio-seek fails
    to decode but ffmpeg recovers from the previous keyframe.
    """
    import io
    try:
        from .tagging import _video_duration
        mid = max(_video_duration(clip_path) / 2, 0.0)
        out = subprocess.run(
            ["ffmpeg", "-ss", str(mid), "-i", clip_path, "-frames:v", "1",
             "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
            capture_output=True, check=True,
        )
        if not out.stdout:
            return None
        from PIL import Image
        return Image.open(io.BytesIO(out.stdout)).convert("RGB")
    except Exception:
        return None


def _phash_of(img) -> str | None:
    try:
        import imagehash
        return str(imagehash.phash(img)) if img is not None else None
    except Exception:
        return None


def keyframe_phash(clip_path: str) -> str | None:
    """Perceptual hash of a mid-clip frame, for near-dup detection."""
    return _phash_of(grab_mid_frame(clip_path))


# --------------------------------------------------------------------------- #
#  The library-facing engine
# --------------------------------------------------------------------------- #
class BrollEngine:
    def __init__(self, index: VectorIndex, store: ObjectStore, glm: GLMClient,
                 min_cache_hits: int = 6, embed_model: str | None = None):
        self.index, self.store, self.glm = index, store, glm
        self.min_cache_hits = min_cache_hits
        self.embed_model = embed_model    # per-profile; None = default model

    def _embed(self, text: str) -> list[float]:
        # call through the module global so tests can monkeypatch embed_text
        return embed_text(text, model=self.embed_model)

    # ---------- HOT PATH ----------
    def library_search(self, query: str, project_id: str | None = None,
                       channel_id: str | None = None, include_global: bool = True,
                       top_k: int = 24,
                       filters: dict | None = None) -> list[tuple[Segment, float]]:
        """`filters` are index-level WHERE filters: tags, niches,
        source_channel_id, min_duration, max_duration, created_after,
        created_before (see VectorIndex.search)."""
        q = self._embed(query)
        hits = self.index.search(q, top_k=top_k * 2, channel_id=channel_id,
                                 include_global=include_global,
                                 **(filters or {}))
        return rank_segments(hits, current_project_id=project_id,
                             channel_id=channel_id)[:top_k]

    # ---------- SHARED CORE: tag a video file -> cut -> dedup -> store ----------
    def _tag_cut_store(self, src_path: str, video_id: str, source: str,
                       channel_id: str | None = None,
                       niches: list[str] | None = None,
                       keep_source: bool = False,
                       source_channel_id: str | None = None,
                       source_channel_name: str | None = None,
                       on_progress=None) -> list[Segment]:
        """
        The heart of both paths. Given a LOCAL video file already on disk, run
        the exhaustive fine pass, cut every segment, dedup, and store. Used by
        both acquire() (downloaded YouTube/stock) and ingest_video() (uploads).
        `on_progress(stage, fraction)` gets "tagging" / "cutting" / "storing".
        """
        cb = on_progress or (lambda stage, frac: None)
        new_segments: list[Segment] = []
        try:
            cb("tagging", 0.0)
            segs = fine_tag_video(self.glm, src_path, video_id, source)  # EXHAUSTIVE
            segs = [s for s in segs if s.end - s.start >= MIN_CLIP_S]
            cb("tagging", 1.0)
            for i, seg in enumerate(segs):
                cb("cutting", i / max(len(segs), 1))
                seg.channel_id = channel_id
                seg.niches = list(niches or [])
                seg.source_channel_id = source_channel_id
                seg.source_channel_name = source_channel_name
                seg.license = default_license(source)
                self._ingest(seg, src_path)
                new_segments.append(seg)
            cb("storing", 1.0)
        finally:
            if not keep_source and os.path.exists(src_path):
                os.remove(src_path)   # clips are what we keep, not the source
        return new_segments

    # ---------- COLD PATH: search found too little -> go get more ----------
    def acquire(self, query: str, max_download: int = 3,
                storyboard_shortlist: int = 5,
                channel_id: str | None = None) -> list[Segment]:
        cands = discover(query)

        # Tier A: cheap thumbnail-only score for ALL candidates.
        for c in cands:
            coarse_score(self.glm, c, query)
        shortlist = sorted(cands, key=lambda c: c.coarse_score,
                           reverse=True)[:storyboard_shortlist]

        # Tier B: storyboards for the shortlist only, re-score with frames.
        attach_storyboards(shortlist, top_n=storyboard_shortlist)
        for c in shortlist:
            if c.storyboard_uri:
                coarse_score(self.glm, c, query)

        # never re-download a video the library already has segments for
        ranked = sorted(shortlist, key=lambda c: c.coarse_score, reverse=True)
        winners = [c for c in ranked
                   if not self.index.has_video(c.video_id)][:max_download]

        new_segments: list[Segment] = []
        for c in winners:
            src = download_segment_source(c.video_id)
            # discovered clips are GLOBAL (channel_id=None) so every channel
            # shares them; only user uploads are channel-scoped.
            new_segments += self._tag_cut_store(
                src, c.video_id, c.source, channel_id=None,
                source_channel_id=c.source_channel_id,
                source_channel_name=c.source_channel_name)
        return new_segments

    # ---------- DIRECT PATH: user sends a link -> clip exactly that video ----
    def ingest_url(self, url_or_id: str, channel_id: str | None = None,
                   niches: list[str] | None = None, force: bool = False,
                   max_res: int | None = None,
                   on_progress=None) -> list[Segment]:
        """
        Clip ONE specific YouTube video by link. No discovery, no coarse
        ranking — straight to download -> fine-tag -> cut -> dedup -> store.
        Skips videos already in the library unless force=True.
        `on_progress(stage, fraction)` gets "downloading" then the
        _tag_cut_store stages — this is what the job queue renders.
        """
        cb = on_progress or (lambda stage, frac: None)
        vid = parse_youtube_id(url_or_id)
        if not force and self.index.has_video(vid):
            print(f"[ingest] {vid} is already in the library — skipping "
                  f"(force=True to re-ingest)")
            return []
        cb("downloading", 0.0)
        src, info = download_segment_source_with_info(vid, max_res=max_res)
        cb("downloading", 1.0)
        return self._tag_cut_store(
            src, vid, source="youtube", channel_id=channel_id, niches=niches,
            source_channel_id=info.get("channel_id"),
            source_channel_name=info.get("channel") or info.get("uploader"),
            on_progress=cb)

    # ---------- UPLOAD PATH: user sends a video -> store in the db ----------
    def ingest_video(self, local_path: str, channel_id: str | None = None,
                     niches: list[str] | None = None, video_id: str | None = None,
                     keep_source: bool = False, force: bool = False,
                     on_progress=None) -> list[Segment]:
        """
        Ingest a user-provided video file into the library. Same exhaustive
        tagging as the cold path, but no discovery/download. Tag with the owning
        channel so it can be scoped later (your own footage stays yours, but is
        still searchable). Returns the segments created.

        When the caller passes an explicit `video_id` (the upload job path
        uses the content hash), a video already in the library is skipped
        like ingest_url does — re-tagging identical footage burns GLM calls
        just to produce all-duplicate rows. No `video_id` = old behavior,
        always ingest.
        """
        if not os.path.exists(local_path):
            raise FileNotFoundError(local_path)
        if video_id and not force and self.index.has_video(video_id):
            print(f"[ingest] {video_id} is already in the library — skipping "
                  f"(force=True to re-ingest)")
            return []
        vid = video_id or f"upload:{os.path.basename(local_path)}"
        # work on a copy so we don't delete the user's original unless asked
        import shutil
        work = f"/tmp/{Segment().id}_{os.path.basename(local_path)}"
        shutil.copy(local_path, work)
        return self._tag_cut_store(work, vid, source="upload",
                                   channel_id=channel_id, niches=niches,
                                   keep_source=keep_source,
                                   on_progress=on_progress)

    # ---------- IMAGE PATH: one still image -> one segment ----------
    def ingest_image(self, local_path: str, channel_id: str | None = None,
                     niches: list[str] | None = None, source: str = "upload",
                     image_id: str | None = None, keep_source: bool = True,
                     on_progress=None) -> list[Segment]:
        """
        Ingest ONE image file as a single segment. The branch happens here,
        before any video machinery: no download-resolution logic, no
        clipping, no chunking — one GLM image call, then the same
        embed -> dedup -> store path as clips. The stored object is the
        image itself; the thumbnail is a resized copy. Returns [segment]
        (which may be a duplicate_of link carrying no bytes).
        `keep_source=False` deletes the input file on success — for spooled
        uploads; user-owned files default to being left alone.
        """
        cb = on_progress or (lambda stage, frac: None)
        if not os.path.exists(local_path):
            raise FileNotFoundError(local_path)
        from PIL import Image
        img = Image.open(local_path)
        img.load()                       # fail loudly on a broken file

        cb("tagging", 0.0)
        tags, caption, confidence = tag_image(self.glm, local_path)
        cb("tagging", 1.0)

        seg = Segment(
            video_id=image_id or f"img:{file_sha256(local_path)}", source=source,
            media_type="image", tags=tags, caption=caption,
            confidence=confidence, width=img.width, height=img.height,
            channel_id=channel_id, niches=list(niches or []),
            license=default_license(source))
        seg.phash = _phash_of(img.convert("RGB"))
        seg.embedding = self._embed(" ".join(tags) + " " + caption)

        # same dedup as clips: re-uploading a near-identical image links to
        # the canonical row instead of storing bytes again
        dupe = self.index.find_near_duplicate(seg)
        if dupe:
            seg.duplicate_of = dupe.id
            self.index.upsert(seg)
        else:
            ext = os.path.splitext(local_path)[1].lower() or ".jpg"
            seg.clip_uri = self.store.put(local_path, f"images/{seg.id}{ext}")
            thumb = img.convert("RGB")
            thumb.thumbnail((480, 480))
            thumb_local = f"/tmp/{seg.id}.jpg"
            thumb.save(thumb_local, "JPEG", quality=85)
            seg.thumb_uri = self.store.put(thumb_local, f"thumbs/{seg.id}.jpg")
            os.remove(thumb_local)
            self.index.upsert(seg)
        cb("storing", 1.0)
        if not keep_source:
            os.remove(local_path)   # only on success, so a retry can re-read
        return [seg]

    def ingest_image_url(self, url: str, channel_id: str | None = None,
                         niches: list[str] | None = None,
                         on_progress=None) -> list[Segment]:
        """Download ONE image by URL (through the proxy — fail-loud like
        every other network touchpoint) and ingest it."""
        import uuid
        import requests
        from .discover import _requests_proxies
        cb = on_progress or (lambda stage, frac: None)
        cb("downloading", 0.0)
        r = requests.get(url, timeout=60, proxies=_requests_proxies(require=True))
        r.raise_for_status()
        from urllib.parse import urlparse
        ext = os.path.splitext(urlparse(url).path)[1].lower() or ".jpg"
        tmp = f"/tmp/broll_img_{uuid.uuid4().hex}{ext}"
        with open(tmp, "wb") as f:
            f.write(r.content)
        cb("downloading", 1.0)
        try:
            return self.ingest_image(tmp, channel_id=channel_id,
                                     niches=niches, source="image_url",
                                     on_progress=cb)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def _ingest(self, seg: Segment, src_path: str) -> None:
        # cut the clip
        clip_local = f"/tmp/{seg.id}.mp4"
        cut_clip(src_path, seg.start, seg.end, clip_local)
        frame = grab_mid_frame(clip_local)      # one decode: phash + thumbnail
        seg.phash = _phash_of(frame)
        seg.embedding = self._embed(" ".join(seg.tags) + " " + seg.caption)

        # dedup: same shot across videos -> link, don't duplicate bytes
        dupe = self.index.find_near_duplicate(seg)
        if dupe:
            seg.duplicate_of = dupe.id
            self.index.upsert(seg)      # row points to canonical; skip storing bytes
            os.remove(clip_local)
            return

        # store bytes in object storage, pointer in the row
        key = f"clips/{seg.id}.mp4"
        seg.clip_uri = self.store.put(clip_local, key)
        if frame is not None:
            thumb_local = f"/tmp/{seg.id}.jpg"
            frame.convert("RGB").save(thumb_local, "JPEG", quality=85)
            seg.thumb_uri = self.store.put(thumb_local, f"thumbs/{seg.id}.jpg")
            os.remove(thumb_local)
        os.remove(clip_local)
        self.index.upsert(seg)

    # ---------- usage tracking (per-channel) ----------
    def mark_used(self, seg_id: str, project_id: str,
                  channel_id: str | None = None) -> None:
        import time
        seg = self.index.get(seg_id)
        if not seg:
            return
        # count usage on the canonical clip if this is a dupe
        target = self.index.get(seg.duplicate_of) if seg.is_duplicate else seg
        target.usage_count += 1
        if channel_id:
            target.usage_by_channel[channel_id] = \
                target.usage_by_channel.get(channel_id, 0) + 1
        target.usage_by_project[project_id] = \
            target.usage_by_project.get(project_id, 0) + 1
        target.last_used = time.time()
        self.index.upsert(target)

    # ---------- combined entry point for the library page ----------
    def search_or_acquire(self, query: str, project_id: str | None = None,
                          channel_id: str | None = None, include_global: bool = True,
                          top_k: int = 24) -> list[tuple[Segment, float]]:
        """
        The one call your library page makes. Serves from cache; only runs the
        expensive cold path when the cache is thin, then re-reads from cache.
        """
        hits = self.library_search(query, project_id, channel_id,
                                   include_global, top_k)
        if len(hits) >= self.min_cache_hits:
            return hits                       # cache hit, ~free
        self.acquire(query, channel_id=channel_id)   # cold path writes back
        return self.library_search(query, project_id, channel_id,
                                   include_global, top_k)
