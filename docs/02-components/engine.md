# Engine

TypeScript package with two renderers behind one interface, the component
catalog, and the theme runtime. Consumed two ways:

- **CLI** (by the worker): `engine render --video-dir <folder> --renderer
  <auto|ffmpeg|remotion>` → writes `final.mp4` atomically; files-only, no
  network, no DB.
- **npm package** (by the platform's editor): exports the components, the
  theme runtime, and a Player wrapper so the editor previews with the
  EXACT code that renders — preview/render parity for the Remotion path.

## Renderer routing (Decided: ffmpeg is the default)

The router inspects the validated plan:

| Plan uses only… | Renderer |
|---|---|
| cuts, crossfade/fade/fade-to-black, Ken Burns / static stills, plain caption preset, audio mix | **ffmpeg** (fast, near-free CPU) |
| any catalog component, styled caption presets, non-basic transitions, transforms/PiP | **Remotion** |

- Channel/video config may pin `renderer: remotion` (e.g. brand caption
  styles on every video) or `renderer: ffmpeg` (which then acts as a
  validation profile: plans requiring more FAIL validation with the list
  of offending items — capability enforcement, not silent degradation).
- Exact ffmpeg feature boundary: OQ-11. Trade-off accepted: ffmpeg-path
  videos don't get Remotion Player preview parity (they're simple; the
  compiled plan + assets preview is sufficient).

## ffmpeg renderer

Generates a filter graph from the plan: per-item trim → scale/crop →
`zoompan` (Ken Burns) → `xfade` chain → `subtitles=` burn-in (plain
preset) → audio mix (voiceover + music with volume/fades). Deterministic,
testable by ffprobe on a fixture.

## Remotion renderer

Track consumers (base visual, captions, overlays, audio mixer) driven by
the plan; components resolved from the catalog; **theme injected at render
time** from the channel config. Deterministic motion; transitions consume
handles and never move narrative cuts; freeze-frame fallback when no
handle exists.

## Component catalog

Every overlay/effect is a React component with a Zod props schema and
catalog metadata (`when_to_use`, `when_not_to_use`) — see
[Component Catalog](../03-contracts/component-catalog.md). `engine catalog`
regenerates `catalog.json` into contracts; CI fails on drift. Components
take **semantic props only** (values, labels, places, `emphasis`) — never
colors or fonts.

## Themes

A theme is a token object — colors (exactly four), typography (face,
caption preset, scale/weight/case/tracking), surface (radius, fill,
accent_rule, density, rule, texture), chart (grid, legend, markers, stroke,
number_format), motion, sound — defined per channel as data. The theme
runtime (`engine/src/themes/runtime.ts`) maps tokens → styles inside every
component, and since D66 that is the ONLY source of appearance: every
visual decision in a component is either a resolver or a proportion of the
frame. AI never sees or chooses tokens. See
[Theme & Style Packs](../03-contracts/theme-and-style.md).

## Component packs

Named, versioned folders (`engine/packs/<name>/`) of extra components for
specific channels, selected by name in channel config. Code ships via
git — NEVER uploaded through the UI (security + catalog integrity).
Catalog generation runs per pack.
