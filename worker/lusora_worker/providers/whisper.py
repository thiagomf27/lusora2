"""Local Whisper transcription (used only when audio was human-provided
and the TTS adapter therefore has no timings). Optional dependency:
`uv add faster-whisper` in worker/ enables it (OQ-17)."""

from __future__ import annotations

from pathlib import Path

from ..context import StageContext
from ..errors import StageError
from ..srt import SrtItem, write_srt

STAGE = "transcript"


def transcribe(ctx: StageContext, audio: Path) -> None:
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError:
        raise StageError(
            STAGE,
            "audio.mp3 was provided without subtitles and no TTS timings exist; "
            "local Whisper is not installed — run `uv add faster-whisper` in worker/, "
            "or upload subtitles.srt with the video",
        )

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(audio), vad_filter=True)
    items = [SrtItem(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    if not items:
        raise StageError(STAGE, "whisper produced no segments from audio.mp3 — is the audio silent?")
    write_srt(ctx.artifact("subtitles.srt"), items)
