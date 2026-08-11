# Beat Sheet (`beats.json`) — Draft v1

The creative core. Produced by the beat planner agent (or a human in the
beat editor), consumed by the compiler. A beat = one visual intention
attached to one span of the video.

Design rule: a beat contains ONLY judgment (what to show, what to
emphasize). Everything computable (timings) or identity-bound
(colors/fonts) is deliberately absent — see Core Principle 3 and 4.

## Shape

```json
{
  "version": "1.1",
  "video_id": "…",
  "beats": [
    {
      "id": "b12",
      "kind": "narration",
      "script_text": "By 1943, nearly 70% of the city's factories had been converted to produce aircraft parts.",
      "visual_intent": "aerial view of a 1940s industrial district, smokestacks, factory floor with workers assembling aircraft wings, archival grain",
      "queries": ["1940s aircraft factory", "wartime assembly line", "factory workers 1940s"],
      "mood": "somber",
      "media_preference": "video",
      "anchors": [
        { "type": "percentage", "value": 70, "label": "factories converted", "source_words": "nearly 70%" }
      ],
      "overlay": { "component": "AnimatedCounter", "anchor_ref": 0, "props_hint": { "label": "factories converted", "suffix": "%" } },
      "notes": null
    },
    {
      "id": "b13",
      "kind": "timed",
      "timing": { "start_s": 0.0, "end_s": 4.5 },
      "visual_intent": "slow push-in on a city skyline at dawn, mist",
      "mood": "reflective",
      "overlay": { "component": "KineticTitle", "props_hint": { "text": "1943" } }
    }
  ],
  "music": [
    { "start_beat": "b1", "end_beat": "b40", "intent": "dark ambient, sparse piano", "volume": "low" }
  ]
}
```

## Field rules

- `kind: narration` — the default. `script_text` MUST be a verbatim
  contiguous span of the script; beats must cover the entire script in
  order without overlap (validator-enforced). Timing comes later from SRT
  alignment — word-level and tolerant of every way the same spoken words
  get WRITTEN differently, because the SRT (Whisper transcript,
  hand-authored captions, or TTS timings) is a TIMING source only and
  `script_text` stays the source of truth. Tolerated (pt-BR and en, see
  `compiler/textmatch.py`):

  | script | narration | |
  |---|---|---|
  | punctuation, `*emphasis*` | anything | folded away |
  | `Estêvão`, `café` | `Estevao`, `cafe` | diacritics folded |
  | `state-of-the-art`, `guerra—a` | spaced words | dashes split |
  | `1945` | `nineteen forty-five`, `mil novecentos e quarenta e cinco` | number runs |
  | `20 mil`, `1.200`, `3.5`, `9:30` | `20,000`, `twelve hundred`, `três vírgula cinco` | number runs |
  | `os anos 1950` | `os anos 50`, `nineteen-fifties` | decades |
  | `Século XX`, `20th` | `século vinte`, `twentieth` | romans, ordinals |
  | `50%`, `US$ 5`, `30 km` | `cinquenta por cento`, `cinco dólares`, `trinta quilômetros` | unit names |
  | `Dr.`, `Sr.`, `vs.` | `doutor`, `senhor`, `versus` | abbreviations |
  | — | up to 6 stray inserted/misheard words between matches | ASR noise |

  A genuine divergence still fails loud: a different word, a different
  NUMBER (`1945` vs `1946`), or a script word the audio never says.
  Unhandled and by design: spelled-out acronyms (`ONU` read `O-N-U`),
  multi-word expansions (`EUA` ↔ `Estados Unidos`), and languages other
  than pt-BR/en, which need their own number tables.
  See `compiler/core.py::_align_beats`.
- `kind: timed` — for spans with no narration (cold opens, music-only
  outros, montage inserts). Carries absolute `timing`. (Music-bar-relative
  beats: deferred, OQ-8.)
- `anchors` — structured facts detected in the span (percentage, number,
  comparison, place, date, name). **An overlay may only reference an
  anchor** (`anchor_ref`) or carry pure text (`KineticTitle`); this is what
  prevents decorative effects glued anywhere.
- `overlay.component` MUST exist in the catalog; `props_hint` is partial —
  the compiler fills the rest from the anchor + defaults, and deterministic
  tools resolve what LLMs get wrong (place name → lat/lng geocoding, date
  parsing).
- `visual_intent` is written scout-style (concrete, visual, rankable by
  vector search) — the planner prompt teaches this with examples. It is the
  SEMANTIC query (the library embeds it) and the image-generation prompt.
- `queries` (v1.1, D53) — 2–3 short KEYWORD searches for the same shot,
  2–4 words each, subject first, most specific first. Stock libraries match
  words, not meaning: handed the scout sentence above, Pexels returns
  whatever shares its most common words. The resolver tries them in order
  within a keyword source before falling through to the next source, since a
  second phrasing of the right shot beats a worse source. Optional and
  additive — a v1.0 sheet (or a hand-written one) resolves exactly as before,
  with keywords derived from `visual_intent` by dropping noise words. The
  validator rejects a query longer than 5 words, because a sentence pasted
  in here is a valid document that searches exactly as badly as before.
- `media_preference` (`video` | `image` | `any`) — hint for resolution
  ordering within the source policy.
- `mood` — the beat's emotional register, and the ONLY thing the model
  contributes to sound (D50). Vocabulary: `neutral, tense, somber,
  hopeful, urgent, triumphant, reflective, playful`. Deliberately typed
  as a plain string: an unrecognised mood degrades to `neutral` in the
  compiler rather than failing a video over a word choice. The compiler
  groups contiguous same-mood beats into spans, absorbs runs shorter than
  the style pack's `music.min_span_s`, and the theme maps mood → bed —
  so mood is a property of a *section*, not a per-beat dial.
- `music[]` (top level) — **superseded by `mood` and read by nothing.**
  It predates D50 and was never requested from the planner nor consumed
  by the compiler. Left in the schema for now; a candidate for deletion
  the next time this contract is touched. Do not build on it.

## What the planner receives (prompt inputs)

script text • style pack (pacing numbers, arc, overlay density, allowed
transitions) • component catalog (names + when_to_use/when_not_to_use +
props schemas) • channel content rules (from channel config) • per-video
instructions (e.g. "more animations than usual" → density raised in the
snapshot).

## Validation (before compile; violations → repair loop)

schema • full script coverage, ordered, non-overlapping • beat count
within pacing-derived range (duration ÷ avg_hold ± tolerance) • every
`script_text` found verbatim in script • every anchor's `source_words`
found in its span • every overlay component in catalog and density within
range • timed beats don't collide with narration timing envelope.

## Editing semantics

The beat editor and the chat agent operate on THIS file: change
`visual_intent` (re-roll = re-run resolution for one beat), edit overlay,
split/merge beats, add timed beats. Per-beat recompilation updates only
that beat's plan items — see the lock/provenance rule in
[Edit Plan](edit-plan.md).
