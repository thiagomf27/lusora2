"""
tagging.py — GLM vision passes.

COARSE (pre-download): score a Candidate from cheap signals — thumbnail,
  optional yt-dlp storyboard mosaic, title/description. Returns 0..1 plus
  rough time ranges when a storyboard was available.

FINE (post-download): one exhaustive pass over the whole video. Returns EVERY
  usable b-roll segment with precise start/end, tags, caption, confidence.

Both passes go through one OpenAI-compatible `GLMClient`, so local vLLM and
hosted Z.ai/FlashX are interchangeable: only base_url + model + api_key change.

JSON contracts (what the prompts demand and the parsers enforce):

  COARSE_SCHEMA = {"score": float 0..1,
                   "rough_ranges": [[start_sec, end_sec], ...]}   # [] if unknown

  FINE_SCHEMA   = [{"start": float, "end": float,
                    "tags": [str, ...], "caption": str,
                    "confidence": float 0..1}, ...]
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess

from .schema import Segment, Candidate


# --------------------------------------------------------------------------- #
#  Client — OpenAI-compatible; local vLLM or hosted Z.ai, same code
# --------------------------------------------------------------------------- #
DEFAULT_BASE_URL = os.environ.get("GLM_BASE_URL", "https://api.z.ai/api/paas/v4")
DEFAULT_MODEL = os.environ.get("GLM_MODEL", "GLM-4.6V-Flash")


class GLMClient:
    """
    Thin wrapper over the OpenAI SDK. api_key falls back to $GLM_API_KEY /
    $ZAI_API_KEY, then "EMPTY" (what a keyless local vLLM expects), so
    constructing one never fails — only calling without a key does.
    """

    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, timeout: float = 300.0):
        self.base_url = base_url or DEFAULT_BASE_URL
        self.model = model or DEFAULT_MODEL
        self.api_key = (api_key or os.environ.get("GLM_API_KEY")
                        or os.environ.get("ZAI_API_KEY") or "EMPTY")
        self.timeout = timeout
        self._client = None   # lazy: keep import/construct free of network

    def _sdk(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key,
                                  timeout=self.timeout)
        return self._client

    # pace requests: the hosted Flash tier both rate-limits per-key bursts
    # (1302) and sheds load when the shared model is swamped (1305)
    MIN_INTERVAL_S = float(os.environ.get("GLM_MIN_INTERVAL_S", "3"))
    MAX_ATTEMPTS = int(os.environ.get("GLM_MAX_ATTEMPTS", "7"))
    _last_call = 0.0

    def complete(self, messages: list[dict], max_tokens: int = 4000,
                 temperature: float = 0.1) -> str:
        import random
        import time
        from openai import APIStatusError

        delay = 5.0
        for attempt in range(self.MAX_ATTEMPTS):
            gap = self.MIN_INTERVAL_S - (time.time() - GLMClient._last_call)
            if gap > 0:
                time.sleep(gap)
            GLMClient._last_call = time.time()
            try:
                resp = self._sdk().chat.completions.create(
                    model=self.model, messages=messages,
                    max_tokens=max_tokens, temperature=temperature,
                )
                return resp.choices[0].message.content or ""
            except APIStatusError as e:
                retryable = e.status_code in (429, 500, 502, 503)
                if not retryable or attempt == self.MAX_ATTEMPTS - 1:
                    raise
                wait = delay * (1 + random.random() * 0.5)   # jitter
                retry_after = (e.response.headers.get("retry-after")
                               if e.response is not None else None)
                if retry_after:
                    try:
                        wait = max(wait, float(retry_after))
                    except ValueError:
                        pass
                time.sleep(min(wait, 120.0))
                delay *= 2
        raise RuntimeError("unreachable")


# --------------------------------------------------------------------------- #
#  Robust JSON extraction — GLM wraps JSON in prose/fences/<think> sometimes
# --------------------------------------------------------------------------- #
def _extract_json(text: str):
    """Pull the first JSON object/array out of a model reply, or raise."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"```(?:json)?", "", text).strip()
    # fast path
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # find the outermost {...} or [...] substring
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start = text.find(open_c)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == open_c:
                depth += 1
            elif text[i] == close_c:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError(f"no JSON found in model reply: {text[:300]!r}")


_START_KEYS = ("start", "start_second", "start_time", "begin")
_END_KEYS = ("end", "end_second", "end_time")


def _salvage_objects(text: str) -> list[dict]:
    """
    Last resort for TRUNCATED replies (max_tokens hit mid-JSON): scan for
    every balanced, parseable {...} that looks like a segment (has start+end
    keys) and return those — complete objects survive even when the array
    around them was cut off.
    """
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"```(?:json)?", "", text)
    objs: list[dict] = []
    i, n = 0, len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth, in_str, esc, end_j = 0, False, False, -1
        for j in range(i, n):
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end_j = j
                    break
        if end_j == -1:       # unbalanced tail = the truncation point;
            i += 1            # step inside it to find nested complete objects
            continue
        try:
            obj = json.loads(text[i:end_j + 1])
        except json.JSONDecodeError:
            obj = None
        if (isinstance(obj, dict) and any(k in obj for k in _START_KEYS)
                and any(k in obj for k in _END_KEYS)):
            objs.append(obj)
            i = end_j + 1     # past this object
        else:
            i += 1            # wrapper/non-segment: descend into it
    return objs


