---
name: lusora-overlay-authoring
description: Decide whether an overlay request is a theme, a style pack, a catalog entry, a component or a new pack — then author it so themes can restyle it without a code change. Use whenever the user asks to add, restyle, duplicate, or "make a pack for" an overlay in LUSORA. Load remotion-best-practices alongside this when writing React.
version: 1.0.0
---

# Authoring overlays in LUSORA

Four layers. Almost every request lands in the first two. The expensive
mistake — the one this skill exists to prevent — is answering a look request
with a new component.

| Layer | Answers | Cost | Lives in |
| --- | --- | --- | --- |
| Theme | how it looks and moves | one JSON file | `contracts/themes/<name>.json` |
| Style pack | how often, how long, which packs | one JSON file | `contracts/style-packs/<name>.json` |
| Entry | when the planner picks it | one JSON object | `contracts/component-packs/<pack>.json` |
| Component | what geometry is drawn | React + registries | `engine/src/components/<pack>/<Name>.tsx` |

---

## Part 1 — STOP. Which layer is this?

Answer in order. Stop at the first YES.

1. **Does something already draw this, just wrong-looking?**
   Colors, fonts, weight, case, tracking, spacing, corners, rules, gridlines,
   entrance, easing, texture, which cue plays — **theme**.
   *Never copy a component to restyle it.*
2. **Does it appear too often / too rarely / hold too long?**
   → **style pack** (`overlays.density`, `pacing`, `sfx.max_per_minute`).
3. **Is it an editing pattern rather than a graphic?**
   "rapid image cuts", "zoom between three maps", "teasing what's next" — those
   are sequences of shots, not overlays — **style pack, compiler, or prompt
   pack**. A component draws one thing for one hold.
4. **Is it a different on-screen situation, but the same shape and props?**
   → **new entry on an existing template**. No code.
5. **Is it the same shape with one more prop?**
   A bar chart that also needs `orientation`; a region map that needs
   `regions[]` instead of `region` — **extend the existing component**.
   Adding a prop is always cheaper than adding a sibling.
6. **Does it need geometry or a data shape nothing can carry?**
   OHLC arrays, a polygon, a photo, a table of rows, browser chrome
   → **new component**. This is the ONLY reason to write code.

If the answer is 1, 2 or 3, say so and stop. Do not create files.

### The two-name test

If the proposed name would work as a **theme** name, it is a theme.
`Archive`, `Minimal`, `Paper`, `Elegant`, `Modern`, `Crime`, `Bold` all fail.
`PieChart`, `PortraitCard`, `Candlestick`, `SocialPost` pass.

A component name describes **what it draws**. It never describes a look, a
channel, or a niche. `PaperLineChart`, `ArchiveLineChart` and `DocLineChart`
are one component called `LineChart`.

---

## Part 2 — When a new PACK is justified

A pack is a **menu extension**. It is never a look and never a niche.

Only create one when step 6 fires **two or more times for the same domain**.

Derive it, never invent it:

1. List the recurring on-screen facts of the vertical.
2. Map each to an anchor type (`number, percentage, comparison, place, date,
   name, quote`) and to a primitive or existing component.
3. Everything that maps is **core + a theme**. Only the remainder is the pack.

A correctly derived pack is **3–6 entries**. If it approaches 26, it is a clone
of `core` and the real request was a theme.

Pack slugs are domain nouns: `finance`, `social`, `markup`, `sports-stats`.
Never `documentary`, `crime`, `elegant`, `minimal`, `archive`, `history`.

**Packs are additive over `core`.** A channel gets `core` plus its pack, so a
pack never re-declares a counter, a chart or a lower third that core has.

---

## Part 3 — Building components that stay open to themes

This is the part that decides whether the system scales. A component is
"open" when a theme can restyle it into an unrecognisably different look
**without touching its file**.

### The rule

> Every visual decision is either read from a theme token, or derived from
> `useVideoConfig()`. There is no third source.

A literal in a component file is a bug unless it is a *proportion of the
frame*. These are all bugs:

