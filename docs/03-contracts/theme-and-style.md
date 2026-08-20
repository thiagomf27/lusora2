# Theme & Style Packs — Draft v1

The two data documents that make channels different without different
code. Both referenced by name from channel config; both editable in the
UI; both snapshotted into `cfg.json` at enqueue.

## Theme (appearance — consumed by the ENGINE, invisible to AI)

```yaml
# themes/<name>.yaml — every token, not one real theme
colors:
  bg: "#0e0d0b"
  text: "#e8e2d4"
  accent: "#c8a24a"
  neutral: "#6b675e"
typography:
  display: "Playfair Display"     # packaged fonts only, by name
  body: "Inter"
  caption_preset: "serif-lower-third"   # from the engine's caption presets
  scale: generous                 # D66 compact | normal | generous
  weight: light                   # D66 light | regular | bold
  case: as_written                # D66 as_written | upper
  tracking: wide                  # D66 tight | normal | wide
motion_feel: slow_heavy           # global duration/easing scale
grain: archival                   # optional post-look (Remotion path)
surface:                          # D46 — the SHAPE of an overlay
  radius: square                  # square | soft | rounded
  fill: translucent               # solid | translucent | none
  accent_rule: top                # top | left | none
  density: airy                   # D66 tight | normal | airy
  rule: hairline                  # D66 hairline | normal | heavy
  texture: paper                  # D66 none | paper | grain | scanline
chart:                            # D66 — how a PLOTTED overlay reads
  grid: horizontal                # none | horizontal | full
  legend: inline                  # inline | bottom
  markers: dot                    # none | dot
  area: tint                      # D69 none | tint — does a line enclose the space under it
  stroke: hairline                # hairline | normal | heavy
  number_format: plain            # plain | compact  (50,000 vs 50.0K)
motion:                           # D46 — HOW an overlay arrives
  entrance: slide                 # fade | rise | slide | pop | wipe | typewriter
  easing: smooth                  # smooth | snap | spring | linear
  per_component:                  # exceptions only; sparse by design
    ChapterCard: typewriter
    AnimatedCounter: pop
sound:                            # D48 — how the theme SOUNDS
  pack: doc-restrained            # sound pack name; a channel may override
  entrance: swoosh-soft           # default cue on an overlay entrance
  per_entrance:                   # by the entrance kind that actually plays
    typewriter: tick-typing
    pop: thud-low
  transition: none                # usually none — see below
  mood_beds:                      # mood -> bed; a mood with no entry is silent
    tense: tense-01
    somber: somber-01
  gain:                           # the mix, in absolute levels
    sfx: 0.28
    music_duck: 0.14              # bed level under speech
    music_lift: 0.45              # bed level in a narration gap
```

Rules: components take semantic props only (`emphasis: accent|neutral`);
the theme runtime resolves them. The AI never sees this file — brand
consistency is enforced by construction. Token list: D69 (adds `chart.area`)
over D66 (supersedes D46, which superseded D30, which closed OQ-10 at the
original eight).

**Four themes ship** (D69): `standard` — the house look, light plate, one
strong accent, tight bold sans, direct labels — plus `paper-print`,
`field-manual` and `bold-editorial`. Six near-duplicates were deleted: a theme
nobody picks goes stale and still costs a row in every picker.

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
| colors, fonts, corners, type scale/weight/case/tracking, spacing, rule weight, texture, gridlines, where a series is labelled, number format, entrance, easing, grain, which cue plays | a **theme** |
| hold lengths, density, allowed components, script length, persona, how often cues fire | a **style pack** |
| a component that does not exist yet | a **component pack** |
| a sound that does not exist yet | a **sound pack** |

A component pack is a *menu*, a theme is a *look*, a style pack is a
*rhythm*. A sound pack (D48) is a menu too — the one other layer that
carries bytes rather than words. Copying 26 entries into a second pack to change a border
radius is the failure mode this table exists to prevent: pack entries
are the planner's menu, so the copies would land in the prompt as
siblings with identical `when_to_use` — the exact ambiguity
`when_not_to_use` exists to remove — and would render as nothing unless
each one also mapped to a template.

That is not hypothetical. The `archive` pack did it at a smaller scale —
seven entries, not 26 — and D66 undid it: the twins were unioned back into
their core counterparts, the look became the tokens above, and 15 entries of
prompt weight came out of every plan call. The tell was that no `when_to_use`
could separate the pairs, because the only difference was a look.

