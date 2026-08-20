# Component Catalog — Draft v1

The effects menu: the ONLY components a plan may reference. The catalog is
declared in `engine/src/catalog/registry.ts` and serialized by
`engine catalog` → `contracts/catalog.json` (CI fails on drift). Each entry
is designed to be read by the planner LLM.

## Entry shape

```json
{
  "name": "AnimatedCounter",
  "pack": "core",
  "when_to_use": "the narration lands a single figure worth dwelling on — a count, a total, a percentage ('29,000 tanks', '70% of factories')",
  "when_not_to_use": "two or more values being compared (ComparisonSplit for two, BarChart for three or more); a figure that should sit in the corner while the shot continues (StatTag); a position in a ranking (RankLabel)",
  "anchor_types": ["number", "percentage"],
  "props": {
    "value": { "type": "number", "required": true, "from_anchor": "value" },
    "label": { "type": "string", "maxWords": 8, "required": true },
    "suffix": { "type": "string", "maxWords": 3 },
    "emphasis": { "enum": ["accent", "neutral"], "default": "accent" }
  },
  "duration_hint_s": { "min": 2.5, "default": 4 },
  "renderer": "remotion"
}
```

- `anchor_types` — which beat anchors may trigger it (the planner may
  only attach it to a matching anchor; KineticTitle-style components declare
  `anchor_types: []` = pure text allowed).
