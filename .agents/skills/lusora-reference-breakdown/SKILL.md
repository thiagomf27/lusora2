---
name: lusora-reference-breakdown
description: Break a reference — a video, screenshots, or someone else's component code — into overlay moments, then route each one to a theme token, an existing entry, a prop extension, or a new component. Use whenever the user shares something and says "I want this look" or "make something like this". Hand off to lusora-overlay-authoring to build whatever the breakdown proves is missing.
version: 1.0.0
---

# Breaking down an overlay reference

A reference arrives as a video, a set of stills, or a folder of someone else's
components. The job is to turn it into a decision, not a description.

**The golden rule:**

> A reference is never a pack. It is one look, a handful of shapes, and a
> rhythm. Almost always the look is a theme, the shapes already exist, and only
> the leftovers are new.

The failure mode this skill prevents: watching a documentary, feeling it is
"a documentary style", and producing a documentary pack of 26 restyled twins.

---

## Part 1 — The three-column split

Every moment in a reference decomposes into exactly three things. Keep them
apart from the first second or the analysis collapses.

| Column | Question | Routes to |
| --- | --- | --- |
| **SHAPE** | What geometry and what data? | component / entry / prop |
| **LOOK** | How is that geometry dressed? | theme tokens |
| **RHYTHM** | How often, how long, in what order? | style pack |

Two overlays with the same SHAPE and different LOOK are **one component**.
Two overlays with the same LOOK and different SHAPE are **two components under
one theme**. Say this out loud for each moment; it resolves most cases.

---

## Part 2 — Procedure

### Step 0 — Load the target catalog

Read `contracts/catalog.json` and every `contracts/component-packs/*.json`, plus
`engine/src/themes/runtime.ts`, `contracts/schemas/theme.schema.json` and
`docs/03-contracts/theme-and-style.md`.

The doc is not optional reading. The schema tells you a token EXISTS; the doc
tells you which kind it is — a SCALE token with an identity element, or a
CHOICE token that carries no default and falls back to each component's own —
and it carries the resolver list. Step 5 cannot route a "maps to no token" row
correctly without both, and the resolver list is the difference between
proposing a fifth colour and finding the derivation that already covers it.

Note also that packs resolve ADDITIVELY over `core` (D67): a channel gets core
plus its pack, never a pack instead of core. A shape you find in `core` is
covered for every channel.

You cannot route anything without knowing what already exists and which tokens
already exist. Do not skip this to save time — every wrong "this is new"
verdict traces back to skipping it.

### Step 1 — Inventory the moments

Walk the reference start to end and list every distinct graphic moment.

- **Video:** timestamp each one (`0:14`, `0:31`). Note repeats — the same
  overlay appearing six times is one moment, and that repetition is RHYTHM
  data, not six moments.
- **Stills:** one row per image; note anything mid-animation.
- **Code:** one row per component; read `defaultProps` for the shape and the
  render function for the look.

Give each moment a neutral working name that describes what it draws, never
what it feels like. `two_series_line_chart`, not `elegant_data_viz`.

### Step 2 — Extract SHAPE

For each moment, write down:

- the **geometry**: panel, strip, full-bleed, annotation-on-top, split, grid
- the **data it carries**, as a prop signature: `series[{name, points[{x,y}]}]`,
  `slices[{label, value}]`, `image + name + dates`
- the **anchor type** it serves: number, percentage, comparison, place, date,
  name, quote
- the **screen region**: `{y_min, y_max}` as fractions

Two moments with the same prop signature and the same anchor type are the same
shape, regardless of how differently they look.

### Step 3 — Extract LOOK

Do not free-write about style. Read the reference against this grid, every
line, every moment. Missing rows are how tokens get missed.

