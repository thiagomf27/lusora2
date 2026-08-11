# Worker Pipeline

Python. A deterministic orchestrator: polls the DB queue, and for each
claimed video runs every stage whose output artifact is missing from the
folder. Stores no state of its own. Emits `video_events` and
`cost_events` rows throughout.

## Stages

| # | Stage | Output artifact | AI? |
|---|---|---|---|
| 1 | claim + materialize | folder, `cfg.json`, uploaded inputs | no |
| 2 | script | `script.txt` | bounded agent |
| 3 | narration | `audio.mp3` | no (TTS API / upload) |
| 4 | transcript | `subtitles.srt` | no (TTS or local Whisper; extract audio first for avatar uploads) |
| 5 | plan_beats | `beats.json` | **bounded agent** ★ |
| 6 | compile_plan | `edit_plan.json` | no (deterministic compiler) |
| 7 | resolve_assets | `clips/` + filled asset paths + provenance | no |
| 7b | resolve_audio | `audio/` — the sound pack's cues and beds copied in, provenance filled | no |
| 8 | validate (full) | pass/fail (no artifact, always runs) | no |
| 9 | render | `final.mp4` | no |
| 10 | finalize | `thumb.jpg`, `metadata.txt`, status RENDERED | optional (thumb/metadata generators) |

Structural validation additionally runs after claim (if a plan was
provided manually) and after compile.

### `resolve_audio` (D48)

The compiler already decided which cues and beds play and when; this
stage only binds those names to bytes, copying them from the snapshotted
sound pack into `<video>/audio/` and recording `library` provenance. It
no-ops when the channel has music and sfx switched off, or when the plan
carries no audio items.

Copying rather than pointing at the pack is what keeps a video
reproducible: re-rendering next year uses the audio it was built with,
even if the pack has been retuned since — the same reason `cfg.json`
snapshots the theme (Principle 7). It costs nothing and needs no network,
so there is no budget gate and no price-table entry.

## Bounded agents — the only three LLM roles in the system

1. **Script agent** (stage 2): generator strategy + persona from the
   style pack. One call (or few, for long-form outline+sections).
2. **Beat planner** (stage 5): inputs = script + style pack (pacing
   numbers, arc, overlay density) + component catalog (when_to_use /
   when_not_to_use) + content rules. Output = beat sheet. Wrapped in the
   validate→repair loop (max 3 attempts, all violations fed back).
   Past `planner.chunk_target_beats` target beats (default 30) it runs in
   two phases (D52): a cheap **spine** call finds where the story turns and
   returns section boundaries as sentence indices, then one planning call
   per section — each validated on its own, so a dropped sentence costs one
   section rather than the whole video, and each carrying the spine, the
   previous section's last beats and a ledger of visuals already spent. The
   merged sheet is judged by the same `validate_beat_sheet` a single call
   faces. A spine that is not a partition is ignored: sections fall back to
   a deterministic word-balanced split.
3. **Editor chat agent** (platform-hosted, worker-independent): emits
   beat operations and plan patch operations only; every result passes
   the same validators.

Each agent: model choice per role from config (cheap by default, OQ-9),
token + cost recorded per call, hard revision caps. No agent ever
controls flow between stages.

## Error model

Fail loudly with ONE actionable reason: which stage, which file, which
provider, why. Status → ERROR, reason as a `video_events` row (and in the
folder log). Fixing the input and re-queuing resumes from the missing
artifact — finished work is never redone. Renderer/tool subprocesses:
non-zero exit + reason on stderr, captured into events.

## Manual-first

Any artifact can be human-provided (upload at enqueue or dropped into the
folder): script, audio, srt, `beats.json`, even a full `edit_plan.json`.
The corresponding stage simply finds its output present and skips. This is
the escape hatch for every AI failure and the basis of the review loop.
