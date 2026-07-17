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
  "version": "1.0",
  "video_id": "…",
  "beats": [
    {
      "id": "b12",
      "kind": "narration",
      "script_text": "By 1943, nearly 70% of the city's factories had been converted to produce aircraft parts.",
      "visual_intent": "aerial view of a 1940s industrial district, smokestacks, factory floor with workers assembling aircraft wings, archival grain",
      "mood": "grave",
      "media_preference": "video",
      "anchors": [
        { "type": "percentage", "value": 70, "label": "factories converted", "source_words": "nearly 70%" }
      ],
      "overlay": { "component": "AnimatedPercentage", "anchor_ref": 0, "props_hint": { "label": "factories converted" } },
      "notes": null
    },
    {
      "id": "b13",
      "kind": "timed",
      "timing": { "start_s": 0.0, "end_s": 4.5 },
      "visual_intent": "slow push-in on a city skyline at dawn, mist",
      "mood": "calm",
      "overlay": { "component": "TitleCard", "props_hint": { "text": "1943" } }
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
  alignment.
- `kind: timed` — for spans with no narration (cold opens, music-only
  outros, montage inserts). Carries absolute `timing`. (Music-bar-relative
  beats: deferred, OQ-8.)
- `anchors` — structured facts detected in the span (percentage, number,
  comparison, place, date, name). **An overlay may only reference an
  anchor** (`anchor_ref`) or carry pure text (`TitleCard`); this is what
  prevents decorative effects glued anywhere.
- `overlay.component` MUST exist in the catalog; `props_hint` is partial —
  the compiler fills the rest from the anchor + defaults, and deterministic
  tools resolve what LLMs get wrong (place name → lat/lng geocoding, date
  parsing).
- `visual_intent` is written scout-style (concrete, visual, rankable by
  vector search) — the planner prompt teaches this with examples.
- `media_preference` (`video` | `image` | `any`) — hint for resolution
  ordering within the source policy.

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
