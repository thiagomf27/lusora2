# Engine

TypeScript package with two renderers behind one interface, the component
catalog, and the theme runtime. Consumed two ways:

- **CLI** (by the worker): `engine render --video-dir <folder> --renderer
  <auto|ffmpeg|remotion>` → writes `final.mp4` atomically; files-only, no
  network, no DB. `engine patch` (D120, below) re-renders only some seconds
  of an existing `final.mp4`.
- **npm package** (by the platform's editor): exports the components, the
  theme runtime, and a Player wrapper so the editor previews with the
  EXACT code that renders — preview/render parity for the Remotion path.

## Renderer routing (Decided: ffmpeg is the default)

The router inspects the validated plan:

| Plan uses only… | Renderer |
|---|---|
| cuts, crossfade/fade/fade-to-black/flash/zoom-through/push/wipe (whip is Remotion-only), Ken Burns / static stills, plain caption preset, audio mix | **ffmpeg** (fast, near-free CPU) |
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

## Patch render (D120)

```
engine patch --video-dir <folder> --spans <s>-<e>[,<s>-<e>...] [--audio keep|remix] [--renderer auto|remotion]
```

Re-renders only the given plan seconds of the folder's `final.mp4` and splices
them in, instead of rendering the whole video again. It works because a
Remotion render is a pure function of the frame: the same plan draws the same
pixels for frame N whether N is drawn alone or inside the whole video.

1. Each span is padded by the transitions at the junctions it touches (a
   transition straddles its cut), snapped outward to whole frames, shifted by
   the render window when the video was a windowed test render (`cfg.json`
   `output.window`; a span outside the window is dropped), and merged with
   any it overlaps or touches.
2. Each span is drawn with Remotion, video only, from ONE bundle.
3. The splice encodes each piece — every untouched stretch of the original,
   cut by frame number, and every patch — on its own with identical x264
   settings (`crf 18`, `preset medium`), then joins them with the concat
   demuxer as a stream copy. One filter graph that trims the original twice
   buffers every raw frame of the later stretch and was killed for memory
   (3.4 GB) on the 60 s Centralia render.
4. `--audio keep` copies the original's audio; `remix` draws the whole mix
   again (Remotion, `codec: "aac"`) and masters it as a full render does
   (`plan.tracks.audio.master.loudness`). An audio-only change copies the
   picture and swaps the sound.
5. Written to `final.tmp.mp4` and renamed over `final.mp4` only when every
   piece and the whole file have exactly the frames they should.
6. Prints `{"patched": [[s, e], ...], "frames": N, "audio": "keep|remix", "ok": true}`.

It refuses, leaving `final.mp4` untouched, when the plan renders with ffmpeg
(patching an ffmpeg render is out of scope: re-render the whole video), or when
`final.mp4` is not this plan's size, rate or length (a retimed plan is not a
patch). The worker's `pipeline/patch.py` decides what to patch from two plans
(`changed_spans`) and falls back to a full render on a retime (`patch_render`
returns False) — and, since D121, whenever the sound changed: Remotion draws
sound by walking every frame, so `--audio remix` costs as much as a whole
render (905 s for the audio of Centralia's 60 s window). Proof: `engine/test/patch.test.ts` (span math; the splice lands
frame-exact on synthetic video) and, by hand, `node engine/scripts/patch-check.mjs`
(a patched render matches a full render of the edited plan, frame by frame).

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
