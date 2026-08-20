# Packs & themes to build — war doc, finance, explainer

Derived with the rules in `lusora-overlay-authoring`. Three channels, one menu,
five looks.

---

## 1. Token additions required first

None of the themes below are expressible with the current D46 token set. These
are the prerequisites. All enums, all defaulting to today's hardcoded value.

```yaml
typography:
  scale: normal          # compact | normal | generous     -> every fontSize ratio
  weight: regular        # light | regular | bold          -> fontWeight 300/400/700
  case: as_written       # as_written | upper              -> textTransform
  tracking: normal       # tight | normal | wide           -> letterSpacing
surface:
  density: normal        # tight | normal | airy           -> padding, panel width
  rule: normal           # hairline | normal | heavy       -> accent bars, borders
  texture: none          # none | paper | grain | scanline -> background treatment
chart:
  grid: horizontal       # none | horizontal | full
  legend: inline         # inline | bottom                 -> right-end labels vs legend row
  markers: dot           # none | dot
  stroke: normal         # hairline | normal | heavy
  number_format: plain   # plain | compact                 -> 50,000 vs 50.0K
```

Resolvers in `engine/src/themes/runtime.ts`, next to `surfaceStyle`:
`typeScale(theme, role)` where role is `title | body | caption | kicker | number`,
plus `typeWeight`, `typeCase`, `typeTracking`, `densityScale`, `ruleWidth`,
`chartStyle(theme)`.

Those eleven enums are what let one `LineChart` produce all three of your
reference images.

---

## 2. Themes (looks) — five

| Theme | For | display / body | scale · weight · case · tracking | density · rule · radius · fill · texture | chart | motion |
|---|---|---|---|---|---|---|
| `paper-print` | your paper reference | Playfair Display / Inter | generous · light · as_written · wide | airy · hairline · square · none · paper | horizontal, inline, dot, hairline, plain | rise · smooth |
| `field-manual` | war documentary | Oswald / Inter | normal · regular · upper · wide | normal · normal · square · translucent · grain | horizontal, inline, dot, normal, plain | slide · smooth |
| `bold-editorial` | Remotion Elements look | Inter / Inter | compact · bold · as_written · tight | tight · heavy · soft · solid · none | none, inline, none, heavy, compact | pop · snap |
| `ledger` | finance | IBM Plex Sans / IBM Plex Mono | normal · regular · as_written · normal | tight · hairline · square · solid · none | full, bottom, none, normal, compact | fade · smooth |
| `clean-explainer` | general explainer | Inter / Inter | normal · regular · as_written · normal | normal · normal · soft · translucent · none | horizontal, bottom, dot, normal, compact | rise · smooth |

Notes:

- **`bold-editorial` is the Remotion Elements style, and it is a theme, not a
  pack.** Their Data elements are described as "bold… with directly labeled
  data points" — that is `weight: bold` + `chart.legend: inline` +
  `chart.grid: none` + `stroke: heavy`. The only things in Elements that are
  *not* reachable by tokens are the hand-drawn markup and the map flyovers,
  which is why `markup` is a pack below.
- **`paper-print` reproduces your image 1 exactly** once `chart.grid:
  horizontal` + `legend: inline` + `markers: dot` + `number_format: plain`
  exist. Your image 2 differs only by `fill: solid` + `radius: soft` +
  `grid: full` + `legend: bottom` + `number_format: compact` — i.e. it is a
  *sixth theme*, not a second component. Pick whichever of the two you actually
  want and drop the other.
- **`field-manual` replaces both `archive` and `history-dark`.** Your existing
  `contracts/themes/archive.json` is most of it already.
- Existing `doc-minimal`, `clean-plain`, `clean-punchy`, `atlas-da-guerra` can
  stay; they cost nothing. But the three channels need only the five above.

---

## 3. Packs (menus)

### `core` — one menu, ~31 entries

Your existing 26, made look-less, plus five additions justified by data shapes
nothing currently carries:

| New core component | Why nothing covers it | Props |
|---|---|---|
| `PieChart` | share-of-whole; no existing component holds a part/whole set | `slices[{label, value}]`, `title`, `highlight_index`, `source` |
| `PortraitCard` | a person's **photo** + name + dates. `NamePlate` has no image, `FramedExhibit` has no identity fields | `image`, `name`, `dates`, `role`, `side` |
| `ImagePair` | two stills under one title (before/after, two commanders). `ComparisonSplit` is numeric | `left{image,label}`, `right{image,label}`, `title` |
| `RankingList` | a full ranked list. `RankLabel` is a single badge; `BulletList` has no ordinal or values | `items[{rank, label, value}]`, `title`, `highlight_index` |
| `DataTable` | rows × columns. `FactSheet` is a flat list | `columns[]`, `rows[][]`, `title`, `highlight_row`, `source` |