```
composition     centered (a card floated over the shot) | poster (owns the frame)
background      bleed | panel | plate | none
panel fill      none | translucent | solid
corners         square | soft | rounded
border / rule   none | hairline | normal | heavy     + where (top, left, full)
overlay texture none | paper | grain | scanline      (the PLATE the type sits on)
frame grain     none | archival | film               (a post-look over the WHOLE frame)
display face    serif | sans | condensed | mono      + weight
body face       serif | sans | mono                  + weight
case            as_written | upper | sentence
tracking        tight | normal | wide
size hierarchy  ratio of title : number : kicker : body : caption — the five
                roles typeScale() moves by different amounts
density         tight | normal | airy    (padding as a fraction of the panel)
color count     how many distinct hues actually appear
accent role     what the one accent color is used FOR
chart grid      none | horizontal | full
chart legend    inline (labels at series end) | bottom
                (observing NO legend is a real answer, but there is no `none`
                 token for it — that row routes to a proposal in Step 5)
chart axis      muted (scaffolding) | ink (the labels are content)
chart markers   none | dot
chart stroke    hairline | normal | heavy
number format   plain (50,000) | compact (50.0K)
entrance        fade | rise | slide | wipe | pop | typewriter
                (a REQUEST: a component that cannot honour it degrades to fade.
                 "draws on" is a component's own reveal, not a theme entrance)
easing          smooth | snap | spring (overshoots) | linear
motion feel     slow_heavy | neutral | fast_light     (scales every duration)
hold            seconds on screen
```

Then state the **one-look rule**: all moments in one reference should produce
one consistent set of answers. If they don't, either the reference mixes two
sources, or one of the moments is depictive (see Part 4). Flag it; do not
average them into a mush.

### Step 4 — Route SHAPE

Per moment, in this order. Stop at the first match:

1. **Existing component draws it** — note the name. Done, zero cost.
2. **Existing component draws it with one more prop** — propose the prop
   extension. Name the component and the prop. Adding a prop beats adding a
   sibling.
3. **Existing shape, new situation** — new catalog entry on an existing
   template or component. No code.
4. **Nothing carries the data shape** — new component. Name the closest
   existing sibling and the one clause that separates them. If you cannot write
   that clause, go back to 1 — it is not new.
5. **It is a sequence of shots, not a graphic** — RHYTHM. A component draws one
   thing for one hold. Rapid cuts, zoom-between-maps, "what's coming next"
   teases are compiler, style pack, or prompt-pack concerns.

### Step 5 — Route LOOK

Every row of the Step 3 grid maps to an existing token, or it doesn't.

- **Maps to a token** — it belongs in a theme file. Write the value.
- **Maps to no token** — propose an **enum** with a default equal to current
  behaviour. Name it, give its values, say which components would read it.
  Never propose a numeric token.
- **Maps to a fifth color** — you want a resolver, not a token. Say so.

The token-or-resolver test is whether the derivation has an **identity** — a
value it returns when the theme says nothing. `mutedInk` does (a readable
neutral comes back untouched), so it needed no token; `chart.axis` does not
(scaffolding and content are a genuine either/or), so it had to be one.

The output is a theme file, plus a short list of proposed enums.

### Step 6 — Route RHYTHM

From the timestamps: overlays per minute, typical hold, whether overlays
cluster or spread, whether entrances vary or repeat, sound cue frequency.
That is a style pack: `overlays.density`, `pacing`, `sfx.max_per_minute`.

---

## Part 3 — Output format

Produce exactly this. Nothing else, and no prose summary of "the vibe".

