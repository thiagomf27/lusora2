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
pacing:
  avg_hold_seconds: 4.0
  min_hold: 2.5
  max_hold: 8.0
  arc: three_act                # setup 30% / turn 40% / release 30%
overlays:
  density: normal               # low|normal|high or {per_minute: N}
  allowed_components: [AnimatedPercentage, AnimatedMap, TitleCard, LowerThird]
transitions:
  allowed: [cut, crossfade, fade_to_black]
  default: cut
script_persona: |
  Grave, precise documentary narrator. Short sentences. No exclamations.
visual_language: |
  Archival, desaturated, wide establishing shots; avoid modern footage.
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
