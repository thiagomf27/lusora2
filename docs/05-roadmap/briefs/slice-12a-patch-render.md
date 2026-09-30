# Slice 12a: patch render (L). Use Opus, or have Opus review the diff

Read [the briefs README](README.md) first.

## Why this is the risky one

Every other brief adds a knob. This one changes how a finished video is
**rebuilt**, in both renderers. A frame off by one at a splice shows as a
flash on every repaired video, and nothing downstream would notice it. Test it
the way the "Proof" section says, not by eye alone.

## Goal

Today a fix to one shot means re-rendering the whole video (about 8–9 minutes
per rendered minute on this laptop). 12a makes it possible to re-render **only
the frames that changed** and splice them into the existing `final.mp4`.
[12b](slice-12b-visual-review.md) is its first user; a human edit in the
editor can use it later.

Done = an engine command `patch`, a worker helper that computes what to
patch from two plans, and the proof tests below. No pipeline stage changes
in 12a.

## Why it can work

Remotion renders are a pure function of the frame (seeded `random()`,
`OffthreadVideo`, no clocks). So the same plan renders the same pixels for
frame N whether frame N is rendered alone or inside the whole video. The
engine already renders a frame range: `frameRange()` in `engine/src/window.ts`,
used by `renderRemotion(plan, videoDir, window)` in
`engine/src/renderers/remotion/render.ts`. A patch is several windows plus a
splice.

## Design (decided)

**Engine command:**
`engine patch --video-dir <d> --spans <s1>-<e1>[,<s2>-<e2>...] [--audio keep|remix]`
in `engine/src/cli.ts`. Spans are in plan seconds.

1. Snap each span outward to whole frames at the plan's `fps`, pad it by
   `max(transition_out.duration_s)` of the items it touches on each side, and
   merge overlapping or touching spans.
2. Render each span with Remotion, **video only** (`muted: true` in
   `renderMedia`), to `patch_<k>.mp4` in a temp dir. Always use Remotion, even
   if the video was first rendered with ffmpeg: the router decides a
   renderer per plan. If the plan routes to ffmpeg, the command refuses with
   a clear message and the caller re-renders the whole video. Patching an
   ffmpeg render is out of scope.
3. **Splice** into a new video stream with one ffmpeg call, frame-accurate:
   `trim=start_frame=..:end_frame=..,setpts=PTS-STARTPTS` on the original for
   each untouched stretch, the patch files in between, then `concat`.
   Re-encode once with libx264 at the same pixel format and fps as the
   original (`crf 18`, `preset medium`). Assert the output frame count equals
   the original's.
4. **Audio:**
   - `keep`: copy the original audio stream unchanged;
   - `remix`: render the whole audio again with Remotion audio-only
     (`codec: "mp3"` or `"aac"` on the same composition; check the Remotion
     docs in `node_modules/@remotion/renderer` for audio-only rendering),
     then master it as `normalizeLoudness` does, honouring
     `plan.tracks.audio.master.loudness` (single or two_pass,
     `engine/src/renderers/loudness.ts`).
   The caller picks `remix` when any audio item or any overlay with a sound
   cue changed.
5. **A windowed test render.** When the video was rendered with
   `output.window`, `final.mp4`'s t=0 is the window's start. Read the window
   from `cfg.json` the way `render_window()` does in the worker (and
   `parseWindow` in `window.ts`), and shift the spans. A span outside the
   window is dropped.
6. Write `final.tmp.mp4` and rename it over `final.mp4` only after the frame
   count check passes (atomic, like `renderRemotion`).
7. Print one JSON line like `render` does:
   `{"patched": [[s,e],...], "frames": N, "audio": "keep|remix", "ok": true}`.

**Worker helper** `worker/lusora_worker/pipeline/patch.py`:
- `changed_spans(old_plan, new_plan) -> (spans, audio_changed)`:
  - visual items that differ in `asset`, `media_type`, `motion`,
    `transition_out`, `grade`, `crt` or `focus_y`, or that were
    added or removed;
  - overlays that differ in any field;
  - captions that differ;
  - `audio_changed` when `tracks.audio` differs, or an overlay that changed
    has an sfx cue whose `origin_id` is that overlay.
- `patch_render(ctx, old_plan, new_plan)`: when the item ids and timings are
  identical and only content changed, run the engine `patch` command (the
  same subprocess pattern as `run_render` in `steps.py`, around line 1632).
  Otherwise, when any item moved in time, return `False` so the caller does a
  full re-render. A retimed plan is not a patch.

## Proof (tests; all required)

Engine (`engine/test/patch.test.ts`):
- span math: snapping, padding by transitions, merging, the window shift, a
  span outside the window dropped;
- the splice on synthetic inputs, fast: make a 90-frame "original" from
  ffmpeg `testsrc` and a 20-frame "patch" from `color=red`; patch frames
  30–49; the result has 90 frames, frames 30–49 are red, and frames 0–29 and
  50–89 match the original (compare per-frame MD5 of decoded raw frames:
  `ffmpeg -i f.mp4 -f framemd5 -`, allowing the re-encode by comparing a
  downscaled grey version, or PSNR above 40 dB per frame).

End to end (a script, `engine/scripts/patch-check.mjs`, run by hand; it takes
a few minutes, so it's not in the unit suite):
1. Build a 6 s, 640×360 plan from `contracts/fixtures/edit_plan.json` with
   three colour or image shots and one overlay; render it fully (A).
2. Change shot 2's asset; render fully (B); patch A with shot 2's span (C).
3. Every frame of C matches B (PSNR above 40 dB, or SSIM above 0.99), and
   frames outside the span match A. Print the worst frame and its score.

Worker (`worker/tests/test_patch.py`): `changed_spans` on hand-made plan
pairs (a swapped asset, a changed overlay prop, a retimed item → a full
re-render, an sfx-bearing overlay → audio remix).

## Real check on Centralia (after the tests pass)

Fork `vid_dfd49c6c34e4` (README recipe, copying everything **including**
`edit_plan.json` and the `clips/` folder with `cp -al`, and `final.mp4` too).
Swap one shot's asset path in its `edit_plan.json` for another clip already in
`clips/`. Run `patch_render` for it directly (a short Python script with a
`StageContext`, not the pipeline). Then:
- time it, against 8–9 minutes for the full 60 s window;
- extract frames around both splice points (±3 frames) and look at them;
- run the QA check (`run_qa`) on the result.

## Docs

Next free D number: the design, the determinism argument, the ffmpeg-plan
limit, and the measured time. `docs/02-components/engine.md`: the `patch`
command. The plan: slice 12's first half built.