def _clamp(x, lo=0.0, hi=1.0) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except (TypeError, ValueError):
        return lo


# --------------------------------------------------------------------------- #
#  COARSE pass — thumbnail (+ optional storyboard) -> score, rough ranges
# --------------------------------------------------------------------------- #
_COARSE_SYSTEM = (
    "You rate how likely a video is to contain usable B-roll footage for a "
    "search query, from its thumbnail, optional storyboard frame-grid, and "
    "title/description. B-roll means clean footage OF the subject itself — "
    "not talking heads, slideshows, text overlays, or reaction content. "
    "Respond with ONLY a JSON object, no prose, no markdown fences:\n"
    '{"score": <float 0.0-1.0>, "rough_ranges": [[start_seconds, end_seconds], ...]}\n'
    "score: 0.0 = certainly no usable footage of the query subject, "
    "1.0 = certainly excellent footage. "
    "rough_ranges: approximate times where the subject appears, ONLY if a "
    "storyboard grid lets you estimate them; otherwise []."
)


def coarse_score(client: GLMClient, cand: Candidate, query: str) -> float:
    """
    Score one candidate 0..1 for `query`. Mutates cand.coarse_score (and
    cand.rough_ranges when a storyboard let the model guess times).
    Cheap signals only — nothing here downloads video bytes.
    """
    content: list[dict] = []
    text = (f"Search query: {query!r}\n"
            f"Video title: {cand.title!r}\n"
            f"Description: {cand.description[:500]!r}")
    if cand.thumb_uri:
        content.append({"type": "image_url", "image_url": {"url": cand.thumb_uri}})
        text += "\nImage 1 is the video thumbnail."
    if cand.storyboard_uri:
        content.append({"type": "image_url",
                        "image_url": {"url": cand.storyboard_uri}})
        text += ("\nThe last image is a storyboard: a grid of frames sampled "
                 "left-to-right, top-to-bottom, evenly across the whole video.")
    content.append({"type": "text", "text": text})

    try:
        reply = client.complete(
            [{"role": "system", "content": _COARSE_SYSTEM},
             {"role": "user", "content": content}],
            max_tokens=500,
        )
        data = _extract_json(reply)
    except Exception as e:
        print(f"[coarse] {cand.video_id}: scoring failed ({e}); score=0")
        cand.coarse_score = 0.0
        return 0.0

    cand.coarse_score = _clamp(data.get("score", 0.0))
    ranges = data.get("rough_ranges") or []
    cand.rough_ranges = [
        (float(r[0]), float(r[1]))
        for r in ranges
        if isinstance(r, (list, tuple)) and len(r) == 2
    ]
    return cand.coarse_score


# --------------------------------------------------------------------------- #
#  IMAGE pass — one still image -> tags/caption/confidence, one call
# --------------------------------------------------------------------------- #
_IMAGE_INSTRUCTIONS = (
    "Describe this image as a B-roll library entry. Respond with ONLY a "
    "JSON object, no prose, no markdown fences:\n"
    '{"tags": [3-8 lowercase keywords: subject, action, setting], '
    '"caption": "<one factual sentence>", '
    '"confidence": <float 0.0-1.0: how certain this is clean usable '
    "B-roll — exclude memes, screenshots, text graphics>}"
)