```tsx
fontSize: height * 0.055,      // scale is a token
fontWeight: 700,               // weight is a token
letterSpacing: "0.1em",        // tracking is a token
textTransform: "uppercase",    // case is a token
padding: height * 0.04,        // density is a token
borderRadius: 12,              // surface.radius is a token
stroke: "#c8a24a",             // seriesColors(theme)
```

Correct form:

```tsx
const { width, height } = useVideoConfig();

fontSize: height * typeScale(theme, "title"),
fontWeight: typeWeight(theme),
letterSpacing: typeTracking(theme),        // ...or capsTracking(theme, 0.06) when the
                                           // tracking exists only BECAUSE of the caps
textTransform: typeCase(theme),
padding: height * 0.04 * densityScale(theme),
...surfaceStyle(theme, { radius: 12 }),   // 12 is this component's PROPORTION, scaled by the token
stroke: seriesColors(theme)[i],
```

Note that `surfaceStyle` **scales** the component's own value rather than
replacing it — a card at 12 and a lower third at 8 keep their relationship
under `rounded`. Every resolver you add follows that pattern.

### The workflow when you need a look the tokens can't express

You will hit this constantly, and it is the moment the system either stays
clean or rots. The answer is **always the same**:

1. Name the visual difference in one phrase ("gridlines are full, not just
   horizontal").
2. **Add a token for it** in `contracts/schemas/theme.schema.json`, as an
   **enum, never a number**. Numbers invite `radius: 13`, and the word stops
   meaning one thing system-wide.
3. Default it to **today's hardcoded value**, so every existing theme renders
   byte-identically (Principle 7) and unconverted components ignore it.
4. Add a resolver in `engine/src/themes/runtime.ts`. The engine owns the pixel
   values; the theme picks a word.
5. Have the component read the resolver.

Never: fork the component, add a `variant` prop, or accept a color as a prop.
A `variant: "paper" | "archive"` prop is a theme smuggled through the planner —
and the planner must never choose a look.

### Scope tokens by concern

Tokens live in blocks so they stay findable, and so a chart token never has to
be set on a theme that draws no charts:

```yaml
typography:  display, body, scale, weight, case, tracking, caption_preset
surface:     radius, fill, accent_rule, density, rule, texture
layout:      composition                    # D70 — where the overlay sits in the FRAME
motion:      entrance, easing, per_component
chart:       grid, legend, axis, markers, area, stroke, number_format
colors:      bg, text, accent, neutral      # everything else is DERIVED
sound:       pack, entrance, per_entrance, mood_beds, gain
```

**Colors stay at four.** Anything else is derived by a resolver
(`surfaceColor`, `seriesColors`, `contrastInk`, `paperStock`, `mutedInk`) so a
new component works under themes authored before it existed. Wanting a fifth
color token is the signal that you wanted a resolver.

**Resolver or token?** Both derive an appearance from the theme, and the test
is whether the derivation has an IDENTITY — a value it returns when the theme
says nothing:

- `mutedInk(theme)` returns the theme's own `neutral` whenever that is already
  readable, so themes authored before it are untouched. No token.
- `chart.axis` is a genuine either/or — an axis label is scaffolding or it is
  content, and neither answer is the neutral one. Token.

A derivation with an identity is a resolver. One without is a token, and it
carries **no schema default** (the `accent_rule` precedent), so it falls back to
the component's own.

**Not every token is a surface token.** Everything through D66 changed what an
overlay was painted IN; `layout.composition` changes what it IS — `centered` is
a card floated over the shot, `poster` hands the component the frame. If four
themes over your component give four palettes of the same picture, the missing
token is probably a composition, not another colour. There is deliberately no
`layout.width` or `layout.height`: under a poster those are not separate
decisions, because the content box is the frame minus its padding and
`surface.density` already scales that padding.

### Declare what you honor

Every component declares which optional tokens it can obey:

```ts
LineChart.honors = ["typography", "surface", "chart", "motion.entrance"];
BarChart.honors  = [..., "layout.composition"];   // only if it HAS a poster branch
```

Two reasons. `motion.entrance` is a **request, not a guarantee** — a typewriter
entrance is meaningless on a bar chart and must degrade to `fade` silently
rather than render broken. And the Overlays screen can show an author which
knobs actually do something for this overlay.

### Depictive components are theme-EXEMPT

One real exception, and it must be explicit or someone will "fix" it later.

A component that **depicts a real-world artifact** — a tweet, a YouTube
comment, a Reddit card, a browser window, a newspaper page — renders that
artifact's own chrome, not the channel's theme. Twitter blue is not the
channel's accent. Theming it makes it *wrong*, not branded.

Such a component:

- declares `honors: ["motion.entrance", "surface.density"]` and nothing else
- carries its own palette internally, keyed by a `platform` prop
- takes the theme only for how it *arrives* and how much room it occupies

Everything non-depictive — charts, cards, titles, lower thirds, maps, tables —
is fully themed. There is no middle category.

### The acceptance test

> Render the component under **two maximally different themes** and look at
> both. If a stranger could not tell they came from the same component, it is
> correctly open. If they look nearly identical, appearance leaked into the
> file.

```
node engine/scripts/preview-overlay.mjs <Name> '<props>' --theme paper-print
node engine/scripts/preview-overlay.mjs <Name> '<props>' --theme bold-editorial
```

---

## Part 4 — Writing entries the planner can choose between

`when_to_use` is a **decision boundary**, not a description. The whole catalog
sits in the prompt of every plan call, so entries stay terse and every word
must help the planner discriminate.

Per entry:

1. Find the nearest neighbour in the **merged** catalog (core + this pack).
2. Write the single clause that separates them.
3. `when_not_to_use` names that sibling explicitly and the case it wins.

**If you cannot write step 2 in one clause, it is a duplicate — delete it and
reuse the sibling.**

Good: `"a single figure worth dwelling on ('29,000 tanks')"` /
`"two values compared (ComparisonSplit); a figure that sits in the corner while
the shot continues (StatTag)"`

Bad: `"an elegant animated number for documentary videos"` — describes a look,
names no sibling, gives the planner nothing to choose on.

### Collision lint

Within one resolved menu, no two entries may share all three of
`(template | component)` + prop signature + `anchor_types`. If they do, the
planner is choosing between them at random. Add this to
`engine/test/catalog.test.ts`.

### Selection eval

Run the planner over ~30 fixture beats and count picks per entry. An entry
never picked, or picked interchangeably with a neighbour, is dead prompt weight
in every video you will ever render.

---

## Part 5 — Remotion rules for this engine

Load `remotion-best-practices` for framework detail. Project-specific:

- A component takes `{ props, theme }` and nothing else.
- Pure function of `frame`. No `Date.now()`, no `Math.random()`, no CSS
  `transition` / `@keyframes` — they will not render.
- `interpolate` always with `extrapolateLeft/Right: "clamp"`; `spring` always
  with `fps`.
- Measure text with `@remotion/layout-utils` before laying out anything that
  must not overflow. A token that changes `scale` or `tracking` changes text
  width, so a layout that only works at `normal` breaks under `generous`.
- Declare `entrance_support` honestly; `sound.per_entrance` keys off the
  entrance that *actually* plays after degradation.
- Declare `region` (`{y_min, y_max}` as fractions from the top) so the compiler
  can lift captions clear.
- Fonts come from the packaged set by name via `typography.display` / `body`.
  Never import a font inside a component.

### The registries that must move together

A name missing from any one of these fails **quietly**:

1. `engine/src/components/<pack>/<Name>.tsx`
2. `COMPONENTS` in `engine/src/components/index.ts` — unregistered renders nothing
3. `CORE_COMPONENTS` in `engine/src/catalog/registry.ts` (core only), then
   `pnpm --filter @lusora/engine run catalog`; non-core packs are data in
   `contracts/component-packs/<pack>.json`
4. `overlays.allowed_packs` in the style packs that should offer the pack
5. core entries only: sample props in `engine/src/catalog/sample-props.json`

### Verify

```
pnpm run validate:schemas
pnpm --filter @lusora/engine test
node engine/scripts/preview-overlay.mjs <Name> '<props>' --theme <a>
node engine/scripts/preview-overlay.mjs <Name> '<props>' --theme <b>
```
