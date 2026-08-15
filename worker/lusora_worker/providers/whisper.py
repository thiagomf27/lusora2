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

    # Condition the ASR on what we already know it is going to hear: the
    # channel language (never guess it from a noisy first second) and the
    # opening of the script, which biases Whisper toward the script's own
    # spelling of names and terms. Every divergence avoided here is one
    # the compiler's alignment doesn't have to forgive later.
    language = str(ctx.cfg.get("language") or "").split("-")[0].lower() or None
    prompt = None
    if ctx.has("script.txt"):
        prompt = ctx.artifact("script.txt").read_text(encoding="utf-8").strip()[:800] or None

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        str(audio), vad_filter=True, language=language, initial_prompt=prompt
    )
    items = [SrtItem(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    if not items:
        raise StageError(STAGE, "whisper produced no segments from audio.mp3 — is the audio silent?")
    write_srt(ctx.artifact("subtitles.srt"), items)
