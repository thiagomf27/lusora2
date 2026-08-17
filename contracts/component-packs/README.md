# Component packs (data-only catalog entries)

The `core` pack is generated from `engine/src/catalog/registry.ts` into
`../catalog.json` (CI fails on drift — do not hand-edit that file).

Everything in *this* directory is the data-only path: one `<pack>.json` per
pack, written by the platform's **Overlays** screen, merged into the catalog by
`lusora_contracts.load_catalog()` and by the platform's `lib/catalog.ts`.

```json
{
  "pack": "history",
  "components": [ { /* one CatalogEntry, validated against
                      ../schemas/catalog_entry.schema.json */ } ]
}
```

A whole pack can be moved between installs: `GET /api/catalog/packs/<pack>`
returns exactly this file, and `POST /api/catalog/packs` takes it back
(all-or-nothing: one invalid entry writes nothing). `PUT` on the same path
replaces a pack's entries, `DELETE` removes the pack and clears its
style-pack allowances. The Overlays screen wraps all four.

Rules the loaders enforce:

- `pack` must equal the filename, be a lowercase slug, and must not be `core`.
- every entry's `pack` must equal the file's `pack`.
- a name already defined by another pack (or by `core`) is a hard error at
  load, not a silent shadow.

The pack name itself is organisational: nothing in the pipeline filters by it
today (`channel_config.component_pack` is stored but unread). What actually
decides whether the planner may pick a component is the style pack's
`overlays.allowed_packs` — `archive-doc` is the one that allows the
`archive` pack.

A pack may also be built for a particular theme. The `archive` overlays paint
their own paper plate from `surfaceColor(theme)` (i.e. `colors.bg`) and set
type on `colors.accent`, so they are drawn for a *paper* theme —
`contracts/themes/archive.json`. They stay legible on a dark theme (the type
on the accent picks its colour by contrast), but the look is the pairing.

**A catalog entry is metadata, not an animation.** Adding one here makes the
planner offer the component and the validator accept it, but something has to
draw it. Either:

- set `"template": "card" | "lower_third" | "big_number" | "bullet_list" |
  "statement"` — the engine's `TemplateOverlay` draws the entry from its props,
  no code, usable in the next video; or
- add a React component in `engine/src/components/<pack>/<Name>.tsx` (`core/`
  for the generated pack) and register it in
  `engine/src/components/index.ts` — see "Adding a component" in
  `docs/03-contracts/component-catalog.md`. `archive.json` is the worked
  example: data entries here, drawing in `engine/src/components/archive/`.
  `engine/test/catalog.test.ts` fails if the two lists drift apart.

With neither, the Overlays screen marks the entry *no renderer* and a plan
referencing it renders an empty overlay.
