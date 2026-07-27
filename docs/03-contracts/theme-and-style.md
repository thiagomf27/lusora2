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
motion_feel: slow_heavy           # global duration/easing scale
grain: archival                   # optional post-look (Remotion path)
surface:                          # D46 — the SHAPE of an overlay
  radius: square                  # square | soft | rounded
  fill: translucent               # solid | translucent | none
  accent_rule: top                # top | left | none
motion:                           # D46 — HOW an overlay arrives
  entrance: slide                 # fade | rise | slide | pop | wipe | typewriter
  easing: smooth                  # smooth | snap | spring | linear
  per_component:                  # exceptions only; sparse by design
    ChapterCard: typewriter
    AnimatedCounter: pop
```

Rules: components take semantic props only (`emphasis: accent|neutral`);
the theme runtime resolves them. The AI never sees this file — brand
consistency is enforced by construction. Token list: D46 (supersedes
D30, which closed OQ-10 at the original eight).

### Why presentation lives HERE and not in a component pack

The renderer receives `{ plan, theme, assets }` and nothing else
(`renderers/remotion/render.ts`). The style pack never reaches the
engine; the compiler copies `template` into the plan item precisely so
the renderer needs no catalog access either. So any token describing how
an overlay *looks or moves* has to be a theme token — anywhere else
needs a new plumbing path from `cfg.json` to the composition.

The three layers, stated as a rule:

| What changes | What you create |
| --- | --- |
| colors, fonts, corners, entrance, easing, grain | a **theme** |
| hold lengths, density, allowed components, script length, persona | a **style pack** |
| a component that does not exist yet | a **component pack** |

A component pack is a *menu*, a theme is a *look*, a style pack is a
*rhythm*. Copying 26 entries into a second pack to change a border
radius is the failure mode this table exists to prevent: pack entries
are the planner's menu, so the copies would land in the prompt as
siblings with identical `when_to_use` — the exact ambiguity
`when_not_to_use` exists to remove — and would render as nothing unless
each one also mapped to a template.

### `surface` and `motion` semantics

- Enums, never raw numbers. `radius: 12` in a theme file invites
  `radius: 13`, and "rounded" stops meaning one thing system-wide. The
  engine owns the pixel values; the theme picks a word.
- Every token is OPTIONAL with a default equal to today's hardcoded
  value, so existing themes render identically and a component that has
  not been converted yet simply ignores them.
- `motion.entrance` is a REQUEST, not a guarantee. `typewriter` is
  meaningless on BarChart or SatelliteLocate — a component declares the
  entrances it can honor and anything else degrades to `fade`. Silent
  degradation is correct here: the alternative is a theme that renders
  one component broken.
- `motion.per_component` is the per-component override, keyed by catalog
  name, and is meant to stay SPARSE. If it approaches one entry per
  component the theme has absorbed the styling problem and every new
  component needs an entry in every theme — that is the trigger for
  motion roles (D47).
- All of this is Remotion-path only, at zero ffmpeg cost: any overlay at
  all already forces the Remotion route (`router.ts`), so D31's
  "each addition is filter-graph work" does not apply.

### Motion roles — the deferred shape (D47)

When `per_component` gets long, components declare a semantic role and
the theme sets motion per role instead of per name:

```yaml
motion:
  entrance: slide
  per_role:
    title: typewriter     # KineticTitle, ChapterCard, HammerStatement
    data: pop             # AnimatedCounter, BarChart, StatTag
    card: rise            # FactCard, DefinitionCard, BulletList
    label: fade           # NamePlate, DateStamp, StatTag
```

Four entries instead of twenty-six, and a new component inherits its
role's motion with no theme edit. The roles map cleanly onto the
catalog's five existing clusters, which is what makes this cheap later.
NOT built now: it is the right answer to a problem that does not exist
until several themes carry long override maps. Deliberately deferred —
see D47 for the trigger.

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
