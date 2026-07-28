# Sound — Sound Packs, Cues and Ducking (D48–D50)

How a video gets sound effects and music. Four layers, the same shape the
rest of personalization already uses.

| Layer | Owns | Where |
| --- | --- | --- |
| **sound pack** | the files + the cue/bed vocabulary — a *menu* | `contracts/sound-packs/<name>/` |
| **theme** | which cue for which event, mood→bed, the gains — a *sound* | `theme.sound` |
| **style pack** | whether, how often, how long — a *rhythm* | `style_pack.sfx` / `.music` |
| **channel / video** | master on/off, pack name, trims | `source_policy.{music,sfx}` |

A sound pack is a menu the way a component pack is a menu, and it is the
only other layer that carries bytes rather than words. See
[Theme & Style Packs](theme-and-style.md) for the table this extends.

## Two rules everything follows

**1. Sound is resolved at COMPILE time, never at render time.** The
compiler emits every cue and bed as a concrete `sfx[]` / `music[]` item
with absolute seconds. That is what makes a cue addressable by the
editor, survivable across a per-beat recompile (it carries `id`,
`beat_id`, `locked` like an overlay), and identical on both render
paths. A cue resolved inside the Remotion composition would be none of
those, and the ffmpeg path could not see it at all.

**2. The LLM never names a sound.** Sound selection is consistent taste,
which D8 already removed from the model's job. Its whole contribution is
`mood` per beat.

## The sound pack

```
contracts/sound-packs/doc-restrained/
  manifest.json          # schema: contracts/schemas/sound_pack.schema.json
  sfx/swoosh-soft.mp3
  beds/tense-01.mp3
```

```jsonc
{
  "name": "doc-restrained",
  "license": "cc0",                       // pack-wide; split the pack rather than loosen it
  "cues": {
    "swoosh-soft": {
      "file": "sfx/swoosh-soft.mp3",
      "kind": "one_shot",                 // one_shot | loop
      "duration_s": 0.392,                // the REAL duration; the compiler sizes items from it
      "lead_s": 0.06,                     // start BEFORE the visual, so the transient lands on it
      "priority": 1                       // survives a min-gap collision against a lower number
    }
  },
  "beds": {
    "tense-01": { "file": "beds/tense-01.mp3", "mood": "tense", "duration_s": 48.02, "loopable": true }
  }
}
```

CI checks the manifest against the schema, that `name` matches the
folder, and that **every declared file exists** — a missing file fails
there rather than surfacing as a render error on a real video days later.

## Cue placement, and the sync problem

For each overlay the compiler resolves, in order:

1. `theme.sound.per_component[Component]` (may be `"none"`)
2. `theme.sound.per_entrance[kind]`, where *kind* is the entrance that
   will **actually play**
3. `theme.sound.entrance`
4. nothing

Step 2 is the interesting one. `useEntrance` computes the entrance as
`fps × seconds × durationMul`, and `entranceFor` resolves which entrance
a component can honour — both pure functions of data. So the catalog
carries `entrance_seconds` and `entrance_support`, and
`worker/lusora_worker/compiler/sound.py` mirrors `entranceFor` and
`motionScale` in Python. The compiler therefore knows *which* entrance
plays and *how long* it lasts:

- a `pop` entrance gets a one-shot at `start_s − lead_s`;
- a `typewriter` entrance gets a **loop cue spanning exactly the reveal
  window** — which is the whole reason those two catalog fields exist.

> Two implementations of one rule. `worker/tests/test_sound.py` pins the
> same cases `engine/test/themes.test.ts` does; change both together.

Per-character tick sounds are deliberately out: hundreds of audio items
per video would choke both renderers and the editor. One looped typing
bed over the entrance window is the right primitive.

Transitions are opt-in in both the theme (`sound.transition`, default
none) and the style pack (`sfx.cues`), and a `cut` never fires one — a
cut is not an event you can hear.

### Density

`sfx.max_per_minute` and `sfx.min_gap_s` are enforced by the compiler and
re-checked by the validator, the same belt-and-suspenders arrangement as
`overlays.density`. On a collision the higher-`priority` cue survives;
over budget, the lowest-priority cues are dropped. Without this, a cue
per overlay at a 2.4 s hold is 25 a minute.

## Music