Plus two **prop extensions**, not new components:

- `RegionHighlight` — `regions[]` instead of `region` (multi-country outline,
  multi-country highlight). Also needs a Natural Earth boundary dataset so it
  stops being editor-only and the planner can pick it — that matters for the
  war channel.
- `SatelliteLocate` — `zoom: world | country | city | neighbourhood`
  ("neighbourhood map spotlight", "world map" are the same component at
  different altitudes).

### `social` — 3 entries (explainer channels)

Depictive. Theme-exempt per Part 3 of the skill.

| Component | Props |
|---|---|
| `SocialPost` | `platform: youtube \| twitter \| reddit`, `author`, `handle`, `body`, `timestamp`, `metrics{likes, replies}`, `avatar` |
| `WebPageFrame` | `image`, `url`, `highlight_region`, `caption` — browser chrome + pan/zoom on a screenshot |
| `HeadlineStack` | `items[{headline, outlet, date}]` — the "multiple items in news" montage |

`platform` is a prop, not three components: the chrome differs, the shape does
not.

### `finance` — 3 entries

| Component | Props |
|---|---|
| `Candlestick` | `bars[{t, o, h, l, c}]`, `title`, `annotations[]`, `source` |
| `MetricGrid` | `metrics[{label, value, change_pct, direction}]` — the ticker/KPI block |
| `WaterfallChart` | `steps[{label, delta}]`, `start`, `end` — how a total was built up or eroded |

### `markup` — 4 entries (all channels)

The hand-drawn annotation layer from Remotion Elements. Genuinely new geometry:
these draw *on top of* something already on screen rather than presenting their
own panel.

`TextMarker`, `CircleMarker`, `StrikeThrough`, `CalloutArrow` (you already have
the last one in core — move it here or leave it, but keep the family together).

### `maps-cinematic` — defer

`MapFlyover` (A-to-B camera move) is real and not covered by `RouteMap`, but it
needs a tile provider, an API key, and render-stability work. One entry does not
justify a pack yet. Revisit when the war channel actually needs it.

---

## 4. VidRush list — triage

| VidRush item | Verdict | Where it goes |
|---|---|---|
| youtube comments | **new** | `social/SocialPost` (platform: youtube) |
| twitter post | covered | same, platform: twitter |
| reddit card | covered | same, platform: reddit |
| website screenshot | **new** | `social/WebPageFrame` |
| multiple items in news | **new** | `social/HeadlineStack` |
| world map image / world map | covered | `SatelliteLocate` + `zoom: world` |
| travel map | covered | `RouteMap` |
| region map | covered | `RegionHighlight` |
| multi map zoom cut | **cut** | editing pattern → style pack |
| neighbourhood map spotlight | covered | `SatelliteLocate` + `zoom: neighbourhood` |
| multi country outline / highlight text | prop extension | `RegionHighlight.regions[]` |
| vertical bar chart | covered | `BarChart.orientation` |
| pie chart | **new** | `core/PieChart` |
| percentage bar chart | covered | `BarChart` + `unit: "%"` |
| multiple pie chart | prop | `PieChart` with grouped slices — one entry |
| multiline chart | covered | `LineChart.series[]` |
| stock chart | **new** | `finance/Candlestick` |
| rival versus split | covered | `ComparisonSplit` |
| three text card | covered | `BulletList` / `FactSheet` |
| three options with icon | covered | `BulletList` + `marker` (icons are an asset problem, not a component) |
| teasing what's next | **cut** | script device → prompt pack |
| paper moving transparent | **theme** | `surface.texture: paper` |
| two image one title | **new** | `core/ImagePair` |
| ranking | **new** | `core/RankingList` |
| single sentence text | covered | `HammerStatement` |
| scroll title | **theme** | `KineticTitle` + `motion.entrance` |
| rapid images cut | **cut** | editing pattern → compiler / style pack |
| rapid cut hook | **cut** | script device → prompt pack |
| portrait shoot / portrait card | **new** | `core/PortraitCard` |
| text list | covered | `BulletList` |
| table image | **new** | `core/DataTable` |
| magnifying text reveal | **theme** | `HighlightedPassage` + entrance |

