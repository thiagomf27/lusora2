# Edit Plan (`edit_plan.json`) — Draft v1 (carries proven v2 design)

The strict, compiled timeline. Produced by the compiler (normal path), a
human, or chat-agent patches — always validated before render. This is
the renderer's ONLY input besides asset files.

## Track model

| Track | Contents | Rules |
|---|---|---|
| `visual` | base items: broll / image / avatar, each with motion + transition_out | **contiguous, non-overlapping, starts at 0** |
| `overlays` | catalog component instances AND media overlays (PiP: media item + transform scale/position) | may overlap each other and the base |
| `captions` | subtitle items + style preset ref | imported from SRT once at compile; plan is then the source of truth |
| `audio` | exactly one voiceover, plus `music[]` beds and `sfx[]` cues | voiceover defines total duration |

Fixed track set; richness lives in items. Transitions consume handles,
never move narrative cuts; freeze-frame fallback.

## The audio track (D48)

Three item shapes, all placed by the compiler:

- **`voiceover`** — exactly one. `start_s + duration_s` is the length of
  the video, and everything else is checked against it.
- **`music[]`** — one bed per mood span, each with `mood`, `loop`,
  crossfade `fade_in_s`/`fade_out_s`, and a `gain_envelope`.
- **`sfx[]`** — one-shots and short loops. Unlike music, a cue extends
  `itemBase`: it has an `id`, a `beat_id` and a `locked` flag, so it is
  addressable by the editor and follows the same recompile rules as an
  overlay. `origin` (`overlay` | `transition` | `manual`) and `origin_id`
  record *why* it exists.

Cues are **not** nested inside the overlay they belong to. A flat track
is what lets the editor move one independently, lets the ffmpeg path mix
it with the same code as music, and keeps a hand-added cue alive across a
recompile. The link is `origin_id`, not containment.

### `gain_envelope` — ducking as data

```json
"gain_envelope": [
  { "t_s": 0,     "gain": 0.16 },
  { "t_s": 12.4,  "gain": 0.16 },
  { "t_s": 12.75, "gain": 0.5  },
  { "t_s": 16.2,  "gain": 0.5  },
  { "t_s": 16.45, "gain": 0.16 }
]
```

Piecewise-linear, **absolute time**, ends held flat, multiplied by
`volume`. The compiler derives it from the exact per-sentence TTS
timings: hold at `music_duck` while a sentence plays, ramp to
`music_lift` in any gap long enough to be worth hearing (~1.2 s), and be
back down before the next sentence starts.

No compressor is involved, on purpose (D49). Remotion interpolates the
points in its volume callback; ffmpeg builds the same curve as a nested
`if(lt(t,…))` expression on `volume=…:eval=frame`. Both read the same
numbers, so both paths mix the same — `engine/test/audio.test.ts` pins
that by evaluating the ffmpeg expression and `gainAt()` against each
other. The schema caps the list at 200 points; the compiler drops the
shortest gaps rather than overflow it.

Finally, one `loudnorm` pass takes the finished mix to **-14 LUFS**,
YouTube's target, so the platform's own normalization leaves it alone.

## Item provenance + lock (the editor-sync rule)

Every item carries:

```json
{ "beat_id": "b12", "locked": false,
  "asset": { "source": "library", "id": "seg_8841", "license": "cc-by", "path": "clips/b12.mp4", "score": 0.71 } }
```

- `beat_id` — which beat produced this item (null for hand-added items).
- `locked` — set true automatically by any manual timeline edit.
- **Recompilation is per-beat and skips locked items.** Editing beat 12
  regenerates only b12's unlocked items; human timeline work is never
  wiped. The chat agent's plan patches follow the same rule.
- `asset` provenance feeds the Video screen's "assets used", license
  checks, and `mark_used` bookkeeping.
- `loop` (D55) — repeat a video source shorter than the item instead of
  freezing on its last frame. Both renderers honour it, and it does not force
  the premium route; `speed` (the `slow` fallback) does, since the ffmpeg
  profile rejects a rate other than 1.
- `absorbed_beat_ids` — beats whose aligned span was under the style pack's
  hold floor (`pacing.hold_floor_ratio`) and which now play under THIS
  item's shot. Provenance only: an absorbed beat keeps its overlay and its
  mood, and this is what tells the editor why beat b7 has no visual of its
  own. One caveat: because the merge is derived from the beat sheet and the
  timings, a *re-*compile against re-synthesised audio can merge differently,
  and a locked item whose beat has been absorbed has no counterpart to
  survive into — the same behaviour a beat split has always had.

## Rejected alternatives (recorded so we don't re-litigate)

- AI generates render code per video → unvalidatable, uneditable, breaks
  parity, security surface.
- Imperative tool-call editing with no artifact → nothing to validate,
  diff, resume, review or open in an editor.
- OTIO/EDL as the native format → generic + heavy; revisit only if
  pro-NLE handoff becomes a feature (an OTIO exporter can be written FROM
  this plan at any time).

Even fully-agentic OpenMontage converges on a schema'd edit-decisions
JSON — the artifact approach is the industry-convergent answer; our
addition is the beat layer that makes it cheap for AI to produce.
