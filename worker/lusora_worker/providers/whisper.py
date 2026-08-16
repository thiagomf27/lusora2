"""Local Whisper transcription (used only when audio was human-provided
and the TTS adapter therefore has no timings). Optional dependency:
`uv add faster-whisper` in worker/ enables it (OQ-17)."""

from __future__ import annotations

from pathlib import Path

from ..context import StageContext
from ..errors import StageError
from ..srt import SrtItem, write_srt

STAGE = "transcript"


def transcribe(ctx: StageContext, audio: Path, words: bool = False) -> None:
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
        str(audio),
        vad_filter=True,
        language=language,
        initial_prompt=prompt,
        word_timestamps=words,
    )

    # D63: one cue per WORD, or one per ASR segment. Word timings are the only
    # thing the TTS adapters cannot produce (they time whole sentences), which
    # is why asking for them always costs a transcription pass.
    items: list[SrtItem] = []
    for segment in segments:
        if words:
            for w in getattr(segment, "words", None) or []:
                text = str(w.word).strip()
                if text:
                    items.append(SrtItem(w.start, w.end, text))
        elif segment.text.strip():
            items.append(SrtItem(segment.start, segment.end, segment.text.strip()))

    if not items:
        unit = "words" if words else "segments"
        raise StageError(STAGE, f"whisper produced no {unit} from audio.mp3 — is the audio silent?")
    write_srt(ctx.artifact("subtitles.srt"), items)
