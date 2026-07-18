"""Stage implementations.

M2: stubs that produce valid placeholder artifacts (the pipeline shape,
resume model and events are real; the content is not). M3 replaces the
spine with real TTS/SRT/compiler/renderer.
"""

from __future__ import annotations

import subprocess

from ..context import StageContext
from ..errors import StageError


def run_script(ctx: StageContext) -> None:
    title = str(ctx.video.get("title") or "Untitled")
    ctx.artifact("script.txt").write_text(
        f"{title}. This is a placeholder script produced by the M2 stub. "
        "It will be replaced by the script stage in M3.",
        encoding="utf-8",
    )


def run_narration(ctx: StageContext) -> None:
    # 2 seconds of silence — a real, probe-able mp3
    out = ctx.artifact("audio.mp3")
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-t", "2", "-q:a", "9", str(out),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise StageError("narration", f"ffmpeg failed writing {out.name}: {proc.stderr[-300:]}")


def run_transcript(ctx: StageContext) -> None:
    script = ctx.artifact("script.txt").read_text(encoding="utf-8").strip()
    ctx.artifact("subtitles.srt").write_text(
        f"1\n00:00:00,000 --> 00:00:02,000\n{script[:80]}\n\n", encoding="utf-8"
    )


def run_plan_beats(ctx: StageContext) -> None:
    script = ctx.artifact("script.txt").read_text(encoding="utf-8").strip()
    ctx.write_json(
        "beats.json",
        {
            "version": "1.0",
            "video_id": ctx.video_id,
            "beats": [
                {
                    "id": "b1",
                    "kind": "narration",
                    "script_text": script,
                    "visual_intent": "placeholder wide establishing shot (M2 stub)",
                    "mood": "neutral",
                }
            ],
        },
    )


def run_compile_plan(ctx: StageContext) -> None:
    output = ctx.cfg.get("output") or {}
    ctx.write_json(
        "edit_plan.json",
        {
            "version": "1.0",
            "video_id": ctx.video_id,
            "fps": int(output.get("fps", 30)),
            "resolution": {
                "width": int(output.get("width", 1920)),
                "height": int(output.get("height", 1080)),
            },
            "tracks": {
                "visual": [
                    {
                        "id": "v1",
                        "beat_id": "b1",
                        "locked": False,
                        "start_s": 0,
                        "end_s": 2.0,
                        "media_type": "image",
                        "asset": {"source": "ai", "path": "clips/b1.jpg"},
                    }
                ],
                "overlays": [],
                "captions": {"enabled": False, "items": []},
                "audio": {"voiceover": {"path": "audio.mp3", "duration_s": 2.0}},
            },
        },
    )


def assets_resolved(ctx: StageContext) -> bool:
    return ctx.has("clips/.resolved")


def run_resolve_assets(ctx: StageContext) -> None:
    clips = ctx.artifact("clips")
    clips.mkdir(exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180",
            "-frames:v", "1", str(clips / "b1.jpg"),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise StageError("resolve_assets", f"ffmpeg failed writing clips/b1.jpg: {proc.stderr[-300:]}")
    (clips / ".resolved").write_text("stub\n")


def run_validate(ctx: StageContext) -> None:
    if not ctx.has("edit_plan.json"):
        raise StageError("validate", "edit_plan.json missing — nothing to validate")


def run_render(ctx: StageContext) -> None:
    # M2 stub: a real (tiny) mp4 so the file is probe-able
    out = ctx.artifact("final.mp4")
    tmp = ctx.artifact("final.tmp.mp4")
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30",
            "-t", "2", "-pix_fmt", "yuv420p", str(tmp),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise StageError("render", f"ffmpeg stub render failed: {proc.stderr[-300:]}")
    tmp.rename(out)


def run_finalize(ctx: StageContext) -> None:
    thumb = ctx.artifact("thumb.jpg")
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(ctx.artifact("final.mp4")), "-frames:v", "1", str(thumb)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise StageError("finalize", f"ffmpeg failed writing thumb.jpg: {proc.stderr[-300:]}")
    ctx.artifact("metadata.txt").write_text(
        f"title: {ctx.video.get('title')}\nchannel: {ctx.channel_id}\n", encoding="utf-8"
    )
    ctx.db.set_size(ctx.video_id, ctx.artifact("final.mp4").stat().st_size)