- `from_anchor` — props auto-filled by the compiler from the anchor, so
  the LLM cannot get the number wrong. `"value"` reads the anchor field;
  `"value[0]"` reads one element of a list-valued field, for components
  taking one prop per compared item (ComparisonSplit's `left` / `right`).
- Semantic props ONLY — no colors, no fonts, no pixel positions (layout
  variants like `position: lower_third|corner` are enums, themed sizes).
- Deterministic resolution: components needing computed data declare it.
  `computed: "geocode"` fills `lat`/`lng` from a `place_name`;
  `computed: "geocode_stops"` fills coordinates for every entry of a named
  stop list (RouteMap). The AI names places, code finds coordinates.
- `when_to_use` / `when_not_to_use` are selection rules for an LLM, not
  descriptions: each `when_not_to_use` names the sibling component that wins
  in the neighbouring case. The whole catalog sits in the prompt of every
  plan call, so entries stay terse.

## Core set (D41, D68, D69)

29 components in the `core` pack, in five clusters. The clusters are what
`when_not_to_use` disambiguates within:

| Cluster | Components |
| --- | --- |
| Titles & statements | KineticTitle, ChapterCard, HammerStatement |
| Cards & lists | FactCard, FactSheet, DefinitionCard, BulletList, StepFlow, DataTable, CalloutArrow |
| Quantities | AnimatedCounter, StatTag, BarChart, LineChart, PieChart, ComparisonSplit, RankLabel |
| Sources & exhibits | QuoteBlock, HighlightedPassage, DocumentCard, FramedExhibit, ArchivalFrame, PortraitPlates |
| Time & place | DateStamp, Timeline, NamePlate, SatelliteLocate, RouteMap, RegionHighlight |

`FactSheet` covers two shapes, and the second one is why `RankingList` was
never written: with `numbered` it is a RANKING, and with `highlight_index` one
row carries the narration. A ranked list was this component plus an ordinal.

RegionHighlight is placed in the editor, never chosen by the planner: it
needs a border polygon and nothing derives one.

## A pack is a menu, not a look (D46, enforced by D66)

Add a pack when you need a component that does not exist — a finance
channel's CandlestickChart, a recipe channel's IngredientList. Do NOT add
one to restyle components that already exist: entrance animation, corner
radius, easing and duration scaling are theme tokens
([Theme & Style Packs](theme-and-style.md)), because the renderer
receives `{ plan, theme, assets }` and no catalog at all.

The test: **if the props are identical, it is a theme.** One `FactCard`
under two themes is two looks; a card that also carries a photo is a new
component.

D66 applied that test to the `archive` pack and it failed seven times out of
nine. `ArchiveBarGraph.bars` and `BarChart.series` were the same array of
`{label, value}`; `ArchiveLowerThird.title`/`subtitle` and `NamePlate.name`/
`role` the same two strings. **A renamed prop is the same prop** — that is
the sharp edge of the test, and it is the one the pack got past. What
actually differed (gridlines, where the series is labelled, type weight,
whether there is a plate) became the D66 tokens, the seven twins were
unioned into their core counterparts and deleted, and the look survives
intact as `contracts/themes/archive.json` plus those tokens.

The cost of getting this wrong is concrete and it is paid per video: every
duplicated pair sat in the planner's prompt as two entries with the same
prop signature and the same `anchor_types`, which is a coin flip dressed as
a choice — the exact ambiguity `when_not_to_use` exists to remove — and 15
entries of prompt weight in every plan call.

**Depictive components are theme-EXEMPT, and that is not a bug.** A component
that draws a real-world artifact — a tweet, a YouTube comment, a Reddit card, a
browser window, a press clipping — renders that artifact's chrome, not the
channel's. Twitter blue is not the channel's accent, and a YouTube comment set
in the channel's serif is not on-brand, it is wrong: the whole reason it is on
screen is that the viewer recognises where it came from. Such a component
declares `honors: ["motion.entrance", "surface.density"]` and nothing else —
the theme gets to say how it ARRIVES and how much room it takes. The `social`
pack is all three. Everything else — charts, cards, titles, lower thirds, maps,
tables — is fully themed. There is no middle category.

**A component name never describes a look, a channel or a niche.**
`PaperLineChart`, `ArchiveLineChart` and `DocLineChart` are one component
called `LineChart`. If the proposed name would also work as a *theme* name,
it is a theme.

## Adding a component

Four lists must move together — a name missing from any of them fails
quietly rather than loudly:

1. `engine/src/components/core/<Name>.tsx` — takes `{ props, theme }`, all
   appearance from the theme runtime, all sizes relative to `useVideoConfig()`.
   A component belonging to a non-core pack lives in
   `engine/src/components/<pack>/<Name>.tsx` instead; the test below checks the
   file is where the entry's `pack` says it is.

   Since D66 that first clause is literal: **every visual decision is either a
   resolver or a proportion of the frame, and there is no third source.** A
   literal is a bug unless it is the component's own proportion, which a
   resolver then scales — `height * 0.05 * typeScale(theme, "title")`,
   `typeWeight(theme, 700)`, `ruleWidth(theme, 2)`, `...groundStyle(theme, {
   radius: 12, legible: true })`. A component that sets type on the frame
   passes `legible: true` so a paper theme cannot leave dark ink on footage.
   Declare `<Name>.honors = [...]` with the token blocks the component can
   actually obey, and never accept a colour, a `variant`-as-look, or a font as
   a prop — those are themes smuggled through the planner, and the planner must
   never choose a look.

   The acceptance test is visual and it is cheap: render it under two
   maximally different themes and look at both.
   `node scripts/preview-batch.mjs --theme paper-print <Name>` and again with
   `--theme bold-editorial`. **If a stranger could not tell the two frames came
   from the same component, it is correctly open. If they look nearly
   identical, appearance leaked into the file** — find the literal and move it
   to a token. That test caught eight leaks across the D66 conversion,
   including two components that rendered unreadably on a light theme.
2. `COMPONENTS` in `engine/src/components/index.ts` — an unregistered name
   renders **nothing** (Composition.tsx returns null).
3. `CORE_COMPONENTS` in `engine/src/catalog/registry.ts`, then
   `pnpm --filter @lusora/engine run catalog`.
4. `allowed_packs` in the style packs that should offer its PACK — the
   validator rejects a component the pack does not list.

`region` (D56) is how an entry says which vertical band it draws in, as
fractions from the top: `{y_min: 0.70, y_max: 0.86}` for a lower third,
`{0, 0.94}` for a full-frame treatment with its own credit line, `{0.10, 0.86}`
for a card in the middle. The compiler reads it to decide whether a graphic is
actually sitting on the captions, and by how much they must rise. Omit it when
the placement comes from a prop the compiler already moves (a corner tag):
absent is read as full-frame, which is the conservative answer.

`engine/test/catalog.test.ts` enforces 2 ↔ 3 parity — across the data packs
too, so a pack entry must be drawn by a component or a template and a
registered component must be reachable from some entry — that every
anchor-gated entry actually reads its anchor, and that every *core* entry has
sample props in `engine/src/catalog/sample-props.json` (shared by
`preview-all.mjs` and the platform's Overlays screen; a pack entry's preview
props are synthesized from its prop spec instead).

### Non-core packs: entries as data

Step 3 has a second form for packs other than `core`. One file per pack in
`contracts/component-packs/<pack>.json` holds plain catalog entries, merged
into the catalog by `lusora_contracts.load_catalog()` and the platform's
`lib/catalog.ts`; `core` stays generated from the registry, so the drift
gate still means something. Duplicate names are a hard error at load, not a
silent shadow. The Overlays screen writes these files, and it edits step 4
(style-pack allowances) directly.

On its own this does **not** remove the need for steps 1 and 2: an entry is
metadata. Until something can draw it the planner may pick the name and the
validator will accept it, but the overlay renders as nothing — which is why
the screen marks such entries *no renderer*.

So a non-core pack comes in two flavours, and they mix inside one file:

- **data + template** — no code at all (see below). No pack ships this way
  today: `doc-minimal` was, and it was retired because every one of its eight
  entries was a core component restyled onto a generic template and renamed
  `Minimal<X>`. That is the flavour to reach for when an entry is a new
  on-screen SITUATION with an existing shape, and the flavour to distrust when
  the entries start being named after the core components they restyle.
- **data + code** — the entries are still data, but each names a React
  component under `engine/src/components/<pack>/`. `social` and `finance` are
  these. `core` stays the only pack generated from the registry.

  The `archive` pack is **gone** (D69), and how it went is the cautionary tale:
  D66 merged seven of its nine components into their core twins, and the two
  survivors turned out not to justify a pack either. `ArchiveCaption` had no
  reason to exist next to FactCard and NamePlate; `ArchiveFrames` did, so it
  moved into core as `PortraitPlates` — renamed because `Archive` describes a
  LOOK, and a two-entry pack still costs a channel a `component_pack` decision
  and the planner two entries. **A pack that shrinks below three entries should
  be asked whether it is a pack at all.**

  That is the shape a healthy pack has: **3–6 entries, all of them geometry
  core cannot carry.** A pack approaching 26 is a clone of `core` and the
  real request was a theme. `social` (SocialPost, WebPageFrame, HeadlineStack)
  and `finance` (Candlestick, MetricGrid, WaterfallChart) are three each, and
  each entry earned its place by carrying a data shape core has no prop for:
  browser chrome, OHLC, a floating bar.

### Templates: entries that draw themselves

An entry may set `template` instead of shipping a component:

```json
{ "name": "VerdictLine", "pack": "history", "template": "statement", … }
```

`engine/src/components/templates/registry.ts` defines the kinds — `card`,
`lower_third`, `big_number`, `bullet_list`, `statement` — each with a fixed
prop vocabulary; `TemplateOverlay` draws them from the theme runtime exactly
like a hand-written component. An entry may declare a subset of the
vocabulary (and narrow it with `required` / `maxWords` / `from_anchor`), but
not prop names the template does not read: the platform rejects that,
because the planner would fill a prop nothing renders.

The compiler copies the kind into the plan item (`overlays[].template`), so
the renderer never reads the catalog. Steps: pick the template, then step 4.
`engine/test/templates.test.ts` keeps the registry, `catalog_entry.schema.json`
and `edit_plan.schema.json` in agreement, and
`node scripts/preview-overlay.mjs <Name> '<props>' --template <kind>` renders
one through the real engine.

Templates cover the common overlay shapes, not everything: anything with its
own geometry or data drawing (maps, charts, mark-ups) still wants steps 1–2.

## Guarantees

Validator checks every plan overlay against the catalog (existence +
props schema + density + the style pack's resolved component menu). Props the
catalog does not declare are rejected as unknown. A hallucinated
effect cannot reach a renderer — worst case it costs one repair-loop
attempt.