### `surface` and `motion` semantics

- Enums, never raw numbers. `radius: 12` in a theme file invites
  `radius: 13`, and "rounded" stops meaning one thing system-wide. The
  engine owns the pixel values; the theme picks a word.
- Every token is OPTIONAL with a default equal to today's hardcoded
  value, so existing themes render identically and a component that has
  not been converted yet simply ignores them.
- `surface.accent_rule: "none"` removes every accent bar an overlay draws,
  not only the one along its edge: on the template path it also takes the
  underline out of `big_number` and `statement`. They are the same ornament
  in a different place, and a theme asking for text on the background does
  not want text on the background with a stripe under it. Themes that leave
  the token unset keep each component's own choice and are unchanged.
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

### `typography` and `chart` semantics (D66)

The bullet above — *"every token is OPTIONAL with a default equal to today's
hardcoded value"* — turns out to be two different promises, and D66 is where
they separate. Which kind a token is decides whether it can carry a default
at all.

- **SCALE tokens** — `typography.scale|weight|case|tracking`,
  `surface.density|rule`, `chart.stroke` — have an identity element. The
  resolver takes the component's OWN value and returns it unchanged at the
  default, exactly the way `surfaceStyle` scales a radius rather than
  replacing it. `typeWeight(theme, 700)` is 700 under an untouched theme and
  `typeWeight(theme, 400)` is 400, so a title and a label keep their
  relationship at every setting instead of collapsing onto one weight.
- **CHOICE tokens** — `chart.grid|legend|markers|area` — have no identity element.
  There is no neutral answer to "where does the legend go". They therefore
  carry **no schema default** and fall back to the component's own, which is
  the `surface.accent_rule` precedent. Writing `legend: inline` as a default
  would have silently restyled every chart that labelled its series
  underneath.
- Because of that fallback, the RESOLVED types are wider than the token
  enums: `chart.grid` resolves to `axes | baseline | none | horizontal |
  full`, where `axes` (LineChart's y-and-x lines) and `baseline` (BarChart's
  single rule) are values a component can hold but no theme can name.
- `typography.tracking` is an em OFFSET, not a multiplier. A title at `0em`
  has to be reachable by `wide`, and zero times anything is zero. It returns
  nothing at all when the result is 0, so the component omits the property
  and CSS keeps `normal` — byte-identity rather than an approximation of it.
- `typography.scale` moves display type further than caption type. A type
  scale is not a zoom: scale everything by the same factor and the page loses
  its hierarchy at `compact` and its captions become unreadable at
  `generous`.
- `surface.texture` is the overlay's own plate. Distinct from top-level
  `grain`, which is a post-look over the whole FRAME. Both are deterministic
  — a fixed-seed `feTurbulence` and CSS, never `Math.random`.
- `chart.number_format` governs axis and label figures. An authored
  `decimals` prop still wins: a figure the script asked for to two places is
  a fact about the claim, not a look.

### The one place a theme is overruled

`surface.fill: "none"` is a request a component cannot always honour. Over
unknown footage light ink survives losing its panel and dark ink does not, so
a paper theme with no plate is a black caption on a night shot.

A component whose ground CARRIES TYPE therefore resolves it through
`groundStyle(theme, { legible: true })`, and a theme whose page is lighter
than its ink gets a plate back whether it asked for one or not. On a dark
theme the fallback never fires and the result is still nothing, so this costs
existing themes exactly zero. It is the same argument `surfaceColor` already
makes: "none" there is not a lighter look, it is unreadable type over moving
footage.

### Colours the theme does not name

Four tokens (`bg`, `text`, `accent`, `neutral`) do not cover every colour an
overlay needs, and the answer is *not* more tokens for each one — it is a
resolver in `engine/src/themes/runtime.ts` that derives the colour from the
four, so no theme has to be re-authored when a component pack arrives:

- `surfaceColor(theme)` — the flat, opaque plate a component sets type ON.
  Deliberately not `surfaceStyle().background`, which resolves a *panel*
  floated over the shot and therefore honours `fill: none`. A plate cannot be
  transparent: that is not a lighter look, it is unreadable type over footage.
