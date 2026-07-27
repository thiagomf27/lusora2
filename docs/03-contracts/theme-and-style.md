# Theme & Style Packs — Draft v1

The two data documents that make channels different without different
code. Both referenced by name from channel config; both editable in the
UI; both snapshotted into `cfg.json` at enqueue.

## Theme (appearance — consumed by the ENGINE, invisible to AI)

```yaml
# themes/history-dark.yaml
colors:
  bg: "#0e0d0b"
  text: "#e8e2d4"
  accent: "#c8a24a"
  neutral: "#6b675e"
typography:
  display: "Playfair Display"     # packaged fonts only, by name
  body: "Inter"
  caption_preset: "serif-lower-third"   # from the engine's caption presets
motion_feel: slow_heavy           # maps to easing/duration scales in components
grain: archival                   # optional post-look (Remotion path)
```

Rules: components take semantic props only (`emphasis: accent|neutral`);
the theme runtime resolves them. The AI never sees this file — brand
consistency is enforced by construction. Final token list: OQ-10.

## Style pack (behavior — consumed by the PLANNER and the COMPILER)

```yaml
# style-packs/doc-slow.yaml
video_type: doc                 # optional; the preset this pack implements
pacing:
  avg_hold_seconds: 4.0
  min_hold: 2.5
  max_hold: 8.0
  arc: three_act                # setup 30% / turn 40% / release 30%
overlays:
  density: normal               # low|normal|high or {per_minute: N}
  allowed_components: [ChapterCard, NamePlate, DateStamp, SatelliteLocate, QuoteBlock,
                       DocumentCard, FramedExhibit, ArchivalFrame, AnimatedCounter,
                       FactCard, Timeline]
transitions:
  allowed: [cut, crossfade, fade_to_black]
  default: cut
script_persona: |
  Grave, precise documentary narrator. Short sentences. No exclamations.
visual_language: |
  Archival, desaturated, wide establishing shots; avoid modern footage.
script:                           # D45, lands in M10
  target_seconds: 90              # per-video overridable, like overlays.density
  tolerance: 0.25
  prompt: doc-grave               # optional: the prompt pack matching this voice
```

- `pacing` numbers are CONSTRAINTS: the prompt derives target beat count
  from them, and the compiler enforces min/max hold (auto-split at
  sentence boundaries, or repair loop). This is what turns pacing from
  advice into a guarantee.
- `overlays.density` is the per-video "more/fewer animations" dial —
  override at enqueue like any config field; the validator checks the
  produced count against the range.
- `allowed_components` is both a planner menu filter and a validate rule
  (belt and suspenders).
- Video-type presets (doc / explainer / breakdown / listicle) are just
  named style packs with different numbers. Initial numbers per type:
  OQ-12 (needs your taste, not a technical decision).
- `script.target_seconds` is where narration length lives (D45, closes
  OQ-23): length is part of a pack's shape, next to the pacing numbers it
  interacts with, and a long-form channel becomes a new pack rather than
  a code change. Per-video overridable like `overlays.density`. Until M10
  ships it, the 60–120 s target is hardcoded in the script prompt.
- `script.prompt` names the prompt pack that carries this pack's voice —
  layer 3 of the resolution order in D44 (video override → channel →
  style pack → default). See [LLM Usage](../02-components/llm-usage.md).
- `video_type` is how a pack says which preset it implements. It is
  optional — a pack without one suits any type — and it is advisory: the
  channel's own `video_type` is what the pipeline reads, and the field
  only narrows the picker on the Channels screen. Adding a video type is
  therefore duplicating a pack and retuning it, on the Style Packs
  screen, with no deploy.