def _image_data_uri(path: str, max_px: int = 1280) -> str:
    """Model-ready inline image: the endpoint rejects remote URLs (400 code
    1210), and downscaling keeps the request small. The ORIGINAL is what
    gets stored."""
    import io
    from PIL import Image
    img = Image.open(path)
    img = img.convert("RGB")
    img.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def tag_image(client: GLMClient, path: str) -> tuple[list[str], str, float]:
    """One GLM call on a LOCAL image file -> (tags, caption, confidence).
    Instructions ride in the user turn like the fine pass — same model,
    same habit of ignoring the system role with media input."""
    content = [
        {"type": "image_url", "image_url": {"url": _image_data_uri(path)}},
        {"type": "text", "text": _IMAGE_INSTRUCTIONS},
    ]
    reply = client.complete([{"role": "user", "content": content}],
                            max_tokens=500)
    data = _extract_json(reply)
    if not isinstance(data, dict):
        raise ValueError(f"expected a JSON object from tag_image, "
                         f"got {type(data).__name__}")
    tags = [str(t).lower() for t in _field(data, "tags", "keywords",
                                           default=[]) or []
            if str(t).strip()]
    caption = str(_field(data, "caption", "description", "desc",
                         default="")).strip()
    return tags, caption, _clamp(_field(data, "confidence", "score",
                                        default=0.5))


# --------------------------------------------------------------------------- #
#  FINE pass — the whole video -> every usable segment, exhaustively
# --------------------------------------------------------------------------- #
# NOTE (tuned against GLM-4.6V-Flash): with video input the model IGNORES the
# system role and defaults to per-second dense captioning. The instructions
# must be in the USER turn, after the video, and must say "segment = one
# continuous shot" with a multi-shot example — that snaps it out of
# second-by-second mode and onto the exact key names.
_FINE_INSTRUCTIONS = """Segment this video into B-roll library entries.

A segment = one CONTINUOUS SHOT (camera cut to camera cut). This video may be \
a single shot — then return exactly one segment covering it. Do NOT describe \
the action second-by-second; do NOT create a new segment just because time \
passed. If one unbroken shot runs longer than 20 seconds, cut it at a natural \
pause. Be exhaustive: cover every usable shot in the video.

Return ONLY a JSON array. Each element has EXACTLY these keys:
"start" (number, seconds), "end" (number, seconds), "tags" (array of 3-8 \
lowercase keywords: subject, action, setting), "caption" (one factual \
sentence), "confidence" (number 0.0-1.0: how certain this is clean usable \
B-roll).

Example output for a two-shot video:
[{"start": 0.0, "end": 14.5, "tags": ["lion", "walking", "dirt road", \
"savanna"], "caption": "A male lion walks slowly along a dirt road.", \
"confidence": 0.9},
{"start": 14.5, "end": 21.0, "tags": ["lion", "drinking", "waterhole"], \
"caption": "A lioness drinks at a waterhole.", "confidence": 0.85}]

{context} Exclude talking heads, title cards, transitions; return [] if \
nothing is usable. Output the JSON array only."""

# hosted endpoints cap request size; re-encode down before base64 if needed
_MAX_VIDEO_MB = float(os.environ.get("GLM_MAX_VIDEO_MB", "18"))

# reply-token budget for the fine pass; the ceiling that truncated replies on
# long videos. Chunking (below) is the structural fix — this is the floor.
_FINE_MAX_TOKENS = int(os.environ.get("GLM_FINE_MAX_TOKENS", "12000"))

# videos longer than ~1 chunk are tagged in overlapping chunks so each reply
# stays far under the token ceiling; overlap lets the merge step re-join
# shots that straddle a boundary
_CHUNK_S = float(os.environ.get("GLM_CHUNK_S", "240"))
_CHUNK_OVERLAP_S = float(os.environ.get("GLM_CHUNK_OVERLAP_S", "12"))

# any native-pass segment longer than this gets ONE refinement call: the span
# is re-tagged as a standalone clip. Multiple shots back -> splice them in;
# one segment back -> the long take is confirmed and kept as-is (no cap on
# stored duration). One recursive level only.
_REFINE_TRIGGER_S = float(os.environ.get("GLM_REFINE_TRIGGER_S", "18"))

# unreported stretches longer than this get ONE re-tag call before refinement
# (chunk replies sometimes just skip footage); interviews/talking heads come
# back empty, which is correct. 0 disables.
_GAPFILL_MIN_S = float(os.environ.get("GLM_GAPFILL_MIN_S", "45"))


def _video_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def _shrink_for_upload(path: str, max_mb: float) -> str:
    """Re-encode small enough to send inline; the ORIGINAL is what gets cut."""
    if os.path.getsize(path) <= max_mb * 1024 * 1024:
        return path
    small = f"{path}.glm.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-vf", "scale=-2:360,fps=8",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-an", small],
        check=True, capture_output=True,
    )
    return small


