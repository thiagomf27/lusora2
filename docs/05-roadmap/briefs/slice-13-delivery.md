# Slice 13: delivery (S)

Read [the briefs README](README.md) first.

## Goal

Two Dark Palace delivery features, both off unless turned on:

1. **Subscribe button.** When the narration says "subscribe" (in any of six
   languages), a subscribe button pops in at the top-right corner on that
   spoken word, its bell swings, and two sounds play: a pop, then a bell.
2. **The finished MP4 is checked as a file** before the video counts as done:
   H.264 picture at the plan's resolution, an audio track, and a clean decode
   of the first and last 8 seconds.

Done = both work, are tested, documented as D116, and the checks pass.

## Dark Palace sources (read-only)

- `/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/motor.py`
  - lines 51–53: `CTA_LANG` (regex → label per language) and `CTA_SKIN`;
  - `cta_widget()` (around line 82): finds the first spoken word matching the
    regex, starts at `hit - 0.15 s`, pops in with a back-out ease over 0.45 s,
    swings the bell `exp(-2.2u)·sin(20u)·18°`, and pins `pop` at +0.05 s and
    `bell` at +0.35 s.
- `/home/thiago/darkpalace/DOCGERAL_STUDIO/estudio/entrega.py`, `confere()`
  (line 79): the MP4 checks.

## Part 1: the subscribe button

**Component** `SubscribeButton` (core, `compiler_only: true`, like `MatchCut`
in `engine/src/catalog/registry.ts` around line 663):
- Props: `label` (string, e.g. "Subscribe").
- It draws a pill with a round disc holding a bell icon, then the label.
- It is themed, not depictive: fill, ink and disc colour come from theme
  resolvers (`engine/src/themes/runtime.ts`: `surfaceStyle`, `contrastInk`,
  the accent colour). Typography comes from `typeScale` / `typeWeight`. The
  only literals allowed are proportions of the frame.
- Region: top-right, `{y_min: 0.03, y_max: 0.13}`.
- Motion: the scale pop over 0.45 s (DP's back-out curve) and the bell swing
  above, as pure functions of the frame. No CSS transitions.
- Register it everywhere a core component goes (README list). Give it sample
  props.

**Style pack knob** `cta` (new top-level block in `style_pack.schema.json`,
the `StylePack` type, and `additionalProperties: false`):

```json
"cta": {
  "enabled": false,
  "hold_s": 4,
  "lead_cue": "pop",
  "bell_cue": "bell",
  "labels": { "pt": "Inscreva-se", "en": "Subscribe", "es": "Suscríbete",
              "fr": "Abonnez-vous", "de": "Abonnieren", "it": "Iscriviti" }
}
```

**Compiler rule.** Put it in a new `worker/lusora_worker/compiler/cta.py`
(pattern: `rhythm.py`), called from `compile_plan` in `compiler/core.py`
**after** `_trim_overlay_holds` so it never displaces a planned graphic:
- Match DP's regexes (`inscrev`, `subscri`, `suscr[ií]b`, `abonn[ei]`,
  `abonnier`, `iscriv`), case-insensitive, against the words of
  `word_timeline` (built in `compile_plan` from `_word_timeline`; each entry
  has `word`, `start_s`, `end_s` in narration time, so add `vo_start`).
- The first match only. Place one overlay `{"id": "o_cta", "kind": "component",
  "component": "SubscribeButton", "props": {"label": <label for the regex that
  matched>}, "start_s": hit − 0.15, "end_s": start + hold_s, ...}`. Copy the
  field set from how `_hook_overlays` builds `o_hook_title` in `core.py`
  (around line 350).
- No match, or `enabled` false → nothing is added.
- Sounds: pin `lead_cue` at start + 0.05 and `bell_cue` at start + 0.35 through
  the `pinned` argument of `sound.compile_sfx` (the hook title card does
  exactly this: look at `pinned_cues` in `compile_plan`). Skip a cue the sound
  pack does not have, with an `on_note` line. `synth-doc` has both `pop` and
  `bell`.
- Validators: `validators.py` refuses `compiler_only` components from a
  planner (lines ~328 and ~740). Make sure a compiler-placed `SubscribeButton`
  still validates in the edit plan.

Turn it on in `contracts/style-packs/documentary.json` (`"enabled": true`).

## Part 2: the MP4 check

Add to `worker/lusora_worker/pipeline/qa.py` (called from `run_qa` in
`steps.py`, around line 1659) a function `container_problems(path, plan) -> list[str]`:
- `ffprobe -v error -show_streams -show_format -of json`;
- a video stream with `codec_name == "h264"` and width/height equal to the
  plan's `resolution`;
- at least one audio stream;
- `ffmpeg -v error -i <f> -t 8 -f null -` and the same from `duration − 8 s`
  both exit 0 with empty stderr.

A problem fails QA the way the existing checks do (read `qa.check`). This is
always on: it's a property of any deliverable, and the renders this repo makes
already pass it. Check that on an existing render first:
`data/videos/vid_dfd49c6c34e4/final.mp4` must pass.

## Tests

- `worker/tests/test_cta.py`:
  - a word timeline containing "subscribe" → one `o_cta` at the right time
    with the English label, and two pinned cues;
  - Portuguese "inscreva-se" → the Portuguese label;
  - no match → no overlay;
  - `enabled: false` and a pack without the block → the plan is byte-identical
    to before (copy the pattern of
    `test_a_pack_without_the_blocks_compiles_byte_identically` in
    `tests/test_rhythm.py`, which uses `compile_with` from `tests/test_texture.py`);
  - the compiled plan passes `validators.validate_plan(..., require_assets=False)`.
- QA tests in `worker/tests/test_qa.py`: build tiny MP4s with ffmpeg in
  `tmp_path`, one good, one without audio, one at the wrong size, one
  truncated (cut the file's bytes in half). Each bad one must name its problem.
- Engine: render the component under two very different themes, for example
  `node engine/scripts/preview-overlay.mjs SubscribeButton '{"label":"Subscribe"}' --theme documentary-dark`
  and `--theme paper-print` (list the themes in `contracts/themes/`). Look at
  both images. They must look clearly different, and the bell must be visible.

## Benchmark

The Centralia script never says "subscribe", so no render is needed for the
button; the unit tests and the previews cover it. For the MP4 check, run QA's
new function against `vid_dfd49c6c34e4/final.mp4` and paste the result in your
report.

## Docs

- D116 row in `decided.md`: what was ported, the defaults, and that the
  button is compiler-placed, never planned.
- The plan: mark slice 13 `✅ BUILT (D116)`.
- `docs/03-contracts/theme-and-style.md`: one short paragraph on `cta`.
- `docs/03-contracts/component-catalog.md`: a short note that `SubscribeButton`
  is compiler-only (placed by `cta.py`, never offered to a planner).

## Out of scope

Moving the MP4 to an output folder or deleting intermediate files (Dark
Palace's `entregar` / `limpar`). LUSORA keeps `data/videos/<id>/` as the
record.
