# Reference: remotion.dev/elements — Data, Overlays, Storytelling

Run with `.agents/skills/lusora-reference-breakdown`. Source read from each
element's page, which publishes the component verbatim; every value below is
lifted from that code, not from a still.

`INVENTORY.md` triaged this catalogue once already, at pack level, and reached
the right verdict: **"`bold-editorial` is the Remotion Elements style, and it is
a theme, not a pack."** This is the per-element pass under it — which of the
nine moments in the three named families the shipped components actually draw,
and what was missing.

---

## Verdict

**Four references, not one.** One theme (already shipped as `standard`) + 5
existing entries covered + 4 component fixes + 0 new components + 0 new packs
+ 0 new tokens. Every gap was a component ignoring a token it already claimed
to honour — nothing in Data, Overlays or Storytelling needed geometry the
catalogue does not carry.

The Data family is one consistent look and `contracts/themes/standard.json` is
that look, token for token (grid below). Overlays and Storytelling are **not**
the same look — different faces, different tracking, different case, different
corners. The one-look rule (Part 2 of the breakdown skill) fails here for a
structural reason, not a defect: Elements is a catalogue of independent
contributions, so it is four references sharing a URL. They are not averaged
below.

---

## Moments

| # | Element | Working name | Shape (props) | Anchor | Routes to | Verdict |
|---|---------|--------------|---------------|--------|-----------|---------|
| 1 | Data / Vertical Bar Chart | highlighted_column_set | `series[{label,value}]` + `highlight_index` | comparison | `BarChart` (vertical) | covered — D70 |
| 2 | Data / Horizontal Bar Chart | ranked_slab_rows | same, `orientation: horizontal` | comparison | `BarChart` (horizontal) | **fixed** — had no poster branch |
| 3 | Data / Line Chart | single_series_trend | `series[{name,points}]` | comparison | `LineChart` | covered — D70 |
| 4 | Data / Number Counter | counting_figure | `value` | number | `AnimatedCounter` | **fixed** — had no poster branch |
| 5 | Data / Pie Chart | share_of_whole_with_key | `slices[{label,value}]` | percentage | `PieChart` | **fixed** — `chart.legend` was declared and ignored |
| 6 | Overlays / Name Lower Third | name_role_bars | `name` + `role` | name | `NamePlate` | covered (shape); look is a proposal, below |
| 7 | Overlays / Location Lower Third | place_venue_slug | `place` + `date` | place | `DateStamp` (`position: bottom_left`) | covered, with a prop extension named and **not** taken — below |
| 8 | Storytelling / News Article Highlight | annotated_page | `text` + `marks[]`, on paper | quote | `HighlightedPassage` (+ `DocumentCard`) | **fixed** — had no poster branch |
| 9 | Storytelling / Polaroid Pictures | instant_photo_scatter | `frames[{image,label}]` | name / place | `PortraitPlates`, `FramedExhibit(frame_style: polaroid)` | covered (shape); scatter is depictive dressing |

Nothing reached step 4 of the routing order (*nothing carries the data shape*).
Every element in three families is drawn by a component that already exists,
which is the outcome the golden rule predicts and the reason no pack was
created.

---

## Theme: the Data family IS `standard`

Read off `vertical-bar-chart.tsx`, `horizontal-bar-chart.tsx`,
`line-chart.tsx`, `pie-chart.tsx`, `number-counter.tsx`. Ratios are against the
1080-tall frame those files are written for.

| Grid row | Observed | Token | Value | Status |
|----------|----------|-------|-------|--------|
| composition | full-bleed `#f5f6f7`, `padding: 56` (5.2%), title top-left | `layout.composition` | `poster` | exists |
| background | bleed | — | — | — |
| panel fill | bars, key rows and the value badge are filled plates | `surface.fill` | `solid` | exists |
| corners | `borderRadius: 12` on bars, badge, key rows | `surface.radius` | `soft` | exists |
| border / rule | baseline `3px #c5cad2`; line-chart gridlines `2px #d1d5db` | `surface.rule` | `normal` | exists |
| overlay texture | none | `surface.texture` | `none` | exists |
| frame grain | none | `grain` | `none` | exists |
| display face | Inter 800 | `typography.display` | `Inter` | exists |
| body face | Inter 700 | `typography.body` | `Inter` | exists |
| case | `Jonny`, `Mar`, `Focused work` — never caps | `typography.case` | `sentence` | exists (D70) |
| tracking | title `-3.8/76` = −0.05em; value `-1.6/48` = −0.033em | `typography.tracking` | `tight` | exists |
| size hierarchy | title 76 : value 48 : label 40 → `0.070 : 0.044 : 0.037` | `typography.scale` | `normal` | exists |
| density | `padding 56`, `gap 42` | `surface.density` | `normal` | exists |
| colour count | 4 — `#f5f6f7` `#111827` `#2858e8` + one muted grey | `colors` | as shipped | exists |
| accent role | the ONE datum the sentence is about | — | `highlight_index` | prop |
| chart grid | bars: a baseline and nothing else; line: 4 ruled values | `chart.grid` | **omitted** | exists |
| chart legend | line names its latest point in a filled badge | `chart.legend` | `inline` | exists |
| chart axis | bar category labels are `#111827` at 700 — content, not scaffolding | `chart.axis` | `ink` | exists (D70) |
| chart markers | a white-filled circle at every point | `chart.markers` | `dot` | exists |
| chart stroke | `strokeWidth: 12` on a 520-tall plot | `chart.stroke` | `heavy` | exists |
| chart area | area under the trend at `opacity: 0.1` | `chart.area` | `tint` | exists (D69) |
| number format | `80K`, `74K` | `chart.number_format` | `compact` | exists |
| entrance | values translate up from behind a mask as the bar lands | `motion.entrance` | `rise` | exists |
| easing | `Easing.spring({damping: 14.5, mass: 0.8, stiffness: 100})` | `motion.easing` | `snap` | exists |
| motion feel | whole element in 4.00s | `motion_feel` | `fast_light` | exists |

