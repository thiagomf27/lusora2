# Authoring guide — new components, themes, style packs

A short, practical manual: **which of the three things you actually want**,
**what to paste into Claude**, and **how to check the result**. Each prompt
below has `[...]` blanks for you to fill in, and a list of files to attach as
the model — attach them as files (or paste them whole); Claude works far
better from the real schema than from a description of it.

## 0. Which one do you want?

| What you want to change | What you create | Where it lands |
| --- | --- | --- |
| colors, fonts, corners, entrance, easing, grain | a **theme** | `contracts/themes/<name>.json` |
| hold lengths, overlay density, allowed components, script length, persona | a **style pack** | `contracts/style-packs/<name>.json` |
| an overlay that does not exist yet | a **component** | catalog entry + (template *or* React) |

Rule of thumb: never copy a component to change how it looks — that is a
theme. Never copy a component to change how often it appears — that is a
style pack. See [theme-and-style.md](03-contracts/theme-and-style.md) for the
reasoning.

For components there are two paths, and picking the right one is most of the
work:

- **Template path (no code).** The overlay is a card, a lower third, a big
  number, a bullet list or a statement. The engine's `TemplateOverlay` draws
  it from a data-only catalog entry — usable in the next video, no deploy.
  Use §1.
- **React path (code).** The overlay has its own geometry or draws data —
  maps, charts, mark-ups, anything the five templates cannot express.
  Use §2.

---

## 1. New component — template path (no code)

**Attach:**

- `contracts/component-packs/README.md` — the rules of the data-only path
- `contracts/component-packs/testpack.json` — a working pack file, the model
- `contracts/schemas/catalog_entry.schema.json` — what validates
- `engine/src/components/templates/registry.ts` — the five kinds and the exact
  prop vocabulary each one reads

**Prompt:**

> I want a new overlay component for LUSORA on the template path (data-only
> catalog entry, no React).
>
> - Component name: `[PascalCaseName]`
> - Pack: `[pack-slug, lowercase; not "core"; new file or existing pack]`
> - What it should show on screen: `[e.g. "the room where a decision was
>   taken plus the hour — one line and a smaller line under it"]`
> - When the planner should pick it: `[the narration situation]`
> - When it should NOT be picked: `[the sibling components that win in the
>   neighbouring cases]`
> - Beat anchors that may trigger it: `[any of: number, percentage,
>   comparison, place, date, name, quote — or none, for pure text]`
> - Roughly how long it should stay on screen: `[e.g. 2–4s]`
>
> Pick the template kind that fits from `templates/registry.ts` (or tell me if
> none does and it needs the React path instead). Declare only props that
> template actually reads, narrowed with `required` / `maxWords` /
> `from_anchor` where it helps the planner. Write the entry into
> `contracts/component-packs/<pack>.json` (create the file if new, keeping
> `pack` equal to the filename), then add the name to
> `overlays.allowed_components` in these style packs: `[names, or "none yet"]`.
> Then validate and render me a preview.

**Verify:** `pnpm run validate:schemas` and
`node engine/scripts/preview-overlay.mjs <Name> '<propsJSON>' --template <kind> --theme <theme>`.

**Note:** the entry is metadata. Without a `template` *and* without a React
component the planner may pick the name and the validator will accept it, but
the overlay renders as nothing (the Overlays screen marks it *no renderer*).

---

## 2. New component — React path (code)

**Attach:**

- `docs/03-contracts/component-catalog.md` — especially "Adding a component"
  (the four lists that must move together)
- `engine/src/components/core/StatTag.tsx` — a small, complete model: Zod
  props, theme runtime, entrance, everything sized off `useVideoConfig()`
- `engine/src/catalog/registry.ts` — the catalog entry style (attach at least
  the header comment plus a couple of entries)
- `engine/src/components/index.ts` — the render registry
- `contracts/schemas/catalog_entry.schema.json`

**Prompt:**

> I want a new core overlay component for the LUSORA engine, on the React
> path (it has its own geometry / draws data, so no template fits).
>
> - Component name: `[PascalCaseName]`
> - What it draws, and how it animates: `[describe the visual — layout,
>   what enters first, what the motion should feel like]`
> - Props it needs: `[e.g. "a list of 2–5 stops with labels, an optional
>   title"]`
> - When the planner should pick it: `[the narration situation]`
> - When it should NOT be picked: `[the sibling components that win nearby]`
> - Beat anchors that may trigger it: `[number | percentage | comparison |
>   place | date | name | quote — or none]`
> - Duration hint: `[min / default seconds]`
>
> Follow "Adding a component" exactly — all four lists:
> 1. `engine/src/components/core/<Name>.tsx`, taking `{ props, theme }`, all
>    appearance from the theme runtime (`emphasisColor`, `fontStack`,
>    `surfaceStyle`, `easingCurve`, `motionScale`, `useEntrance`), every size
>    relative to `useVideoConfig()`, no hardcoded colors;
> 2. register it in `engine/src/components/index.ts`;
> 3. add the entry to `CORE_COMPONENTS` in `engine/src/catalog/registry.ts`
>    (props mirroring the Zod schema, in catalog vocabulary — `maxWords`
>    counts words where Zod caps characters) and run
>    `pnpm --filter @lusora/engine run catalog`;
> 4. add sample props to `engine/src/catalog/sample-props.json`, and add the
>    name to `overlays.allowed_components` in these style packs:
>    `[names, or "none yet"]`.
>
> Declare which entrances it can honor and let anything else degrade to fade.
> Then run `pnpm run ci` and render me a preview.