def _video_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        return "data:video/mp4;base64," + base64.b64encode(f.read()).decode()


def _sample_frames(path: str, duration: float, max_frames: int = 32) -> list[tuple[float, str]]:
    """Fallback when the endpoint can't take video: (timestamp, jpeg data URI)."""
    step = max(duration / max_frames, 1.0)
    frames = []
    t = step / 2
    while t < duration:
        out = subprocess.run(
            ["ffmpeg", "-ss", str(t), "-i", path, "-frames:v", "1",
             "-vf", "scale=-2:336", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
            capture_output=True, check=True,
        )
        uri = "data:image/jpeg;base64," + base64.b64encode(out.stdout).decode()
        frames.append((round(t, 1), uri))
        t += step
    return frames


def _field(item: dict, *names, default=None):
    """First present key among aliases — GLM likes to rename fields."""
    for n in names:
        if n in item:
            return item[n]
    return default


def _parse_segments(data, video_id: str, source: str,
                    duration: float) -> list[Segment]:
    if isinstance(data, dict):          # model wrapped the array in an object
        for v in data.values():
            if isinstance(v, list):
                data = v
                break
    segs: list[Segment] = []
    if not isinstance(data, list):
        return segs
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            start = float(_field(item, "start", "start_second", "start_time",
                                 "begin"))
            end = float(_field(item, "end", "end_second", "end_time"))
        except (TypeError, ValueError):
            continue
        start = max(0.0, start)
        end = min(end, duration) if duration else end
        if end - start < 0.5:
            continue
        tags = [str(t).lower() for t in _field(item, "tags", "keywords",
                                               default=[]) or []
                if str(t).strip()]
        caption = str(_field(item, "caption", "description", "desc",
                             default="")).strip()
        segs.append(Segment(
            video_id=video_id, source=source, tags=tags, caption=caption,
            start=start, end=end, duration=end - start,
            confidence=_clamp(_field(item, "confidence", "score",
                                     default=0.5)),
        ))
    # drop UMBRELLA segments first: when the model emits one span covering
    # several distinct shots plus the shots themselves, keep the fine shots
    # (the whole point is per-shot b-roll) — without this, the micro-slice
    # rule below would keep the umbrella and discard everything inside it.
    # BUT only drop when the contained shots actually cover most of the
    # umbrella's span — otherwise dropping it loses the uncovered footage;
    # a kept umbrella is long, so the refinement pass will split it instead.
    def _contains(a: Segment, b: Segment) -> bool:
        return a.start <= b.start + 1.0 and b.end <= a.end + 1.0 and a is not b
    def _is_covered_umbrella(s: Segment) -> bool:
        inside = [o for o in segs if _contains(s, o)]
        if len(inside) < 2:
            return False
        covered = sum(o.end - o.start for o in inside)
        return covered >= 0.7 * (s.end - s.start)
    segs = [s for s in segs if not _is_covered_umbrella(s)]
    # drop micro-slices of the same shot: sort by start, skip any segment
    # overlapping the previously kept one by more than half its length
    segs.sort(key=lambda s: (s.start, -(s.end - s.start)))
    kept: list[Segment] = []
    for s in segs:
        if kept and s.start < kept[-1].end - 0.5 * (s.end - s.start):
            continue
        kept.append(s)
    return kept


def _chunk_windows(duration: float) -> list[tuple[float, float]]:
    """Overlapping (start, end) windows covering the video; a stub tail
    window is absorbed into the previous one."""
    step = _CHUNK_S - _CHUNK_OVERLAP_S
    wins, t = [], 0.0
    while True:
        end = min(t + _CHUNK_S, duration)
        wins.append((t, end))
        if end >= duration:
            break
        t += step
    if len(wins) >= 2 and wins[-1][1] - wins[-1][0] < _CHUNK_OVERLAP_S * 2:
        wins[-2] = (wins[-2][0], wins[-1][1])
        wins.pop()
    return wins


def _encode_chunk(path: str, start: float, end: float, out: str) -> None:
    """Cut + shrink in ONE re-encode: input seeking with re-encode is
    frame-accurate (a stream-copy cut would snap to a keyframe and shift
    every timestamp the model reports)."""
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start), "-to", str(end), "-i", path,
         "-vf", "scale=-2:360,fps=8", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "32", "-an", out],
        check=True, capture_output=True,
    )