`chart.grid` stays **omitted** deliberately: naming `none` would take the bar
chart's baseline away too, and the reference draws one. That is the choice-token
design working — an omitted token keeps each component's own.

### The one row the token set cannot hold

The reference's Line Chart labels its trend where the line ends (`inline`) and
its Pie Chart labels its slices in a filled key beside the ring (`bottom`).
Under `chart.legend` those are the two values of ONE token, so a single theme
cannot have both. `standard` names `inline`, which is right for the line and
leaves the pie naming its wedges on the ring.

This is not a missing token. `legend` is a genuine either/or about how a reader
is asked to cross-reference, and the reference is internally inconsistent about
it — which a catalogue of independent contributions is entitled to be and a
channel is not. A theme that wants the key form now has it: set
`chart.legend: "bottom"` and `PieChart` draws it.

### Overlays and Storytelling are their own looks

Recorded so nobody later averages them into `standard`:

| | Name Lower Third | Location Lower Third | News Article Highlight | Polaroid Pictures |
|---|---|---|---|---|
| face | Inter 700 / 500 | Arial 700 / 500 | Georgia 700 + Arial | Caveat 600 |
| case | UPPER | as written | mixed (masthead upper) | as written |
| tracking | `+1.2` (wide) | `-1` (tight) | masthead `+3.8` | — |
| corners | square | — | square | square |
| fill | two solid bars, `#2563eb` over `#18181b` | none | white page, `1px #d9d9d6` | `#f8f1e5` card + tape |
| palette | outside the four | outside the four | outside the four | outside the four |

Four grid rows apart is two themes, not one (Part 4 of the skill). None of them
is `standard`, and none of them is a component.

---

## Proposed tokens

**None.** Every gap resolved to a component reading a token it already had.

Two deliberate non-proposals, recorded so they are not re-derived:

- **The Name Lower Third's plate is `#2563eb`** — its *accent* — with white
  type, where `NamePlate` sets ink on `colors.bg`. Making that reachable means
  either a fifth colour or a `surface.plate: page | accent` token. It is neither
  obviously a scale token nor obviously a choice with no identity, and one lower
  third is not enough evidence to close the question. Left open;
  `variant: "boxed"` is the nearest shipped lockup.
- **`DateStamp.lead: "date" | "place"`.** `DateStamp` and the Location Lower
  Third draw the same shape — two lines in a corner, a display-face headline
  over a muted second line — but opposite ways round: `DateStamp` leads with the
  date and qualifies it with the place, and the reference leads with the place
  and qualifies it with the venue and date. That is one prop. It is not taken
  here because it only pays off once `date` stops being `required`, and that is
  a change to a shipped catalog entry's contract that the planner sees — it
  deserves its own decision rather than arriving as a side effect of a look
  pass. Until then a place-led slug is authorable but not plannable.

---

## New components

**None.** Two candidates were considered and rejected:

- **A merged "annotated newspaper page"** (element 8). `DocumentCard` draws the
  paper with a masthead, a rule, body lines and a signature; `HighlightedPassage`
  draws a passage with marks landing on phrases. The reference is both at once.
  Neither can carry the other's data, but a third component would duplicate both
  and could not be told apart from either in one `when_to_use` clause — the test
  at step 4. It stays two entries, and a beat that wants the reference reads as
  `HighlightedPassage` (the marks are the point) or `DocumentCard` (the document
  is the point).