**Score: 31 items — 10 new components, 3 prop extensions, 4 theme tokens,
4 cuts, 10 already covered.** Nothing in that list justifies a "documentary
pack" or a "crime pack".

### Missing from VidRush, worth adding for your niches

- `PortraitCard` covers war-doc's biggest gap (a face with a name and dates).
- **War doc also needs a troop-movement / front-line map**, which `RouteMap`
  only half covers. That is the one place a `maps-cinematic` pack might later
  earn itself.
- Finance needs `WaterfallChart` more than it needs a pie chart.

---

## 5. Build order

Steps 1–4 and the `archive` half of 6 shipped as **D66**. What is left is
5, 7 (partly), 8 and 9.

1. ~~Add the eleven tokens + resolvers, all defaulting to current behaviour.~~
   **Done.** Plus two resolvers the conversion earned rather than tokens:
   `paperStock` and `groundStyle`. `colors` stayed at four.
2. ~~Convert **one** component — `LineChart` — and render it under the three
   themes.~~ **Done**, and it paid for itself: the pilot is what surfaced that
   `chart.grid|legend|markers` cannot carry a default, and that
   `surface.fill: translucent` is the identity element rather than a real
   translucency (still true, still worth fixing — see the note under 5).
3. ~~Delete `ArchiveLineChart`.~~ **Done.** `PaperLineChart` and
   `DocLineChart` never existed.
4. ~~Convert the remaining 25 core components.~~ **Done.** 25 of 26 render
   pixel-identically under `history-dark`; the acceptance test caught eight
   leaks, five of which were the same missing idea (no ground under type on a
   light theme) and became `groundStyle(…, { legible: true })`.
5. ~~Patch `platform/src/lib/look.ts` so packs resolve additively over
   `core`.~~ **Done (D67)** — and it was load-bearing, not cosmetic: after step
   6 shrank `archive` to two entries, the one channel installing it resolved to
   a two-component menu. The Overlays grid and `look-options` were moved to the
   same rule so the screen cannot report a menu the enqueue will not produce.
   **Still outstanding here:** the `surface.fill` fix. `translucent` should mean
   a real alpha and the "keep the component's own" behaviour should move to
   omitting the token, the way `accent_rule` already works. One line in the
   schema now; a re-audit of 26 components if it waits.
6. ~~Retire the `archive` and `doc-minimal` packs into theme files.~~ **Done.**
   `archive` went 9 entries to 2 (D66) and `doc-minimal` was deleted outright
   (D67) — all eight of its entries were core components drawn through a
   generic template and renamed `Minimal<X>`. `testpack` went with it for the
   same reason. Together that took 25 entries of prompt weight out of the
   catalog. The doc-minimal look lives in `contracts/themes/doc-minimal.json`,
   now carrying the D66 tokens that actually express "stripped back":
   `weight: light`, `density: airy`, `rule: hairline`, `markers: none`.
7. Write the five themes. **Three done**: `paper-print`, `field-manual`,
   `bold-editorial`. `ledger` and `clean-explainer` are not written yet.
8. ~~Add `core`'s five new components, then `social`, `finance`, `markup`.~~
   **Done (D68), but only eight of the fourteen were written.** Checking each
   against the merged catalog first showed six already covered:
   `PortraitCard` and `ImagePair` are both `ArchiveFrames`; `RankingList` is
   `FactSheet` + `numbered` + `highlight_index`; and `TextMarker`,
   `CircleMarker` and `StrikeThrough` are three values of
   `HighlightedPassage.marks[].style`, which already offers
   highlight/circle/underline/box/bracket/strike. **`markup` was therefore
   never created** — step 6 fired zero times for it. §3 above is left as
   written so the triage can be compared against what the check actually
   found.
9. ~~Add the collision lint to `engine/test/catalog.test.ts`.~~ **Done (D67).**
   Verified against the pre-deletion tree: it fails on `core+doc-minimal`
   (`MinimalFramedExhibit` / `MinimalDefinitionCard`, both `card` with the same
   props and no anchors). It does NOT fire on `core+archive`, and that is worth
   knowing rather than assuming — a twin with its own component name is a
   different drawing identity, and a renamed prop defeats a signature match.
   The lint is the cheap half; the human test is still the load-bearing one.
