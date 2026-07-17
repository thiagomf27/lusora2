# Component Catalog — Draft v1

The effects menu: the ONLY components a plan may reference, generated
from the engine's Zod schemas (`engine catalog` → `catalog.json` in
contracts; CI fails on drift). Each entry is designed to be read by the
planner LLM.

## Entry shape

```json
{
  "name": "AnimatedPercentage",
  "pack": "core",
  "when_to_use": "the narration states a single percentage or share of a whole (e.g. '70% of factories were converted')",
  "when_not_to_use": "multiple values compared (use ComparisonBars); vague quantities ('most', 'many'); decorative emphasis with no stated number",
  "anchor_types": ["percentage"],
  "props": {
    "value": { "type": "number", "min": 0, "max": 100, "from_anchor": "value" },
    "label": { "type": "string", "maxWords": 4 },
    "emphasis": { "enum": ["accent", "neutral"], "default": "accent" }
  },
  "duration_hint_s": { "min": 2.5, "default": 4 },
  "renderer": "remotion"
}
```

- `anchor_types` — which beat anchors may trigger it (the planner may
  only attach it to a matching anchor; TitleCard-style components declare
  `anchor_types: []` = pure text allowed).
- `from_anchor` — props auto-filled by the compiler from the anchor, so
  the LLM cannot get the number wrong.
- Semantic props ONLY — no colors, no fonts, no pixel positions (layout
  variants like `position: lower_third|corner` are enums, themed sizes).
- Deterministic resolution: components needing computed data declare it —
  e.g. `AnimatedMap` props take place NAMES from the beat; the compiler
  geocodes to lat/lng before the plan is written.

## Initial core set (proposal, OQ-14)

`TitleCard`, `LowerThird`, `AnimatedPercentage`, `ComparisonBars`,
`AnimatedMap`, `QuoteCard`, `TimelineStrip` — enough to cover doc /
explainer / breakdown formats; each new channel need should become a new
catalog entry, not a special case.

## Guarantees

Validator checks every plan overlay against the catalog (existence +
props schema + density + style pack's allowed_components). A hallucinated
effect cannot reach a renderer — worst case it costs one repair-loop
attempt.
