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

## Core set (D41)

26 components in the `core` pack, in five clusters. The clusters are what
`when_not_to_use` disambiguates within:

| Cluster | Components |
| --- | --- |
| Titles & statements | KineticTitle, ChapterCard, HammerStatement |
| Cards & lists | FactCard, FactSheet, DefinitionCard, BulletList, StepFlow, CalloutArrow |
| Quantities | AnimatedCounter, StatTag, BarChart, LineChart, ComparisonSplit, RankLabel |
| Sources & exhibits | QuoteBlock, HighlightedPassage, DocumentCard, FramedExhibit, ArchivalFrame |
| Time & place | DateStamp, Timeline, NamePlate, SatelliteLocate, RouteMap, RegionHighlight |

RegionHighlight is placed in the editor, never chosen by the planner: it
needs a border polygon and nothing derives one.

## Adding a component

Four lists must move together — a name missing from any of them fails
quietly rather than loudly:

1. `engine/src/components/core/<Name>.tsx` — takes `{ props, theme }`, all
   appearance from the theme runtime, all sizes relative to `useVideoConfig()`.
2. `COMPONENTS` in `engine/src/components/index.ts` — an unregistered name
   renders **nothing** (Composition.tsx returns null).
3. `CORE_COMPONENTS` in `engine/src/catalog/registry.ts`, then
   `pnpm --filter @lusora/engine run catalog`.
4. `allowed_components` in the style packs that should offer it — the
   validator rejects a component the pack does not list.

`engine/test/catalog.test.ts` enforces 2 ↔ 3 parity, that every
anchor-gated entry actually reads its anchor, and that every entry has
sample props in `engine/src/catalog/sample-props.json` (shared by
`preview-all.mjs` and the platform's Overlays screen).

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
props schema + density + style pack's allowed_components). Props the
catalog does not declare are rejected as unknown. A hallucinated
effect cannot reach a renderer — worst case it costs one repair-loop
attempt.