def _merge_chunk_segments(segs: list[Segment]) -> list[Segment]:
    """Collapse duplicate reports of the same shot from adjacent chunks'
    overlap zones: range-merge any pair overlapping by more than half the
    shorter one, keeping the higher-confidence metadata."""
    segs.sort(key=lambda s: s.start)
    merged: list[Segment] = []
    for s in segs:
        if merged:
            p = merged[-1]
            overlap = min(p.end, s.end) - max(p.start, s.start)
            if overlap > 0.5 * min(p.end - p.start, s.end - s.start):
                if s.confidence > p.confidence:
                    p.tags, p.caption, p.confidence = s.tags, s.caption, s.confidence
                p.start = min(p.start, s.start)
                p.end = max(p.end, s.end)
                p.duration = p.end - p.start
                continue
        merged.append(s)
    return merged


def _fine_native_once(client: GLMClient, upload_path: str, video_id: str,
                      source: str, clip_dur: float, offset: float,
                      context: str) -> list[Segment]:
    """One native-video call on an upload-sized file; timestamps offset back
    into full-video time. Salvages complete segments from truncated replies."""
    instr = _FINE_INSTRUCTIONS.replace("{context}", context)
    content = [
        {"type": "video_url", "video_url": {"url": _video_data_uri(upload_path)}},
        {"type": "text", "text": instr},
    ]
    reply = client.complete([{"role": "user", "content": content}],
                            max_tokens=_FINE_MAX_TOKENS)
    try:
        data = _extract_json(reply)
    except ValueError:
        data = _salvage_objects(reply)
        if not data:
            raise
        print(f"[fine] {video_id}: reply truncated; salvaged {len(data)} "
              f"complete segments")
    segs = _parse_segments(data, video_id, source, clip_dur)
    for s in segs:
        s.start += offset
        s.end += offset
    return segs


def _fine_native_chunked(client: GLMClient, path: str, video_id: str,
                         source: str, duration: float) -> list[Segment]:
    wins = _chunk_windows(duration)
    print(f"[fine] {video_id}: {duration:.0f}s video -> {len(wins)} chunks "
          f"of ~{_CHUNK_S:.0f}s ({_CHUNK_OVERLAP_S:.0f}s overlap)")
    all_segs: list[Segment] = []
    chunks_ok = 0
    for a, b in wins:
        chunk = f"{path}.chunk_{int(a)}_{int(b)}.mp4"
        ctx = (f"This clip is the {a:.0f}s-{b:.0f}s portion of a longer "
               f"video. It is {b - a:.1f} seconds long; report timestamps "
               f"relative to THIS clip (0.0 to {b - a:.1f}).")
        try:
            _encode_chunk(path, a, b, chunk)
            for attempt in (1, 2):                 # one retry per chunk
                try:
                    all_segs += _fine_native_once(client, chunk, video_id,
                                                  source, b - a, offset=a,
                                                  context=ctx)
                    chunks_ok += 1
                    break
                except Exception as e:
                    print(f"[fine] {video_id}: chunk {a:.0f}-{b:.0f}s "
                          f"attempt {attempt} failed ({e})")
        finally:
            if os.path.exists(chunk):
                os.remove(chunk)
    if chunks_ok == 0:
        raise RuntimeError(f"all {len(wins)} chunks failed")
    if chunks_ok < len(wins):
        print(f"[fine] {video_id}: WARNING {len(wins) - chunks_ok} chunk(s) "
              f"skipped — coverage has gaps")
    return _merge_chunk_segments(all_segs)


def _fill_gaps(client: GLMClient, path: str, video_id: str, source: str,
               segs: list[Segment], duration: float) -> list[Segment]:
    """
    Re-tag stretches the native pass reported nothing for. Runs BEFORE
    refinement, so a lazy blob returned for a gap still gets split. Gaps
    that are genuinely non-b-roll (interviews) come back empty — one cheap
    call confirms the hole is deliberate.
    """
    if _GAPFILL_MIN_S <= 0:
        return segs
    segs = sorted(segs, key=lambda s: s.start)
    gaps: list[tuple[float, float]] = []
    prev = 0.0
    for s in segs:
        if s.start - prev > _GAPFILL_MIN_S:
            gaps.append((prev, s.start))
        prev = max(prev, s.end)
    if duration - prev > _GAPFILL_MIN_S:
        gaps.append((prev, duration))
    filled: list[Segment] = []
    for a, b in gaps:
        gap_path = f"{path}.gap_{int(a)}_{int(b)}.mp4"
        try:
            _encode_chunk(path, a, b, gap_path)
            got = _fine_native_once(
                client, gap_path, video_id, source, b - a, offset=a,
                context=(f"This clip is {b - a:.1f} seconds long; report "
                         f"timestamps relative to THIS clip (0.0 to "
                         f"{b - a:.1f})."))
        except Exception as e:
            print(f"[fine] {video_id}: gap {a:.0f}-{b:.0f}s re-tag failed "
                  f"({e}); leaving the gap")
            continue
        finally:
            if os.path.exists(gap_path):
                os.remove(gap_path)
        print(f"[fine] {video_id}: gap {a:.0f}-{b:.0f}s re-tag -> "
              f"{len(got)} segments" + ("" if got else " (non-b-roll hole)"))
        filled += got
    return sorted(segs + filled, key=lambda s: s.start)