- `seriesColors(theme)` — the data ramp for two or three series that must be
  told apart (`accent` at three opacities is not a ramp). Engine-owned on
  purpose: a ramp has to hold contrast against the plate AND against itself
  under colour-blindness, which is a property of the three colours together,
  not a preference. Two variants, picked by the plate's luminance.
  **The accent LEADS the ramp when it clears 3:1 against the plate** (D69) —
  a viewer expects a channel's first series to be the channel's colour, and for
  most themes it can be. The gate is what keeps a GROUND colour out of the
  data: the old `archive` tan sat at 1.9:1 on cream, which is a line nobody can
  follow, and that case is why the ramp exists at all. Series 2 and 3 always
  come from the ramp.
- `contrastInk(theme, ground)` — type set on a coloured ground picks `text` or
  `bg`, whichever reads. A pack built for a theme whose `accent` is a ground
  (the `archive` pack's tan) would otherwise land at 1.9:1 on a theme whose
  accent is a bright mark.
- `paperStock(theme)` (D66) — stock and ink for a component that DEPICTS
  printed matter: a directive, a telegram, a page torn out of something. The
  lighter of the theme's page and its ink is the stock, the darker is the
  type. Not the same as `surfaceColor`: a panel takes the channel's ground
  whatever its luminance, but a document is dark type on light stock in every
  channel, because that is what a document IS. `DocumentCard` hardcoded
  `colors.text` as the stock, which is right on a dark theme and inverts into
  a black directive on a paper one.
- `groundStyle(theme, opts)` (D66) — the ground an overlay sets type on:
  `surface.fill` and `surface.texture` resolved into one style object, `null`
  when the theme asks for neither. Pass the component's own pre-conversion
  alpha (`"00"` if it never had a panel) and `legible: true` if it carries
  type; see *The one place a theme is overruled* above.

D66 added two resolvers and no colours. That is the rule working: **wanting a
fifth colour token is the signal that you wanted a resolver.** A token would
leave every theme authored before the component without a value for it; a
resolver derives one from the four that were always there.

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

### `sound` semantics (D48)

- **Names, not files.** A theme names cues the way `typography` names
  packaged fonts. The bytes live in the sound pack; the theme picks from
  its vocabulary. A name the pack does not define is a hard compile
  error, not a silent fallback — a swoosh that quietly went missing is
  worse than a video that refuses to build.
- **Silence is the default.** `entrance` omitted means no cue at all. The
  D46 tokens could default to today's look because there was a look;
  there is no "today's sound" to preserve.
- **`per_entrance` is keyed by the entrance that ACTUALLY plays**, after
  `motion.per_component`, `motion.entrance` and the component's own
  support are resolved. `clean-punchy` asks ChapterCard for `typewriter`
  and gets `fade` (ChapterCard draws no typewriter) — so it also sounds
  like a fade. The compiler mirrors `entranceFor` exactly for this, which
  is why the catalog carries `entrance_support` and `entrance_seconds`.
- **`transition` defaults to none.** At a 4 s hold, a cue on every
  transition is about 15 a minute. That is the single fastest way to make
  a channel sound amateur, so it is opt-in in both the theme and the
  style pack.
- **The gains are ABSOLUTE levels**, applied to the pack's files; the
  channel's `source_policy.music.default_volume` is a *trim* on top
  (1 = as the theme mixed it). Against the shipped packs (beds at
  -24 LUFS) `music_duck: 0.16` puts the bed about 18 dB under a typical
  narration and `music_lift: 0.5` brings it to about 8 dB under in a gap.
  Replace the beds with material at another level and these need
  retuning — see `contracts/sound-packs/README.md`.

## Style pack (behavior — consumed by the PLANNER and the COMPILER)

```yaml
# style-packs/doc-slow.yaml
video_type: doc                 # optional; the preset this pack implements
pacing:
  avg_hold_seconds: 4.0
  min_hold: 2.5
  max_hold: 8.0
  arc: three_act                # setup 30% / turn 40% / release 30%
  hold_floor_ratio: 1.0         # x min_hold: a shorter slot merges into its neighbour
  hold_ceiling_ratio: 1.5       # x max_hold: a longer slot is divided into equal slots
overlays:
  density: normal               # low|normal|high or {per_minute: N}
  allowed_packs: [core, archive]  # component PACKS this style draws from
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
fallback:                         # D55 — when the sources have nothing good
  component: ChapterCard          # drawn over a plain colour fill
  text_prop: title                # filled from the beat's own keyword query
sfx:                              # D48 — how OFTEN cues fire
  enabled: false                  # doc-slow ships silent; punchier packs opt in
  cues: [entrance]                # entrance | transition
  max_per_minute: 4
  min_gap_s: 1.2
music:                            # D48 — how music is SHAPED
  enabled: true
  min_span_s: 28                  # shorter mood runs merge into a neighbour
  crossfade_s: 2.5
```

- `pacing` numbers are CONSTRAINTS: the prompt derives target beat count
  from them, and the compiler enforces min/max hold (auto-split at
  sentence boundaries, or repair loop). This is what turns pacing from
  advice into a guarantee.
- `hold_floor_ratio` / `hold_ceiling_ratio` close the gap those two left.
  A narration beat's DURATION is not authored: the planner writes a span of
  script and the SRT decides how long it takes to say, so a beat could land
  at 0.8s and flash past, or hold one frame for fourteen seconds because it
  is a single long sentence with no boundary to cut at. After alignment the
  compiler merges anything under `min_hold * hold_floor_ratio` into its
  neighbour and divides anything over `max_hold * hold_ceiling_ratio` into
  equal slots; `validate_plan` re-checks the result, exempting `locked`
  items (a human who dragged a cut outranks the pack, D39). Both default to
  **0 = off** in the schema, and every shipped pack sets 1.0 / 1.5 — so a
  video enqueued before these existed carries a snapshot without them and
  re-compiles byte-identically (Principle 7).
- The merge is a VISUAL-track decision and rewrites nothing: the beat sheet
  keeps its verbatim coverage of the script, and the absorbed beat still
  draws its own overlay and still contributes its mood to the score. The
  surviving item records who it swallowed in `absorbed_beat_ids`.
- `overlays.density` is the per-video "more/fewer animations" dial —
  override at enqueue like any config field; the validator checks the
  produced count against the range.
- `allowed_packs` is both a planner menu filter and a validate rule (belt and
  suspenders), at PACK granularity. "This style suits the archive pack" is a
  statement about a body of work, and it does not go stale when a component is
  added to that pack — which an enumerated list of component names did, every
  time, silently. A channel resolves to `core` PLUS at most one installed pack
  (packs are ADDITIVE — D66), so this is also what decides whether a style and a
  channel can work together at all. `core` is not something a style opts into:
  listing it is harmless, omitting it does not take the base menu away, and the
  tool for "not this core component" is `look.exclude.components`.
- The menu is RESOLVED at enqueue: `applyComponentPack` in the platform crosses
  `allowed_packs` with the channel's `component_pack` and writes the concrete
  `allowed_components` list into the embedded document. The planner, compiler,
  validator and both renderers go on reading that list and none of them learns
  that packs exist — the same move `look.exclude` makes, and what lets a video
  snapshotted before this change replay byte-identically (Principle 7).
- Per-COMPONENT trimming did not disappear, it moved to where the taste is:
  `look.exclude.components` on a channel or a single video.
- `overlays.emphasis` (D59) opens a second overlay class, keyed on where
  attention needs a lift instead of on a fact in the script, with its own
  `per_minute` ceiling. Off by default: `density` above is anchor-gated, so it
  tracks factual density — right for a documentary, limiting for a channel
  whose best reason to put something on screen is "this is the line the video
  exists for". The budgets are separate so the new class cannot crowd out the
  old one, and the prompt mentions it only when a pack turns it on.
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
- `sfx.max_per_minute` and `min_gap_s` are the same arrangement as
  `overlays.density`: numbers the compiler enforces (dropping the
  lowest-priority cues on a collision) and the validator re-checks. The
  theme picks *which* sound; this picks *how many*, and without it a cue
  per overlay at a 2.4 s hold is 25 a minute.
- `music.min_span_s` is a floor on how often the bed may change. A
  two-beat mood blip restarting the score reads as a bug, so a short run
  is absorbed into its longer neighbour before any bed is chosen.
- `video_type` is how a pack says which preset it implements. It is
  optional — a pack without one suits any type — and it is advisory: the
  channel's own `video_type` is what the pipeline reads, and the field
  only narrows the picker on the Channels screen. Adding a video type is
  therefore duplicating a pack and retuning it, on the Style Packs
  screen, with no deploy.