`beat.mood` → contiguous same-mood beats grouped into spans → runs
shorter than `music.min_span_s` absorbed into their longer neighbour →
`theme.sound.mood_beds` maps mood to bed. A mood with no bed plays no
music, which is a legitimate choice: silence under the turn.

Vocabulary: `neutral, tense, somber, hopeful, urgent, triumphant,
reflective, playful`. An unrecognised mood degrades to `neutral` rather
than failing the video — a planner writing "ominous" has made a
reasonable word choice.

## Ducking and loudness

Ducking is **computed, not compressed**. The TTS adapters already emit
exact per-sentence timings, so the compiler writes a `gain_envelope` on
each bed: hold at `music_duck` while a sentence plays, ramp to
`music_lift` in any gap worth hearing (~1.2 s), and be back down before
the next sentence starts. See
[Edit Plan](edit-plan.md#gain_envelope--ducking-as-data) for the shape.

A sidechain compressor would be nondeterministic, would sound different
on the two render paths, and would be invisible in the plan and
uneditable in the UI. The envelope is none of those things.

**Expect a flat envelope over continuous narration.** The TTS adapters
concatenate sentences back to back, so a normally-narrated stretch has no
gap ≥ 1.2 s and the bed correctly sits at `music_duck` throughout — the
compiler emits a flat two-point envelope and that is the right answer for
someone talking without pause. The lift shows up where there genuinely is
room: a cold open before the voiceover starts (`timed` beats), the tail
after the last sentence, and anywhere a human-supplied SRT has real
silence. The editor's audio lane draws the envelope over its bed, so
which case you are in is visible at a glance.

**Levels.** `music_duck` / `music_lift` / `sfx` are ABSOLUTE levels
applied to the pack's files; `source_policy.music.default_volume` is a
trim on top (1 = as the theme mixed it). Multiplying two absolute levels
is what buries a bed 40 dB under the voice. Against the shipped packs
(beds at -24 LUFS) `music_duck: 0.16` sits about 18 dB under a typical
narration and `music_lift: 0.5` about 8 dB under.

Finally one `loudnorm` pass takes the mix to **-14 LUFS** — YouTube's
target, so the platform's own normalization leaves it alone.

## Editing

**Per video**, in the editor: the audio lane shows beds as spans (with the
ducking envelope drawn over them — a flat line means nothing is being
lifted) and cues as ticks. Plan ops: `set_music_volume`, `move_sfx`,
`set_sfx_gain`, `remove_sfx`. Timing edits lock, level edits do not
(D39). The chat agent may move, quieten or remove what is there, and may
change a beat's mood — it cannot choose a sound or add one.

**Per pack**, on the **Sounds** screen (`/sounds`), the sound-pack sibling
of Overlays: every cue and bed in every pack, playable in the browser,
with the metadata the compiler reads. File-backed like Themes and Style
Packs — git is the version history, CI is the gate.

- The player has a **gain slider** set to the level a theme will actually
  apply, so a cue is judged at its real loudness rather than at 100%.
- **`duration_s` is not editable.** Uploads are probed with `ffprobe`
  server-side and a client-supplied duration is discarded on save. The
  compiler sizes one-shot cues from that number, so a hand-typed value
  produces a cue that ends early or overruns and nothing complains until
  someone listens.
- Uploads are **normalized by kind** — cues to -6 dBFS peak, beds to
  -24 LUFS — which is what keeps a theme's `gain` a predictable trim
  across a pack. Opt out per upload.
- Each sound lists the themes that name it, and **deleting is refused
  while any do** (409), the same guard style packs have against a channel.
  The person deleting is the one who can still see why it matters.
- A file a manifest names but that is missing on disk is flagged in the
  list, matching the CI check.

## Adding a sound pack

From the UI: **Sounds → New pack**, then **Add sound** per cue or bed.
By hand:

1. `contracts/sound-packs/<name>/manifest.json` + the files.
2. Point a theme at it: `sound.pack`, plus `entrance` / `per_entrance` /
   `mood_beds` naming its cues.
3. `node scripts/validate-schemas.mjs`.

Either way, no deploy and no code. The shipped packs are synthesized placeholders —
`contracts/sound-packs/README.md` explains how to replace them with real
CC0 recordings, and why cues are peak-normalized while beds are
loudness-normalized.
