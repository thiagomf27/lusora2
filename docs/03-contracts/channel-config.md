# Channel Config & Source Policy — Draft v1

A channel row in the DB, validated against the schema, edited on the
Channels screen. Per-video overrides deep-merge at enqueue; `chain` lists
replace wholesale (no list merging). Result is the immutable `cfg.json`.

```yaml
channel_id: HIST_BR_01
name: "Histórias da Guerra"
language: pt-BR
video_type: doc                    # selects default style pack
theme: history-dark
style_pack: doc-slow
component_pack: null               # or a named engine pack
pipeline: faceless                 # D60 — stage list; omit to let enqueue pick
voice: { provider: ai33, voice_id: "…" }
script: { generator: scriptforge, llm: deepseek }
captions: { enabled: true }        # preset comes from the theme
renderer: auto                     # auto | ffmpeg | remotion (pin)
budget: { max_usd_per_video: 0.80 }
retention: { clips: on_render, final_mp4_days_after_posted: 30 }

source_policy:
  visual:
    chain:
      - source: library
        media_types: [video_clip, image]
        profile: default
        include_global: true
        niches: [history, war]
        tags: []
        licenses: [cc0, cc-by, owned]     # anti-copyright rule (needs OQ-13)
        min_score: 0.55
      - source: stock
        providers: [pexels]
        media_types: [video]
      - source: ai_image
        provider: ai33
        style: "archival photo, desaturated, film grain"
    max_clip_seconds: 12
    orientation: landscape
    min_score_floor: 0.45             # D55 — under this, show a card, not a bad clip
    short_clip_fallback: [loop, freeze]  # D55 — footage shorter than the beat
    dedup:                            # D54 — the same shot twice in one video
      reuse_window_items: 0           # 0 = a segment is spent for the whole video
      min_hamming_distance: 6         # near-duplicate frames; 0 = off (default)
  sound_pack: doc-restrained          # optional; overrides theme.sound.pack
  music:
    enabled: true                     # master switch for this channel
    default_volume: 1                 # a TRIM on the theme's levels, not the level
  sfx:
    enabled: true                     # master switch
    default_gain: 0.28                # optional; overrides theme.sound.gain.sfx
```

## Semantics (Decided)

- `pipeline` (D60) names the stage list this channel's videos run
  (`contracts/pipelines/<name>.yaml`). Omitted, the selection resolver at
  enqueue picks one — today always `faceless`. Whichever wins, the whole
  manifest is embedded as `pipeline_doc` in the snapshot, beside
  `theme_doc` / `style_pack_doc` / `sound_pack_doc` and for the same
  reason (Principle 7): a later edit to the manifest never changes this
  video. See [Pipeline Manifest](pipeline.md).
- `visual.chain` order = preference; omission = forbidden. Per beat,
  `resolve_assets` walks the chain and stops at the first acceptable
  asset; `min_score` is what makes fallthrough honest (without it the
  library always returns *something*).
- Every library filter maps 1:1 to a `library_search` parameter — the
  policy is stored arguments, not a query language.
- `visual.dedup` (D54) is what keeps one video from showing the same thing
  twice. Beat resolution is independent per item, so nothing else stops two
  adjacent beats about the same subject from fetching the same clip. A source
  now walks its RANKED results and skips an asset id this video already used
  within `reuse_window_items` (0 = the whole video; a small window suits a thin
  library, where a callback four minutes later reads as a motif). Skipping is
  not failing: a used segment loses to the next result down, but still beats
  falling through to a worse source. `min_hamming_distance` adds a perceptual
  check on one frame — off by default, since it costs a wasted download per
  rejection — for the case ids cannot catch: the same drone pass sold twice.
- `music.enabled` / `sfx.enabled` are the **master switches for sound**
  (D48): with either false, nothing is produced for it whatever the theme
  and style pack say, and `resolve_audio` no-ops. Both default TRUE. Like
  every config field they deep-merge at enqueue, so silencing one video is
  an override and needs no code.
- `music.default_volume` is a **trim**, not a level: 1 means "as the theme
  mixed it". The absolute levels are `theme.sound.gain.music_duck` /
  `music_lift`, so the mix lives in one place. `music.chain` /
  `audio_library` remain declared and unimplemented — sound comes from the
  sound pack named here or in the theme, not from a source chain.
- `visual.min_score_floor` (D55) is the LAST word, where `chain[].min_score` is
  a per-source one: the first decides whether to fall through, this decides
  whether what the chain finally returned is worth showing. Under it, the item
  becomes a colour fill carrying the style pack's `fallback` card, which names
  the subject instead of showing something nearly unrelated. Only sources that
  return a score (the library) are judged — there is nothing to judge stock or
  a generated image by.
- `visual.short_clip_fallback` (D55) covers a slot longer than its footage.
  Before it the two renderers disagreed in silence: Remotion froze on the last
  frame, the ffmpeg path ran out and truncated the segment. `loop` is a plan
  field both now honour, `slow` ramps to at most 0.5x and forces the Remotion
  route (the ffmpeg profile rejects `speed != 1`), `freeze` is the old
  behaviour, kept for a channel that prefers it.
- Chain exhausted with nothing found → the stage FAILS with the beat id
  and query (consistent fail-loud; placeholder-and-flag rejected — silent
  gaps reach review).
- `qa` (D57) holds the post-render thresholds: how many frames to sample, what
  counts as black, flat, silent or clipping, and how far the finished file may
  drift from the voiceover's length. They are numbers on things ffmpeg
  measures, so loosening one is a channel decision rather than a code change;
  `qa.enabled: false` skips the stage entirely.
- `budget.max_usd_per_video` is enforced pre-spend by the cost gate (see
  [Costs](costs.md)); a video that would exceed it stops with an
  actionable event before generating.
- overlay density / pacing overrides ride the same merge (they live in
  the style pack section of the snapshot).