def _refine_long_segments(client: GLMClient, path: str, video_id: str,
                          source: str, segs: list[Segment]) -> list[Segment]:
    """
    Second look at suspiciously long segments (lazy-model blobs): re-tag the
    span alone. >=2 shots back = the blob hid real cuts, splice them in;
    1 back = confirmed continuous take, keep the ORIGINAL untouched.
    Refined results are never re-refined (one recursive level).
    """
    out: list[Segment] = []
    for s in segs:
        span = s.end - s.start
        if span <= _REFINE_TRIGGER_S:
            out.append(s)
            continue
        sub_path = f"{path}.refine_{int(s.start)}_{int(s.end)}.mp4"
        try:
            _encode_chunk(path, s.start, s.end, sub_path)
            subsegs = _fine_native_once(
                client, sub_path, video_id, source, span, offset=s.start,
                context=(f"This clip is {span:.1f} seconds long; report "
                         f"timestamps relative to THIS clip (0.0 to "
                         f"{span:.1f})."))
        except Exception as e:
            print(f"[fine] {video_id}: refine {s.start:.0f}-{s.end:.0f}s "
                  f"failed ({e}); keeping original segment")
            out.append(s)
            continue
        finally:
            if os.path.exists(sub_path):
                os.remove(sub_path)
        if len(subsegs) >= 2:
            print(f"[fine] {video_id}: refined {s.start:.0f}-{s.end:.0f}s "
                  f"({span:.0f}s) into {len(subsegs)} shots")
            out += subsegs
        else:
            out.append(s)     # confirmed single take (or nothing usable back)
    return out


def fine_tag_video(client: GLMClient, path: str, video_id: str,
                   source: str = "youtube") -> list[Segment]:
    """
    Exhaustive fine pass over a LOCAL video file -> list[Segment] (not yet
    embedded/cut/stored — pipeline._ingest does that). Native video input
    first — chunked when the video is long, so each reply stays under the
    token ceiling, plus one refinement look at suspiciously long segments —
    then the sampled-frames fallback if video input fails.
    """
    duration = _video_duration(path)

    # attempt 1: native video input (GLM-4.xV supports video_url)
    try:
        if duration > _CHUNK_S * 1.25:
            segs = _fine_native_chunked(client, path, video_id, source,
                                        duration)
        else:
            upload = _shrink_for_upload(path, _MAX_VIDEO_MB)
            segs = _fine_native_once(
                client, upload, video_id, source, duration, offset=0.0,
                context=f"The video is {duration:.1f} seconds long.")
        segs = _fill_gaps(client, path, video_id, source, segs, duration)
        return _refine_long_segments(client, path, video_id, source, segs)
    except Exception as e:
        print(f"[fine] {video_id}: native video input failed ({e}); "
              f"falling back to sampled frames")

    # attempt 2: sampled frames with timestamps in the prompt
    frames = _sample_frames(path, duration)
    content = []
    stamps = []
    for i, (t, uri) in enumerate(frames, 1):
        content.append({"type": "image_url", "image_url": {"url": uri}})
        stamps.append(f"image {i} = t={t}s")
    instr = _FINE_INSTRUCTIONS.replace("{context}", (
        f"The video is {duration:.1f} seconds long. You are seeing "
        f"{len(frames)} frames sampled from it: {'; '.join(stamps)}. "
        "Infer segment boundaries from the frame timestamps."))
    content.append({"type": "text", "text": instr})
    reply = client.complete([{"role": "user", "content": content}],
                            max_tokens=_FINE_MAX_TOKENS)
    return _parse_segments(_extract_json(reply), video_id, source, duration)