- **A "photo scatter"** (element 9). Three instant photos at −8°/+6° with tape,
  a developing overlay and handwritten captions is `PortraitPlates`' shape with
  `FramedExhibit`'s `polaroid` mount. An instant photo is a real-world artifact,
  so its cream stock and its tape are depictive chrome, not the channel's theme
  (Part 4 of the authoring skill) — and none of it is a data shape core cannot
  carry.

---

## Style pack

The reference does not have one: every element is a standalone 4–5s composition
with no video around it. Recorded as unknown rather than guessed.

Per element, for whoever tunes `pacing` later: hold 4.00s (all of Data and
Overlays), 5.00s (both Storytelling), 30 fps, one overlay on screen at a time.

---

## Not overlays

- **The News Article Highlight's camera.** `perspective: 1800`, rotateX 7.5°→
  −7.5°, rotateY −7.5°→7.5°, scale 1→1.045 and a blur ramp 16→0→8 across the
  hold. That is a treatment of the whole frame over time, not an overlay: it
  belongs to the compiler or a style pack, alongside the ken-burns push that
  `FramedExhibit` already runs inside its own mount.
- **The Polaroid drift.** Container scale 1→1.035 with an 18px lift over the
  hold — same category.
- **The Backgrounds, Captions, Commerce, Maps, Text Effects and YouTube
  families**, which are out of the three this pass covers. `INVENTORY.md`
  already routed the ones that matter: the hand-drawn Text Effects are three
  values of `HighlightedPassage.marks[].style`, and the map flyover is deferred
  behind a tile provider.

---

## What was built

Four components, all under `layout.composition` / `chart.legend`, which they
already declared in `honors`. No shipped theme other than `standard` moves,
because every one of them names `centered` by omission and `legend: inline`.

| Component | Change |
|---|---|
| `BarChart` | `orientation: "horizontal"` gained the poster composition it was left out of at D70. A poster row is a slab sized to the height the headline leaves, not a rule sized to a fraction of the frame, and its name and figure are set inside it at ratios taken off the reference (0.22 : 0.30 : 0.36 of the row). The rail behind a bar now answers to `chart.grid` — it is the baseline seen end-on. |
| `AnimatedCounter` | Gained the poster composition. The label becomes the headline and the figure takes the page, measured with `fitText` against the SETTLED value so it does not resize as digits arrive. |
| `PieChart` | `chart.legend: "bottom"` now draws the reference's key: one filled row per slice in that slice's colour, carrying its share, wiping in as the sweep passes its own wedge. The ring gives up the width the key needs. |
| `HighlightedPassage` | Gained the poster composition — the passage as the page rather than a card floated over the shot. |

Two bugs fell out of the horizontal poster and are fixed with it:

- `BarChart`'s inside-bar figure asked only whether IT fitted the bar, never
  whether the name was already in there. At a poster row's type size that put
  `9.2K units` on top of `Germany`. Both are measured now, and a figure with no
  room outside either stays inside rather than leaving the frame.
- A `source` credit is positioned against the bottom of the frame, so a poster
  running its content to the padding box printed the credit through it. The
  band is reserved, the way `LineChart` already reserves one.

---

## Verification

The acceptance test in `lusora-overlay-authoring` is "render under two maximally
different themes and look at both". For a change that is supposed to move ONE
theme, the stronger test is the other half: render the shipped themes before and
after and require the bytes to match.

Method: `git stash` the component changes, `preview-batch.mjs` each theme,
snapshot the stills, restore, render again with the **same batch composition**
(the still is cut out of one mp4, so a batch of three and a batch of one encode
differently and `cmp` is meaningless across them), then `cmp` pair by pair.

Result, at 1280×720:

| | AnimatedCounter | PieChart | HighlightedPassage | BarChart (horizontal) |
|---|---|---|---|---|
| `paper-print` | identical | identical | identical | identical |
| `bold-editorial` | identical | identical | identical | **changed — intended** |

The one intended change is `bold-editorial`, which names `chart.grid: "none"`
and now loses the rail behind its bars, the same statement that already takes
the baseline out from under its columns.

Two false starts the byte test caught, both of which would have shipped as
"looks fine to me":

- Moving the inside-bar `fontSize` off the wrapper and onto the two spans left
  `letterSpacing` — which is in `em` — resolving against the page's inherited
  16px instead of the bar's own type. On `paper-print`, whose hairline stroke
  makes that type about 5px, the tracking came out three times too wide on
  every label in the chart.
- `flexShrink: 0` on `PieChart`'s `<svg>`, added for the key row, is not inert
  when there is no key row: it is a `style` prop on an element that had none,
  and it moved `bold-editorial`'s ring by a fraction of a pixel — 5.4% of the
  frame's subpixels, up to 32 levels, on every antialiased edge.

Also run: `pnpm run validate:schemas`, `pnpm --filter @lusora/engine run
catalog:check`, `tsc --noEmit`, and the engine suite (85 pass / 0 fail).