**Verify:** `pnpm run ci` (catalog drift, registry parity, sample props,
anchor gating are all enforced by tests) and
`node engine/scripts/preview-overlay.mjs <Name> '<propsJSON>' --theme <theme>`.

---

## 3. New theme (a look)

**Attach:**

- `contracts/schemas/theme.schema.json` — the whole token list; `additionalProperties: false`, so nothing else is accepted
- `contracts/themes/history-dark.json` — a complete theme, the model
- `docs/03-contracts/theme-and-style.md` — the theme section, for the semantics
- `engine/src/themes/runtime.ts` — how each token turns into pixels (font
  stacks, caption presets, motion scales)

**Prompt:**

> I want a new theme for LUSORA.
>
> - Name (kebab-case, becomes the filename): `[name]`
> - The channel / mood it is for: `[e.g. "modern tech explainer, bright,
>   confident, a bit clinical"]`
> - Palette: `[either give hex values for bg / text / accent / neutral, or
>   describe it — "near-black background, warm off-white text, a single
>   saturated cyan accent" — and let Claude pick]`
> - Display font: `[e.g. Playfair Display / Inter / "pick something serif"]`
> - Body font: `[...]`
> - Caption preset: `[plain | boxed | serif-lower-third]`
> - Motion feel: `[slow_heavy | neutral | fast_light]`
> - Grain: `[none | archival | film]`
> - Overlay shape — corners `[square | soft | rounded]`, panel fill
>   `[solid | translucent | none]`, accent rule `[top | left | none, or omit
>   to keep each component's own choice]`
> - How overlays arrive — entrance `[fade | rise | slide | pop | wipe |
>   typewriter]`, easing `[smooth | snap | spring | linear]`
> - Per-component entrance exceptions (keep this sparse, or leave empty):
>   `[e.g. ChapterCard: typewriter]`
>
> Write `contracts/themes/<name>.json` validating against the schema, check
> the text/background contrast is readable at video scale, then render me the
> same overlay under this theme and under `history-dark` so I can compare.

**Verify:** `pnpm run validate:schemas`, then
`node engine/scripts/preview-overlay.mjs FactCard '<propsJSON>' --theme <name>`.
The Themes screen in the platform edits the same files, so you can tweak
there afterwards.

**Constraints worth knowing:** only the four colors, hex only (`#rrggbb`).
Fonts are names, resolved to a stack by `fontStack()` — anything containing
Playfair / Georgia / Times / Merriweather / Lora gets the serif fallback,
everything else the sans one. `motion.entrance` is a *request*: a component
that cannot honor it (typewriter on a chart) silently degrades to fade.

---

## 4. New style pack (a rhythm)

**Attach:**

- `contracts/schemas/style_pack.schema.json`
- `contracts/style-packs/doc-slow.json` — a complete pack, the model (also
  `listicle-fast.json` if you want the fast end of the range)
- `docs/03-contracts/theme-and-style.md` — the style pack section
- `contracts/catalog.json` — so Claude picks real component names for
  `allowed_components` (or say "use only the names in this file")

**Prompt:**

> I want a new style pack for LUSORA.
>
> - Name (kebab-case, becomes the filename): `[name]`
> - Video type it implements: `[doc | explainer | breakdown | listicle, or
>   omit]`
> - The feel in one sentence: `[e.g. "fast, punchy top-10 with a hook every
>   fifteen seconds"]`
> - Pacing: average shot hold `[e.g. 2.2s]`, min `[e.g. 1.2s]`, max `[e.g.
>   4s]`, arc `[three_act | linear | listicle]`
> - Overlay density: `[low | normal | high, or a per_minute number]`
> - Which components the planner may use: `[list them, or describe — "all the
>   text and number ones, no maps, no archival looks" — and let Claude pick
>   from catalog.json]`
> - Transitions: allowed `[cut, crossfade, fade, fade_to_black]`, default
>   `[one of them]`
> - Narrator persona (goes to the script agent): `[e.g. "Dry, fast, second
>   person. Never more than two clauses a sentence."]`
> - Visual language (goes to the beat planner): `[e.g. "Bright modern stock,
>   people and screens, no archival."]`
> - Target narration length: `[e.g. 90s]`, tolerance `[e.g. 0.25]`
> - Prompt pack for this voice: `[name, or omit to use the default]`
>
> Write `contracts/style-packs/<name>.json` validating against the schema.
> Check every name in `allowed_components` exists in `contracts/catalog.json`,
> and that the pacing numbers are coherent (min < avg < max) and consistent
> with the density I asked for.

**Verify:** `pnpm run validate:schemas`. The Style Packs screen edits the
same files. A pack is only real once a channel points at it — the pacing
numbers are constraints the compiler enforces, not advice, so if renders
start hitting the repair loop, widen min/max before blaming the planner.

---

## 5. After any of the three

- `pnpm run ci` — schemas, boundaries, types, tests, catalog drift.
- Themes and style packs are snapshotted into `cfg.json` at enqueue, so an
  in-flight video keeps the version it started with; edit freely.
- New component names must be added to a style pack's `allowed_components`
  or the validator will reject any plan that uses them — that is the step
  most often forgotten.