```markdown
## Reference: <name / url / repo path>

### Verdict
One theme (<proposed name>) + N existing entries + M prop extensions
+ P new components + Q proposed tokens. <One sentence.>

### Moments
| # | Time | Working name | Shape (props) | Anchor | Routes to | Verdict |
|---|------|--------------|---------------|--------|-----------|---------|
| 1 | 0:14 | two_series_line_chart | series[{name,points}] | comparison | LineChart | covered |
| 2 | 0:31 | ranked_list_of_five | items[{rank,label,value}] | comparison | — | NEW: RankingList (vs BulletList: carries an ordinal and a value) |

### Theme: <name>
| Grid row | Observed | Token | Value | Status |
|----------|----------|-------|-------|--------|
| corners | square | surface.radius | square | exists |
| chart legend | labels at series end | chart.legend | inline | exists |
| texture | fibrous paper | surface.texture | paper | PROPOSED |

### Proposed tokens
- `<block>.<name>`: `a | b | c` — default `a` (current behaviour).
  Read by: <components>. Needed because: <the observed difference>.

### New components
- `<Name>` — props `<signature>`. Nearest sibling `<X>`.
  when_to_use: <one clause>. when_not_to_use: <names X and its case>.
  Pack: <core | existing pack | NEW pack>. A healthy pack is 3–6 entries, all
  of them geometry core cannot carry; below three, say so and put them in core
  instead (D69 — a two-entry pack still costs a channel a decision and the
  planner two entries).

### Style pack
density: <n>/min · typical hold: <n>s · pacing: <slow|medium|fast> · sfx: <n>/min

### Not overlays
<items that are editing patterns or script devices, with where they belong>
```

---

## Part 4 — Reference-type specifics

### Video

- Scrub for the **repeat**, not the standout. The overlay used eleven times
  defines the channel; the one clever moment at 2:40 usually shouldn't become a
  component at all.
- Separate the overlay from the **footage** underneath. A grainy archival look
  often comes from the b-roll, not from any token, and chasing it with
  `surface.texture` produces a worse result than sourcing better footage.
- Judge entrance and easing from motion, not from a still. A still cannot tell
  you `snap` from `smooth`.

### Images / screenshots

- Screenshots hide RHYTHM entirely. Say so rather than guessing, and mark the
  style pack section as unknown.
- Beware reading a mid-animation frame as a final layout.
- Two stills that differ on five grid rows are **two themes**, not one theme
  and not two components. Make the user pick.

### Someone else's code

This is the richest source and the easiest to over-copy.

- Read `defaultProps` for the SHAPE. Read the render function for the LOOK.
- Every hardcoded literal in their render function is a LOOK row: `fontWeight`,
  `letterSpacing`, `textTransform`, `borderRadius`, padding fractions, stroke
  widths, gridline decisions, number formatting.
- Their **file names lie**. `PaperLineChart`, `ArchiveLineChart` and
  `MinimalLineChart` are one shape and three themes. Group their files by prop
  signature, not by name, before doing anything else.
- Their component boundaries encode *their* architecture. Import the shapes and
  the token values; never import the file structure.
- Copy no colors, fonts, or literals into a component. They go in a theme file
  or they do not come across at all.

---

## Part 5 — Traps

- **"This whole reference is a new pack."** Almost never. Route each moment
  individually and count the verdicts before saying the word pack.
- **Naming a component after the reference.** If the proposed name would work
  as a theme name — `Paper`, `Archive`, `Bold`, `Noir` — it is a theme.
- **Depictive moments.** A tweet, a comment, a browser window, a newspaper page
  renders its own real chrome and is theme-exempt. Do not put its colors into
  the theme grid; it will pollute the whole look.
- **Confusing footage treatment with overlay treatment.** Letterboxing, film
  burn, speed ramps and color grade are not overlays.
- **Averaging two references.** If the user sends three references, run this
  three times and produce three themes. Then help them choose.
- **Proposing a numeric token** to capture something the grid couldn't hold.
  Widen the enum instead.

---

## Handoff

The breakdown is an analysis artifact, not an implementation plan. Once the
user approves it, switch to `lusora-overlay-authoring` and build in this order:
proposed tokens first, then the theme file, then prop extensions, then new
components, then the style pack.

---

## Prompt to invoke this

```
Use .agents/skills/lusora-reference-breakdown/SKILL.md.

Reference: <paste url / attach stills / give repo path>
Target channel: <war documentary | finance | explainer>

Read the merged catalog and the theme schema first, then produce the breakdown
in the Part 3 format. Route every moment individually. Do not write any code
and do not create any files — I want the verdict table before anything is
built.
```
