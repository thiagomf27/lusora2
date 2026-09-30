# Slice 12b: visual review (M)

Read [the briefs README](README.md) first. Needs
[12a](slice-12a-patch-render.md) merged: the repairs are re-rendered with its
`patch_render`.

## Goal

A new stage `visual_review` between `render` and `qa` in the `documentary`
pipeline. It looks at two frames of every shot on contact sheets with a vision
model, fixes the shots that have a problem, and re-renders only those.
Off unless the channel turns it on (`source_policy.visual.review.enabled`).

Also: **never an empty frame.** A shot whose asset is missing or failed to
resolve takes a neighbour's picture instead of rendering black. This is
Dark Palace's `imagem_de_reserva`; its version is dead code for plain scenes,
LUSORA's must work.

## Dark Palace source (read-only)

`/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/revisor.py` (197 lines, read it
whole):
- `PEDIDO`: the prompt. Problems are `logo` (a small corner watermark, with
  its corner), `alheio` (foreign text: TV banners, "BREAKING NEWS", burned-in
  subtitles, a screenshot), `cortado` (our own text cut off at the edge or
  spilling out of its box) and `preto` (black, blank or broken). The answer is
  one JSON array.
- `folhas`: frames at 25% and 75% of each block, 320×180, sheets of 12 blocks,
  the block number in yellow.
- `consertar`, the repairs:
  - `alheio` → that **source** is banned from the whole video, and every shot
    that used it is resolved again;
  - `logo` → that source gets the corner crop;
  - `cortado` on a graphic → the graphic is dropped;
  - `preto` → the shot gets another picture.

## How (map DP's words to LUSORA)

- A DP "block" is a LUSORA visual item (`tracks.visual[]`). Number the sheets
  by item index.
- **Frames** come from `final.mp4` at 25% and 75% of each item's span (mind a
  windowed render's offset; see 12a's window rule). Items outside a render
  window are skipped.
- **Sheets**: reuse `pick_shots`' contact sheets (`build_sheet` in
  `worker/lusora_worker/agents/pick_shots.py`, around line 142) instead of
  writing a second builder. Extend it if it needs a two-frames-per-row mode.
- **The call**: a new prompt role `visual_review` (register it everywhere;
  see the README list), its welded system text ported from `PEDIDO`, JSON out,
  called through `llm.see` with the channel's pick provider
  (`source_policy.visual.pick.llm`, a chain after 11a), under a budget gate
  with operation `llm.visual_review`. Validate the answer: item numbers must be
  on that sheet, problems one of the four. Drop anything else, with a note.
- **The repairs** go in the plan (keep the old plan as
  `edit_plan.before_review.json`):
  - `alheio` → add the asset's source video (`sources.Ledger.parent()`, or
    its asset id when there is no parent) to a new
    `visual_review.json` `banned` list, clear the asset on every item that
    used it, and resolve those items again through the same code path as
    `resolve_assets` (call its per-item fetch; don't duplicate it). The
    ledger must refuse banned sources: pass the banned set in.
  - `logo` → re-cut that item's clip with the corner crop. `pick_shots`
    already crops a judged logo (`crop_logos`, the `reframe()` helper in
    `sources.py`); reuse it.
  - `cortado` on an item under a graphic → drop that overlay (and its sfx
    cue).
  - `preto` → resolve the item again, excluding its current asset.
- Then `patch.changed_spans(old, new)` and `patch.patch_render(...)` from 12a.
  If it returns `False`, re-render the whole video.
- **One round only.** Write `visual_review.json`: what was found, what was
  done, and the patched spans. The stage is idempotent: when
  `visual_review.json` is newer than `final.mp4`, skip.
- **Empty frame**: in `resolve_assets`
  (`worker/lusora_worker/pipeline/steps.py`, `_place`), when an item would
  otherwise raise "source chain exhausted" and has a neighbour with an asset,
  copy the neighbour's asset (prefer the previous one), log it as a named
  degrade (`degrade.py` has the pattern), and don't fail. Off unless the new
  knob is on. The same knob covers both: `source_policy.visual.review`.

**Knob** (`channel_config.schema.json`, under `source_policy.visual`):
`"review": {"enabled": false, "never_empty": true}`. Manifest: add the
`visual_review` stage after `render` in `contracts/pipelines/documentary.yaml`,
bump the version, add a paragraph, and register it in `STEP_REGISTRY`.
When disabled, the stage writes `{"enabled": false}` and returns, like
`run_pick_shots` does.

## Tests

- Answer validation (unknown item, unknown problem, a non-array answer).
- Each repair on a hand-made plan: `alheio` bans the source across all its
  items; `logo` marks the crop; `cortado` drops the overlay and its cue;
  `preto` re-resolves, excluding the current asset.
- Disabled → no call, and the plan is untouched.
- Empty frame: a chain that finds nothing for item 3 → item 3 takes item 2's
  asset, and the event is logged.
- Idempotence: a second run with a fresh `visual_review.json` does nothing.

## Real check on Centralia

Fork `vid_dfd49c6c34e4` with `source_policy.visual.review.enabled: true`,
copying everything up to and including `final.mp4` (README recipe, plus
`edit_plan.json`, `clips/` with `cp -al`, and `final.mp4`). Only
`visual_review`, `qa` and `finalize` then run. Report what the model flagged
and look at each flagged item's frames yourself: was it right? The Centralia
footage includes YouTube clips; one with a channel logo is a likely true
positive.

## Docs

Next free D number; the plan: slice 12 `✅ BUILT`; `llm-usage.md` (the new
role); `pipeline.md` (the new version).
